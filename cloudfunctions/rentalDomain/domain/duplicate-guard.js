const { invariant } = require('../infrastructure/errors')

function normalizedText(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .replace(/\s+/g, '')
    .toLowerCase()
}

function normalizedPhone(value) {
  return String(value === undefined || value === null ? '' : value).replace(/[\s-]/g, '')
}

function normalizedIdCard(value) {
  return String(value === undefined || value === null ? '' : value)
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase()
}

function dateKeys(value) {
  if (!value) return []
  const text = String(value)
  const keys = new Set()
  const match = text.match(/^\d{4}-\d{2}-\d{2}/)
  if (match) keys.add(match[0])
  const date = value instanceof Date ? value : new Date(value)
  if (!Number.isNaN(date.getTime())) {
    keys.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`)
    keys.add(date.toISOString().slice(0, 10))
  }
  return [...keys]
}

function sameDate(left, right) {
  const rightKeys = new Set(dateKeys(right))
  return dateKeys(left).some(key => rightKeys.has(key))
}

async function assertNoDuplicateHouse(repo, params = {}) {
  const code = normalizedText(params.code)
  const address = normalizedText(params.address)
  const duplicate = (await repo.queryAll('houses')).find(item => (
    normalizedText(item.code) === code && normalizedText(item.address) === address
  ))
  invariant(!duplicate, 'CONFLICT', '该房屋已存在，不能重复创建', {
    existingHouseId: duplicate && duplicate._id
  })
}

async function assertNoDuplicateTenant(repo, params = {}) {
  const name = normalizedText(params.name)
  const phone = normalizedPhone(params.phone)
  const idCard = normalizedIdCard(params.idCard)
  const duplicate = (await repo.queryAll('tenants')).find(item => {
    const samePhone = phone && normalizedPhone(item.phone) === phone
    const sameIdCard = idCard && normalizedIdCard(item.idCard) === idCard
    const sameAnonymousProfile = name && !phone && !idCard && normalizedText(item.name) === name && !normalizedPhone(item.phone) && !normalizedIdCard(item.idCard)
    return samePhone || sameIdCard || sameAnonymousProfile
  })
  invariant(!duplicate, 'CONFLICT', '该租客已存在，不能重复创建', {
    existingTenantId: duplicate && duplicate._id
  })
}

async function assertNoDuplicateLease(repo, params = {}) {
  const leases = await repo.queryAll('lease_agreements')
  const exact = leases.find(item => (
    String(item.houseId) === String(params.houseId) &&
    String(item.tenantId) === String(params.tenantId) &&
    sameDate(item.startDate, params.startDate)
  ))
  invariant(!exact, 'CONFLICT', '相同房屋、租客和起租日的合同已存在，不能重复创建', {
    existingLeaseId: exact && exact._id
  })

  const activeHouseLease = leases.find(item => String(item.houseId) === String(params.houseId) && item.status === 'active')
  invariant(!activeHouseLease, 'CONFLICT', '该房屋已有生效合同')
  const activeTenantLease = leases.find(item => String(item.tenantId) === String(params.tenantId) && item.status === 'active')
  invariant(!activeTenantLease, 'CONFLICT', '该租客已有生效合同')
}

module.exports = {
  assertNoDuplicateHouse,
  assertNoDuplicateTenant,
  assertNoDuplicateLease
}
