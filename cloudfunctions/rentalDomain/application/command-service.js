const { invariant } = require('../infrastructure/errors')
const { idempotencyKey, loadPendingConfirmation, findExecutedOperation } = require('../infrastructure/idempotency')
const { createRepository } = require('../repositories/rental-repository')
const { number } = require('../domain/presenters')
const { assertNoDuplicateHouse, assertNoDuplicateTenant, assertNoDuplicateLease } = require('../domain/duplicate-guard')
const rentCoverage = require('../domain/rent-coverage')
const {
  buildMoveOutSettlementSnapshot,
  buildPrepayRentSnapshot,
  buildRentCollectionSnapshot,
  buildRentCollectionPlan
} = require('./preview-service')
const {
  buildHistoricalImportSnapshot,
  buildBillingPlan
} = require('./historical-import-service')

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
  if (!['settleMoveOut', 'confirmPrepayRent', 'confirmRentCollection', 'confirmHistoricalLeaseImport'].includes(action)) return
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

  async function assertHistoricalImportConfirmationFresh(input, caller, confirmation) {
    invariant(confirmation, 'VALIDATION_ERROR', '历史合同建档必须先生成预览确认记录')
    invariant(confirmation.sourceDigest, 'STALE_CONFIRMATION', '历史合同预览已过期，请重新生成预览')
    const snapshot = await buildHistoricalImportSnapshot(repo.forOwner(caller.openId), input)
    invariant(snapshot.sourceDigest === confirmation.sourceDigest, 'STALE_CONFIRMATION', '房屋、租客或合同状态已变化，请重新生成预览')
  }

  function generateHistoricalLeaseId() {
    const now = new Date()
    const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const suffix = require('crypto').randomBytes(6).toString('hex').toUpperCase()
    return `LA_${date}_${suffix}`
  }

  async function executeHistoricalLeaseImport(input, caller) {
    const transaction = await db.startTransaction()
    try {
      const now = new Date()
      const plan = buildBillingPlan(input, now)
      let houseId = input.house.houseId || ''
      let tenantId = input.tenant.tenantId || ''

      if (input.house.mode === 'existing') {
        const houseRes = await transaction.collection('houses').where({ _id: houseId, _openid: caller.openId }).get()
        const house = houseRes.data && houseRes.data[0]
        invariant(house, 'FORBIDDEN', '不能操作其他用户的房屋')
        invariant(house.status !== 'maintenance', 'CONFLICT', '房屋维护中，不能导入合同')
      } else {
        const duplicateRes = await transaction.collection('houses').where({
          _openid: caller.openId,
          code: input.house.code,
          address: input.house.address
        }).get()
        invariant(!duplicateRes.data || duplicateRes.data.length === 0, 'CONFLICT', '该房屋已存在，不能重复创建')
        const houseData = {
          _openid: caller.openId,
          code: input.house.code,
          address: input.house.address,
          rent: number(input.house.rent),
          status: 'rented',
          createdAt: now,
          updatedAt: now
        }
        const houseAdd = await transaction.collection('houses').add(houseData)
        houseId = houseAdd.id || houseAdd._id
      }

      if (input.tenant.mode === 'existing') {
        const tenantRes = await transaction.collection('tenants').where({ _id: tenantId, _openid: caller.openId }).get()
        const tenant = tenantRes.data && tenantRes.data[0]
        invariant(tenant, 'FORBIDDEN', '不能操作其他用户的租客')
      } else {
        const duplicateQueries = []
        if (input.tenant.phone) duplicateQueries.push(transaction.collection('tenants').where({ _openid: caller.openId, phone: input.tenant.phone }).get())
        if (input.tenant.idCard) duplicateQueries.push(transaction.collection('tenants').where({ _openid: caller.openId, idCard: input.tenant.idCard }).get())
        if (!input.tenant.phone && !input.tenant.idCard) duplicateQueries.push(transaction.collection('tenants').where({ _openid: caller.openId, name: input.tenant.name }).get())
        const duplicateRows = await Promise.all(duplicateQueries)
        invariant(!duplicateRows.some(item => item.data && item.data.length), 'CONFLICT', '该租客已存在，不能重复创建')
        const suffix = require('crypto').randomBytes(8).toString('hex')
        const tenantData = {
          _openid: caller.openId,
          orderNo: `T_${String(caller.openId).slice(-12)}_${now.getTime()}_${suffix}`,
          name: input.tenant.name,
          idCard: input.tenant.idCard || '',
          phone: input.tenant.phone || '',
          remark: input.tenant.remark || '',
          status: 'active',
          createdAt: now,
          updatedAt: now
        }
        const tenantAdd = await transaction.collection('tenants').add(tenantData)
        tenantId = tenantAdd.id || tenantAdd._id
      }

      const [houseLeaseRes, tenantLeaseRes] = await Promise.all([
        transaction.collection('lease_agreements').where({ _openid: caller.openId, houseId, status: 'active' }).get(),
        transaction.collection('lease_agreements').where({ _openid: caller.openId, tenantId, status: 'active' }).get()
      ])
      if (input.lease.occupancyState !== 'ended') {
        invariant(!houseLeaseRes.data || houseLeaseRes.data.length === 0, 'CONFLICT', '该房屋已有生效合同')
        invariant(!tenantLeaseRes.data || tenantLeaseRes.data.length === 0, 'CONFLICT', '该租客已有生效合同')
      }

      const leaseId = generateHistoricalLeaseId()
      const startDate = parseDateInput(input.lease.startDate)
      const endDate = input.lease.endDate ? parseDateInput(input.lease.endDate) : null
      const coveredUntil = parseDateInput(input.lease.rentCoveredUntil)
      const nextRentDueDate = parseDateInput(plan.nextRentDueDate)
      const leaseData = {
        _id: leaseId,
        _openid: caller.openId,
        houseId,
        tenantId,
        startDate,
        endDate,
        documentStartDate: parseDateInput(input.lease.documentStartDate || input.lease.startDate),
        documentEndDate: input.lease.documentEndDate ? parseDateInput(input.lease.documentEndDate) : null,
        documentTerms: input.lease.documentTerms || {},
        occupancyState: input.lease.occupancyState || 'active_contract',
        rent: number(input.lease.rent),
        deposit: number(input.lease.deposit),
        paymentCycle: input.lease.paymentCycle,
        moveInElectricity: 0,
        moveInWater: 0,
        meterReplaced: false,
        status: input.lease.occupancyState === 'ended' ? 'terminated' : 'active',
        rentCoveredUntil: coveredUntil,
        nextRentDueDate,
        coverageBaselineSource: 'historical_import',
        endedAt: input.lease.occupancyState === 'ended' ? now : null,
        remark: input.lease.remark || '历史合同建档',
        createdAt: now,
        updatedAt: now
      }
      await transaction.collection('lease_agreements').add(leaseData)

      // 历史租金和押金仅作为合同事实保存，不创建历史账单或收款流水。
      let billsCreated = 0

      for (const period of plan.unpaidPeriods) {
        await transaction.collection('bills').add({
          _openid: caller.openId,
          leaseId,
          houseId,
          tenantId,
          type: 'rent',
          period: period.period,
          amount: period.amount,
          paidAmount: 0,
          status: 'unpaid',
          dueDate: parseDateInput(period.periodStart),
          rentCoverageStart: parseDateInput(period.periodStart),
          rentCoverageEnd: parseDateInput(period.periodEnd),
          coverageMonths: period.coverageMonths,
          coverageDays: 0,
          remark: `逾期租金，覆盖${period.periodStart}至${period.periodEnd}`,
          createdAt: now,
          updatedAt: now
        })
        billsCreated += 1
      }

      let utilityRecordId = ''
      if (input.utilityBaseline) {
        const record = {
          _openid: caller.openId,
          leaseId,
          houseId,
          tenantId,
          electricityReading: number(input.utilityBaseline.electricityReading),
          waterReading: number(input.utilityBaseline.waterReading),
          electricityUsage: 0,
          waterUsage: 0,
          electricityCost: 0,
          waterCost: 0,
          totalCost: 0,
          calculationDate: parseDateInput(input.utilityBaseline.calculationDate),
          recordType: 'regular',
          meterReplaced: false,
          remark: '历史合同建档水电结清基准',
          createdAt: now
        }
        const recordAdd = await transaction.collection('utility_records').add(record)
        utilityRecordId = recordAdd.id || recordAdd._id
      }

      const isActiveLease = input.lease.occupancyState !== 'ended'
      const housePatch = { status: isActiveLease ? 'rented' : (input.house.mode === 'create' ? 'available' : undefined), updatedAt: now }
      if (input.house.mode === 'create' || input.house.updateRent) housePatch.rent = number(input.house.rent || input.lease.rent)
      if (housePatch.status === undefined) delete housePatch.status
      await transaction.collection('houses').where({ _id: houseId, _openid: caller.openId }).update(housePatch)
      if (isActiveLease || input.tenant.mode === 'create') {
        await transaction.collection('tenants').where({ _id: tenantId, _openid: caller.openId }).update({ status: isActiveLease ? 'active' : 'inactive', updatedAt: now })
      }

      await transaction.commit()
      return {
        leaseId,
        houseId,
        tenantId,
        utilityRecordId,
        billsCreated,
        paymentsCreated: 0,
        rentCoveredUntil: input.lease.rentCoveredUntil,
        nextRentDueDate: plan.nextRentDueDate
      }
    } catch (err) {
      await transaction.rollback()
      throw err
    }
  }

  async function confirmHistoricalLeaseImport(params, caller) {
    invariant(params && params.confirmationId, 'VALIDATION_ERROR', '历史合同建档必须从预览确认记录执行')
    invariant(caller && caller.openId, 'FORBIDDEN', '缺少调用者身份')
    const resolved = await resolveParams(params, caller, 'confirmHistoricalLeaseImport')
    if (resolved.replay) return { replayed: true, idempotencyKey: resolved.key, result: resolved.result }
    await assertHistoricalImportConfirmationFresh(resolved.input, caller, resolved.confirmation)
    await markExecuting(params.confirmationId)
    try {
      const result = await executeHistoricalLeaseImport(resolved.input, caller)
      await markExecuted(params.confirmationId, result)
      return { ...result, confirmationId: params.confirmationId, idempotencyKey: resolved.key }
    } catch (err) {
      await markPendingAfterFailure(params.confirmationId)
      throw err
    }
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
      if (action === 'confirmCreateLease') {
        await assertNoDuplicateLease(repo.forOwner(caller.openId), input)
      }
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

  async function collectBillBatch(params, caller) {
    const billIds = [...new Set((params.billIds || []).filter(Boolean))]
    invariant(billIds.length, 'VALIDATION_ERROR', '缺少待缴账单')
    invariant(Number(params.amount) > 0, 'VALIDATION_ERROR', '请输入有效金额')
    const transaction = await db.startTransaction()
    try {
      const bills = []
      for (const billId of billIds) {
        const res = await transaction.collection('bills').where({ _id: billId, _openid: caller.openId }).get()
        const bill = res.data && res.data[0]
        invariant(bill, 'FORBIDDEN', '不能操作其他用户的账单')
        const remaining = number(number(bill.amount) - number(bill.paidAmount))
        if (remaining > 0 && bill.status !== 'paid') bills.push(bill)
      }
      invariant(bills.length, 'CONFLICT', '所选账单已结清，请刷新后重试')
      const totalRemaining = number(bills.reduce((sum, bill) => sum + Math.max(0, number(bill.amount) - number(bill.paidAmount)), 0))
      const requestedAmount = number(params.amount)
      invariant(requestedAmount <= totalRemaining, 'VALIDATION_ERROR', `缴费金额超出所选账单待收金额，最多可缴 ${totalRemaining} 元`)

      // 租金必须按账期从早到晚分配，避免先缴后期却留下前期欠租。
      bills.sort((a, b) => {
        const left = a.type === 'rent' ? parseDateInput(a.rentCoverageStart || a.dueDate) : parseDateInput(a.dueDate)
        const right = b.type === 'rent' ? parseDateInput(b.rentCoverageStart || b.dueDate) : parseDateInput(b.dueDate)
        return Number(left || 0) - Number(right || 0)
      })
      const now = new Date()
      const paymentDate = params.paymentDate ? parseDateInput(params.paymentDate) : now
      let remainingToAllocate = requestedAmount
      const payments = []
      const updatedByLease = new Map()
      for (const bill of bills) {
        if (remainingToAllocate <= 0) break
        const before = number(number(bill.amount) - number(bill.paidAmount))
        const allocation = number(Math.min(before, remainingToAllocate))
        if (allocation <= 0) continue
        const paidAmount = number(number(bill.paidAmount) + allocation)
        const status = paidAmount >= number(bill.amount) ? 'paid' : 'partial'
        const paymentData = {
          _openid: caller.openId, billId: bill._id, leaseId: bill.leaseId,
          houseId: bill.houseId, tenantId: bill.tenantId, amount: allocation,
          direction: 'in', paymentDate, paymentMethod: params.paymentMethod || 'cash',
          remark: params.remark || '首页待收批量缴费', createdAt: now
        }
        const paymentRes = await transaction.collection('payments').add(paymentData)
        await transaction.collection('bills').where({ _id: bill._id, _openid: caller.openId }).update({
          paidAmount, status, paidAt: status === 'paid' ? now : bill.paidAt, updatedAt: now
        })
        const updated = { ...bill, paidAmount, status, paidAt: status === 'paid' ? now : bill.paidAt, updatedAt: now }
        if (bill.type === 'rent' && bill.leaseId) {
          if (!updatedByLease.has(bill.leaseId)) updatedByLease.set(bill.leaseId, [])
          updatedByLease.get(bill.leaseId).push(updated)
        }
        payments.push({ ...paymentData, _id: paymentRes.id || paymentRes._id })
        remainingToAllocate = number(remainingToAllocate - allocation)
      }
      for (const [leaseId, changedBills] of updatedByLease.entries()) {
        const leaseRes = await transaction.collection('lease_agreements').where({ _id: leaseId, _openid: caller.openId }).get()
        const lease = leaseRes.data && leaseRes.data[0]
        if (!lease) continue
        const rentRes = await transaction.collection('bills').where({ leaseId, type: 'rent', _openid: caller.openId }).get()
        const changedMap = new Map(changedBills.map(item => [item._id, item]))
        const coverage = rentCoverage.recalculateContinuousRentCoverage(lease, (rentRes.data || []).map(item => changedMap.get(item._id) || item))
        await transaction.collection('lease_agreements').where({ _id: leaseId, _openid: caller.openId }).update({
          rentCoveredUntil: coverage.rentCoveredUntil, nextRentDueDate: coverage.nextRentDueDate, updatedAt: now
        })
      }
      await transaction.commit()
      return {
        billIds: payments.map(item => item.billId), paymentIds: payments.map(item => item._id),
        paidAmount: requestedAmount, remaining: number(totalRemaining - requestedAmount),
        settledCount: payments.length
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
    await assertNoDuplicateHouse(repo.forOwner(caller.openId), params)
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
    await assertNoDuplicateTenant(repo.forOwner(caller.openId), params)
    // orderNo 是 tenants.orderNo_unique 的业务唯一字符串，不使用“最大值+1”。
    // 唯一索引是最后一道并发保护；极小概率冲突时重试。
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const now = new Date()
      const suffix = require('crypto').randomBytes(8).toString('hex')
      const data = {
        _openid: caller.openId,
        orderNo: `T_${String(caller.openId || 'anonymous').slice(-12)}_${now.getTime()}_${suffix}`,
        name: String(params.name).trim(),
        idCard: params.idCard || '',
        phone: params.phone || '',
        remark: params.remark || '',
        status: params.status || 'inactive',
        createdAt: now,
        updatedAt: now
      }
      try {
        const res = await db.collection('tenants').add(data)
        return { tenantId: res.id || res._id, tenant: data }
      } catch (err) {
        const message = String(err && err.message || err || '')
        if (!/orderNo_unique|duplicate key/i.test(message) || attempt === 2) throw err
      }
    }
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
    confirmHistoricalLeaseImport,
    confirmRenewLease(params, caller) {
      return runLegacy(params, caller, 'confirmRenewLease', 'createNextRentBill')
    },
    confirmRentCollection,
    confirmPrepayRent,
    confirmCollectRent(params, caller) {
      return runDirect(params, caller, 'confirmCollectRent', collectSingleBillPayment)
    },
    confirmCollectBillBatch(params, caller) {
      return runDirect(params, caller, 'confirmCollectBillBatch', collectBillBatch)
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
