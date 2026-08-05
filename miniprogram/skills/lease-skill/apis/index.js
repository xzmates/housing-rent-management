const { callRentalDomain, successResult, errorResult } = require('../../_shared/domain-client')

function encodeQuery(params = {}) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&')
}

async function getActiveLeases(params = {}) {
  console.info('[ai-mode] lease-skill getActiveLeases params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('getActiveLeases', {
      keyword: params.keyword || ''
    })
    const leases = (data && data.leases) || []
    const text = leases.length > 0
      ? `找到 ${leases.length} 份生效合同：${leases.map(l => `${l.tenant ? l.tenant.name : ''}（${l.house ? l.house.label : ''}，合同ID：${l.id || ''}）`).join('、')}。后续办理提前收租时请使用对应的合同ID。`
      : '当前没有生效的租赁合同。'
    return successResult(text, {
      title: '生效合同',
      subtitle: '办理提前收租时必须使用 leaseId/合同ID，不要使用租客ID或房屋展示名称。',
      leases: leases.map(l => ({
        id: l.id || '',
        leaseId: l.id || '',
        tenantId: l.tenant ? l.tenant.id || '' : '',
        tenantName: l.tenant ? l.tenant.name || '' : '',
        houseId: l.house ? l.house.id || '' : '',
        houseLabel: l.house ? l.house.label || '' : '',
        rent: l.rent,
        paymentCycle: l.paymentCycle,
        rentCoveredUntil: l.rentCoveredUntil,
        nextRentDueDate: l.nextRentDueDate,
        status: l.status,
        startDate: l.startDate,
        endDate: l.endDate
      })),
      fields: leases.map(l => ({
        label: l.tenant ? l.tenant.name : '—',
        value: l.house ? l.house.label : '—',
        leaseId: l.id || '',
        rentCoveredUntil: l.rentCoveredUntil || '',
        nextRentDueDate: l.nextRentDueDate || ''
      }))
    })
  } catch (err) {
    console.error('[ai-mode] lease-skill getActiveLeases error:', err.message)
    return errorResult('查询生效合同失败：' + err.message)
  }
}

async function getFinancialReport(params = {}) {
  try {
    if (isIsoDate(params.startDate) && isIsoDate(params.endDate) && params.startDate > params.endDate) {
      return successResult(`开始日期（${params.startDate}）晚于结束日期（${params.endDate}），日期范围无效，本次未执行查询。请提供正确的开始/结束日期后重查。`, {
        title: '日期范围无效',
        queryExecuted: false,
        routeRejected: 'inverted_date_range',
        limitations: '不得自行交换日期；需要用户确认正确的日期范围后重查。'
      })
    }
    const data = await callRentalDomain('getFinancialReport', params)
    const fields = [
      { label: '实际收款', value: `¥${data.cashReceived || 0}` },
      { label: '房租实际收款', value: `¥${data.rentReceived || 0}` },
      { label: '水电费实际收款', value: `¥${data.utilityReceived || 0}` },
      { label: '收取押金（保证金）', value: `¥${data.depositReceived || 0}` },
      { label: '退租补缴', value: `¥${data.settlementReceived || 0}` },
      { label: '其他收款', value: `¥${data.otherReceived || 0}` },
      { label: '实际退款', value: `¥${data.cashRefunded || 0}` },
      { label: '退还押金', value: `¥${data.depositRefund || 0}` },
      { label: '退还多收租金', value: `¥${data.rentRefund || 0}` },
      { label: '其他退款', value: `¥${data.otherRefund || 0}` },
      { label: `当前待收（截至 ${data.receivableAsOf || '今天'}）`, value: `¥${data.currentReceivableAmount || data.unpaidAmount || 0}` },
      { label: '其中逾期欠费', value: `¥${data.overdueAmount || 0}` }
    ]
    const limitations = []
    if (data.unclassifiedIncomingCount) limitations.push(`有 ${data.unclassifiedIncomingCount} 笔实际收款未关联可识别账单类型，已列入其他收款。`)
    if (data.unclassifiedRefundCount) limitations.push(`有 ${data.unclassifiedRefundCount} 笔实际退款未关联可识别账单类型，已列入其他退款。`)
    if (data.undatedOutstandingAmount) limitations.push(`有 ¥${data.undatedOutstandingAmount} 未结清账单未记录到期日，已计入当前待收，但无法判断是否逾期。`)
    return successResult('已按真实付款流水汇总实际收款和实际退款，押金单列为保证金。上述金额未扣维修、税费等支出，不能等同利润。', {
      title: '收款与退款汇总',
      subtitle: `${data.startDate || '全部时间'} 至 ${data.endDate || '今天'}`,
      fields,
      limitations: limitations.join('')
    })
  } catch (err) { return errorResult('查询收支汇总失败：' + err.message) }
}

function globalActivityRouteRejectedResult() {
  return successResult('此接口只能查询未指定房屋和租客的全量时间范围名单；当前未执行数据库查询。指定租客住过哪些房，请使用租客详情查询。', {
    title: '查询范围需要确认',
    queryExecuted: false,
    routeRejected: 'global_activity_requires_unfiltered_scope',
    canAnswerSubjectSpecific: false,
    resultKind: 'global_activity_list',
    limitations: '未确认全量无对象查询，不能用全库入住退租名单推断指定租客历史。'
  })
}

function isIsoDate(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''))
}

async function listGlobalMoveInOutByDateRange(params = {}) {
  if (params.scope !== 'global_unfiltered' || !isIsoDate(params.startDate) || !isIsoDate(params.endDate) || params.startDate > params.endDate) {
    return globalActivityRouteRejectedResult()
  }
  try {
    const { scope, ...range } = params
    const data = await callRentalDomain('getLeaseActivity', range)
    const fields = [...(data.moveIns || []).map(item => ({ label: `入住 · ${item.tenant.name}`, value: item.house.label })), ...(data.moveOuts || []).map(item => ({ label: `退租 · ${item.tenant.name}`, value: item.house.label }))]
    return successResult(`全量时间范围内：入住 ${data.moveIns.length} 人，退租 ${data.moveOuts.length} 人。`, {
      title: '全量入住与退租名单',
      fields,
      queryExecuted: true,
      queryScope: scope,
      subject: null,
      filters: range,
      resultKind: 'global_activity_list',
      limitations: '该结果是未筛选任何房屋或租客的全量名单，不能用于推断指定对象。'
    })
  } catch (err) { return errorResult('查询入住退租名单失败：' + err.message) }
}

function relativeDateRange(period = 'this_month', now = new Date()) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const date = formatLocalDate
  const today = new Date(year, month, now.getDate())
  const addDays = (days) => new Date(year, month, now.getDate() + days)
  const weekDay = today.getDay() || 7
  const monday = addDays(1 - weekDay)
  if (period === 'today') return { startDate: date(today), endDate: date(today) }
  if (period === 'yesterday') return { startDate: date(addDays(-1)), endDate: date(addDays(-1)) }
  if (period === 'this_week') return { startDate: date(monday), endDate: date(addDays(7 - weekDay)) }
  if (period === 'last_week') return { startDate: date(addDays(-weekDay - 6)), endDate: date(addDays(-weekDay)) }
  if (period === 'recent_7_days') return { startDate: date(addDays(-6)), endDate: date(today) }
  if (period === 'recent_30_days') return { startDate: date(addDays(-29)), endDate: date(today) }
  if (period === 'last_month') return { startDate: date(new Date(year, month - 1, 1)), endDate: date(new Date(year, month, 0)) }
  if (period === 'this_year') return { startDate: `${year}-01-01`, endDate: `${year}-12-31` }
  if (period === 'last_year') return { startDate: `${year - 1}-01-01`, endDate: `${year - 1}-12-31` }
  return { startDate: date(new Date(year, month, 1)), endDate: date(new Date(year, month + 1, 0)) }
}

async function listGlobalMoveInOutForRelativePeriod(params = {}) {
  if (params.scope !== 'global_unfiltered') return globalActivityRouteRejectedResult()
  try {
    const range = relativeDateRange(params.period)
    const data = await callRentalDomain('getLeaseActivity', range)
    const fields = [
      ...(data.moveIns || []).map(item => ({ label: `入住 · ${item.tenant.name}`, value: item.house.label })),
      ...(data.moveOuts || []).map(item => ({ label: `退租 · ${item.tenant.name}`, value: item.house.label }))
    ]
    return successResult(`按${({ today: '今天', yesterday: '昨天', this_week: '本周', last_week: '上周', recent_7_days: '最近7天', recent_30_days: '最近30天', this_month: '本月', last_month: '上月', this_year: '今年', last_year: '去年' })[params.period] || '本月'}统计：入住 ${data.moveIns.length} 人，退租 ${data.moveOuts.length} 人。`, {
      title: '入住与退租名单',
      subtitle: `${range.startDate} 至 ${range.endDate}`,
      fields,
      ...data,
      queryExecuted: true,
      queryScope: params.scope,
      subject: null,
      filters: range,
      resultKind: 'global_activity_list',
      limitations: '该结果是未筛选任何房屋或租客的全量名单，不能用于推断指定对象。'
    })
  } catch (err) { return errorResult('查询入住退租名单失败：' + err.message) }
}

async function getSettlementReport(params = {}) {
  try {
    const data = await callRentalDomain('getSettlementReport', params)
    const settlements = data.settlements || []
    const settlementFields = settlements.flatMap(item => {
      const fields = [{ label: `退租结算 · ${item.tenantName || '未标注租客'}`, value: `${item.houseLabel || '未标注房屋'}，现金结算 ¥${item.cashSettlementAmount || 0}` }]
      if (Number(item.damageAmount || 0) !== 0) {
        const damageDepositText = Number(item.damageDepositDeducted || 0) > 0
          ? `；从押金扣除 ¥${item.damageDepositDeducted}（非现金）`
          : ''
        const actualText = item.damageEvidence === 'direct'
          ? `已证实结算：现金到账 ¥${item.damageReceived || 0}${damageDepositText}`
          : item.damageEvidence === 'derived'
            ? `已由押金收款、抵扣和退款流水复核${damageDepositText}`
          : item.damageEvidence === 'partial'
            ? `已证实结算 ¥${(item.damageReceived || 0) + (item.damageDepositDeducted || 0)}，其余 ¥${item.damageUnconfirmedAmount || 0} 当前无法确认`
            : '当前无付款流水，无法确认实际到账'
        fields.push({ label: `房损结算 · ${item.tenantName || '未标注租客'}`, value: `结算金额 ¥${item.damageAmount}；${actualText}` })
      }
      if (Number(item.depositOffsetAmount || 0) !== 0) fields.push({ label: `押金抵扣 · ${item.tenantName || '未标注租客'}`, value: `¥${item.depositOffsetAmount}` })
      if (Number(item.totalRefund || 0) !== 0 || Number(item.refundPaidAmount || 0) !== 0) {
        const refundText = item.refundEvidence === 'direct'
          ? `实际退款 ¥${item.refundPaidAmount || 0}`
          : item.refundEvidence === 'partial'
            ? `已证实退款 ¥${item.refundPaidAmount || 0}，其余 ¥${item.refundUnconfirmedAmount || 0} 当前无法确认`
            : '当前无退款付款流水，无法确认实际退款'
        fields.push({ label: `退款结算 · ${item.tenantName || '未标注租客'}`, value: `结算金额 ¥${item.totalRefund || 0}；${refundText}` })
      }
      return fields
    })
    const damageCount = settlements.filter(item => Number(item.damageAmount || 0) > 0).length
    const settlementSummary = settlements.map(item => {
      const parts = [`合同押金 ¥${item.deposit || 0}`, `房损结算 ¥${item.damageAmount || 0}`, `押金抵扣 ¥${item.depositOffsetAmount || 0}`, `水电结算 ¥${item.utilityCost || 0}`]
      if (Number(item.totalRefund || 0) !== 0 || Number(item.refundPaidAmount || 0) !== 0) {
        parts.push(item.refundEvidence === 'direct' ? `实际退款 ¥${item.refundPaidAmount || 0}` : `退款结算 ¥${item.totalRefund || 0}（实际退款待付款流水确认）`)
      }
      return `${item.tenantName || '未标注租客'}（${item.houseLabel || '未标注房屋'}）：${parts.join('，')}`
    }).join('；')
    return successResult(
      `已汇总押金、退款、补缴与退租结算记录${damageCount ? `，其中 ${damageCount} 条含房损` : ''}。${settlementSummary}${data.limitations || ''}`,
      {
        title: '押金、退款与退租结算',
        fields: [
          ...(data.records || []).map(item => ({ label: `${item.typeText}账单 · ${item.tenantName}`, value: `账单金额 ¥${item.amount}（不等同实际收付款）` })),
          ...settlementFields
        ],
        settlements,
        limitations: data.limitations || ''
      }
    )
  } catch (err) { return errorResult('查询结算流水失败：' + err.message) }
}

function formatPaymentHistory(data = {}, subjectName = '') {
  const payments = data.payments || []
  const typeText = { rent: '租金', deposit: '押金', utility: '水电费', electricity: '电费', water: '水费', extra_due: '退租补缴', damage: '退租补缴', deposit_return: '押金退还', rent_refund: '租金退还' }
  const isInternalOffset = item => item.direction !== 'out' && (item.cashImpact === false || item.paymentMethod === 'deposit_offset')
  const isCashIncoming = item => item.direction === 'in' && !isInternalOffset(item)
  const incoming = payments.filter(isCashIncoming)
  const outgoing = payments.filter(item => item.direction === 'out')
  const internalOffsets = payments.filter(isInternalOffset)
  const sourceTotals = incoming.reduce((result, item) => {
    const type = item.billType || 'unknown'
    result[type] = (result[type] || 0) + Number(item.amount || 0)
    return result
  }, {})
  const sourceSummary = Object.entries(sourceTotals)
    .map(([type, amount]) => `${typeText[type] || '未分类'} ¥${amount}`)
    .join('，')
  const incomingTotal = incoming.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  const outgoingTotal = outgoing.reduce((sum, item) => sum + Number(item.amount || 0), 0)
  return successResult(
    `${subjectName ? `${subjectName}：` : ''}找到 ${payments.length} 条资金流水：实际收款 ¥${incomingTotal}${sourceSummary ? `（${sourceSummary}）` : ''}${internalOffsets.length ? `；另有 ${internalOffsets.length} 条内部抵扣，非新增收款` : ''}${outgoing.length ? `；实际退款/支出 ¥${outgoingTotal}` : ''}。`,
    {
      title: '缴费历史',
      fields: [
        { label: '实际收款合计', value: `¥${incomingTotal}` },
        ...(internalOffsets.length ? [{ label: '内部抵扣（非新增收款）', value: `¥${internalOffsets.reduce((sum, item) => sum + Number(item.amount || 0), 0)}` }] : []),
        ...Object.entries(sourceTotals).map(([type, amount]) => ({ label: `${typeText[type] || '未分类'}实收`, value: `¥${amount}` })),
        ...(outgoing.length ? [{ label: '实际退款/支出', value: `¥${outgoingTotal}` }] : []),
        ...payments.map(item => ({ label: `${item.direction === 'out' ? '退款/支出' : isInternalOffset(item) ? '内部抵扣' : '收款'} · ${typeText[item.billType] || item.billType || '未分类'} · ${item.paymentDate || '未标注日期'}`, value: `¥${item.amount || 0}` }))
      ],
      payments,
      sourceTotals,
      incomingTotal,
      outgoingTotal,
      internalOffsetTotal: internalOffsets.reduce((sum, item) => sum + Number(item.amount || 0), 0),
      evidenceLevel: payments.every(item => item.evidenceLevel === 'direct') ? 'direct' : 'partial'
    }
  )
}

async function getLeasePaymentHistory(params = {}) {
  try {
    if (!params.leaseId) return errorResult('请先确定要查询的合同；可先查询该房屋或租客的合同。')
    return formatPaymentHistory(await callRentalDomain('getPaymentHistory', { leaseId: params.leaseId }))
  } catch (err) { return errorResult('查询缴费历史失败：' + err.message) }
}

async function getTenantPaymentHistoryByKeyword(params = {}) {
  const keyword = String(params.keyword || '').trim()
  if (!keyword) return errorResult('请提供租客姓名或手机号。')
  try {
    const resolved = await callRentalDomain('resolveTenant', { keyword })
    if (resolved.status === 'not_found') return errorResult(`没有找到“${keyword}”对应的租客。`)
    if (resolved.status === 'ambiguous') {
      const candidates = resolved.candidates || []
      return successResult(`找到 ${candidates.length} 位匹配租客，请根据手机号或房屋进一步确认；不会自动混合不同租客的付款记录。`, {
        title: '需要确认租客',
        candidates,
        fields: candidates.map(item => ({ label: item.name || '未命名租客', value: item.phone || '当前数据库未记录手机号' })),
        evidenceLevel: 'direct',
        limitations: '存在多个匹配租客，当前数据库不足以确认用户指的是哪一位。'
      })
    }
    const tenant = resolved.tenant || {}
    if (!tenant._id) return errorResult('未能确认唯一租客，无法查询付款记录。')
    const range = paymentHistoryRange(params)
    return formatPaymentHistory(await callRentalDomain('getPaymentHistory', { tenantId: tenant._id, ...range }), tenant.name || keyword)
  } catch (err) { return errorResult('查询租客缴费历史失败：' + err.message) }
}

function paymentHistoryRange(params = {}) {
  if (isIsoDate(params.startDate) && isIsoDate(params.endDate) && params.startDate <= params.endDate) {
    return { startDate: params.startDate, endDate: params.endDate }
  }
  if (params.period) return relativeDateRange(params.period)
  return {}
}

async function getHousePaymentHistoryByKeyword(params = {}) {
  const keyword = String(params.keyword || '').trim()
  if (!keyword) return errorResult('请提供房屋编号或地址关键词。')
  try {
    const resolved = await callRentalDomain('resolveHouse', { keyword })
    if (resolved.status === 'not_found') return errorResult(`没有找到“${keyword}”对应的房屋。`)
    if (resolved.status === 'ambiguous') {
      const candidates = resolved.candidates || []
      return successResult(`找到 ${candidates.length} 套匹配房屋，请补充编号或地址；不会混合不同房屋的付款记录。`, {
        title: '需要确认房屋',
        candidates,
        fields: candidates.map(item => ({ label: item.label || '未标注房屋', value: item.address || '当前数据库未记录地址' })),
        evidenceLevel: 'direct',
        limitations: '存在多个匹配房屋，当前数据库不足以确认用户指的是哪一套。'
      })
    }
    const house = resolved.house || {}
    if (!house._id) return errorResult('未能确认唯一房屋，无法查询付款记录。')
    return formatPaymentHistory(await callRentalDomain('getPaymentHistory', { houseId: house._id, ...paymentHistoryRange(params) }), house.label || keyword)
  } catch (err) { return errorResult('查询房屋缴费历史失败：' + err.message) }
}

async function getTenantArrearsByKeyword(params = {}) {
  const keyword = String(params.keyword || '').trim()
  if (!keyword) return errorResult('请提供租客姓名或手机号。')
  try {
    const resolved = await callRentalDomain('resolveTenant', { keyword })
    if (resolved.status === 'not_found') return errorResult(`没有找到“${keyword}”对应的租客。`)
    if (resolved.status === 'ambiguous') return successResult('找到多个同名或相似租客，请补充手机号后再查欠费；不会混合不同租客的账单。', { title: '需要确认租客', candidates: resolved.candidates || [], evidenceLevel: 'direct', limitations: '当前数据库不足以确认用户指的是哪一位。' })
    const tenant = resolved.tenant || {}
    if (!tenant._id) return errorResult('未能确认唯一租客，无法查询欠费。')
    return getArrearsReport({ tenantId: tenant._id, type: params.type, minOverdueDays: params.minOverdueDays })
  } catch (err) { return errorResult('查询租客欠费失败：' + err.message) }
}

async function getContractOverview(params = {}) {
  try {
    const data = await callRentalDomain('getLeaseReport', {})
    const today = formatLocalDate(new Date())
    const active = (data.leases || []).filter(item => item.status === 'active')
    const expiredActive = active.filter(item => item.endDate && item.endDate < today)
    const duplicate = (items, key) => Object.values(items.reduce((groups, item) => {
      const value = item[key]
      if (!value) return groups
      groups[value] = groups[value] || []
      groups[value].push(item)
      return groups
    }, {})).filter(group => group.length > 1)
    const houseConflicts = duplicate(active.map(item => ({ ...item, _groupId: item.house?.id })), '_groupId')
    const tenantConflicts = duplicate(active.map(item => ({ ...item, _groupId: item.tenant?.id })), '_groupId')
    const mode = params.mode || 'active'
    const rows = mode === 'expired_active' ? expiredActive : mode === 'house_conflicts' ? houseConflicts.flat() : mode === 'tenant_conflicts' ? tenantConflicts.flat() : active
    const label = { active: '有效合同', expired_active: '已到期仍有效的合同', house_conflicts: '同房屋多份有效合同', tenant_conflicts: '同租客多份有效合同' }[mode] || '有效合同'
    return successResult(`${label} ${rows.length} 份。`, {
      title: '合同概览',
      fields: rows.map(item => ({ label: `${item.house?.label || '未标注房屋'} · ${item.tenant?.name || '未标注租客'}`, value: `合同 ${item.id || item._id || '—'}，到期 ${item.endDate || '未记录'}` })),
      activeCount: active.length,
      expiredActiveCount: expiredActive.length,
      houseConflictCount: houseConflicts.length,
      tenantConflictCount: tenantConflicts.length,
      evidenceLevel: 'direct',
      limitations: '合同结束日不等于实际退租日；本结果仅检查合同记录本身。'
    })
  } catch (err) { return errorResult('查询合同概览失败：' + err.message) }
}

function relativeLeaseExpiryRange(period = 'next_7_days', now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const addDays = (days) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days)
  if (period === 'next_month') {
    return {
      startDate: formatLocalDate(new Date(today.getFullYear(), today.getMonth() + 1, 1)),
      endDate: formatLocalDate(new Date(today.getFullYear(), today.getMonth() + 2, 0))
    }
  }
  const days = { next_10_days: 10, next_30_days: 30 }[period] || 7
  return { startDate: formatLocalDate(addDays(1)), endDate: formatLocalDate(addDays(days)) }
}

async function getRelativeLeaseExpiry(params = {}) {
  try {
    const data = await callRentalDomain('getLeaseReport', {})
    const active = (data.leases || []).filter(item => item.status === 'active')
    const mode = params.mode || 'relative'
    const range = mode === 'earliest' ? null : relativeLeaseExpiryRange(params.period)
    const dated = active.filter(item => isIsoDate(item.endDate)).sort((a, b) => a.endDate.localeCompare(b.endDate))
    const rows = mode === 'earliest'
      ? dated.slice(0, 1)
      : dated.filter(item => item.endDate >= range.startDate && item.endDate <= range.endDate)
    const withoutEndDate = active.filter(item => !isIsoDate(item.endDate)).length
    const label = mode === 'earliest' ? '最先到期的有效合同' : `${range.startDate} 至 ${range.endDate} 到期的有效合同`
    return successResult(`${label} ${rows.length} 份。${withoutEndDate ? `另有 ${withoutEndDate} 份有效合同未记录结束日，当前无法判断其到期时间。` : ''}`, {
      title: '合同到期查询',
      subtitle: mode === 'earliest' ? '' : `${range.startDate} 至 ${range.endDate}`,
      fields: rows.map(item => ({ label: `${item.house?.label || '未标注房屋'} · ${item.tenant?.name || '未标注租客'}`, value: `合同 ${item.id || item._id || '—'}，结束日 ${item.endDate}` })),
      contracts: rows,
      filters: range || { mode: 'earliest' },
      evidenceLevel: 'direct',
      limitations: `${withoutEndDate ? `有 ${withoutEndDate} 份有效合同未记录结束日，无法判断到期时间。` : ''}合同结束日不等于实际退租日。`
    })
  } catch (err) { return errorResult('查询合同到期失败：' + err.message) }
}

async function getLeaseReport(params = {}) {
  try {
    const data = await callRentalDomain('getLeaseReport', params)
    return successResult(`找到 ${data.leases.length} 份合同。`, { title: '合同查询', fields: data.leases.map(item => ({ label: `${item.house.label} · ${item.tenant.name}`, value: `${item.statusText}，到期 ${item.endDate || '未记录'}` })) })
  } catch (err) { return errorResult('查询合同失败：' + err.message) }
}

function groupArrearsByTenant(bills = []) {
  const byTenant = []
  const index = {}
  for (const item of bills) {
    const key = item.tenantId || item.tenantName || '未标注租客'
    if (!index[key]) {
      index[key] = { tenantName: item.tenantName || '未标注租客', billCount: 0, totalRemaining: 0 }
      byTenant.push(index[key])
    }
    index[key].billCount += 1
    index[key].totalRemaining += Number(item.remaining || 0)
  }
  return byTenant
}

async function getArrearsReport(params = {}) {
  try {
    const data = await callRentalDomain('getArrearsReport', params)
    const futureText = data.futureOutstandingCount
      ? `另有未来应收 ¥${data.futureOutstandingAmount || 0}，不计入当前欠费。`
      : ''
    const byTenant = groupArrearsByTenant(data.bills)
    const byTenantText = byTenant.map(t => `${t.tenantName} ¥${t.totalRemaining}`).join('；')
    return successResult(`当前已到期未缴 ${data.totalRemaining || 0} 元，共 ${data.bills.length} 笔（按租客：${byTenantText || '无'}）。${futureText}`, {
      title: '欠费与逾期',
      summary: `按租客：${byTenantText || '无'}`,
      byTenant,
      fields: data.bills.map(item => ({
        label: `${item.tenantName || '未标注租客'} · ${item.typeText}`,
        value: `应缴 ¥${item.amount}，已缴 ¥${item.paidAmount}，待缴 ¥${item.remaining}，逾期 ${item.overdueDays} 天`
      })),
      futureOutstandingCount: data.futureOutstandingCount || 0,
      futureOutstandingAmount: data.futureOutstandingAmount || 0,
      limitations: data.limitations || ''
    })
  } catch (err) { return errorResult('查询欠费失败：' + err.message) }
}

function formatLocalDate(value) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
}

function relativeFutureReceivableRange(period = 'next_7_days', now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const addDays = (days) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days)
  if (period === 'next_week') {
    const weekDay = today.getDay() || 7
    const nextMonday = addDays(8 - weekDay)
    return { startDate: formatLocalDate(nextMonday), endDate: formatLocalDate(new Date(nextMonday.getFullYear(), nextMonday.getMonth(), nextMonday.getDate() + 6)) }
  }
  const days = { next_10_days: 10, next_30_days: 30 }[period] || 7
  return { startDate: formatLocalDate(addDays(1)), endDate: formatLocalDate(addDays(days)) }
}

function futureReceivableResult(data = {}, title = '未来应收') {
  const bills = data.bills || []
  return successResult(
    `${data.startDate || '开始日期'} 至 ${data.endDate || '结束日期'}有 ${bills.length} 笔未来应收，合计 ¥${data.totalRemaining || 0}；不含当前已到期欠费。`,
    {
      title,
      subtitle: `${data.startDate || '—'} 至 ${data.endDate || '—'}`,
      fields: bills.map(item => ({
        label: `${item.tenantName || '未标注租客'} · ${item.typeText || '账单'} · 到期 ${item.dueDate || '未标注'}`,
        value: `应缴 ¥${item.amount || 0}，已缴 ¥${item.paidAmount || 0}，待缴 ¥${item.remaining || 0}`
      })),
      bills,
      totalRemaining: data.totalRemaining || 0,
      limitations: data.limitations || ''
    }
  )
}

async function getFutureReceivablesByExplicitDateRange(params = {}) {
  if (params.scope !== 'explicit_date_range') {
    return successResult('此接口只用于用户明确给出开始和结束日期的未来应收查询；当前未执行数据库查询。用户说“未来7天/下周”时，应使用相对未来应收查询。', {
      title: '查询范围需要确认',
      queryExecuted: false,
      routeRejected: 'future_receivables_requires_explicit_date_range',
      limitations: '未确认明确日期范围，不能自行生成日期后改查。'
    })
  }
  try {
    if (!params.startDate || !params.endDate) return errorResult('请提供未来应收的开始日期和结束日期。')
    const { scope, ...query } = params
    return futureReceivableResult(await callRentalDomain('getFutureReceivables', query))
  } catch (err) { return errorResult('查询未来应收失败：' + err.message) }
}

function isFutureReceivablesActionUnavailable(err) {
  const message = String(err?.message || '')
  return /getFutureReceivables/i.test(message) && /(未知|未实现|不支持|unknown|not\s*found)/i.test(message)
}

function futureReceivablesDeploymentPendingResult() {
  return successResult('停止查询：当前云端 rentalDomain 尚未部署 getFutureReceivables，因此本次没有得到任何未来应收金额或账单。请只说明“当前云端能力未部署，无法确认未来应收，请部署后重新查询”；不得引用经营概览、待收、当前欠费或任何未由本次工具返回的金额。', {
    title: '未来应收待云端部署',
    queryExecuted: false,
    deploymentRequired: true,
    answerPolicy: '只可陈述当前云端能力未部署、无法确认未来应收和请部署后重试；禁止补充任何金额或其他查询结果。',
    limitations: '当前云端能力未就绪，数据库结果不足以回答；不得自动改查其他接口、不得从其他上下文推断金额。'
  })
}

async function getRelativeFutureReceivables(params = {}) {
  try {
    const range = relativeFutureReceivableRange(params.period)
    return futureReceivableResult(await callRentalDomain('getFutureReceivables', range), '未来到期应收')
  } catch (err) {
    if (isFutureReceivablesActionUnavailable(err)) return futureReceivablesDeploymentPendingResult()
    return errorResult('查询未来应收失败：' + err.message)
  }
}

async function getOperatingOverview() {
  try {
    const [data, arrears] = await Promise.all([
      callRentalDomain('getOperatingOverview', {}),
      callRentalDomain('getArrearsReport', {})
    ])
    const byTenant = groupArrearsByTenant(arrears.bills || [])
    const byTenantText = byTenant.map(t => `${t.tenantName} ¥${t.totalRemaining}`).join('；')
    return successResult('已汇总当前经营概况。本月实际收款包含押金，且未扣维修、税费等支出，不能等同利润。', {
      title: '经营概况',
      fields: [
        { label: '房屋总数', value: String(data.houseCount) },
        { label: '已出租 / 空置', value: `${data.rentedHouseCount} / ${data.vacantHouseCount}` },
        { label: '有效合同', value: String(data.activeLeaseCount) },
        { label: '当前待收', value: `¥${data.currentReceivableAmount || data.unpaidAmount || 0}` },
        { label: '其中逾期欠费', value: `¥${data.overdueAmount || data.currentArrearsAmount || 0}` },
        { label: '欠费按租客', value: byTenantText || '无' },
        { label: `未来${data.futureRentReminderDays || 15}天即将收租（预计）`, value: `¥${data.futureRentReminderAmount || 0}` },
        { label: '本月实际收款', value: `¥${data.monthCashReceived || 0}` },
        { label: '本月实际退款', value: `¥${data.monthCashRefunded || 0}` },
        { label: '本月收取押金', value: `¥${data.monthDepositReceived || 0}` }
      ],
      byTenant,
      limitations: data.arrearsLimitations || ''
    })
  } catch (err) { return errorResult('查询经营概况失败：' + err.message) }
}

async function getSubjectProfile(params = {}) {
  try {
    // 房屋综合档案只能由 house-skill 的安全关键词入口处理，避免此泛化接口抢占房屋路由。
    if (!params.tenantId || params.houseId) return errorResult('此接口仅用于已唯一确认的租客综合档案；房屋整体情况请使用房屋查询入口。')
    const data = await callRentalDomain('getSubjectProfile', { tenantId: params.tenantId })
    const subject = data.subject || {}
    const activeLease = (data.leases || []).find(item => item.status === 'active') || null
    const depositEvidenceText = data.depositEvidence === 'direct'
      ? '已由付款流水证实'
      : data.depositEvidence === 'insufficient'
        ? '当前数据库记录不足以确认'
        : '不适用'
    return successResult('已汇总该对象的合同、待缴、押金和实际付款记录；待缴可能包含未来应收，不等同当前欠费。', {
      title: '租客档案',
      subtitle: subject.label || subject.name || '—',
      fields: [
        ...(data.subjectType === 'tenant' ? [
          { label: '姓名', value: subject.name || '—' },
          { label: '电话', value: subject.phone || '当前数据库未记录' },
          { label: '身份证', value: subject.idCard || '当前数据库未记录' },
          { label: '当前房屋', value: activeLease?.house?.label || '当前无生效合同' },
          ...(activeLease ? [{ label: '当前合同', value: `${activeLease.startDate || '未记录'} 至 ${activeLease.endDate || '未记录'}` }] : [])
        ] : []),
        { label: '合同数', value: String((data.leases || []).length) },
        ...(data.leases || []).map((item, index) => ({
          label: `合同 ${index + 1} · ${item.house?.label || item.tenant?.name || '未标注对象'}`,
          value: `${item.statusText || item.status || '未知状态'}，${item.startDate || '未记录起租日'} 至 ${item.endDate || '未记录结束日'}`
        })),
        { label: '合同约定押金', value: `¥${data.depositAgreedAmount || 0}` },
        { label: `实际收到押金（${depositEvidenceText}）`, value: `¥${data.depositReceivedAmount || 0}` },
        { label: '当前已到期欠费', value: `¥${data.currentArrearsAmount || 0}` },
        ...(data.currentArrearsBills || []).map(item => ({
          label: `${item.typeText || '账单'} · ${item.dueDate || '未标注到期日'}`,
          value: `应缴 ¥${item.amount || 0}，已缴 ¥${item.paidAmount || 0}，待缴 ¥${item.remaining || 0}，逾期 ${item.overdueDays || 0} 天`
        })),
        ...(data.futureOutstandingCount ? [{ label: '未来应收（不计当前欠费）', value: `¥${data.futureOutstandingAmount || 0}` }] : []),
        { label: '待缴金额（可能含未来应收）', value: `¥${data.unpaidAmount || 0}` },
        { label: '付款记录', value: `${data.paymentCount || 0} 笔` }
      ],
      evidenceLevel: data.evidenceLevel || 'direct',
      limitations: [data.limitations, data.arrearsLimitations].filter(Boolean).join('')
    })
  } catch (err) { return errorResult('查询综合档案失败：' + err.message) }
}

function rentCollectionHandoff(data = {}, params = {}, action = 'rentCollection') {
  const view = data.rentCollectionView || data.prepayView || {}
  const input = data.normalizedInput || {}
  const lease = view.lease || {}
  return {
    query: encodeQuery({
      action,
      confirmationId: data.confirmationId || '',
      leaseId: input.leaseId || params.leaseId || lease.id || ''
    }),
    payload: {
      type: action,
      action: action === 'prepayRent' ? 'confirmPrepayRent' : 'confirmRentCollection',
      confirmationId: data.confirmationId || '',
      expiresAt: data.expiresAt || '',
      input,
      rentCollectionView: data.rentCollectionView || null,
      prepayView: data.prepayView || null
    }
  }
}

async function previewPrepayRent(params = {}) {
  console.info('[ai-mode] lease-skill previewPrepayRent params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewPrepayRent', params)
    const result = successResult('提前收租预览已生成，请点击小程序卡片进入页面核对，并在确认已线下收款后入账。', data)
    if (data && !data.needPeriod) result.handoff = rentCollectionHandoff(data, params, 'prepayRent')
    return result
  } catch (err) {
    console.error('[ai-mode] lease-skill previewPrepayRent error:', err.message)
    return errorResult('预览提前收租失败：' + err.message)
  }
}

async function previewRentCollection(params = {}) {
  console.info('[ai-mode] lease-skill previewRentCollection params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewRentCollection', params)
    if (data && data.needPeriod) {
      return successResult(data.message || '请补充收租账期，例如从哪一天开始、收几个月。', data)
    }
    const view = data.rentCollectionView || {}
    const modeText = ({ arrears: '补交欠租', current: '当期收租', advance: '提前收租', mixed: '混合收租' })[view.mode] || '租金收款'
    const result = successResult(`${modeText}预览已生成，请点击小程序卡片进入页面核对，并在确认已线下收款后入账。`, data)
    result.handoff = rentCollectionHandoff(data, params, 'rentCollection')
    return result
  } catch (err) {
    console.error('[ai-mode] lease-skill previewRentCollection error:', err.message)
    return errorResult('预览租金收款失败：' + err.message)
  }
}

async function previewCreateLease(params = {}) {
  console.info('[ai-mode] lease-skill previewCreateLease params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewCreateLease', params)
    const result = successResult('合同预览已生成，请点击小程序卡片进入页面核对后创建。', data)
    result.handoff = {
      query: encodeQuery({ action: 'createLease', confirmationId: data.confirmationId || '' }),
      payload: { type: 'createLease', confirmationId: data.confirmationId || '', expiresAt: data.expiresAt || '', input: params, lease: data.lease || null }
    }
    return result
  } catch (err) {
    console.error('[ai-mode] lease-skill previewCreateLease error:', err.message)
    return errorResult('预览创建合同失败：' + err.message)
  }
}

async function confirmCreateLease(params = {}) {
  console.info('[ai-mode] lease-skill confirmCreateLease params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('confirmCreateLease', params)
    return successResult('合同创建成功。', data)
  } catch (err) {
    console.error('[ai-mode] lease-skill confirmCreateLease error:', err.message)
    return errorResult('创建合同失败：' + err.message)
  }
}

async function previewRenewLease(params = {}) {
  console.info('[ai-mode] lease-skill previewRenewLease params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewRenewLease', params)
    return successResult('已生成续租确认卡，请核对后确认。', data)
  } catch (err) {
    console.error('[ai-mode] lease-skill previewRenewLease error:', err.message)
    return errorResult('预览续租失败：' + err.message)
  }
}

async function confirmRenewLease(params = {}) {
  console.info('[ai-mode] lease-skill confirmRenewLease params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('confirmRenewLease', params)
    return successResult('下一期租金账单已生成。', data)
  } catch (err) {
    console.error('[ai-mode] lease-skill confirmRenewLease error:', err.message)
    return errorResult('确认续租失败：' + err.message)
  }
}

module.exports = { getActiveLeases, getFinancialReport, listGlobalMoveInOutByDateRange, listGlobalMoveInOutForRelativePeriod, getSettlementReport, getLeasePaymentHistory, getTenantPaymentHistoryByKeyword, getHousePaymentHistoryByKeyword, getTenantArrearsByKeyword, getContractOverview, getRelativeLeaseExpiry, getLeaseReport, getArrearsReport, getFutureReceivablesByExplicitDateRange, getRelativeFutureReceivables, getOperatingOverview, getSubjectProfile, previewCreateLease, confirmCreateLease, previewPrepayRent, previewRentCollection, previewRenewLease, confirmRenewLease }
