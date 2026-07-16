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

async function buildPrepayRentSnapshot(repo, params) {
  const input = normalizePrepayInput(params)
  invariant(input.leaseId, 'VALIDATION_ERROR', '缺少合同 ID')
  input.leaseId = await resolvePrepayLeaseId(repo, input.leaseId)
  const ctx = await getLeaseContext(repo, input.leaseId)
  invariant(ctx.lease.status === 'active', 'CONFLICT', '合同不是生效状态')
  const rentBills = await repo.queryAll('bills', { leaseId: input.leaseId, type: 'rent' })
  const calc = calculatePrepayPeriod(ctx.lease, input)
  const existingBill = rentBills.find(item => item.period === calc.period) || null
  if (existingBill && existingBill.status === 'paid') {
    invariant(false, 'CONFLICT', '该周期租金账单已全额支付')
  }
  const remainingAmount = existingBill
    ? number(number(existingBill.amount) - number(existingBill.paidAmount))
    : calc.amount
  invariant(remainingAmount > 0, 'CONFLICT', '该周期租金已结清')

  const normalizedInput = {
    leaseId: input.leaseId,
    amount: input.amount,
    coverageMonths: input.coverageMonths,
    coverageDays: input.coverageDays,
    paymentDate: input.paymentDate,
    paymentMethod: input.paymentMethod,
    startDate: formatDateKey(calc.coverageStart)
  }
  const prepayView = {
    lease: leaseView(ctx.lease, ctx.house, ctx.tenant),
    nextRentDueDate: dateText(ctx.lease.nextRentDueDate),
    rentCoveredUntil: dateText(ctx.lease.rentCoveredUntil),
    monthlyRent: calc.monthlyRent,
    coverageStart: formatDateKey(calc.coverageStart),
    coverageEnd: formatDateKey(calc.coverageEnd),
    coverageText: calc.coverageText,
    period: calc.period,
    amount: calc.amount,
    receivableAmount: remainingAmount,
    paymentDate: input.paymentDate,
    paymentMethod: input.paymentMethod,
    paymentMethodText: paymentMethodText(input.paymentMethod),
    willCreateBill: !existingBill,
    existingBill: existingBill ? billView(existingBill, ctx.lease, ctx.house, ctx.tenant) : null,
    paymentNote: input.paymentMethod === 'wechat' ? '按微信转账已收款入账。' : ''
  }
  return {
    targetId: input.leaseId,
    sourceDigest: prepaySourceDigest(ctx, rentBills),
    normalizedInput,
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
    return {
      prepayView: snapshot.prepayView,
      normalizedInput: snapshot.normalizedInput,
      sourceDigest: snapshot.sourceDigest,
      targetId: snapshot.targetId,
      ...(await createConfirmation(db, caller, 'confirmPrepayRent', snapshot.normalizedInput, snapshot))
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

  return { previewCreateHouse, previewCreateTenant, previewCreateLease, previewRenewLease, previewPrepayRent, previewCollectRent, previewMeterReading, previewMoveOutSettlement }
}

module.exports = { createPreviewService, buildMoveOutSettlementSnapshot, buildPrepayRentSnapshot, calculatePrepayPeriod, formatDateKey }
