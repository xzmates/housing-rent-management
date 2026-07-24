const { houseView, tenantView, leaseView, billView } = require('../domain/presenters')
const { invariant } = require('../infrastructure/errors')
const { recalculateContinuousRentCoverage, formatDateKey } = require('../domain/rent-coverage')

function createQueryService(repo, command) {
  async function mapsForLeases(leases) {
    const houseIds = [...new Set(leases.map(item => item.houseId).filter(Boolean))]
    const tenantIds = [...new Set(leases.map(item => item.tenantId).filter(Boolean))]
    const houses = houseIds.length ? await repo.queryAll('houses', { _id: command.in(houseIds) }) : []
    const tenants = tenantIds.length ? await repo.queryAll('tenants', { _id: command.in(tenantIds) }) : []
    return {
      houseMap: Object.fromEntries(houses.map(item => [item._id, item])),
      tenantMap: Object.fromEntries(tenants.map(item => [item._id, item]))
    }
  }

  async function searchHouses(params = {}) {
    const keyword = String(params.keyword || '').trim().toLowerCase()
    const rows = await repo.queryAll('houses', params.status ? { status: params.status } : {})
    return { houses: rows.filter(item => !keyword || `${item.code || ''} ${item.address || ''}`.toLowerCase().includes(keyword)).slice(0, 20).map(houseView) }
  }

  async function getHouseDetail(params = {}) {
    invariant(params.houseId, 'VALIDATION_ERROR', '缺少房屋 ID')
    const house = await repo.byId('houses', params.houseId)
    invariant(house, 'NOT_FOUND', '未找到房屋')
    const leases = await repo.queryAll('lease_agreements', { houseId: params.houseId, status: 'active' })
    const lease = leases[0] || null
    const tenant = lease ? await repo.byId('tenants', lease.tenantId) : null
    return { house: houseView(house), activeLease: lease ? leaseView(lease, house, tenant || {}) : null }
  }

  async function searchTenants(params = {}) {
    const keyword = String(params.keyword || '').trim().toLowerCase()
    const rows = await repo.queryAll('tenants', params.status ? { status: params.status } : {})
    return { tenants: rows.filter(item => !keyword || `${item.name || ''} ${item.phone || ''}`.toLowerCase().includes(keyword)).slice(0, 20).map(tenantView) }
  }

  async function getTenantDetail(params = {}) {
    invariant(params.tenantId, 'VALIDATION_ERROR', '缺少租客 ID')
    const tenant = await repo.byId('tenants', params.tenantId)
    invariant(tenant, 'NOT_FOUND', '未找到租客')
    const leases = await repo.queryAll('lease_agreements', { tenantId: params.tenantId })
    const { houseMap } = await mapsForLeases(leases)
    return { tenant: tenantView(tenant), leases: leases.map(item => leaseView(item, houseMap[item.houseId] || {}, tenant)) }
  }

  async function getActiveLeases(params = {}) {
    const leases = await repo.queryAll('lease_agreements', { status: 'active' }, { field: 'createdAt', direction: 'desc' })
    const { houseMap, tenantMap } = await mapsForLeases(leases)
    const keyword = String(params.keyword || '').trim().toLowerCase()
    const views = leases.map(item => leaseView(item, houseMap[item.houseId] || {}, tenantMap[item.tenantId] || {}))
    return { leases: views.filter(item => !keyword || `${item.house.label} ${item.tenant.name}`.toLowerCase().includes(keyword)).slice(0, 20) }
  }

  async function listBills(where, params = {}) {
    const bills = await repo.queryAll('bills', where, { field: 'createdAt', direction: 'desc' })
    const leaseIds = [...new Set(bills.map(item => item.leaseId).filter(Boolean))]
    const leases = leaseIds.length ? await repo.queryAll('lease_agreements', { _id: command.in(leaseIds) }) : []
    const leaseMap = Object.fromEntries(leases.map(item => [item._id, item]))
    const { houseMap, tenantMap } = await mapsForLeases(leases)
    return bills.map(item => {
      const lease = leaseMap[item.leaseId] || {}
      return billView(item, lease, houseMap[lease.houseId] || {}, tenantMap[lease.tenantId] || {})
    }).filter(item => !params.keyword || `${item.houseLabel} ${item.tenantName}`.toLowerCase().includes(String(params.keyword).toLowerCase()))
  }

  async function getUnpaidBills(params = {}) {
    const rows = await listBills({ status: command.in(['unpaid', 'partial']), type: 'rent' }, params)
    return { bills: rows.slice(0, 20), totalRemaining: rows.reduce((sum, item) => sum + item.remaining, 0) }
  }

  async function getPaymentHistory(params = {}) {
    const where = params.leaseId ? { leaseId: params.leaseId } : {}
    return { payments: (await repo.queryAll('payments', where, { field: 'paymentDate', direction: 'desc' })).slice(0, 30) }
  }

  async function getMeterTargets(params = {}) { return getActiveLeases(params) }
  async function getMoveOutTargets(params = {}) { return getActiveLeases(params) }

  async function getHouseAvailability(params = {}) {
    const mode = params.mode === 'rented' ? 'rented' : 'available'
    const houses = await repo.queryAll('houses')
    const leases = await repo.queryAll('lease_agreements', { status: 'active' })
    const activeByHouse = Object.fromEntries(leases.map(item => [item.houseId, item]))
    const tenantIds = leases.map(item => item.tenantId).filter(Boolean)
    const tenants = tenantIds.length ? await repo.queryAll('tenants', { _id: command.in(tenantIds) }) : []
    const tenantMap = Object.fromEntries(tenants.map(item => [item._id, item]))
    return { mode, houses: houses.filter(house => mode === 'rented' ? !!activeByHouse[house._id] : !activeByHouse[house._id]).map(house => ({ ...houseView(house), occupancy: activeByHouse[house._id] ? 'rented' : 'available', tenantName: tenantMap[activeByHouse[house._id]?.tenantId]?.name || '', leaseId: activeByHouse[house._id]?._id || '' })) }
  }

  async function getTenantOccupancy(params = {}) {
    const mode = params.mode === 'current' ? 'current' : 'history'
    const tenants = await repo.queryAll('tenants')
    const leases = await repo.queryAll('lease_agreements')
    const active = new Set(leases.filter(item => item.status === 'active').map(item => item.tenantId))
    return { mode, tenants: tenants.filter(item => mode === 'current' ? active.has(item._id) : !active.has(item._id)).map(item => ({ ...tenantView(item), occupancy: active.has(item._id) ? 'current' : 'history' })) }
  }

  async function getFinancialReport(params = {}) {
    const start = params.startDate ? new Date(params.startDate).getTime() : 0
    const end = params.endDate ? new Date(params.endDate).getTime() + 86400000 : Number.MAX_SAFE_INTEGER
    const payments = await repo.queryAll('payments', {}, { field: 'paymentDate', direction: 'desc' })
    const rows = payments.filter(item => { const time = new Date(item.paymentDate || item.createdAt).getTime(); return time >= start && time < end })
    const totalIncome = rows.filter(item => item.direction !== 'out').reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const totalRefund = rows.filter(item => item.direction === 'out').reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const sourceTotals = rows.reduce((result, item) => {
      const key = item.type || item.paymentType || 'other'
      result[key] = (result[key] || 0) + Number(item.amount || 0)
      return result
    }, {})
    return { startDate: params.startDate || '', endDate: params.endDate || '', totalIncome, totalRefund, netIncome: totalIncome - totalRefund, sourceTotals, payments: rows.slice(0, 100) }
  }

  async function getLeaseActivity(params = {}) {
    const start = params.startDate ? new Date(params.startDate).getTime() : 0
    const end = params.endDate ? new Date(params.endDate).getTime() + 86400000 : Number.MAX_SAFE_INTEGER
    const leases = await repo.queryAll('lease_agreements')
    const { houseMap, tenantMap } = await mapsForLeases(leases)
    const filterDate = (value) => { const time = new Date(value).getTime(); return time >= start && time < end }
    const moveIns = leases.filter(item => filterDate(item.startDate)).map(item => leaseView(item, houseMap[item.houseId] || {}, tenantMap[item.tenantId] || {}))
    const moveOuts = leases.filter(item => item.status === 'terminated' && filterDate(item.endDate || item.updatedAt)).map(item => leaseView(item, houseMap[item.houseId] || {}, tenantMap[item.tenantId] || {}))
    return { startDate: params.startDate || '', endDate: params.endDate || '', moveIns, moveOuts }
  }

  async function getSettlementReport(params = {}) {
    const bills = await listBills({}, params)
    const types = new Set(['deposit', 'deposit_return', 'rent_refund', 'extra_due'])
    const rows = bills.filter(item => types.has(item.type))
    return { records: rows, deposits: rows.filter(item => item.type === 'deposit'), refunds: rows.filter(item => ['deposit_return', 'rent_refund'].includes(item.type)), damages: rows.filter(item => item.type === 'extra_due') }
  }
  async function auditLeaseRentCoverage(params = {}) {
    invariant(params.leaseId, 'VALIDATION_ERROR', '缺少合同 ID')
    const lease = await repo.byId('lease_agreements', params.leaseId)
    invariant(lease, 'NOT_FOUND', '未找到合同')
    const rentBills = await repo.queryAll('bills', { leaseId: params.leaseId, type: 'rent' })
    const calculated = recalculateContinuousRentCoverage(lease, rentBills)
    const calculatedRentCoveredUntil = calculated.rentCoveredUntil ? formatDateKey(calculated.rentCoveredUntil) : ''
    const calculatedNextRentDueDate = calculated.nextRentDueDate ? formatDateKey(calculated.nextRentDueDate) : ''
    const storedRentCoveredUntil = lease.rentCoveredUntil ? formatDateKey(lease.rentCoveredUntil) : ''
    const storedNextRentDueDate = lease.nextRentDueDate ? formatDateKey(lease.nextRentDueDate) : ''
    return {
      leaseId: params.leaseId,
      storedRentCoveredUntil,
      calculatedRentCoveredUntil,
      storedNextRentDueDate,
      calculatedNextRentDueDate,
      isConsistent: storedRentCoveredUntil === calculatedRentCoveredUntil && storedNextRentDueDate === calculatedNextRentDueDate,
      firstUnpaidPeriod: calculated.firstUnpaidPeriod,
      continuousPaidPeriods: calculated.continuousPaidPeriods,
      anomalies: calculated.anomalies
    }
  }

  return { searchHouses, getHouseDetail, searchTenants, getTenantDetail, getActiveLeases, getUnpaidBills, getPaymentHistory, getMeterTargets, getMoveOutTargets, getHouseAvailability, getTenantOccupancy, getFinancialReport, getLeaseActivity, getSettlementReport, auditLeaseRentCoverage, mapsForLeases }
}

module.exports = { createQueryService }
