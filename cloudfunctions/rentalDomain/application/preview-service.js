const { invariant } = require('../infrastructure/errors')
const { createConfirmation, digest } = require('../infrastructure/confirmations')
const { billView, houseView, tenantView, leaseView, number, dateText } = require('../domain/presenters')
const { calculateMeterPreview, calculateSettlement } = require('../domain/settlement')

function dateValue(value) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function pick(doc = {}, fields = []) {
  return fields.reduce((out, field) => {
    if (doc[field] !== undefined) out[field] = field.endsWith('At') || field.endsWith('Date') ? dateValue(doc[field]) : doc[field]
    return out
  }, {})
}

function moveOutSourceDigest(ctx, bills, latestRecord, settings) {
  return digest({
    lease: pick(ctx.lease, [
      '_id', 'houseId', 'tenantId', 'status', 'rent', 'deposit', 'paymentCycle',
      'startDate', 'endDate', 'rentCoveredUntil', 'nextRentDueDate',
      'moveInElectricity', 'moveInWater', 'updatedAt'
    ]),
    house: pick(ctx.house, ['_id', 'status', 'rent', 'updatedAt']),
    tenant: pick(ctx.tenant, ['_id', 'status', 'updatedAt']),
    bills: bills.map(item => pick(item, ['_id', 'leaseId', 'type', 'amount', 'paidAmount', 'status', 'dueDate', 'period', 'updatedAt', 'createdAt']))
      .sort((a, b) => String(a._id || '').localeCompare(String(b._id || ''))),
    latestUtilityRecord: pick(latestRecord, ['_id', 'leaseId', 'electricityReading', 'waterReading', 'calculationDate', 'updatedAt', 'createdAt']),
    settings: pick(settings, ['_id', 'electricityPrice', 'waterPrice', 'updatedAt'])
  })
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

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate())
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function calcOccupiedMonths(startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate) return 0
  const months = (endDate.getFullYear() - startDate.getFullYear()) * 12
    + endDate.getMonth() - startDate.getMonth()
  return endDate.getDate() >= startDate.getDate() ? months + 1 : months
}

function billingMonths(cycle) {
  return { month: 1, quarter: 3, half_year: 6, year: 12 }[cycle] || 1
}

function calcOccupiedBillingMonths(startDate, endDate, paymentCycle) {
  const occupiedMonths = calcOccupiedMonths(startDate, endDate)
  const cycleMonths = billingMonths(paymentCycle)
  if (occupiedMonths <= 0) return 0
  return Math.ceil(occupiedMonths / cycleMonths) * cycleMonths
}

function buildRentRefundView(lease = {}, bills = [], moveOutDate) {
  const leaseStartDate = parseDateInput(lease.startDate)
  const actualEndDate = parseDateInput(moveOutDate)
  const paidRentBills = bills.filter(item => item.type === 'rent' && ['paid', 'partial'].includes(item.status))
  const totalPaidRent = number(paidRentBills.reduce((sum, item) => sum + number(item.paidAmount), 0))
  const occupiedMonths = calcOccupiedBillingMonths(leaseStartDate, actualEndDate, lease.paymentCycle)
  const actualRentDue = number(occupiedMonths * number(lease.rent))
  const overpaidRent = number(Math.max(0, totalPaidRent - actualRentDue))
  return {
    occupiedPeriod: `${formatDateKey(leaseStartDate)} 至 ${formatDateKey(actualEndDate)}`,
    occupiedMonths,
    billingCycleMonths: billingMonths(lease.paymentCycle),
    actualRentDue,
    paidRentDetails: paidRentBills.map(item => ({
      period: item.period || dateText(item.dueDate),
      amount: number(item.paidAmount),
      coverageStart: item.rentCoverageStart ? formatDateKey(parseDateInput(item.rentCoverageStart)) : '',
      coverageEnd: item.rentCoverageEnd ? formatDateKey(parseDateInput(item.rentCoverageEnd)) : ''
    })),
    totalPaidRent,
    overpaidRent
  }
}

function formatPeriod(start, end) {
  if (start.getTime() === end.getTime()) return formatDateKey(start)
  return `${formatDateKey(start)}~${formatDateKey(end)}`
}

function paymentMethodText(method) {
  return ({ cash: '现金', wechat: '微信转账', alipay: '支付宝转账', bank: '银行卡转账', other: '其他' })[method] || '现金'
}

function normalizePaymentMethod(method) {
  return ['cash', 'wechat', 'alipay', 'bank', 'other'].includes(method) ? method : 'cash'
}

function normalizePrepayInput(params = {}) {
  const coverageMonths = Number(params.coverageMonths || 0)
  const coverageDays = Number(params.coverageDays || 0)
  const amount = number(params.amount || 0)
  return {
    leaseId: params.leaseId || '',
    amount,
    coverageMonths,
    coverageDays,
    paymentDate: params.paymentDate || params.payDate || new Date().toISOString().slice(0, 10),
    paymentMethod: normalizePaymentMethod(params.paymentMethod || params.payMethod || 'cash'),
    startDate: params.startDate || params.dueDate || ''
  }
}

function normalizeRentCollectionInput(params = {}) {
  return {
    leaseId: params.leaseId || '',
    periodStart: params.periodStart || params.startDate || '',
    periodEnd: params.periodEnd || '',
    periodCount: Number(params.periodCount || 0),
    amount: number(params.amount || 0),
    paymentDate: params.paymentDate || params.payDate || new Date().toISOString().slice(0, 10),
    paymentMethod: normalizePaymentMethod(params.paymentMethod || params.payMethod || 'cash'),
    note: params.note || params.remark || ''
  }
}

function calculatePrepayPeriod(lease = {}, input = {}) {
  const monthlyRent = number(lease.rent)
  invariant(monthlyRent > 0, 'VALIDATION_ERROR', '合同月租金无效')
  const coverageStart = lease.nextRentDueDate
    ? parseDateInput(lease.nextRentDueDate)
    : addDays(parseDateInput(lease.rentCoveredUntil || lease.startDate), 1)
  if (input.startDate) {
    const requestedStart = parseDateInput(input.startDate)
    invariant(formatDateKey(requestedStart) === formatDateKey(coverageStart), 'VALIDATION_ERROR', '提前收租暂只支持从下次交租日开始')
  }

  const months = Math.max(0, Number(input.coverageMonths || 0))
  let days = Math.max(0, Number(input.coverageDays || 0))
  let amount = number(input.amount || 0)
  let coverageEnd
  let coverageText

  invariant(months > 0 || days > 0 || amount > 0, 'VALIDATION_ERROR', '缺少预收月数、天数或金额')

  if (months > 0) {
    coverageEnd = addDays(addMonths(coverageStart, months), -1)
    if (amount <= 0) amount = number(monthlyRent * months)
    days = 0
    coverageText = `${months}个月`
  } else {
    if (days <= 0) days = Math.max(1, Math.round(amount / monthlyRent * 30))
    coverageEnd = addDays(coverageStart, days - 1)
    if (amount <= 0) amount = number(monthlyRent / 30 * days)
    coverageText = `${days}天`
  }

  invariant(amount > 0, 'VALIDATION_ERROR', '请填写有效的预收租金金额')
  return {
    monthlyRent,
    coverageStart,
    coverageEnd,
    period: formatPeriod(coverageStart, coverageEnd),
    amount,
    coverageMonths: months,
    coverageDays: days,
    coverageText
  }
}

function sameDate(left, right) {
  return formatDateKey(parseDateInput(left)) === formatDateKey(parseDateInput(right))
}

function compareDate(left, right) {
  const l = parseDateInput(left)
  const r = parseDateInput(right)
  return new Date(l.getFullYear(), l.getMonth(), l.getDate()).getTime()
    - new Date(r.getFullYear(), r.getMonth(), r.getDate()).getTime()
}

function inferBillMonthsFromAmount(bill, lease) {
  const monthlyRent = number(lease && lease.rent)
  const amount = number(bill && bill.amount)
  if (monthlyRent <= 0 || amount <= 0) return billingMonths(lease && lease.paymentCycle)
  return Math.max(1, Math.round(amount / monthlyRent))
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

function coverageKey(period) {
  return `${formatDateKey(period.start)}~${formatDateKey(period.end)}`
}

function assertAlignedPeriodStart(lease, periodStart) {
  const cycleMonths = billingMonths(lease.paymentCycle)
  let cursor = parseDateInput(lease.startDate)
  const target = parseDateInput(periodStart)
  for (let i = 0; i < 480; i += 1) {
    if (sameDate(cursor, target)) return
    if (compareDate(cursor, target) > 0) break
    cursor = addMonths(cursor, cycleMonths)
  }
  invariant(false, 'VALIDATION_ERROR', '起始账期必须与合同租金账期对齐')
}

function buildBillingPeriods(lease, input) {
  invariant(input.periodStart, 'NEED_PERIOD', '请明确起始账期')
  const cycleMonths = billingMonths(lease.paymentCycle)
  const start = parseDateInput(input.periodStart)
  assertAlignedPeriodStart(lease, start)

  let periodCount = Number(input.periodCount || 0)
  let end = input.periodEnd ? parseDateInput(input.periodEnd) : null

  if (periodCount > 0) {
    invariant(Number.isInteger(periodCount), 'VALIDATION_ERROR', '收取月数必须为整数')
    invariant(periodCount > 0 && periodCount <= 120, 'VALIDATION_ERROR', '收取月数超出合理范围')
    invariant(periodCount % cycleMonths === 0, 'VALIDATION_ERROR', '收取月数必须按合同缴费周期取整')
    const expectedEnd = addDays(addMonths(start, periodCount), -1)
    if (end) invariant(sameDate(end, expectedEnd), 'VALIDATION_ERROR', '收取月数与结束账期不一致')
    end = expectedEnd
  } else {
    invariant(end, 'NEED_PERIOD', '请明确收取月数或结束账期')
    invariant(compareDate(end, start) >= 0, 'VALIDATION_ERROR', '结束账期不能早于起始账期')
    for (let months = cycleMonths; months <= 120; months += cycleMonths) {
      const candidateEnd = addDays(addMonths(start, months), -1)
      if (sameDate(candidateEnd, end)) {
        periodCount = months
        break
      }
      if (compareDate(candidateEnd, end) > 0) break
    }
    invariant(periodCount > 0, 'VALIDATION_ERROR', '结束账期必须与合同缴费周期对齐')
  }

  const periods = []
  for (let offset = 0; offset < periodCount; offset += cycleMonths) {
    const periodStart = addMonths(start, offset)
    const periodEnd = addDays(addMonths(periodStart, cycleMonths), -1)
    periods.push({
      period: formatPeriod(periodStart, periodEnd),
      start: periodStart,
      end: periodEnd,
      months: cycleMonths
    })
  }
  return {
    periods,
    periodStart: start,
    periodEnd: end,
    periodCount
  }
}

function findRentBillForPeriod(rentBills, lease, period) {
  const target = coverageKey(period)
  return rentBills.find((bill) => coverageKey(inferRentBillCoverage(bill, lease)) === target)
    || rentBills.find((bill) => String(bill.period || '') === period.period)
    || null
}

function classifyRentCollectionMode(lease, paymentDate, periods) {
  const payDate = parseDateInput(paymentDate)
  const cycleMonths = billingMonths(lease.paymentCycle)
  let currentStart = parseDateInput(lease.startDate)
  for (let i = 0; i < 480; i += 1) {
    const currentEnd = addDays(addMonths(currentStart, cycleMonths), -1)
    if (compareDate(payDate, currentStart) >= 0 && compareDate(payDate, currentEnd) <= 0) break
    if (compareDate(payDate, currentStart) < 0) break
    currentStart = addMonths(currentStart, cycleMonths)
  }
  const currentEnd = addDays(addMonths(currentStart, cycleMonths), -1)
  const containsArrears = periods.some((item) => compareDate(item.end, currentStart) < 0)
  const containsCurrent = periods.some((item) => compareDate(item.start, currentEnd) <= 0 && compareDate(item.end, currentStart) >= 0)
  const containsAdvance = periods.some((item) => compareDate(item.start, currentEnd) > 0)
  const count = [containsArrears, containsCurrent, containsAdvance].filter(Boolean).length
  const mode = count > 1 ? 'mixed' : containsArrears ? 'arrears' : containsCurrent ? 'current' : 'advance'
  return { mode, containsArrears, containsCurrent, containsAdvance }
}

function calculateContinuousRentCoverage(lease, rentBills, plannedAllocations = []) {
  const plannedByKey = new Map(plannedAllocations.map((item) => [coverageKey({ start: parseDateInput(item.periodStart), end: parseDateInput(item.periodEnd) }), item]))
  const coverages = rentBills.map((bill) => {
    const coverage = inferRentBillCoverage(bill, lease)
    const planned = plannedByKey.get(coverageKey(coverage))
    const paidAmount = number(bill.paidAmount) + number(planned && planned.allocationAmount)
    const amount = number(bill.amount)
    return {
      start: coverage.start,
      end: coverage.end,
      paid: amount > 0 && paidAmount >= amount
    }
  })

  plannedAllocations
    .filter((item) => item.source === 'new')
    .forEach((item) => {
      coverages.push({
        start: parseDateInput(item.periodStart),
        end: parseDateInput(item.periodEnd),
        paid: number(item.allocationAmount) >= number(item.receivableAmount)
      })
    })

  let cursor = parseDateInput(lease.startDate)
  let coveredUntil = null
  const rows = coverages.filter(item => item.paid).sort((a, b) => a.start.getTime() - b.start.getTime())
  let advanced = true
  while (advanced) {
    advanced = false
    for (const item of rows) {
      if (compareDate(item.start, cursor) <= 0 && compareDate(item.end, cursor) >= 0) {
        coveredUntil = item.end
        cursor = addDays(item.end, 1)
        advanced = true
      }
    }
  }
  return coveredUntil
}

function buildRentCollectionPlan(lease, rentBills, input) {
  const monthlyRent = number(lease.rent)
  invariant(monthlyRent > 0, 'VALIDATION_ERROR', '合同月租金无效')
  const built = buildBillingPeriods(lease, input)
  const classifications = classifyRentCollectionMode(lease, input.paymentDate, built.periods)
  const allocations = built.periods.map((period) => {
    const existingBill = findRentBillForPeriod(rentBills, lease, period)
    const receivableAmount = existingBill ? number(existingBill.amount) : number(monthlyRent * period.months)
    const alreadyPaidAmount = existingBill ? number(existingBill.paidAmount) : 0
    const allocationAmount = existingBill && existingBill.status === 'paid'
      ? 0
      : number(Math.max(0, receivableAmount - alreadyPaidAmount))
    const resultStatus = allocationAmount <= 0 ? 'paid' : 'paid'
    return {
      period: period.period,
      periodStart: formatDateKey(period.start),
      periodEnd: formatDateKey(period.end),
      billId: existingBill ? existingBill._id : '',
      source: existingBill ? 'existing' : 'new',
      receivableAmount,
      alreadyPaidAmount,
      allocationAmount,
      remainingAmount: 0,
      resultStatus,
      coverageMonths: period.months,
      dueDate: formatDateKey(period.start)
    }
  })

  const totalReceivable = number(allocations.reduce((sum, item) => sum + item.receivableAmount, 0))
  const totalAlreadyPaid = number(allocations.reduce((sum, item) => sum + item.alreadyPaidAmount, 0))
  const totalCollectionAmount = number(allocations.reduce((sum, item) => sum + item.allocationAmount, 0))
  if (input.amount > 0) {
    invariant(input.amount === totalCollectionAmount, 'VALIDATION_ERROR', `收款金额与所选账期应收不一致，应收 ${totalCollectionAmount} 元`)
  }
  invariant(totalCollectionAmount > 0, 'CONFLICT', '所选账期已全部缴清')
  const projectedRentCoveredUntil = calculateContinuousRentCoverage(lease, rentBills, allocations)

  return {
    ...built,
    ...classifications,
    allocations,
    existingBills: allocations.filter(item => item.source === 'existing'),
    billsToCreate: allocations.filter(item => item.source === 'new'),
    totalReceivable,
    totalAlreadyPaid,
    totalCollectionAmount,
    projectedRentCoveredUntil
  }
}

function rentCollectionSourceDigest(ctx, rentBills, input) {
  return digest({
    input,
    lease: pick(ctx.lease, [
      '_id', 'houseId', 'tenantId', 'status', 'rent', 'paymentCycle',
      'startDate', 'endDate', 'rentCoveredUntil', 'nextRentDueDate', 'updatedAt'
    ]),
    house: pick(ctx.house, ['_id', 'status', 'rent', 'updatedAt']),
    tenant: pick(ctx.tenant, ['_id', 'status', 'updatedAt']),
    rentBills: rentBills.map(item => pick(item, [
      '_id', 'leaseId', 'type', 'period', 'amount', 'paidAmount', 'status',
      'dueDate', 'rentCoverageStart', 'rentCoverageEnd', 'coverageMonths', 'coverageDays', 'updatedAt', 'createdAt'
    ])).sort((a, b) => String(a._id || '').localeCompare(String(b._id || '')))
  })
}

function prepaySourceDigest(ctx, rentBills) {
  return digest({
    lease: pick(ctx.lease, [
      '_id', 'houseId', 'tenantId', 'status', 'rent', 'paymentCycle',
      'rentCoveredUntil', 'nextRentDueDate', 'updatedAt'
    ]),
    house: pick(ctx.house, ['_id', 'status', 'rent', 'updatedAt']),
    tenant: pick(ctx.tenant, ['_id', 'status', 'updatedAt']),
    rentBills: rentBills.map(item => pick(item, [
      '_id', 'leaseId', 'type', 'period', 'amount', 'paidAmount', 'status',
      'dueDate', 'rentCoverageStart', 'rentCoverageEnd', 'updatedAt', 'createdAt'
    ])).sort((a, b) => String(a._id || '').localeCompare(String(b._id || '')))
  })
}

async function getLeaseContext(repo, leaseId) {
  const lease = await repo.byId('lease_agreements', leaseId)
  invariant(lease, 'NOT_FOUND', '未找到有效合同')
  const [house, tenant] = await Promise.all([repo.byId('houses', lease.houseId), repo.byId('tenants', lease.tenantId)])
  return { lease, house: house || {}, tenant: tenant || {} }
}

async function resolvePrepayLeaseId(repo, candidateId) {
  const direct = await repo.byId('lease_agreements', candidateId)
  if (direct) return direct._id
  const [byTenant, byHouse] = await Promise.all([
    repo.queryAll('lease_agreements', { tenantId: candidateId, status: 'active' }),
    repo.queryAll('lease_agreements', { houseId: candidateId, status: 'active' })
  ])
  const matches = [...byTenant, ...byHouse].filter((item, index, rows) => rows.findIndex(row => row._id === item._id) === index)
  invariant(matches.length > 0, 'NOT_FOUND', '未找到有效合同，请先调用 getActiveLeases，并使用返回的 leaseId/合同ID')
  invariant(matches.length === 1, 'CONFLICT', '找到多个生效合同，请补充更准确的房屋或租客信息')
  return matches[0]._id
}

function rentCollectionView(ctx, input, plan) {
  return {
    mode: plan.mode,
    leaseId: ctx.lease._id,
    houseId: ctx.lease.houseId,
    tenantId: ctx.lease.tenantId,
    lease: leaseView(ctx.lease, ctx.house, ctx.tenant),
    periodStart: formatDateKey(plan.periodStart),
    periodEnd: formatDateKey(plan.periodEnd),
    periodCount: plan.periodCount,
    paymentMethod: input.paymentMethod,
    paymentMethodText: paymentMethodText(input.paymentMethod),
    paymentDate: input.paymentDate,
    note: input.note || '',
    existingBills: plan.existingBills,
    billsToCreate: plan.billsToCreate,
    allocations: plan.allocations,
    totalReceivable: plan.totalReceivable,
    totalAlreadyPaid: plan.totalAlreadyPaid,
    totalCollectionAmount: plan.totalCollectionAmount,
    containsArrears: plan.containsArrears,
    containsCurrent: plan.containsCurrent,
    containsAdvance: plan.containsAdvance,
    monthlyRent: number(ctx.lease.rent),
    nextRentDueDate: dateText(ctx.lease.nextRentDueDate),
    currentRentCoveredUntil: dateText(ctx.lease.rentCoveredUntil),
    projectedRentCoveredUntil: plan.projectedRentCoveredUntil ? formatDateKey(plan.projectedRentCoveredUntil) : ''
  }
}

async function buildRentCollectionSnapshot(repo, params, options = {}) {
  const input = normalizeRentCollectionInput(params)
  invariant(input.leaseId, 'VALIDATION_ERROR', '缺少合同 ID')
  input.leaseId = await resolvePrepayLeaseId(repo, input.leaseId)
  const ctx = await getLeaseContext(repo, input.leaseId)
  invariant(ctx.lease.status === 'active', 'CONFLICT', '合同不是生效状态')
  const rentBills = await repo.queryAll('bills', { leaseId: input.leaseId, type: 'rent' })

  if (options.defaultFromNextDue && !input.periodStart) {
    const coverageStart = ctx.lease.nextRentDueDate
      ? parseDateInput(ctx.lease.nextRentDueDate)
      : addDays(parseDateInput(ctx.lease.rentCoveredUntil || ctx.lease.startDate), 1)
    input.periodStart = formatDateKey(coverageStart)
  }
  if (options.defaultFromNextDue && !input.periodCount && !input.periodEnd) {
    const legacy = normalizePrepayInput(params)
    if (legacy.coverageMonths > 0) input.periodCount = legacy.coverageMonths
    else if (legacy.amount > 0) input.periodCount = Math.max(1, Math.round(legacy.amount / number(ctx.lease.rent)))
  }
  if (!input.periodStart || (!input.periodCount && !input.periodEnd)) {
    return {
      status: 'need_period',
      needPeriod: true,
      message: '请确认起始账期和收取月数后再入账',
      targetId: input.leaseId,
      normalizedInput: input,
      rentCollectionView: {
        lease: leaseView(ctx.lease, ctx.house, ctx.tenant),
        leaseId: input.leaseId,
        paymentMethod: input.paymentMethod,
        paymentMethodText: paymentMethodText(input.paymentMethod),
        paymentDate: input.paymentDate,
        currentRentCoveredUntil: dateText(ctx.lease.rentCoveredUntil),
        nextRentDueDate: dateText(ctx.lease.nextRentDueDate)
      }
    }
  }

  const plan = buildRentCollectionPlan(ctx.lease, rentBills, input)

  const normalizedInput = {
    leaseId: input.leaseId,
    amount: input.amount,
    periodStart: formatDateKey(plan.periodStart),
    periodEnd: formatDateKey(plan.periodEnd),
    periodCount: plan.periodCount,
    paymentDate: input.paymentDate,
    paymentMethod: input.paymentMethod,
    note: input.note || ''
  }
  const view = rentCollectionView(ctx, normalizedInput, plan)
  return {
    targetId: input.leaseId,
    sourceDigest: rentCollectionSourceDigest(ctx, rentBills, normalizedInput),
    normalizedInput,
    rentCollectionView: view
  }
}

async function buildPrepayRentSnapshot(repo, params) {
  const snapshot = await buildRentCollectionSnapshot(repo, params, { defaultFromNextDue: true })
  if (snapshot.needPeriod) return snapshot
  const view = snapshot.rentCollectionView || {}
  const prepayView = {
    ...view,
    lease: view.lease || {},
    nextRentDueDate: view.nextRentDueDate || '',
    rentCoveredUntil: view.currentRentCoveredUntil || '',
    monthlyRent: number(view.monthlyRent || (view.lease || {}).rent),
    coverageStart: view.periodStart,
    coverageEnd: view.periodEnd,
    coverageText: `${view.periodCount || 0}个月`,
    period: view.periodStart && view.periodEnd ? formatPeriod(parseDateInput(view.periodStart), parseDateInput(view.periodEnd)) : '',
    amount: view.totalCollectionAmount,
    receivableAmount: view.totalCollectionAmount,
    willCreateBill: (view.billsToCreate || []).length > 0,
    existingBill: (view.existingBills || [])[0] || null,
    paymentNote: view.paymentMethod === 'wechat' ? '按微信转账已收款入账。' : ''
  }
  return {
    ...snapshot,
    prepayView
  }
}

async function buildMoveOutSettlementSnapshot(repo, params) {
  invariant(params.leaseId, 'VALIDATION_ERROR', '缺少合同 ID')
  const ctx = await getLeaseContext(repo, params.leaseId)
  invariant(ctx.lease.status === 'active', 'CONFLICT', '合同不是生效状态')
  const [bills, records, settingsRows] = await Promise.all([
    repo.queryAll('bills', { leaseId: params.leaseId }),
    repo.queryAll('utility_records', { leaseId: params.leaseId }, { field: 'createdAt', direction: 'desc' }),
    repo.queryAll('system_settings', { _id: 'global' })
  ])
  const latest = records[0] || {}
  const settings = settingsRows[0] || {}
  const outstandingAmount = bills.filter(item => item.status !== 'paid').reduce((sum, item) => sum + Math.max(0, number(item.amount) - number(item.paidAmount)), 0)
  const rentRefund = buildRentRefundView(ctx.lease, bills, params.moveOutDate)
  const settlementView = {
    lease: leaseView(ctx.lease, ctx.house, ctx.tenant),
    moveOutDate: params.moveOutDate,
    rentRefund,
    ...calculateSettlement({
      ...params,
      deposit: ctx.lease.deposit,
      outstandingAmount,
      overpaidRent: rentRefund.overpaidRent,
      lastElectricity: latest.electricityReading || ctx.lease.moveInElectricity || 0,
      lastWater: latest.waterReading || ctx.lease.moveInWater || 0,
      electricityPrice: settings.electricityPrice || 0.8,
      waterPrice: settings.waterPrice || 3.5
    })
  }
  return {
    targetId: params.leaseId,
    sourceDigest: moveOutSourceDigest(ctx, bills, latest, settings),
    settlementView
  }
}

function createPreviewService(db, repo) {
  async function context(leaseId) {
    return getLeaseContext(repo, leaseId)
  }

  async function previewCollectRent(params, caller) {
    invariant(params.billId, 'VALIDATION_ERROR', '缺少租金账单 ID')
    const bill = await repo.byId('bills', params.billId)
    invariant(bill && bill.type === 'rent', 'NOT_FOUND', '未找到租金账单')
    const ctx = await context(bill.leaseId)
    const view = billView(bill, ctx.lease, ctx.house, ctx.tenant)
    const amount = number(params.amount || view.remaining)
    invariant(amount > 0 && amount <= view.remaining, 'VALIDATION_ERROR', '收款金额不合法')
    const snapshot = { bill: view, amount, paymentMethod: params.paymentMethod || 'cash', paymentDate: params.paymentDate || new Date().toISOString().slice(0, 10), statusAfter: amount === view.remaining ? 'paid' : 'partial' }
    return { ...snapshot, ...(await createConfirmation(db, caller, 'confirmCollectRent', params, snapshot)) }
  }

  async function previewCreateHouse(params, caller) {
    invariant(params.code, 'VALIDATION_ERROR', '缺少房屋编号')
    invariant(params.address, 'VALIDATION_ERROR', '缺少房屋地址')
    invariant(number(params.rent) > 0, 'VALIDATION_ERROR', '月租金必须大于 0')
    const snapshot = {
      house: houseView({
        code: String(params.code).trim(),
        address: String(params.address).trim(),
        rent: number(params.rent),
        status: params.status || 'available'
      })
    }
    return { ...snapshot, ...(await createConfirmation(db, caller, 'confirmCreateHouse', params, snapshot)) }
  }

  async function previewCreateTenant(params, caller) {
    invariant(params.name, 'VALIDATION_ERROR', '缺少租客姓名')
    const snapshot = {
      tenant: tenantView({
        name: String(params.name).trim(),
        phone: params.phone || '',
        status: params.status || 'inactive'
      })
    }
    return { ...snapshot, ...(await createConfirmation(db, caller, 'confirmCreateTenant', params, snapshot)) }
  }

  async function previewCreateLease(params, caller) {
    invariant(params.houseId, 'VALIDATION_ERROR', '缺少房屋 ID')
    invariant(params.tenantId, 'VALIDATION_ERROR', '缺少租客 ID')
    invariant(params.startDate, 'VALIDATION_ERROR', '缺少起租日期')
    invariant(number(params.rent) > 0, 'VALIDATION_ERROR', '月租金必须大于 0')
    const [house, tenant] = await Promise.all([repo.byId('houses', params.houseId), repo.byId('tenants', params.tenantId)])
    invariant(house, 'NOT_FOUND', '房屋不存在')
    invariant(tenant, 'NOT_FOUND', '租客不存在')
    const [houseLeases, tenantLeases] = await Promise.all([
      repo.queryAll('lease_agreements', { houseId: params.houseId, status: 'active' }),
      repo.queryAll('lease_agreements', { tenantId: params.tenantId, status: 'active' })
    ])
    invariant(house.status !== 'maintenance', 'CONFLICT', '房屋维护中，无法创建合同')
    invariant(houseLeases.length === 0, 'CONFLICT', '该房屋已有生效合同')
    invariant(tenantLeases.length === 0, 'CONFLICT', '该租客已有生效合同')
    const snapshot = {
      lease: leaseView({
        houseId: params.houseId,
        tenantId: params.tenantId,
        rent: number(params.rent),
        deposit: params.deposit === undefined ? number(params.rent) : number(params.deposit),
        paymentCycle: params.paymentCycle || 'month',
        startDate: params.startDate,
        status: 'active'
      }, house, tenant)
    }
    return { ...snapshot, ...(await createConfirmation(db, caller, 'confirmCreateLease', params, snapshot)) }
  }

  async function previewRenewLease(params, caller) {
    invariant(params.leaseId, 'VALIDATION_ERROR', '缺少合同 ID')
    const ctx = await context(params.leaseId)
    invariant(ctx.lease.status === 'active', 'CONFLICT', '合同不是生效状态')
    const snapshot = {
      lease: leaseView(ctx.lease, ctx.house, ctx.tenant),
      nextRentDueDate: ctx.lease.nextRentDueDate || '',
      rentCoveredUntil: ctx.lease.rentCoveredUntil || '',
      rent: number(ctx.lease.rent),
      paymentCycle: ctx.lease.paymentCycle || 'month'
    }
    return { ...snapshot, ...(await createConfirmation(db, caller, 'confirmRenewLease', params, snapshot)) }
  }

  async function previewPrepayRent(params, caller) {
    const snapshot = await buildPrepayRentSnapshot(repo, params)
    if (snapshot.needPeriod) return snapshot
    return {
      prepayView: snapshot.prepayView,
      rentCollectionView: snapshot.rentCollectionView,
      normalizedInput: snapshot.normalizedInput,
      sourceDigest: snapshot.sourceDigest,
      targetId: snapshot.targetId,
      ...(await createConfirmation(db, caller, 'confirmPrepayRent', snapshot.normalizedInput, snapshot))
    }
  }

  async function previewRentCollection(params, caller) {
    const snapshot = await buildRentCollectionSnapshot(repo, params)
    if (snapshot.needPeriod) return snapshot
    return {
      rentCollectionView: snapshot.rentCollectionView,
      normalizedInput: snapshot.normalizedInput,
      sourceDigest: snapshot.sourceDigest,
      targetId: snapshot.targetId,
      ...(await createConfirmation(db, caller, 'confirmRentCollection', snapshot.normalizedInput, snapshot))
    }
  }

  async function previewMeterReading(params, caller) {
    invariant(params.leaseId, 'VALIDATION_ERROR', '缺少合同 ID')
    const ctx = await context(params.leaseId)
    invariant(ctx.lease.status === 'active', 'CONFLICT', '合同不是生效状态')
    const records = await repo.queryAll('utility_records', { leaseId: params.leaseId }, { field: 'createdAt', direction: 'desc' })
    const latest = records[0] || {}
    const settings = (await repo.queryAll('system_settings', { _id: 'global' }))[0] || {}
    const meter = calculateMeterPreview({ ...params, lastElectricity: latest.electricityReading || ctx.lease.moveInElectricity || 0, lastWater: latest.waterReading || ctx.lease.moveInWater || 0, electricityPrice: settings.electricityPrice || 0.8, waterPrice: settings.waterPrice || 3.5 })
    const snapshot = { lease: leaseView(ctx.lease, ctx.house, ctx.tenant), ...meter }
    return { ...snapshot, ...(await createConfirmation(db, caller, 'confirmMeterReading', params, snapshot)) }
  }

  async function previewMoveOutSettlement(params, caller) {
    const snapshot = await buildMoveOutSettlementSnapshot(repo, params)
    return {
      settlementView: snapshot.settlementView,
      sourceDigest: snapshot.sourceDigest,
      targetId: snapshot.targetId,
      ...(await createConfirmation(db, caller, 'settleMoveOut', params, snapshot))
    }
  }

  return { previewCreateHouse, previewCreateTenant, previewCreateLease, previewRenewLease, previewPrepayRent, previewRentCollection, previewCollectRent, previewMeterReading, previewMoveOutSettlement }
}

module.exports = {
  createPreviewService,
  buildMoveOutSettlementSnapshot,
  buildPrepayRentSnapshot,
  buildRentCollectionSnapshot,
  buildRentCollectionPlan,
  calculateContinuousRentCoverage,
  inferRentBillCoverage,
  calculatePrepayPeriod,
  formatDateKey
}
