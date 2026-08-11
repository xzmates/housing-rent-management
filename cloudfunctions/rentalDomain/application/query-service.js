const { houseView, tenantView, leaseView, billView } = require('../domain/presenters')
const { invariant } = require('../infrastructure/errors')
const { recalculateContinuousRentCoverage, formatDateKey, billingMonths, inferRentBillCoverage } = require('../domain/rent-coverage')
const { businessDateKey, businessDateValue } = require('../domain/business-date')
const { money, isCashIncoming, summarizeCashflow } = require('../domain/cashflow-summary')

function createQueryService(repo, command) {
  function dateValue(value, endOfDay = false) {
    if (!value) return null
    const key = businessDateKey(value)
    invariant(key, 'VALIDATION_ERROR', '日期格式无效')
    return businessDateValue(key, endOfDay)
  }

  function dateRange(params = {}) {
    const start = dateValue(params.startDate)
    const end = dateValue(params.endDate, true)
    invariant(!(start !== null && end !== null && start > end), 'VALIDATION_ERROR', '开始日期不能晚于结束日期')
    return { start: start === null ? 0 : start, end: end === null ? Number.MAX_SAFE_INTEGER : end }
  }

  function inRange(value, range) {
    const time = dateValue(value)
    return time !== null && time >= range.start && time <= range.end
  }

  function pagination(params = {}) {
    const page = Math.max(1, Number(params.page || 1))
    const pageSize = Math.min(100, Math.max(1, Number(params.pageSize || 20)))
    return { page, pageSize, offset: (page - 1) * pageSize }
  }

  function pageResult(rows, params = {}) {
    const { page, pageSize, offset } = pagination(params)
    return { items: rows.slice(offset, offset + pageSize), total: rows.length, page, pageSize }
  }

  function searchableHouse(house) {
    return `${house.code || ''} ${house.address || ''}`.toLowerCase()
  }

  function searchableTenant(tenant) {
    return `${tenant.name || ''} ${tenant.phone || ''} ${tenant.idCard || ''}`.toLowerCase()
  }

  async function resolveHouse(params = {}) {
    if (params.houseId) {
      const house = await repo.byId('houses', params.houseId)
      return house ? { status: 'unique', house } : { status: 'not_found', candidates: [] }
    }
    const keyword = String(params.houseKeyword || params.keyword || '').trim().toLowerCase()
    invariant(keyword, 'VALIDATION_ERROR', '请提供房屋编号、地址或房屋 ID')
    const candidates = (await repo.queryAll('houses')).filter(item => searchableHouse(item).includes(keyword))
    return candidates.length === 1 ? { status: 'unique', house: candidates[0] } : { status: candidates.length ? 'ambiguous' : 'not_found', candidates: candidates.map(houseView) }
  }

  async function resolveTenant(params = {}) {
    if (params.tenantId) {
      const tenant = await repo.byId('tenants', params.tenantId)
      return tenant ? { status: 'unique', tenant } : { status: 'not_found', candidates: [] }
    }
    const keyword = String(params.tenantKeyword || params.keyword || '').trim().toLowerCase()
    invariant(keyword, 'VALIDATION_ERROR', '请提供租客姓名、手机号或租客 ID')
    const candidates = (await repo.queryAll('tenants')).filter(item => searchableTenant(item).includes(keyword))
    return candidates.length === 1 ? { status: 'unique', tenant: candidates[0] } : { status: candidates.length ? 'ambiguous' : 'not_found', candidates: candidates.map(tenantView) }
  }

  function limited(rows, params) {
    const result = pageResult(rows, params)
    return { ...result, truncated: result.page * result.pageSize < result.total }
  }

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
    if (params.status === 'available' || params.status === 'rented') {
      const availability = await getHouseAvailability({ mode: params.status === 'rented' ? 'rented' : 'available', page: 1, pageSize: 100 })
      const rows = availability.houses.filter(item => !keyword || `${item.code} ${item.address}`.toLowerCase().includes(keyword))
      const result = limited(rows, params)
      return { houses: result.items, pagination: { total: result.total, page: result.page, pageSize: result.pageSize, truncated: result.truncated } }
    }
    const rows = await repo.queryAll('houses', params.status ? { status: params.status } : {})
    const result = limited(rows.filter(item => !keyword || searchableHouse(item).includes(keyword)).map(houseView), params)
    return { houses: result.items, pagination: { total: result.total, page: result.page, pageSize: result.pageSize, truncated: result.truncated } }
  }

  async function getHouseDetail(params = {}) {
    invariant(params.houseId, 'VALIDATION_ERROR', '缺少房屋 ID')
    const house = await repo.byId('houses', params.houseId)
    invariant(house, 'NOT_FOUND', '未找到房屋')
    const leases = await repo.queryAll('lease_agreements', { houseId: params.houseId })
    const { tenantMap } = await mapsForLeases(leases)
    const activeLease = leases.find(item => item.status === 'active') || null
    return {
      house: houseView(house),
      activeLease: activeLease ? leaseView(activeLease, house, tenantMap[activeLease.tenantId] || {}) : null,
      leaseHistory: leases.map(item => leaseView(item, house, tenantMap[item.tenantId] || {})),
      evidenceLevel: 'direct'
    }
  }

  async function searchTenants(params = {}) {
    const keyword = String(params.keyword || '').trim().toLowerCase()
    if (params.status === 'active' || params.status === 'inactive') {
      const occupancy = await getTenantOccupancy({ mode: params.status === 'active' ? 'current' : 'history', page: 1, pageSize: 100 })
      const rows = occupancy.tenants.filter(item => !keyword || `${item.name} ${item.phone}`.toLowerCase().includes(keyword))
      const result = limited(rows, params)
      return { tenants: result.items, pagination: { total: result.total, page: result.page, pageSize: result.pageSize, truncated: result.truncated } }
    }
    const rows = await repo.queryAll('tenants', params.status ? { status: params.status } : {})
    const result = limited(rows.filter(item => !keyword || searchableTenant(item).includes(keyword)).map(tenantView), params)
    return { tenants: result.items, pagination: { total: result.total, page: result.page, pageSize: result.pageSize, truncated: result.truncated } }
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
    const result = limited(views.filter(item => !keyword || `${item.house.label} ${item.tenant.name}`.toLowerCase().includes(keyword)), params)
    return { leases: result.items, pagination: { total: result.total, page: result.page, pageSize: result.pageSize, truncated: result.truncated } }
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
    const range = dateRange(params)
    let leaseIds = params.leaseId ? [params.leaseId] : []
    if (params.houseId || params.tenantId) {
      const leaseWhere = {}
      if (params.houseId) leaseWhere.houseId = params.houseId
      if (params.tenantId) leaseWhere.tenantId = params.tenantId
      const scopedLeases = await repo.queryAll('lease_agreements', leaseWhere)
      const scopedLeaseIds = new Set(scopedLeases.map(item => item._id).filter(Boolean))
      if (params.leaseId) {
        // 同时给出合同和房屋/租客条件时，必须满足全部关联条件，不能借付款记录上的冗余字段猜测。
        leaseIds = scopedLeaseIds.has(params.leaseId) ? [params.leaseId] : []
      } else {
        leaseIds = [...scopedLeaseIds]
      }
    }
    let payments = leaseIds.length
      ? await repo.queryAll('payments', { leaseId: command.in(leaseIds) }, { field: 'paymentDate', direction: 'desc' })
      : (params.leaseId || params.houseId || params.tenantId ? [] : await repo.queryAll('payments', {}, { field: 'paymentDate', direction: 'desc' }))
    payments = payments.filter(item => inRange(item.paymentDate || item.createdAt, range))
    const billIds = [...new Set(payments.map(item => item.billId).filter(Boolean))]
    const bills = billIds.length ? await repo.queryAll('bills', { _id: command.in(billIds) }) : []
    const billMap = Object.fromEntries(bills.map(item => [item._id, item]))
    const items = payments.map(item => ({ ...item, billType: billMap[item.billId]?.type || '', evidenceLevel: billMap[item.billId] ? 'direct' : 'partial' }))
    const result = limited(items, params)
    return { payments: result.items, startDate: params.startDate || '', endDate: params.endDate || '', pagination: { total: result.total, page: result.page, pageSize: result.pageSize, truncated: result.truncated } }
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
    const rows = houses.filter(house => mode === 'rented' ? !!activeByHouse[house._id] : !activeByHouse[house._id]).map(house => ({ ...houseView(house), occupancy: activeByHouse[house._id] ? 'rented' : 'available', tenantName: tenantMap[activeByHouse[house._id]?.tenantId]?.name || '', leaseId: activeByHouse[house._id]?._id || '' }))
    const result = limited(rows, params)
    return { mode, houses: result.items, pagination: { total: result.total, page: result.page, pageSize: result.pageSize, truncated: result.truncated } }
  }

  async function getTenantOccupancy(params = {}) {
    const mode = params.mode === 'current' ? 'current' : 'history'
    const tenants = await repo.queryAll('tenants')
    const leases = await repo.queryAll('lease_agreements')
    const active = new Set(leases.filter(item => item.status === 'active').map(item => item.tenantId))
    const rows = tenants.filter(item => mode === 'current' ? active.has(item._id) : !active.has(item._id)).map(item => ({ ...tenantView(item), occupancy: active.has(item._id) ? 'current' : 'history' }))
    const result = limited(rows, params)
    return { mode, tenants: result.items, pagination: { total: result.total, page: result.page, pageSize: result.pageSize, truncated: result.truncated } }
  }

  async function getFinancialReport(params = {}) {
    const range = dateRange(params)
    let leaseIds = params.leaseId ? [params.leaseId] : []
    if (params.houseId || params.tenantId) {
      const leaseWhere = {}
      if (params.houseId) leaseWhere.houseId = params.houseId
      if (params.tenantId) leaseWhere.tenantId = params.tenantId
      const scopedLeases = await repo.queryAll('lease_agreements', leaseWhere)
      const scopedLeaseIds = new Set(scopedLeases.map(item => item._id).filter(Boolean))
      leaseIds = params.leaseId ? (scopedLeaseIds.has(params.leaseId) ? [params.leaseId] : []) : [...scopedLeaseIds]
    }
    let payments = leaseIds.length
      ? await repo.queryAll('payments', { leaseId: command.in(leaseIds) }, { field: 'paymentDate', direction: 'desc' })
      : (params.leaseId || params.houseId || params.tenantId ? [] : await repo.queryAll('payments', {}, { field: 'paymentDate', direction: 'desc' }))
    const rows = payments.filter(item => inRange(item.paymentDate || item.createdAt, range))
    const billIds = [...new Set(rows.map(item => item.billId).filter(Boolean))]
    const bills = billIds.length ? await repo.queryAll('bills', { _id: command.in(billIds) }) : []
    const billMap = Object.fromEntries(bills.map(item => [item._id, item]))
    const cashflow = summarizeCashflow(rows, billMap)
    const sourceTotals = rows.filter(isCashIncoming).reduce((result, item) => {
      const key = billMap[item.billId]?.type || 'unclassified'
      result[key] = money(Number(result[key] || 0) + Number(item.amount || 0))
      return result
    }, {})
    const arrears = await getArrearsReport({ houseId: params.houseId, tenantId: params.tenantId })
    // 兼容旧客户端：这些字段不再面向用户展示；新页面统一使用 cashflow 字段。
    const rentIncome = cashflow.rentReceived
    const utilityIncome = cashflow.utilityReceived
    const damageIncome = cashflow.settlementReceived
    const totalIncome = money(rentIncome + utilityIncome + damageIncome)
    const result = limited(rows.map(item => ({ ...item, billType: billMap[item.billId]?.type || '', evidenceLevel: billMap[item.billId] ? 'direct' : 'partial' })), params)
    return {
      startDate: params.startDate || '',
      endDate: params.endDate || '',
      ...cashflow,
      // 新口径：所有已生成且未结清账单均为当前待收；逾期只是其中到期日前的子集。
      unpaidAmount: money(arrears.currentReceivableAmount),
      currentReceivableAmount: money(arrears.currentReceivableAmount),
      currentReceivableCount: arrears.currentReceivableCount,
      overdueAmount: money(arrears.overdueAmount),
      overdueCount: arrears.overdueCount,
      dueTodayAmount: money(arrears.dueTodayAmount),
      dueTodayCount: arrears.dueTodayCount,
      // 历史兼容字段：仅表示已生成账单中尚未到期的部分，不应在老人界面称为“未来待收”。
      upcomingAmount: arrears.futureOutstandingAmount,
      undatedOutstandingAmount: arrears.undatedOutstandingAmount,
      receivableAsOf: businessDateKey(new Date()),
      sourceTotals,
      // Deprecated compatibility fields. Do not use for user-facing reporting.
      totalIncome,
      totalRefund: cashflow.cashRefunded,
      netIncome: money(totalIncome - cashflow.cashRefunded),
      rentIncome,
      utilityIncome,
      damageIncome,
      payments: result.items,
      pagination: { total: result.total, page: result.page, pageSize: result.pageSize, truncated: result.truncated }
    }
  }

  async function getLeaseActivity(params = {}) {
    const range = dateRange(params)
    const leases = await repo.queryAll('lease_agreements')
    const { houseMap, tenantMap } = await mapsForLeases(leases)
    const filterDate = (value) => inRange(value, range)
    const moveIns = leases.filter(item => filterDate(item.startDate)).map(item => leaseView(item, houseMap[item.houseId] || {}, tenantMap[item.tenantId] || {}))
    const moveOuts = leases.filter(item => item.status === 'terminated' && filterDate(item.actualMoveOutDate || item.endedAt || item.terminatedAt || item.updatedAt)).map(item => ({
      ...leaseView(item, houseMap[item.houseId] || {}, tenantMap[item.tenantId] || {}),
      // 终止记录时间只能证明系统记录了退租，不能替代实际搬离日。
      moveOutRecordDate: businessDateKey(item.endedAt || item.terminatedAt || item.updatedAt),
      moveOutEvidence: item.actualMoveOutDate ? 'direct' : 'partial'
    }))
    const moveInResult = limited(moveIns, params)
    const moveOutResult = limited(moveOuts, params)
    return { startDate: params.startDate || '', endDate: params.endDate || '', moveIns: moveInResult.items, moveOuts: moveOutResult.items, pagination: { moveIns: { total: moveInResult.total, page: moveInResult.page, pageSize: moveInResult.pageSize }, moveOuts: { total: moveOutResult.total, page: moveOutResult.page, pageSize: moveOutResult.pageSize } }, limitations: '未记录 actualMoveOutDate、endedAt 或 terminatedAt 的合同只能按状态更新时间统计为退租记录，不能证明实际退租日。' }
  }

  async function getSettlementReport(params = {}) {
    const bills = await listBills({}, params)
    const types = new Set(['deposit', 'deposit_return', 'rent_refund', 'extra_due'])
    const rows = bills.filter(item => types.has(item.type))
    const terminated = await repo.queryAll('lease_agreements', { status: 'terminated' })
    const { houseMap, tenantMap } = await mapsForLeases(terminated)
    const keyword = String(params.keyword || '').trim().toLowerCase()
    const matchedLeases = terminated.filter(lease => {
      if (!keyword) return true
      const houseLabel = houseView(houseMap[lease.houseId] || {}).label
      const tenantName = tenantMap[lease.tenantId]?.name || ''
      return `${houseLabel} ${tenantName}`.toLowerCase().includes(keyword)
    })
    const leaseIds = matchedLeases.map(item => item._id).filter(Boolean)
    const settlementBills = leaseIds.length ? await repo.queryAll('bills', { leaseId: command.in(leaseIds) }) : []
    const settlementPayments = leaseIds.length ? await repo.queryAll('payments', { leaseId: command.in(leaseIds) }) : []
    const billsByLease = settlementBills.reduce((result, bill) => {
      if (!result[bill.leaseId]) result[bill.leaseId] = []
      result[bill.leaseId].push(bill)
      return result
    }, {})
    const paymentsByLease = settlementPayments.reduce((result, payment) => {
      if (!result[payment.leaseId]) result[payment.leaseId] = []
      result[payment.leaseId].push(payment)
      return result
    }, {})
    const settlements = matchedLeases.map(lease => {
      const leaseBills = billsByLease[lease._id] || []
      const leasePayments = paymentsByLease[lease._id] || []
      const damageBillIds = new Set(leaseBills.filter(item => ['extra_due', 'damage'].includes(item.type)).map(item => item._id))
      const depositBillIds = new Set(leaseBills.filter(item => item.type === 'deposit').map(item => item._id))
      const refundBillIds = new Set(leaseBills.filter(item => ['deposit_return', 'rent_refund'].includes(item.type)).map(item => item._id))
      const damageReceived = leasePayments
        .filter(item => isCashIncoming(item) && (damageBillIds.has(item.billId) || ['extra_due', 'damage'].includes(item.type)))
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
      const recordedDamageDepositDeducted = leasePayments
        .filter(item => !isCashIncoming(item) && damageBillIds.has(item.billId) && item.paymentMethod === 'deposit_damage')
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
      const refundPaidAmount = leasePayments
        .filter(item => item.direction === 'out' && (refundBillIds.has(item.billId) || ['deposit_return', 'rent_refund'].includes(item.type)))
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
      const depositRefundPaidAmount = leasePayments
        .filter(item => item.direction === 'out' && (leaseBills.find(bill => bill._id === item.billId)?.type === 'deposit_return' || item.type === 'deposit_return'))
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
      const damageAmount = Number(lease.damageAmount || 0)
      const deposit = Number(lease.deposit || 0)
      const depositReceivedAmount = leasePayments
        .filter(item => isCashIncoming(item) && depositBillIds.has(item.billId))
        .reduce((sum, item) => sum + Number(item.amount || 0), 0)
      const depositOffsetAmount = Number(lease.depositOffsetAmount || 0)
      // 旧合同没有“房损押金扣除”流水时，只在押金收款、其他抵扣与实际退款可完整
      // 对平房损金额时，才作为推导证据；不能把合同字段本身当作付款证据。
      const canDeriveDamageDepositDeduction = recordedDamageDepositDeducted <= 0
        && damageAmount > 0
        && damageAmount <= deposit
        && depositReceivedAmount >= deposit
        && Math.abs((deposit - depositOffsetAmount - depositRefundPaidAmount) - damageAmount) < 0.01
      const damageDepositDeducted = recordedDamageDepositDeducted > 0
        ? recordedDamageDepositDeducted
        : canDeriveDamageDepositDeduction
          ? damageAmount
          : 0
      const damageEvidenceSource = recordedDamageDepositDeducted > 0
        ? 'direct'
        : canDeriveDamageDepositDeduction
          ? 'derived'
          : ''
      const damageSettledAmount = damageReceived + damageDepositDeducted
      const refundSettlementAmount = Number(lease.totalRefund || 0)
      const damageEvidence = damageAmount <= 0
        ? 'not_applicable'
        : damageSettledAmount >= damageAmount
          ? (damageEvidenceSource === 'derived' ? 'derived' : 'direct')
          : damageSettledAmount > 0
            ? 'partial'
            : 'insufficient'
      const refundEvidence = refundSettlementAmount <= 0 && refundPaidAmount <= 0
        ? 'not_applicable'
        : refundPaidAmount >= refundSettlementAmount
          ? 'direct'
          : refundPaidAmount > 0
            ? 'partial'
            : 'insufficient'
      return {
        leaseId: lease._id,
        houseLabel: houseView(houseMap[lease.houseId] || {}).label,
        tenantName: tenantMap[lease.tenantId]?.name || '',
        endedAt: businessDateKey(lease.endedAt || lease.terminatedAt || lease.actualMoveOutDate),
        deposit,
        damageAmount,
        damageReceived,
        damageDepositDeducted,
        damageEvidence,
        damageUnconfirmedAmount: Math.max(0, damageAmount - damageSettledAmount),
        depositOffsetAmount,
        cashSettlementAmount: Number(lease.cashSettlementAmount || 0),
        totalRefund: refundSettlementAmount,
        refundPaidAmount,
        refundEvidence,
        refundUnconfirmedAmount: Math.max(0, refundSettlementAmount - refundPaidAmount),
        utilityCost: Number(lease.utilityCost || 0),
        evidenceLevel: damageEvidence === 'insufficient' || refundEvidence === 'insufficient' ? 'partial' : 'direct'
      }
    }).filter(item => item.damageAmount || item.depositOffsetAmount || item.cashSettlementAmount || item.totalRefund || item.utilityCost)
    const unconfirmedDamage = settlements.filter(item => item.damageEvidence === 'insufficient' || item.damageEvidence === 'partial')
    const unconfirmedRefund = settlements.filter(item => item.refundEvidence === 'insufficient' || item.refundEvidence === 'partial')
    const limitations = [
      unconfirmedDamage.length ? `有 ${unconfirmedDamage.length} 份退租结算的房损金额未被完整付款流水证明；房损结算金额不等同实际到账。` : '',
      unconfirmedRefund.length ? `有 ${unconfirmedRefund.length} 份退款结算金额未被完整付款流水证明；结算退款不等同实际退款。` : ''
    ].filter(Boolean).join('')
    return { records: rows, deposits: rows.filter(item => item.type === 'deposit'), refunds: rows.filter(item => ['deposit_return', 'rent_refund'].includes(item.type)), damages: rows.filter(item => item.type === 'extra_due'), settlements, limitations }
  }

  async function getLeaseReport(params = {}) {
    const now = new Date()
    const dueBefore = params.dueBefore ? new Date(params.dueBefore).getTime() : 0
    const leases = await repo.queryAll('lease_agreements')
    const { houseMap, tenantMap } = await mapsForLeases(leases)
    const rows = leases.filter(item => {
      if (params.houseId && item.houseId !== params.houseId) return false
      if (params.tenantId && item.tenantId !== params.tenantId) return false
      if (params.status && item.status !== params.status) return false
      if (dueBefore && !params.status && item.status !== 'active') return false
      if (dueBefore && (!item.endDate || new Date(item.endDate).getTime() > dueBefore)) return false
      return true
    }).map(item => leaseView(item, houseMap[item.houseId] || {}, tenantMap[item.tenantId] || {}))
    const expiredActive = rows.filter(item => item.status === 'active' && item.endDate && new Date(item.endDate).getTime() < now.getTime())
    const result = limited(rows, params)
    const expiredResult = limited(expiredActive, params)
    return { leases: result.items, expiredActive: expiredResult.items, pagination: { total: result.total, page: result.page, pageSize: result.pageSize, truncated: result.truncated } }
  }

  async function getArrearsReport(params = {}) {
    const today = businessDateValue(new Date())
    const bills = await listBills({ status: command.in(['unpaid', 'partial']) }, params)
    const scoped = bills.filter(item => {
      if (Number(item.remaining || 0) <= 0) return false
      if (params.houseId && item.houseId !== params.houseId) return false
      if (params.tenantId && item.tenantId !== params.tenantId) return false
      if (params.type && item.type !== params.type) return false
      return true
    })
    // 已生成且未结清的账单，都是房东现在可以办理的“当前待收”。
    // 到期日只决定是否逾期，不决定是否进入待收。
    const futureOutstanding = scoped.filter(item => {
      const due = businessDateValue(item.dueDate)
      return due !== null && due > today
    })
    const undatedOutstanding = scoped.filter(item => businessDateValue(item.dueDate) === null)
    const overdueRows = scoped
      .filter(item => {
        const due = businessDateValue(item.dueDate)
        if (due === null || due >= today) return false
        const overdueDays = Math.floor((today - due) / 86400000)
        return !params.minOverdueDays || overdueDays >= Number(params.minOverdueDays)
      })
      .map(item => {
        const due = businessDateValue(item.dueDate)
        return { ...item, overdueDays: Math.floor((today - due) / 86400000) }
      })
    const currentRows = scoped.map(item => {
      const due = businessDateValue(item.dueDate)
      return {
        ...item,
        overdueDays: due !== null && due < today ? Math.floor((today - due) / 86400000) : 0,
        dueStatus: due === null ? 'undated' : due < today ? 'overdue' : due === today ? 'due_today' : 'not_due'
      }
    })
    const result = limited(overdueRows, params)
    const futureOutstandingAmount = futureOutstanding.reduce((sum, item) => sum + Number(item.remaining || 0), 0)
    const undatedOutstandingAmount = undatedOutstanding.reduce((sum, item) => sum + Number(item.remaining || 0), 0)
    const currentReceivableAmount = currentRows.reduce((sum, item) => sum + Number(item.remaining || 0), 0)
    const dueTodayRows = currentRows.filter(item => item.dueStatus === 'due_today')
    const limitations = []
    if (futureOutstanding.length) limitations.push(`有 ${futureOutstanding.length} 笔已生成账单尚未到期（合计 ¥${futureOutstandingAmount}），已计入当前待收但不属于逾期欠费。`)
    if (undatedOutstanding.length) limitations.push(`有 ${undatedOutstanding.length} 笔未结清账单未记录到期日，已计入当前待收，但无法判断是否逾期。`)
    return {
      // 兼容旧调用：bills / totalRemaining 仍表示逾期账单及其金额。
      bills: result.items,
      totalRemaining: overdueRows.reduce((sum, item) => sum + Number(item.remaining || 0), 0),
      currentReceivableBills: currentRows,
      currentReceivableCount: currentRows.length,
      currentReceivableAmount,
      overdueCount: overdueRows.length,
      overdueAmount: overdueRows.reduce((sum, item) => sum + Number(item.remaining || 0), 0),
      dueTodayCount: dueTodayRows.length,
      dueTodayAmount: dueTodayRows.reduce((sum, item) => sum + Number(item.remaining || 0), 0),
      futureOutstandingCount: futureOutstanding.length,
      futureOutstandingAmount,
      undatedOutstandingCount: undatedOutstanding.length,
      undatedOutstandingAmount,
      limitations: limitations.join('') || '当前待收包含所有已生成且尚未结清的账单；逾期欠费仅为其中到期日前的部分。',
      pagination: { total: result.total, page: result.page, pageSize: result.pageSize, truncated: result.truncated }
    }
  }

  async function getFutureReceivables(params = {}) {
    invariant(params.startDate && params.endDate, 'VALIDATION_ERROR', '查询未来应收必须提供开始日期和结束日期')
    const range = dateRange(params)
    const today = businessDateValue(new Date())
    const bills = await listBills({ status: command.in(['unpaid', 'partial']) }, params)
    const rows = bills.filter(item => {
      if (Number(item.remaining || 0) <= 0) return false
      if (params.houseId && item.houseId !== params.houseId) return false
      if (params.tenantId && item.tenantId !== params.tenantId) return false
      if (params.type && item.type !== params.type) return false
      const due = businessDateValue(item.dueDate)
      return due !== null && due > today && due >= range.start && due <= range.end
    })
    const result = limited(rows, params)
    return {
      startDate: params.startDate,
      endDate: params.endDate,
      bills: result.items,
      totalRemaining: rows.reduce((sum, item) => sum + Number(item.remaining || 0), 0),
      pagination: { total: result.total, page: result.page, pageSize: result.pageSize, truncated: result.truncated },
      limitations: '仅统计查询区间内、当前日期之后到期且尚未结清的账单；不包含已到期欠费或已缴账单。'
    }
  }

  async function getFutureRentReminders(params = {}) {
    const days = Math.min(60, Math.max(1, Number(params.days || 15)))
    const today = businessDateValue(new Date())
    const end = new Date(today)
    end.setDate(end.getDate() + days)
    const leases = await repo.queryAll('lease_agreements', { status: 'active' })
    const leaseIds = leases.map(item => item._id).filter(Boolean)
    const rentBills = leaseIds.length
      ? await repo.queryAll('bills', { leaseId: command.in(leaseIds), type: 'rent' })
      : []
    const openBillsByLease = rentBills.reduce((result, bill) => {
      const remaining = Math.max(0, Number(bill.amount || 0) - Number(bill.paidAmount || 0))
      if (!['unpaid', 'partial'].includes(bill.status) || remaining <= 0) return result
      if (!result[bill.leaseId]) result[bill.leaseId] = []
      result[bill.leaseId].push(bill)
      return result
    }, {})
    const { houseMap, tenantMap } = await mapsForLeases(leases)
    const items = leases.map(lease => {
      const dueDate = businessDateValue(lease.nextRentDueDate)
      if (dueDate === null || dueDate <= today || dueDate > end.getTime()) return null
      // 账单优先：以账单覆盖期起点匹配下一收费期，而不是以账单 dueDate 猜测，避免同一期重复提醒。
      const hasOpenRentBill = (openBillsByLease[lease._id] || []).some(bill => {
        const coverage = inferRentBillCoverage(bill, lease)
        return coverage && businessDateValue(coverage.start) === dueDate
      })
      if (hasOpenRentBill) return null
      const house = houseMap[lease.houseId] || {}
      const tenant = tenantMap[lease.tenantId] || {}
      const daysUntilDue = Math.floor((dueDate - today) / 86400000)
      return {
        id: `lease_due_${lease._id}_${formatDateKey(lease.nextRentDueDate)}`,
        reminderKind: 'lease_due',
        leaseId: lease._id,
        houseId: lease.houseId || '',
        tenantId: lease.tenantId || '',
        houseCode: house.code || '',
        houseAddress: house.address || '',
        tenantName: tenant.name || '',
        dueDate: formatDateKey(lease.nextRentDueDate),
        expectedAmount: money(Number(lease.rent || 0) * billingMonths(lease.paymentCycle)),
        daysUntilDue,
        statusText: `${daysUntilDue}天后收租`,
        statusClass: 'status-blue',
        evidenceLevel: 'derived'
      }
    }).filter(Boolean).sort((a, b) => a.daysUntilDue - b.daysUntilDue || String(a.houseCode).localeCompare(String(b.houseCode), 'zh-CN', { numeric: true }))
    return {
      days,
      items,
      total: items.length,
      totalExpectedAmount: money(items.reduce((sum, item) => sum + Number(item.expectedAmount || 0), 0)),
      limitations: '仅为有效合同且未来指定天数内、尚未生成对应未结清租金账单的预计收租提醒；不是已形成欠款。'
    }
  }

  function reminderDateText(value) {
    const key = businessDateKey(value)
    return key ? key.replace(/-/g, '/') : ''
  }

  function billPeriodText(bill) {
    if (bill.type === 'rent') {
      if (bill.rentCoverageStart && bill.rentCoverageEnd) return `${reminderDateText(bill.rentCoverageStart)}-${reminderDateText(bill.rentCoverageEnd)}`
      if (bill.period) return bill.period.replace(/-/g, '/')
    }
    return reminderDateText(bill.meterReadingDate || bill.dueDate) || '日期未记录'
  }

  function rentRangeForBill(bill) {
    if (bill.rentCoverageStart && bill.rentCoverageEnd) return { start: businessDateKey(bill.rentCoverageStart), end: businessDateKey(bill.rentCoverageEnd) }
    const parts = String(bill.period || '').match(/(\d{4}[-/]\d{2}[-/]\d{2})\s*[~～]\s*(\d{4}[-/]\d{2}[-/]\d{2})/)
    return parts ? { start: businessDateKey(parts[1].replace(/\//g, '-')), end: businessDateKey(parts[2].replace(/\//g, '-')) } : null
  }

  function mergeRentRanges(ranges = []) {
    const ordered = ranges.filter(item => item.start && item.end).sort((a, b) => a.start.localeCompare(b.start))
    const merged = []
    ordered.forEach(range => {
      const last = merged[merged.length - 1]
      const startsNextDay = last && businessDateValue(range.start) <= businessDateValue(last.end) + 86400000
      if (startsNextDay) {
        if (range.end > last.end) last.end = range.end
      } else merged.push({ ...range })
    })
    return merged.map(item => `${reminderDateText(item.start)}-${reminderDateText(item.end)}`)
  }

  async function getCurrentReceivableGroups(params = {}) {
    const arrears = await getArrearsReport(params)
    const groups = new Map()
    arrears.currentReceivableBills.forEach(bill => {
      const key = `${bill.houseId}|${bill.tenantId}|${bill.type}`
      const current = groups.get(key) || {
        id: key,
        houseId: bill.houseId,
        tenantId: bill.tenantId,
        houseLabel: bill.houseLabel || '未关联房屋',
        tenantName: bill.tenantName || '未关联租客',
        type: bill.type,
        typeText: ['extra_due', 'damage'].includes(bill.type) ? '退租补缴' : bill.typeText,
        amount: 0,
        billCount: 0,
        billIds: [],
        periods: [],
        rentRanges: [],
        overdueAmount: 0,
        overdueCount: 0
      }
      current.amount = money(current.amount + Number(bill.remaining || 0))
      current.billCount += 1
      current.billIds.push(bill.id)
      const range = bill.type === 'rent' ? rentRangeForBill(bill) : null
      if (range) current.rentRanges.push(range)
      else {
        const period = billPeriodText(bill)
        if (period && !current.periods.includes(period)) current.periods.push(period)
      }
      if (bill.dueStatus === 'overdue') {
        current.overdueAmount = money(current.overdueAmount + Number(bill.remaining || 0))
        current.overdueCount += 1
      }
      groups.set(key, current)
    })
    return [...groups.values()].map(item => ({
      ...item,
      periodText: item.type === 'rent' ? mergeRentRanges(item.rentRanges).join('、') || item.periods.join('、') : item.periods.join('、'),
      statusText: item.overdueCount ? `含 ${item.overdueCount} 笔逾期` : '待收'
    })).sort((a, b) => Number(b.overdueAmount > 0) - Number(a.overdueAmount > 0) || String(a.houseLabel).localeCompare(String(b.houseLabel), 'zh-CN', { numeric: true }))
  }

  async function getOperatingOverview() {
    const todayKey = businessDateKey(new Date())
    const monthStart = `${todayKey.slice(0, 7)}-01`
    const monthEnd = businessDateKey(new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0))
    // Agent 原子工具有较短的结果等待窗口。以下查询彼此独立，必须并行，
    // 避免先完成财务汇总后再重复读取账单导致超时。
    const [houses, tenants, leases, financial, futureRentReminder, currentReceivableGroups] = await Promise.all([
      repo.queryAll('houses'),
      repo.queryAll('tenants'),
      repo.queryAll('lease_agreements'),
      getFinancialReport({ startDate: monthStart, endDate: monthEnd }),
      getFutureRentReminders({ days: 15 }),
      getCurrentReceivableGroups({})
    ])
    const activeLeases = leases.filter(item => item.status === 'active')
    return {
      houseCount: houses.length,
      rentedHouseCount: new Set(activeLeases.map(item => item.houseId)).size,
      vacantHouseCount: Math.max(0, houses.length - new Set(activeLeases.map(item => item.houseId)).size),
      tenantCount: tenants.length,
      activeTenantCount: new Set(activeLeases.map(item => item.tenantId).filter(Boolean)).size,
      activeLeaseCount: activeLeases.length,
      managedDeposit: money(activeLeases.reduce((sum, item) => sum + Number(item.deposit || 0), 0)),
      unpaidAmount: financial.unpaidAmount,
      currentReceivableAmount: financial.currentReceivableAmount,
      currentReceivableCount: financial.currentReceivableCount,
      currentArrearsAmount: financial.overdueAmount,
      overdueAmount: financial.overdueAmount,
      overdueCount: financial.overdueCount,
      dueTodayAmount: financial.dueTodayAmount,
      dueTodayCount: financial.dueTodayCount,
      futureOutstandingAmount: financial.upcomingAmount,
      undatedOutstandingAmount: financial.undatedOutstandingAmount,
      receivableAsOf: financial.receivableAsOf,
      monthStart,
      monthEnd,
      monthCashReceived: financial.cashReceived,
      monthCashRefunded: financial.cashRefunded,
      monthNetCashChange: financial.netCashChange,
      monthRentReceived: financial.rentReceived,
      monthUtilityReceived: financial.utilityReceived,
      monthDepositReceived: financial.depositReceived,
      monthSettlementReceived: financial.settlementReceived,
      monthOtherReceived: financial.otherReceived,
      monthIncome: financial.cashReceived,
      futureRentReminderDays: futureRentReminder.days,
      futureRentReminderAmount: futureRentReminder.totalExpectedAmount,
      futureRentReminderCount: futureRentReminder.total,
      futureRentReminders: futureRentReminder.items,
      currentReceivableGroups
    }
  }

  async function getSubjectProfile(params = {}) {
    invariant(params.houseId || params.tenantId, 'VALIDATION_ERROR', '缺少房屋或租客 ID')
    const leases = await repo.queryAll('lease_agreements', params.houseId ? { houseId: params.houseId } : { tenantId: params.tenantId })
    const { houseMap, tenantMap } = await mapsForLeases(leases)
    const leaseIds = leases.map(item => item._id).filter(Boolean)
    const bills = leaseIds.length ? await repo.queryAll('bills', { leaseId: command.in(leaseIds) }) : []
    const payments = leaseIds.length ? await repo.queryAll('payments', { leaseId: command.in(leaseIds) }, { field: 'paymentDate', direction: 'desc' }) : []
    const billMap = Object.fromEntries(bills.map(item => [item._id, item]))
    // 内部抵扣不是新收款；对象档案的“实际收款”必须与经营收入口径一致。
    const receiptPayments = payments.filter(isCashIncoming)
    const payoutPayments = payments.filter(item => item.direction === 'out')
    const actualReceivedAmount = receiptPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const actualPaidOutAmount = payoutPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const receiptTotalsByBillType = receiptPayments.reduce((totals, item) => {
      const type = billMap[item.billId]?.type || 'unknown'
      totals[type] = Number(totals[type] || 0) + Number(item.amount || 0)
      return totals
    }, {})
    const unpaidAmount = bills.filter(item => ['unpaid', 'partial'].includes(item.status)).reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0) - Number(item.paidAmount || 0)), 0)
    // 档案接口常被 Agent 作为兜底选择；复用欠费服务，避免把未来应收误称为当前欠费。
    const arrears = await getArrearsReport(params)
    const depositBillIds = new Set(bills.filter(item => item.type === 'deposit').map(item => item._id).filter(Boolean))
    const depositPayments = payments.filter(item => depositBillIds.has(item.billId) && item.direction !== 'out')
    const depositAgreedAmount = leases.reduce((sum, item) => sum + Number(item.deposit || 0), 0)
    const depositReceivedAmount = depositPayments.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const depositEvidence = depositBillIds.size
      ? 'direct'
      : depositAgreedAmount > 0
        ? 'insufficient'
        : 'not_applicable'
    const unverifiedDepositAmount = Math.max(0, depositAgreedAmount - depositReceivedAmount)
    const depositLimitation = depositEvidence === 'insufficient'
      ? '存在合同约定押金，但未找到关联押金付款流水，当前数据库记录不足以确认实际收到押金。'
      : unverifiedDepositAmount > 0
        ? `合同约定押金中仍有 ¥${unverifiedDepositAmount} 未被付款流水证明。`
        : ''
    return {
      subjectType: params.houseId ? 'house' : 'tenant',
      subject: params.houseId ? houseView(houseMap[params.houseId] || {}) : tenantView(tenantMap[params.tenantId] || {}),
      leases: leases.map(item => leaseView(item, houseMap[item.houseId] || {}, tenantMap[item.tenantId] || {})),
      unpaidAmount,
      currentArrearsAmount: arrears.totalRemaining,
      currentArrearsBills: arrears.bills,
      futureOutstandingCount: arrears.futureOutstandingCount,
      futureOutstandingAmount: arrears.futureOutstandingAmount,
      arrearsLimitations: arrears.limitations,
      paymentCount: payments.length,
      latestPayments: payments.slice(0, 10),
      // 只聚合该房屋/租客关联合同的 payments；账单应收不能替代实际收款。
      actualReceivedAmount,
      actualPaidOutAmount,
      netCashFlow: actualReceivedAmount - actualPaidOutAmount,
      receiptCount: receiptPayments.length,
      payoutCount: payoutPayments.length,
      receiptTotalsByBillType,
      receiptScope: 'all_linked_leases',
      receiptEvidence: 'direct',
      depositAgreedAmount,
      depositReceivedAmount,
      depositReceiptCount: depositPayments.length,
      depositEvidence,
      unverifiedDepositAmount,
      evidenceLevel: 'direct',
      limitations: `付款记录反映实际流水；合同押金与账单金额不等同于实际收到或退还的资金。${depositLimitation}`
    }
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

  return { searchHouses, getHouseDetail, searchTenants, getTenantDetail, getActiveLeases, getUnpaidBills, getPaymentHistory, getMeterTargets, getMoveOutTargets, getHouseAvailability, getTenantOccupancy, getFinancialReport, getLeaseActivity, getSettlementReport, getLeaseReport, getArrearsReport, getFutureReceivables, getFutureRentReminders, getCurrentReceivableGroups, getOperatingOverview, getSubjectProfile, auditLeaseRentCoverage, resolveHouse, resolveTenant, mapsForLeases }
}

module.exports = { createQueryService }
