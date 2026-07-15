const { invariant } = require('../infrastructure/errors')
const { idempotencyKey, loadPendingConfirmation, findExecutedOperation } = require('../infrastructure/idempotency')
const { createRepository } = require('../repositories/rental-repository')
const { number } = require('../domain/presenters')
const { buildMoveOutSettlementSnapshot, buildPrepayRentSnapshot, calculatePrepayPeriod } = require('./preview-service')

async function legacyCall(app, name, data) {
  const res = await app.callFunction({ name, data })
  const result = res.result || {}
  if (result.code && result.code !== 200 && result.code !== 0) {
    const error = new Error(result.message || `${name} 调用失败`)
    error.code = result.code
    throw error
  }
  return Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result
}

function cleanParams(params) {
  const out = { ...(params || {}) }
  delete out.confirmationId
  return out
}

function sameValue(left, right) {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  return String(left) === String(right)
}

function assertConfirmationParamsNotOverridden(action, params, confirmation) {
  if (!['settleMoveOut', 'confirmPrepayRent'].includes(action)) return
  const supplied = cleanParams(params)
  const normalized = confirmation.normalizedInput || {}
  const changedKeys = Object.keys(supplied).filter(key => !sameValue(supplied[key], normalized[key]))
  invariant(changedKeys.length === 0, 'VALIDATION_ERROR', '确认参数与预览记录不一致，请重新生成预览')
}

function normalizeMoveOutParams(params) {
  const out = cleanParams(params)
  if (!out.endDate && out.moveOutDate) out.endDate = out.moveOutDate
  if (out.moveOutElectricity !== undefined && out.electricityReading === undefined) out.electricityReading = out.moveOutElectricity
  if (out.moveOutWater !== undefined && out.waterReading === undefined) out.waterReading = out.moveOutWater
  return out
}

function parseDateInput(value) {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  if (value && value.$date) return new Date(value.$date)
  return value ? new Date(value) : new Date()
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function createCommandService(app, db) {
  const repo = createRepository(db)

  async function resolveParams(params, caller, action) {
    if (!params || !params.confirmationId) return { input: cleanParams(params), confirmation: null, key: '' }

    const key = idempotencyKey(action, params.confirmationId)
    const executed = await findExecutedOperation(db, caller, key)
    if (executed) return { replay: true, key, result: executed.summary && executed.summary.result }

    const confirmation = await loadPendingConfirmation(db, caller, action, params.confirmationId)
    assertConfirmationParamsNotOverridden(action, params, confirmation)
    return { input: { ...(confirmation.normalizedInput || {}) }, confirmation, key }
  }

  async function markConfirmation(confirmationId, patch) {
    if (!confirmationId) return
    await db.collection('operation_confirmations').doc(confirmationId).update(patch)
  }

  async function markExecuting(confirmationId) {
    await markConfirmation(confirmationId, { status: 'executing', executingAt: new Date() })
  }

  async function markPendingAfterFailure(confirmationId) {
    await markConfirmation(confirmationId, { status: 'pending', executingAt: null })
  }

  async function markExecuted(confirmationId, result) {
    await markConfirmation(confirmationId, {
      status: 'executed',
      executedAt: new Date(),
      result
    })
  }

  async function assertMoveOutConfirmationFresh(input, caller, confirmation) {
    if (!confirmation) return
    invariant(confirmation.targetId === input.leaseId, 'VALIDATION_ERROR', '确认记录与合同不匹配')
    invariant(confirmation.sourceDigest, 'STALE_CONFIRMATION', '退租预览已过期，请重新生成预览')
    const snapshot = await buildMoveOutSettlementSnapshot(repo.forOwner(caller.openId), input)
    invariant(snapshot.sourceDigest === confirmation.sourceDigest, 'STALE_CONFIRMATION', '退租数据已变化，请重新生成预览')
  }

  async function assertPrepayConfirmationFresh(input, caller, confirmation) {
    invariant(confirmation, 'VALIDATION_ERROR', '提前收租必须先生成预览确认记录')
    invariant(confirmation.targetId === input.leaseId, 'VALIDATION_ERROR', '确认记录与合同不匹配')
    invariant(confirmation.sourceDigest, 'STALE_CONFIRMATION', '提前收租预览已过期，请重新生成预览')
    const snapshot = await buildPrepayRentSnapshot(repo.forOwner(caller.openId), input)
    invariant(snapshot.sourceDigest === confirmation.sourceDigest, 'STALE_CONFIRMATION', '提前收租数据已变化，请重新生成预览')
  }

  async function executePrepayRent(input, caller) {
    const transaction = await db.startTransaction()
    try {
      const leaseRes = await transaction.collection('lease_agreements')
        .where({ _id: input.leaseId, _openid: caller.openId })
        .get()
      const lease = leaseRes.data && leaseRes.data[0]
      invariant(lease, 'FORBIDDEN', '不能操作其他用户的合同')
      invariant(lease.status === 'active', 'CONFLICT', '合同不是生效状态')

      const calc = calculatePrepayPeriod(lease, input)
      const existingRes = await transaction.collection('bills')
        .where({ leaseId: input.leaseId, type: 'rent', period: calc.period, _openid: caller.openId })
        .get()
      const existingBill = existingRes.data && existingRes.data[0]
      invariant(!existingBill || existingBill.status !== 'paid', 'CONFLICT', '该周期租金账单已全额支付')

      const now = new Date()
      let bill = existingBill
      let billCreated = false
      if (!bill) {
        const billData = {
          _openid: caller.openId,
          leaseId: input.leaseId,
          houseId: lease.houseId,
          tenantId: lease.tenantId,
          type: 'rent',
          period: calc.period,
          amount: calc.amount,
          paidAmount: 0,
          status: 'unpaid',
          dueDate: calc.coverageStart,
          rentCoverageStart: calc.coverageStart,
          rentCoverageEnd: calc.coverageEnd,
          coverageMonths: calc.coverageMonths,
          coverageDays: calc.coverageDays,
          remark: '提前收租',
          createdAt: now,
          updatedAt: now
        }
        const billRes = await transaction.collection('bills').add(billData)
        bill = { ...billData, _id: billRes.id || billRes._id }
        billCreated = true
      }

      const billAmount = number(bill.amount)
      const oldPaidAmount = number(bill.paidAmount)
      const paymentAmount = number(billAmount - oldPaidAmount)
      invariant(paymentAmount > 0, 'CONFLICT', '该周期租金已结清')
      const newPaidAmount = number(oldPaidAmount + paymentAmount)
      invariant(newPaidAmount <= billAmount, 'VALIDATION_ERROR', '缴费金额超出应缴金额')
      const newStatus = newPaidAmount >= billAmount ? 'paid' : 'partial'

      const paymentData = {
        _openid: caller.openId,
        billId: bill._id,
        leaseId: bill.leaseId,
        houseId: bill.houseId,
        tenantId: bill.tenantId,
        amount: paymentAmount,
        direction: 'in',
        paymentDate: input.paymentDate ? parseDateInput(input.paymentDate) : now,
        paymentMethod: input.paymentMethod || 'cash',
        remark: input.paymentMethod === 'wechat' ? '线下微信收款记账' : '提前收租',
        createdAt: now
      }
      const paymentRes = await transaction.collection('payments').add(paymentData)

      await transaction.collection('bills').where({ _id: bill._id, _openid: caller.openId }).update({
        paidAmount: newPaidAmount,
        status: newStatus,
        paidAt: newStatus === 'paid' ? now : bill.paidAt,
        updatedAt: now
      })

      if (newStatus === 'paid') {
        const coveredUntil = bill.rentCoverageEnd ? parseDateInput(bill.rentCoverageEnd) : calc.coverageEnd
        const oldCoveredUntil = lease.rentCoveredUntil ? parseDateInput(lease.rentCoveredUntil) : null
        if (!oldCoveredUntil || oldCoveredUntil.getTime() <= coveredUntil.getTime()) {
          await transaction.collection('lease_agreements').where({ _id: input.leaseId, _openid: caller.openId }).update({
            rentCoveredUntil: coveredUntil,
            nextRentDueDate: addDays(coveredUntil, 1),
            updatedAt: now
          })
        }
      }

      await transaction.commit()
      return {
        billId: bill._id,
        paymentId: paymentRes.id || paymentRes._id,
        bill: {
          ...bill,
          paidAmount: newPaidAmount,
          status: newStatus,
          paidAt: newStatus === 'paid' ? now : bill.paidAt,
          updatedAt: now
        },
        payment: { ...paymentData, _id: paymentRes.id || paymentRes._id },
        billCreated,
        paidAmount: newPaidAmount,
        totalAmount: billAmount,
        status: newStatus,
        remaining: number(billAmount - newPaidAmount),
        paymentMethod: input.paymentMethod || 'cash',
        paymentDate: input.paymentDate || ''
      }
    } catch (err) {
      await transaction.rollback()
      throw err
    }
  }

  async function runLegacy(params, caller, action, legacyName, mapParams = cleanParams) {
    invariant(caller && caller.openId, 'FORBIDDEN', '缺少调用者身份')
    const resolved = await resolveParams(params, caller, action)
    if (resolved.replay) return { replayed: true, idempotencyKey: resolved.key, result: resolved.result }

    if (action === 'settleMoveOut' && resolved.confirmation) {
      await assertMoveOutConfirmationFresh(resolved.input, caller, resolved.confirmation)
      await markExecuting(params.confirmationId)
    }
    const input = mapParams(resolved.input)
    try {
      await assertLegacyTargetOwner(action, input, caller)
      const result = await legacyCall(app, legacyName, input)
      if (resolved.confirmation) await markExecuted(params.confirmationId, result)
      return { ...result, confirmationId: params && params.confirmationId, idempotencyKey: resolved.key }
    } catch (err) {
      if (action === 'settleMoveOut' && resolved.confirmation) await markPendingAfterFailure(params.confirmationId)
      throw err
    }
  }

  async function assertOwned(collection, id, caller, label) {
    invariant(id, 'VALIDATION_ERROR', `缺少${label} ID`)
    const res = await db.collection(collection).where({ _id: id, _openid: caller.openId }).limit(1).get()
    invariant(res && res.data && res.data[0], 'FORBIDDEN', `不能操作其他用户的${label}`)
  }

  async function assertLegacyTargetOwner(action, input, caller) {
    if (action === 'confirmCreateLease') {
      await Promise.all([
        assertOwned('houses', input.houseId, caller, '房屋'),
        assertOwned('tenants', input.tenantId, caller, '租客')
      ])
      return
    }
    if (action === 'confirmCollectRent') {
      await assertOwned('bills', input.billId, caller, '账单')
      return
    }
    if (['confirmRenewLease', 'confirmMeterReading', 'settleMoveOut'].includes(action)) {
      await assertOwned('lease_agreements', input.leaseId, caller, '合同')
    }
  }

  async function runDirect(params, caller, action, executor) {
    invariant(caller && caller.openId, 'FORBIDDEN', '缺少调用者身份')
    const resolved = await resolveParams(params, caller, action)
    if (resolved.replay) return { replayed: true, idempotencyKey: resolved.key, result: resolved.result }

    const result = await executor(cleanParams(resolved.input), caller)
    if (resolved.confirmation) await markExecuted(params.confirmationId, result)
    return { ...result, confirmationId: params && params.confirmationId, idempotencyKey: resolved.key }
  }

  async function confirmPrepayRent(params, caller) {
    invariant(params && params.confirmationId, 'VALIDATION_ERROR', '提前收租必须从页面确认记录执行')
    invariant(caller && caller.openId, 'FORBIDDEN', '缺少调用者身份')
    const resolved = await resolveParams(params, caller, 'confirmPrepayRent')
    if (resolved.replay) return { replayed: true, idempotencyKey: resolved.key, result: resolved.result }
    await assertPrepayConfirmationFresh(resolved.input, caller, resolved.confirmation)
    await markExecuting(params.confirmationId)
    try {
      const result = await executePrepayRent(resolved.input, caller)
      await markExecuted(params.confirmationId, result)
      return { ...result, confirmationId: params.confirmationId, idempotencyKey: resolved.key }
    } catch (err) {
      await markPendingAfterFailure(params.confirmationId)
      throw err
    }
  }

  async function createHouse(params, caller) {
    invariant(params.code, 'VALIDATION_ERROR', '缺少房屋编号')
    invariant(params.address, 'VALIDATION_ERROR', '缺少房屋地址')
    invariant(Number(params.rent) > 0, 'VALIDATION_ERROR', '月租金必须大于 0')
    const now = new Date()
    const data = {
      _openid: caller.openId,
      code: String(params.code).trim(),
      address: String(params.address).trim(),
      rent: Number(params.rent),
      status: params.status || 'available',
      createdAt: now,
      updatedAt: now
    }
    const res = await db.collection('houses').add(data)
    return { houseId: res.id || res._id, house: data }
  }

  async function createTenant(params, caller) {
    invariant(params.name, 'VALIDATION_ERROR', '缺少租客姓名')
    const now = new Date()
    const data = {
      _openid: caller.openId,
      name: String(params.name).trim(),
      idCard: params.idCard || '',
      phone: params.phone || '',
      remark: params.remark || '',
      status: params.status || 'inactive',
      createdAt: now,
      updatedAt: now
    }
    const res = await db.collection('tenants').add(data)
    return { tenantId: res.id || res._id, tenant: data }
  }

  return {
    confirmCreateHouse(params, caller) {
      return runDirect(params, caller, 'confirmCreateHouse', createHouse)
    },
    confirmCreateTenant(params, caller) {
      return runDirect(params, caller, 'confirmCreateTenant', createTenant)
    },
    confirmCreateLease(params, caller) {
      return runLegacy(params, caller, 'confirmCreateLease', 'createLeaseAgreement')
    },
    confirmRenewLease(params, caller) {
      return runLegacy(params, caller, 'confirmRenewLease', 'createNextRentBill')
    },
    confirmPrepayRent,
    confirmCollectRent(params, caller) {
      return runLegacy(params, caller, 'confirmCollectRent', 'payBill')
    },
    confirmMeterReading(params, caller) {
      return runLegacy(params, caller, 'confirmMeterReading', 'addUtilityRecord')
    },
    settleMoveOut(params, caller) {
      return runLegacy(params, caller, 'settleMoveOut', 'terminateLease', normalizeMoveOutParams)
    }
  }
}

module.exports = { createCommandService }
