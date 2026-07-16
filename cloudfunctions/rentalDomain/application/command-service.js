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
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  if (value && value.$date) return new Date(value.$date)
  return value ? new Date(value) : new Date()
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate())
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatPeriod(start, end) {
  if (start.getTime() === end.getTime()) return formatDateKey(start)
  return `${formatDateKey(start)}~${formatDateKey(end)}`
}

function parsePeriodEnd(period) {
  if (typeof period !== 'string' || !period.includes('~')) return null
  const dateMatches = period.match(/\d{4}-\d{2}-\d{2}/g)
  if (dateMatches && dateMatches.length) return parseDateInput(dateMatches[dateMatches.length - 1])
  const monthMatches = period.match(/\d{4}-\d{2}/g)
  if (monthMatches && monthMatches.length) {
    const [year, month] = monthMatches[monthMatches.length - 1].split('-').map(Number)
    return new Date(year, month, 0)
  }
  const [, end] = period.split('~')
  return end ? parseDateInput(end.trim()) : null
}

function inferBillMonthsFromAmount(bill, lease) {
  const monthlyRent = number(lease && lease.rent)
  const amount = number(bill && bill.amount)
  if (monthlyRent <= 0 || amount <= 0) return 1
  return Math.max(1, Math.round(amount / monthlyRent))
}

function inferRentBillCoverage(bill, lease) {
  const start = parseDateInput(bill.rentCoverageStart || bill.dueDate)
  let end = bill.rentCoverageEnd ? parseDateInput(bill.rentCoverageEnd) : parsePeriodEnd(bill.period)
  if (!end || Number.isNaN(end.getTime())) {
    if (Number(bill.coverageMonths || 0) > 0) {
      end = addDays(addMonths(start, Number(bill.coverageMonths)), -1)
    } else if (Number(bill.coverageDays || 0) > 0) {
      end = addDays(start, Number(bill.coverageDays) - 1)
    } else {
      end = addDays(addMonths(start, inferBillMonthsFromAmount(bill, lease)), -1)
    }
  }
  return { start, end }
}

function isOverlappingCoverage(left, right) {
  return left.start.getTime() <= right.end.getTime() && left.end.getTime() >= right.start.getTime()
}

function advanceCursorByPaidCoverages(cursor, coverages) {
  let current = cursor
  let advanced = true
  const rows = coverages.slice().sort((a, b) => a.start.getTime() - b.start.getTime())
  while (advanced) {
    advanced = false
    for (const item of rows) {
      if (item.start.getTime() <= current.getTime() && item.end.getTime() >= current.getTime()) {
        current = addDays(item.end, 1)
        advanced = true
      }
    }
  }
  return current
}

function monthSpan(start, end) {
  for (let months = 1; months <= 240; months += 1) {
    if (addDays(addMonths(start, months), -1).getTime() === end.getTime()) return months
  }
  return 0
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
      const rentBillRes = await transaction.collection('bills')
        .where({ leaseId: input.leaseId, type: 'rent', _openid: caller.openId })
        .get()
      const now = new Date()
      const paymentDate = input.paymentDate ? parseDateInput(input.paymentDate) : now
      const targetCoverage = { start: calc.coverageStart, end: calc.coverageEnd }
      const rentBills = rentBillRes.data || []
      const payableBills = rentBills
        .map(bill => ({ bill, coverage: inferRentBillCoverage(bill, lease) }))
        .filter(item => item.bill.status !== 'paid')
        .filter(item => number(number(item.bill.amount) - number(item.bill.paidAmount)) > 0)
        .filter(item => isOverlappingCoverage(item.coverage, targetCoverage))
        .sort((a, b) => a.coverage.start.getTime() - b.coverage.start.getTime())

      let remainingPayment = number(calc.amount)
      const payments = []
      const paidBills = []
      const createdBills = []
      const paidCoverages = []

      async function addPaymentForBill(bill, amount, remark) {
        const paymentData = {
          _openid: caller.openId,
          billId: bill._id,
          leaseId: bill.leaseId,
          houseId: bill.houseId,
          tenantId: bill.tenantId,
          amount,
          direction: 'in',
          paymentDate,
          paymentMethod: input.paymentMethod || 'cash',
          remark,
          createdAt: now
        }
        const paymentRes = await transaction.collection('payments').add(paymentData)
        const payment = { ...paymentData, _id: paymentRes.id || paymentRes._id }
        payments.push(payment)
        return payment
      }

      for (const item of payableBills) {
        if (remainingPayment <= 0) break
        const billAmount = number(item.bill.amount)
        const oldPaidAmount = number(item.bill.paidAmount)
        const billRemaining = number(billAmount - oldPaidAmount)
        const paymentAmount = number(Math.min(remainingPayment, billRemaining))
        const newPaidAmount = number(oldPaidAmount + paymentAmount)
        const newStatus = newPaidAmount >= billAmount ? 'paid' : 'partial'
        await addPaymentForBill(item.bill, paymentAmount, input.paymentMethod === 'wechat' ? '线下微信收款记账：结清已有租金账单' : '提前收租：结清已有租金账单')
        await transaction.collection('bills').where({ _id: item.bill._id, _openid: caller.openId }).update({
          paidAmount: newPaidAmount,
          status: newStatus,
          paidAt: newStatus === 'paid' ? now : item.bill.paidAt,
          updatedAt: now
        })
        const updatedBill = {
          ...item.bill,
          paidAmount: newPaidAmount,
          status: newStatus,
          paidAt: newStatus === 'paid' ? now : item.bill.paidAt,
          updatedAt: now
        }
        paidBills.push(updatedBill)
        if (newStatus === 'paid') paidCoverages.push(item.coverage)
        remainingPayment = number(remainingPayment - paymentAmount)
      }

      if (remainingPayment > 0) {
        const futureStart = advanceCursorByPaidCoverages(calc.coverageStart, paidCoverages)
        invariant(futureStart.getTime() <= calc.coverageEnd.getTime(), 'CONFLICT', '该周期租金已结清')
        const futureEnd = calc.coverageEnd
        const futureMonths = monthSpan(futureStart, futureEnd)
        const billData = {
          _openid: caller.openId,
          leaseId: input.leaseId,
          houseId: lease.houseId,
          tenantId: lease.tenantId,
          type: 'rent',
          period: formatPeriod(futureStart, futureEnd),
          amount: remainingPayment,
          paidAmount: remainingPayment,
          status: 'paid',
          dueDate: futureStart,
          rentCoverageStart: futureStart,
          rentCoverageEnd: futureEnd,
          coverageMonths: futureMonths,
          coverageDays: futureMonths > 0 ? 0 : Math.max(1, Math.ceil((futureEnd.getTime() - futureStart.getTime()) / (1000 * 60 * 60 * 24)) + 1),
          remark: '提前收租',
          paidAt: now,
          createdAt: now,
          updatedAt: now
        }
        const billRes = await transaction.collection('bills').add(billData)
        const bill = { ...billData, _id: billRes.id || billRes._id }
        createdBills.push(bill)
        paidBills.push(bill)
        paidCoverages.push({ start: futureStart, end: futureEnd })
        await addPaymentForBill(bill, remainingPayment, input.paymentMethod === 'wechat' ? '线下微信收款记账' : '提前收租')
        remainingPayment = 0
      }

      const cursor = advanceCursorByPaidCoverages(calc.coverageStart, paidCoverages)
      const coveredUntil = addDays(cursor, -1)
      const oldCoveredUntil = lease.rentCoveredUntil ? parseDateInput(lease.rentCoveredUntil) : null
      if (paidCoverages.length && (!oldCoveredUntil || oldCoveredUntil.getTime() < coveredUntil.getTime())) {
        await transaction.collection('lease_agreements').where({ _id: input.leaseId, _openid: caller.openId }).update({
          rentCoveredUntil: coveredUntil,
          nextRentDueDate: addDays(coveredUntil, 1),
          updatedAt: now
        })
      }

      await transaction.commit()
      const primaryBill = createdBills[0] || paidBills[0] || null
      const totalPaidAmount = number(payments.reduce((sum, payment) => sum + number(payment.amount), 0))
      const fullyCovered = coveredUntil.getTime() >= calc.coverageEnd.getTime()
      return {
        billId: primaryBill && primaryBill._id,
        paymentId: payments[0] && payments[0]._id,
        bill: primaryBill,
        payment: payments[0] || null,
        billCreated: createdBills.length > 0,
        createdBillIds: createdBills.map(item => item._id),
        settledBillIds: paidBills.filter(item => !createdBills.some(created => created._id === item._id)).map(item => item._id),
        paidAmount: totalPaidAmount,
        totalAmount: calc.amount,
        status: fullyCovered ? 'paid' : 'partial',
        remaining: number(calc.amount - totalPaidAmount),
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
