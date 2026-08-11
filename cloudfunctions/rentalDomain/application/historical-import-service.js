const { invariant } = require('../infrastructure/errors')
const { digest } = require('../infrastructure/confirmations')
const { number } = require('../domain/presenters')
const rentCoverage = require('../domain/rent-coverage')
const { assertNoDuplicateHouse, assertNoDuplicateTenant } = require('../domain/duplicate-guard')

const PAYMENT_CYCLES = new Set(['month', 'quarter', 'half_year', 'year'])

function parseDate(value, label, required = true) {
  const date = rentCoverage.parseDateInput(value)
  if (required) invariant(date, 'VALIDATION_ERROR', `缺少或无法识别${label}`)
  else invariant(!value || date, 'VALIDATION_ERROR', `${label}格式不正确`)
  return date
}

function dateKey(value) {
  return rentCoverage.formatDateKey(value)
}

function addMonths(value, months) {
  return rentCoverage.addMonths(value, months)
}

function addDays(value, days) {
  return rentCoverage.addDays(value, days)
}

function sameDay(left, right) {
  return dateKey(left) === dateKey(right)
}

function normalizeText(value) {
  return String(value === undefined || value === null ? '' : value).trim()
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, '').toLowerCase()
}

function normalizePhone(value) {
  return normalizeText(value).replace(/[\s-]/g, '')
}

function normalizeIdCard(value) {
  return normalizeText(value).replace(/\s+/g, '').toUpperCase()
}

function validIdCard(value) {
  const id = normalizeIdCard(value)
  if (!id) return true
  if (!/^\d{17}[\dX]$/.test(id)) return false
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const sum = weights.reduce((total, weight, index) => total + Number(id[index]) * weight, 0)
  return checks[sum % 11] === id[17]
}

function monthSpan(start, end, maxMonths = 600) {
  for (let months = 1; months <= maxMonths; months += 1) {
    if (sameDay(addDays(addMonths(start, months), -1), end)) return months
  }
  return 0
}

function formatPeriod(start, end) {
  return `${dateKey(start)}~${dateKey(end)}`
}

function normalizeHistoricalImportInput(params = {}) {
  const houseSource = params.house || {}
  const tenantSource = params.tenant || {}
  const leaseSource = params.lease || {}
  const utilitySource = params.utilityBaseline || null
  const houseMode = houseSource.mode === 'create' ? 'create' : 'existing'
  const tenantMode = tenantSource.mode === 'create' ? 'create' : 'existing'
  const paymentCycle = PAYMENT_CYCLES.has(leaseSource.paymentCycle) ? leaseSource.paymentCycle : 'month'

  const startDate = parseDate(leaseSource.startDate, '实际入住/计费开始日期')
  const documentStartDate = parseDate(leaseSource.documentStartDate || leaseSource.startDate, '纸质合同起租日期')
  // 兼容旧调用：历史导入原来的 endDate 表示纸质合同结束日期。
  const documentEndDate = parseDate(leaseSource.documentEndDate || leaseSource.endDate, '纸质合同结束日期', false)
  const occupancyState = ['active_contract', 'continued_without_renewal', 'ended'].includes(leaseSource.occupancyState)
    ? leaseSource.occupancyState
    : 'active_contract'
  const actualEndDate = occupancyState === 'ended'
    ? parseDate(leaseSource.actualEndDate || leaseSource.endDate, '实际退租日期')
    : null
  const rentCoveredUntil = parseDate(leaseSource.rentCoveredUntil, '租金已缴至日期')
  const rent = number(leaseSource.rent)
  const deposit = Number(leaseSource.deposit)
  invariant(rent > 0, 'VALIDATION_ERROR', '月租金必须大于 0')
  invariant(Number.isFinite(deposit) && deposit >= 0, 'VALIDATION_ERROR', '押金必须为大于等于 0 的数字')
  invariant(rentCoveredUntil.getTime() >= startDate.getTime(), 'VALIDATION_ERROR', '租金已缴至不能早于起租日期')

  invariant(!documentEndDate || documentEndDate.getTime() >= documentStartDate.getTime(), 'VALIDATION_ERROR', '纸质合同结束日期不能早于纸质合同起租日期')
  if (actualEndDate) invariant(actualEndDate.getTime() >= startDate.getTime(), 'VALIDATION_ERROR', '实际退租日期不能早于实际入住日期')
  if (documentEndDate && documentEndDate.getTime() < rentCoveredUntil.getTime()) {
    invariant(occupancyState === 'continued_without_renewal', 'VALIDATION_ERROR', '纸质合同已在租金已缴日前到期，请确认租客是否到期后继续居住')
  }

  if (houseMode === 'existing') {
    invariant(houseSource.houseId, 'VALIDATION_ERROR', '请选择现有房屋')
  } else {
    invariant(normalizeText(houseSource.code), 'VALIDATION_ERROR', '缺少新房屋编号')
    invariant(normalizeText(houseSource.address), 'VALIDATION_ERROR', '缺少新房屋地址')
    invariant(number(houseSource.rent || rent) > 0, 'VALIDATION_ERROR', '新房屋月租必须大于 0')
  }
  if (tenantMode === 'existing') {
    invariant(tenantSource.tenantId, 'VALIDATION_ERROR', '请选择现有租客')
  } else {
    invariant(normalizeText(tenantSource.name), 'VALIDATION_ERROR', '缺少租客姓名')
    invariant(validIdCard(tenantSource.idCard), 'VALIDATION_ERROR', '身份证号格式或校验位不正确，请核对后再建档')
    invariant(!tenantSource.phone || /^1[3-9]\d{9}$/.test(normalizePhone(tenantSource.phone)), 'VALIDATION_ERROR', '手机号格式不正确，请核对后再建档')
  }

  let utilityBaseline = null
  if (utilitySource && (utilitySource.calculationDate || utilitySource.electricityReading !== '' || utilitySource.waterReading !== '')) {
    const calculationDate = parseDate(utilitySource.calculationDate, '水电最后结清日期')
    const electricityReading = Number(utilitySource.electricityReading)
    const waterReading = Number(utilitySource.waterReading)
    invariant(Number.isFinite(electricityReading) && electricityReading >= 0, 'VALIDATION_ERROR', '电表读数必须为大于等于 0 的数字')
    invariant(Number.isFinite(waterReading) && waterReading >= 0, 'VALIDATION_ERROR', '水表读数必须为大于等于 0 的数字')
    invariant(calculationDate.getTime() >= startDate.getTime(), 'VALIDATION_ERROR', '水电结清日期不能早于起租日期')
    utilityBaseline = {
      calculationDate: dateKey(calculationDate),
      electricityReading,
      waterReading
    }
  }

  return {
    house: houseMode === 'existing' ? {
      mode: 'existing',
      houseId: normalizeText(houseSource.houseId),
      updateRent: houseSource.updateRent !== false,
      rent: number(houseSource.rent || rent)
    } : {
      mode: 'create',
      code: normalizeText(houseSource.code),
      address: normalizeText(houseSource.address),
      rent: number(houseSource.rent || rent)
    },
    tenant: tenantMode === 'existing' ? {
      mode: 'existing',
      tenantId: normalizeText(tenantSource.tenantId)
    } : {
      mode: 'create',
      name: normalizeText(tenantSource.name),
      idCard: normalizeIdCard(tenantSource.idCard),
      phone: normalizePhone(tenantSource.phone),
      remark: normalizeText(tenantSource.remark)
    },
    lease: {
      startDate: dateKey(startDate),
      endDate: actualEndDate ? dateKey(actualEndDate) : '',
      documentStartDate: dateKey(documentStartDate),
      documentEndDate: documentEndDate ? dateKey(documentEndDate) : '',
      documentTerms: {
        rent: number(leaseSource.documentTerms && leaseSource.documentTerms.rent !== undefined ? leaseSource.documentTerms.rent : rent),
        deposit: Number.isFinite(Number(leaseSource.documentTerms && leaseSource.documentTerms.deposit)) ? Number(leaseSource.documentTerms.deposit) : deposit,
        paymentCycle: PAYMENT_CYCLES.has(leaseSource.documentTerms && leaseSource.documentTerms.paymentCycle) ? leaseSource.documentTerms.paymentCycle : paymentCycle
      },
      occupancyState,
      rent,
      deposit,
      paymentCycle,
      rentCoveredUntil: dateKey(rentCoveredUntil),
      remark: normalizeText(leaseSource.remark)
    },
    utilityBaseline
  }
}

function buildBillingPlan(input, todayValue = new Date()) {
  const rentCoveredUntil = parseDate(input.lease.rentCoveredUntil, '租金已缴至日期')
  const today = new Date(todayValue.getFullYear(), todayValue.getMonth(), todayValue.getDate())
  const cycleMonths = rentCoverage.billingMonths(input.lease.paymentCycle)
  const nextRentDueDate = addDays(rentCoveredUntil, 1)
  const unpaidPeriods = []
  if (input.lease.occupancyState === 'ended') {
    return { nextRentDueDate: dateKey(nextRentDueDate), unpaidPeriods, historicalRentAmount: 0, settledMonths: 0 }
  }
  let cursor = nextRentDueDate

  for (let count = 0; count < 600 && cursor.getTime() <= today.getTime(); count += 1) {
    const periodEnd = addDays(addMonths(cursor, cycleMonths), -1)
    unpaidPeriods.push({
      periodStart: dateKey(cursor),
      periodEnd: dateKey(periodEnd),
      period: formatPeriod(cursor, periodEnd),
      amount: number(input.lease.rent * cycleMonths),
      coverageMonths: cycleMonths
    })
    cursor = addMonths(cursor, cycleMonths)
  }

  return {
    settledMonths: 0,
    historicalRentAmount: 0,
    nextRentDueDate: dateKey(nextRentDueDate),
    unpaidPeriods
  }
}

function selectHouseDuplicate(rows, house) {
  return (rows || []).find(item => compactText(item.code) === compactText(house.code) && compactText(item.address) === compactText(house.address)) || null
}

function selectTenantDuplicate(rows, tenant) {
  const phone = normalizePhone(tenant.phone)
  const idCard = normalizeIdCard(tenant.idCard)
  const name = compactText(tenant.name)
  return (rows || []).find(item => (
    (phone && normalizePhone(item.phone) === phone) ||
    (idCard && normalizeIdCard(item.idCard) === idCard) ||
    (name && !phone && !idCard && compactText(item.name) === name && !normalizePhone(item.phone) && !normalizeIdCard(item.idCard))
  )) || null
}

function sourceDocument(doc, fields) {
  if (!doc) return null
  return fields.reduce((out, field) => {
    if (doc[field] !== undefined) out[field] = doc[field]
    return out
  }, {})
}

async function buildHistoricalImportSnapshot(repo, params, todayValue = new Date()) {
  const input = normalizeHistoricalImportInput(params)
  const [allHouses, allTenants, allLeases] = await Promise.all([
    repo.queryAll('houses'),
    repo.queryAll('tenants'),
    repo.queryAll('lease_agreements')
  ])

  let house = null
  if (input.house.mode === 'existing') {
    house = allHouses.find(item => item._id === input.house.houseId)
    invariant(house, 'NOT_FOUND', '房屋不存在')
    invariant(house.status !== 'maintenance', 'CONFLICT', '房屋维护中，不能导入合同')
    if (input.lease.occupancyState !== 'ended') invariant(!allLeases.some(item => item.houseId === house._id && item.status === 'active'), 'CONFLICT', '该房屋已有生效合同')
  } else {
    await assertNoDuplicateHouse(repo, input.house)
  }

  let tenant = null
  if (input.tenant.mode === 'existing') {
    tenant = allTenants.find(item => item._id === input.tenant.tenantId)
    invariant(tenant, 'NOT_FOUND', '租客不存在')
    if (input.lease.occupancyState !== 'ended') invariant(!allLeases.some(item => item.tenantId === tenant._id && item.status === 'active'), 'CONFLICT', '该租客已有生效合同')
  } else {
    await assertNoDuplicateTenant(repo, input.tenant)
  }

  const plan = buildBillingPlan(input, todayValue)
  const relevantLeases = allLeases.filter(item => (
    (house && item.houseId === house._id) || (tenant && item.tenantId === tenant._id)
  )).map(item => sourceDocument(item, ['_id', 'houseId', 'tenantId', 'status', 'startDate', 'updatedAt']))
  const duplicateHouse = input.house.mode === 'create' ? selectHouseDuplicate(allHouses, input.house) : null
  const duplicateTenant = input.tenant.mode === 'create' ? selectTenantDuplicate(allTenants, input.tenant) : null
  const sourceDigest = digest({
    input,
    house: sourceDocument(house, ['_id', 'code', 'address', 'rent', 'status', 'updatedAt']),
    tenant: sourceDocument(tenant, ['_id', 'name', 'phone', 'idCard', 'status', 'updatedAt']),
    duplicateHouse: sourceDocument(duplicateHouse, ['_id', 'code', 'address', 'updatedAt']),
    duplicateTenant: sourceDocument(duplicateTenant, ['_id', 'name', 'phone', 'idCard', 'updatedAt']),
    relevantLeases
  })

  return {
    targetId: (house && house._id) || (tenant && tenant._id) || '',
    sourceDigest,
    normalizedInput: input,
    plan,
    historicalImportView: {
      house: house ? { id: house._id, code: house.code || '', address: house.address || '', currentRent: number(house.rent), importedRent: input.lease.rent, updateRent: input.house.updateRent } : { id: '', code: input.house.code, address: input.house.address, currentRent: input.house.rent, importedRent: input.lease.rent, updateRent: true },
      tenant: tenant ? { id: tenant._id, name: tenant.name || '', phone: tenant.phone || '', idCard: tenant.idCard || '' } : { id: '', name: input.tenant.name, phone: input.tenant.phone, idCard: input.tenant.idCard },
      lease: input.lease,
      utilityBaseline: input.utilityBaseline,
      historicalRentAmount: 0,
      historicalDepositAmount: 0,
      nextRentDueDate: plan.nextRentDueDate,
      unpaidBillCount: plan.unpaidPeriods.length,
      unpaidAmount: number(plan.unpaidPeriods.reduce((sum, item) => sum + item.amount, 0)),
      paymentsCreated: 0
    }
  }
}

module.exports = {
  normalizeHistoricalImportInput,
  buildBillingPlan,
  buildHistoricalImportSnapshot,
  monthSpan,
  selectHouseDuplicate,
  selectTenantDuplicate,
  normalizePhone,
  normalizeIdCard,
  validIdCard,
  compactText
}
