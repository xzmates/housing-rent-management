const { invariant } = require('../infrastructure/errors')
const { idempotencyKey, loadPendingConfirmation, findExecutedOperation } = require('../infrastructure/idempotency')
const { createRepository } = require('../repositories/rental-repository')
const { number } = require('../domain/presenters')
const rentCoverage = require('../domain/rent-coverage')
const {
  buildMoveOutSettlementSnapshot,
  buildPrepayRentSnapshot,
  buildRentCollectionSnapshot,
  buildRentCollectionPlan
} = require('./preview-service')

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
  if (!['settleMoveOut', 'confirmPrepayRent', 'confirmRentCollection'].includes(action)) return
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
  return rentCoverage.parseDateInput(value) || new Date()
}

function addDays(date, days) {
  return rentCoverage.addDays(date, days)
}

function addMonths(date, months) {
  return rentCoverage.addMonths(date, months)
}

function formatDateKey(date) {
  return rentCoverage.formatDateKey(date)
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
    invariant(!snapshot.needPeriod, 'STALE_CONFIRMATION', '提前收租预览已过期，请重新生成预览')
    invariant(snapshot.sourceDigest === confirmation.sourceDigest, 'STALE_CONFIRMATION', '提前收租数据已变化，请重新生成预览')
  }

  async function assertRentCollectionConfirmationFresh(input, caller, confirmation) {
    invariant(confirmation, 'VALIDATION_ERROR', '租金收款必须先生成预览确认记录')
    invariant(confirmation.targetId === input.leaseId, 'VALIDATION_ERROR', '确认记录与合同不匹配')
    invariant(confirmation.sourceDigest, 'STALE_CONFIRMATION', '租金收款预览已过期，请重新生成预览')
    const snapshot = await buildRentCollectionSnapshot(repo.forOwner(caller.openId), input)
    invariant(!snapshot.needPeriod, 'STALE_CONFIRMATION', '租金收款预览已过期，请重新生成预览')
    invariant(snapshot.sourceDigest === confirmation.sourceDigest, 'STALE_CONFIRMATION', '租金收款数据已变化，请重新生成预览')
  }

  function groupNewBillAllocations(allocations = []) {
    const grouped = []
    let cursor = 0
    while (cursor < allocations.length) {
      const item = allocations[cursor]
      if (item.source !== 'new') {
        grouped.push(item)
        cursor += 1
        continue
      }
      const group = { ...item }
      cursor += 1
      while (cursor < allocations.length && allocations[cursor].source === 'new') {
        const next = allocations[cursor]
        group.periodEnd = next.periodEnd
        group.period = formatPeriod(parseDateInput(group.periodStart), parseDateInput(group.periodEnd))
        group.receivableAmount = number(group.receivableAmount + next.receivableAmount)
        group.allocationAmount = number(group.allocationAmount + next.allocationAmount)
        group.coverageMonths = Number(group.coverageMonths || 0) + Number(next.coverageMonths || 0)
        cursor += 1
      }
      grouped.push(group)
    }
    return grouped
  }

  async function executeRentCollection(input, caller, collectionId = '', options = {}) {
    const transaction = await db.startTransaction()
    try {
      const leaseRes = await transaction.collection('lease_agreements')
        .where({ _id: input.leaseId, _openid: caller.openId })
        .get()
      const lease = leaseRes.data && leaseRes.data[0]
      invariant(lease, 'FORBIDDEN', '不能操作其他用户的合同')
      invariant(lease.status === 'active', 'CONFLICT', '合同不是生效状态')

      const rentBillRes = await transaction.collection('bills')
        .where({ leaseId: input.leaseId, type: 'rent', _openid: caller.openId })
        .get()
      const now = new Date()
      const paymentDate = input.paymentDate ? parseDateInput(input.paymentDate) : now
      const rentBills = rentBillRes.data || []
      const plan = buildRentCollectionPlan(lease, rentBills, input)
      const payments = []
      const paidBills = []
      const createdBills = []

      async function addPaymentForBill(bill, amount, remark) {
        const paymentData = {
          _openid: caller.openId,
          collectionId,
          confirmationId: collectionId,
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

      const executableAllocations = options.groupNewBills
        ? groupNewBillAllocations(plan.allocations)
        : plan.allocations

      for (const allocation of executableAllocations) {
        if (number(allocation.allocationAmount) <= 0) continue
        if (allocation.source === 'existing') {
          const bill = rentBills.find(item => item._id === allocation.billId)
          invariant(bill, 'STALE_CONFIRMATION', '租金账单已变化，请重新生成预览')
          const billAmount = number(bill.amount)
          const newPaidAmount = number(number(bill.paidAmount) + number(allocation.allocationAmount))
          invariant(newPaidAmount <= billAmount, 'VALIDATION_ERROR', '收款金额超出账单待收金额')
          const newStatus = newPaidAmount >= billAmount ? 'paid' : 'partial'
          await addPaymentForBill(bill, allocation.allocationAmount, input.note || '租金收款登记：结清已有租金账单')
          await transaction.collection('bills').where({ _id: bill._id, _openid: caller.openId }).update({
            paidAmount: newPaidAmount,
            status: newStatus,
            paidAt: newStatus === 'paid' ? now : bill.paidAt,
            updatedAt: now
          })
          paidBills.push({
            ...bill,
            paidAmount: newPaidAmount,
            status: newStatus,
            paidAt: newStatus === 'paid' ? now : bill.paidAt,
            updatedAt: now
          })
          continue
        }

        const periodStart = parseDateInput(allocation.periodStart)
        const periodEnd = parseDateInput(allocation.periodEnd)
        const billData = {
          _openid: caller.openId,
          leaseId: input.leaseId,
          houseId: lease.houseId,
          tenantId: lease.tenantId,
          type: 'rent',
          period: allocation.period,
          amount: allocation.receivableAmount,
          paidAmount: allocation.allocationAmount,
          status: 'paid',
          dueDate: periodStart,
          rentCoverageStart: periodStart,
          rentCoverageEnd: periodEnd,
          coverageMonths: allocation.coverageMonths,
          coverageDays: 0,
          remark: input.note || '租金收款登记',
          paidAt: now,
          createdAt: now,
          updatedAt: now
        }
        const billRes = await transaction.collection('bills').add(billData)
        const bill = { ...billData, _id: billRes.id || billRes._id }
        createdBills.push(bill)
        paidBills.push(bill)
        await addPaymentForBill(bill, allocation.allocationAmount, input.note || '租金收款登记')
      }

      const coveredUntil = plan.projectedRentCoveredUntil
      if (coveredUntil) {
        await transaction.collection('lease_agreements').where({ _id: input.leaseId, _openid: caller.openId }).update({
          rentCoveredUntil: coveredUntil,
          nextRentDueDate: addDays(coveredUntil, 1),
          updatedAt: now
        })
      }

      await transaction.commit()
      const primaryBill = createdBills[0] || paidBills[0] || null
      const totalPaidAmount = number(payments.reduce((sum, payment) => sum + number(payment.amount), 0))
      return {
        collectionId,
        billId: primaryBill && primaryBill._id,
        paymentId: payments[0] && payments[0]._id,
        paymentIds: payments.map(item => item._id),
        bill: primaryBill,
        payment: payments[0] || null,
        billCreated: createdBills.length > 0,
        createdBillIds: createdBills.map(item => item._id),
        settledBillIds: paidBills.filter(item => !createdBills.some(created => created._id === item._id)).map(item => item._id),
        paidAmount: totalPaidAmount,
        totalAmount: plan.totalCollectionAmount,
        status: 'paid',
        remaining: 0,
        paymentMethod: input.paymentMethod || 'cash',
        paymentDate: input.paymentDate || '',
        rentCoveredUntil: coveredUntil ? formatDateKey(coveredUntil) : '',
        nextRentDueDate: coveredUntil ? formatDateKey(addDays(coveredUntil, 1)) : '',
        allocations: executableAllocations
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
      const result = await executeRentCollection(resolved.input, caller, params.confirmationId, { groupNewBills: true })
      await markExecuted(params.confirmationId, result)
      return { ...result, confirmationId: params.confirmationId, idempotencyKey: resolved.key }
    } catch (err) {
      await markPendingAfterFailure(params.confirmationId)
      throw err
    }
  }

  async function confirmRentCollection(params, caller) {
    invariant(params && params.confirmationId, 'VALIDATION_ERROR', '租金收款必须从页面确认记录执行')
    invariant(caller && caller.openId, 'FORBIDDEN', '缺少调用者身份')
    const resolved = await resolveParams(params, caller, 'confirmRentCollection')
    if (resolved.replay) return { replayed: true, idempotencyKey: resolved.key, result: resolved.result }
    await assertRentCollectionConfirmationFresh(resolved.input, caller, resolved.confirmation)
    await markExecuting(params.confirmationId)
    try {
      const result = await executeRentCollection(resolved.input, caller, params.confirmationId)
      await markExecuted(params.confirmationId, result)
      return { ...result, confirmationId: params.confirmationId, idempotencyKey: resolved.key }
    } catch (err) {
      await markPendingAfterFailure(params.confirmationId)
      throw err
    }
  }

  async function collectSingleBillPayment(params, caller) {
    invariant(params && params.billId, 'VALIDATION_ERROR', '缺少账单 ID')
    invariant(Number(params.amount) > 0, 'VALIDATION_ERROR', '请输入有效金额')
    const transaction = await db.startTransaction()
    try {
      const billRes = await transaction.collection('bills')
        .where({ _id: params.billId, _openid: caller.openId })
        .get()
      const bill = billRes.data && billRes.data[0]
      invariant(bill, 'FORBIDDEN', '不能操作其他用户的账单')
      invariant(bill.status !== 'paid', 'VALIDATION_ERROR', '该账单已全额支付')

      const amount = number(params.amount)
      const remainingBefore = number(number(bill.amount) - number(bill.paidAmount))
      invariant(amount <= remainingBefore, 'VALIDATION_ERROR', `超额缴费，缴费金额超出应缴金额，最多可缴 ${remainingBefore} 元`)

      const now = new Date()
      const paymentDate = params.paymentDate ? parseDateInput(params.paymentDate) : now
      const paymentData = {
        _openid: caller.openId,
        billId: bill._id,
        leaseId: bill.leaseId,
        houseId: bill.houseId,
        tenantId: bill.tenantId,
        amount,
        direction: 'in',
        paymentDate,
        paymentMethod: params.paymentMethod || 'cash',
        remark: params.remark || '',
        createdAt: now
      }
      const paymentRes = await transaction.collection('payments').add(paymentData)
      const paymentId = paymentRes.id || paymentRes._id

      const inc = db.command && db.command.inc ? db.command.inc(amount) : amount
      await transaction.collection('bills').where({ _id: bill._id, _openid: caller.openId }).update({
        paidAmount: inc,
        updatedAt: now
      })
      const latestBillRes = await transaction.collection('bills')
        .where({ _id: bill._id, _openid: caller.openId })
        .get()
      const latestBill = latestBillRes.data && latestBillRes.data[0]
      const newPaidAmount = number(latestBill && latestBill.paidAmount)
      const newStatus = newPaidAmount >= number(bill.amount) ? 'paid' : 'partial'
      const updatedBill = {
        ...bill,
        paidAmount: newPaidAmount,
        status: newStatus,
        paidAt: newStatus === 'paid' ? now : bill.paidAt,
        updatedAt: now
      }
      await transaction.collection('bills').where({ _id: bill._id, _openid: caller.openId }).update({
        status: updatedBill.status,
        paidAt: updatedBill.paidAt,
        updatedAt: updatedBill.updatedAt
      })

      let coverageResult = null
      if (bill.type === 'rent') {
        const leaseRes = await transaction.collection('lease_agreements')
          .where({ _id: bill.leaseId, _openid: caller.openId })
          .get()
        const lease = leaseRes.data && leaseRes.data[0]
        invariant(lease, 'FORBIDDEN', '不能操作其他用户的合同')
        const rentBillRes = await transaction.collection('bills')
          .where({ leaseId: bill.leaseId, type: 'rent', _openid: caller.openId })
          .get()
        const updatedRentBills = (rentBillRes.data || []).map(item => item._id === bill._id ? updatedBill : item)
        coverageResult = rentCoverage.recalculateContinuousRentCoverage(lease, updatedRentBills)
        await transaction.collection('lease_agreements').where({ _id: bill.leaseId, _openid: caller.openId }).update({
          rentCoveredUntil: coverageResult.rentCoveredUntil,
          nextRentDueDate: coverageResult.nextRentDueDate,
          updatedAt: now
        })
      }

      await transaction.commit()
      return {
        billId: bill._id,
        paymentId,
        paidAmount: newPaidAmount,
        totalAmount: bill.amount,
        status: newStatus,
        remaining: number(number(bill.amount) - newPaidAmount),
        rentCoveredUntil: coverageResult && coverageResult.rentCoveredUntil ? formatDateKey(coverageResult.rentCoveredUntil) : '',
        nextRentDueDate: coverageResult && coverageResult.nextRentDueDate ? formatDateKey(coverageResult.nextRentDueDate) : '',
        firstUnpaidPeriod: coverageResult && coverageResult.firstUnpaidPeriod,
        coverageAnomalies: coverageResult ? coverageResult.anomalies : []
      }
    } catch (err) {
      await transaction.rollback()
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
    confirmRentCollection,
    confirmPrepayRent,
    confirmCollectRent(params, caller) {
      return runDirect(params, caller, 'confirmCollectRent', collectSingleBillPayment)
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
