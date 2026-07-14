const { houseView, tenantView, leaseView, billView } = require('../domain/presenters')
const { invariant } = require('../infrastructure/errors')

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

  return { searchHouses, getHouseDetail, searchTenants, getTenantDetail, getActiveLeases, getUnpaidBills, getPaymentHistory, getMeterTargets, getMoveOutTargets, mapsForLeases }
}

module.exports = { createQueryService }
