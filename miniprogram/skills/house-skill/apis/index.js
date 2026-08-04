const { callRentalDomain, successResult, errorResult } = require('../../_shared/domain-client')

async function searchHouses(params = {}) {
  console.info('[ai-mode] house-skill searchHouses params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('searchHouses', {
      keyword: params.keyword || '',
      status: params.status || '',
      page: params.page || 1,
      // 房屋列表默认完整返回，避免“所有空房”被默认 20 条分页截断。
      pageSize: params.pageSize || 100
    })
    const houses = (data && data.houses) || []
    const text = houses.length > 0
      ? `找到 ${houses.length} 套房：${houses.map(h => `${h.label || ''}（¥${h.rent || 0}）`).join('、')}`
      : '没有找到匹配的房屋。'
    return successResult(text, data)
  } catch (err) {
    console.error('[ai-mode] house-skill searchHouses error:', err.message)
    return errorResult('查询房屋列表失败：' + err.message)
  }
}

async function getHouseAvailability(params = {}) {
  try {
    const mode = params.mode === 'rented' ? 'rented' : 'available'
    const data = await callRentalDomain('getHouseAvailability', { mode, page: params.page || 1, pageSize: params.pageSize || 100 })
    const houses = data.houses || []
    const pagination = data.pagination || {}
    const suffix = pagination.truncated ? `当前仅展示前 ${houses.length} 套，请继续翻页。` : ''
    return successResult(`${mode === 'rented' ? '已出租' : '未出租'}房屋共 ${pagination.total ?? houses.length} 套。${suffix}`, { title: mode === 'rented' ? '已出租房屋' : '未出租房屋', fields: houses.map(item => ({ label: item.label, value: mode === 'rented' ? `租客：${item.tenantName || '—'}` : `¥${item.rent}/月` })), pagination })
  } catch (err) { return errorResult('查询房屋状态失败：' + err.message) }
}

function normalizeHouseKey(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s\-－_]/g, '')
}

function houseCandidateFields(candidates = []) {
  return candidates.map(item => ({
    label: item.label || `${item.code || ''} - ${item.address || ''}`.trim(),
    value: `月租 ¥${item.rent || 0}，${item.statusText || item.status || '未知状态'}`
  }))
}

async function resolveHouseByKeyword(keyword) {
  const normalizedKeyword = normalizeHouseKey(keyword)
  if (!normalizedKeyword) return { status: 'invalid' }
  // 不能只依赖关键字模糊搜索的单个返回值：同号不同楼、近似房号都必须先看到全量候选再消歧。
  const candidates = []
  let page = 1
  let total = 0
  do {
    const data = await callRentalDomain('searchHouses', { keyword: '', page, pageSize: 100 })
    candidates.push(...(data.houses || []))
    total = Number(data.pagination?.total || candidates.length)
    page += 1
  } while (candidates.length < total)
  const exact = candidates.filter(item => {
    const keys = [item.code, item.address, item.label, `${item.address || ''}${item.code || ''}`, `${item.code || ''}${item.address || ''}`]
    return keys.some(value => normalizeHouseKey(value) === normalizedKeyword)
  })
  if (exact.length === 1) return { status: 'unique', house: exact[0] }
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact }
  return { status: 'not_found', candidates: [] }
}

function houseResolutionResult(keyword, resolved) {
  if (resolved.status === 'invalid') return errorResult('请提供房屋编号或地址。')
  if (resolved.status === 'not_found') return errorResult(`没有找到“${keyword}”对应的房屋。`)
  if (resolved.status === 'ambiguous') {
    const candidates = resolved.candidates || []
    return successResult(`找到 ${candidates.length} 套匹配房屋，请根据完整房号或地址进一步确认；不会自动选择其中一套。`, {
      title: '需要确认房屋',
      candidates,
      fields: houseCandidateFields(candidates),
      evidenceLevel: 'direct',
      limitations: '存在多个相同或近似房屋，当前数据库不足以确认用户指的是哪一套。'
    })
  }
  return null
}

async function getHouseDetailByKeyword(params = {}) {
  const keyword = String(params.keyword || '').trim()
  try {
    const resolved = await resolveHouseByKeyword(keyword)
    const terminal = houseResolutionResult(keyword, resolved)
    if (terminal) return terminal
    return getHouseDetail({ houseId: resolved.house.id || resolved.house._id })
  } catch (err) {
    console.error('[ai-mode] house-skill getHouseDetailByKeyword error:', err.message)
    return errorResult('匹配房屋详情失败：' + err.message)
  }
}

async function getHouseDetail(params = {}) {
  console.info('[ai-mode] house-skill getHouseDetail params=', JSON.stringify(params || {}))
  try {
    const { houseId } = params
    if (!houseId) return errorResult('缺少房屋 ID。')
    const data = await callRentalDomain('getHouseDetail', { houseId })
    const house = data && data.house
    if (!house) return errorResult('未找到该房屋。')
    const fields = [
      { label: '编号', value: house.code || '—' },
      { label: '地址', value: house.address || '—' },
      { label: '月租', value: `¥${house.rent || 0}` },
      { label: '状态', value: house.statusText || house.status || '—' }
    ]
    const activeLease = data.activeLease || null
    if (activeLease) {
      fields.push({ label: '当前租客', value: activeLease.tenant?.name || '当前合同未关联租客信息' })
      fields.push({ label: '合同开始日', value: activeLease.startDate || '当前数据库未记录' })
      fields.push({ label: '合同结束日', value: activeLease.endDate || '当前数据库未记录' })
      fields.push({ label: '合同约定押金', value: `¥${activeLease.deposit || 0}` })
    }
    const history = data.leaseHistory || []
    const historyTenants = [...new Set(history.filter(item => item.status !== 'active').map(item => item.tenant?.name).filter(Boolean))]
    fields.push({ label: '历史租客', value: historyTenants.length ? historyTenants.join('、') : '未记录已结束合同' })
    const residentText = activeLease ? `，当前租客 ${activeLease.tenant?.name || '未记录'}` : ''
    const leaseText = activeLease ? `，合同 ${activeLease.startDate || '未记录'} 至 ${activeLease.endDate || '未记录'}，押金 ¥${activeLease.deposit || 0}` : ''
    const text = `${house.address || ''}${house.code || ''}，月租 ¥${house.rent || 0}，${house.statusText || house.status || ''}${residentText}${leaseText}`
    return successResult(text, { title: '房屋详情', subtitle: house.label || '', summary: text, fields, activeLease, leaseHistory: history })
  } catch (err) {
    console.error('[ai-mode] house-skill getHouseDetail error:', err.message)
    return errorResult('查询房屋详情失败：' + err.message)
  }
}

async function getHouseProfile(params = {}) {
  try {
    if (!params.houseId) return errorResult('缺少房屋 ID。')
    const data = await callRentalDomain('getSubjectProfile', { houseId: params.houseId })
    const subject = data.subject || {}
    const currentArrearsKnown = Object.prototype.hasOwnProperty.call(data, 'currentArrearsAmount')
    const leases = data.leases || []
    const arrears = data.currentArrearsBills || []
    const receiptTotals = data.receiptTotalsByBillType || {}
    const receiptAmountKnown = Object.prototype.hasOwnProperty.call(data, 'actualReceivedAmount')
    const receiptTypeFields = Object.entries(receiptTotals).map(([type, amount]) => ({ label: `实际收款 · ${type || '来源未明'}`, value: `¥${amount || 0}` }))
    const receiptSummary = receiptAmountKnown
      ? `关联付款流水实际收款 ¥${data.actualReceivedAmount || 0}`
      : '当前云端未返回该房屋范围内的实际收款汇总，无法确认金额'
    const summary = `${subject.label || '该房屋'}：${leases.length} 份关联合同，当前已到期欠费 ¥${data.currentArrearsAmount || 0}，未来应收 ¥${data.futureOutstandingAmount || 0}，${receiptSummary}。`
    const receiptLimitation = receiptAmountKnown ? '' : '当前云端 rentalDomain 未返回按关联合同限定的实际收款汇总；不得改用全局付款查询补充金额。'
    return successResult(`${summary}\n实际收款必须限定为该房屋关联合同的付款流水；不得为补充金额调用全局付款查询。`, {
      title: '房屋综合档案',
      subtitle: subject.label || '—',
      summary,
      fields: [
        { label: '合同数', value: String((data.leases || []).length) },
        ...leases.map((item, index) => ({
          label: `合同 ${index + 1} · ${item.tenant?.name || '未标注租客'}`,
          value: `${item.statusText || item.status || '未知状态'}，${item.startDate || '未记录起租日'} 至 ${item.endDate || '未记录结束日'}，月租 ¥${item.rent || 0}，押金 ¥${item.deposit || 0}`
        })),
        ...(currentArrearsKnown ? [{ label: '当前已到期欠费', value: `¥${data.currentArrearsAmount || 0}` }] : []),
        ...arrears.map(item => ({
          label: `${item.typeText || '账单'} · 到期 ${item.dueDate || '未标注'}`,
          value: `应缴 ¥${item.amount || 0}，已缴 ¥${item.paidAmount || 0}，待缴 ¥${item.remaining || 0}，逾期 ${item.overdueDays || 0} 天`
        })),
        ...(currentArrearsKnown && data.futureOutstandingCount ? [{ label: '未来应收（不计当前欠费）', value: `¥${data.futureOutstandingAmount || 0}` }] : []),
        { label: '待缴金额', value: `¥${data.unpaidAmount || 0}` },
        ...(receiptAmountKnown ? [{ label: '实际收款（关联付款流水）', value: `¥${data.actualReceivedAmount || 0}（${data.receiptCount || 0} 笔）` }] : []),
        ...(receiptAmountKnown && data.actualPaidOutAmount ? [{ label: '实际支出/退款（关联付款流水）', value: `¥${data.actualPaidOutAmount || 0}` }] : []),
        ...receiptTypeFields
      ],
      houseId: params.houseId,
      leases,
      currentArrearsBills: arrears,
      receiptScope: data.receiptScope || 'all_linked_leases',
      receiptEvidence: receiptAmountKnown ? (data.receiptEvidence || 'direct') : 'insufficient',
      evidenceLevel: data.evidenceLevel || 'direct',
      limitations: [data.limitations, receiptLimitation].filter(Boolean).join('')
    })
  } catch (err) { return errorResult('查询房屋综合档案失败：' + err.message) }
}

async function getHouseProfileByKeyword(params = {}) {
  const keyword = String(params.keyword || '').trim()
  try {
    const resolved = await resolveHouseByKeyword(keyword)
    const terminal = houseResolutionResult(keyword, resolved)
    if (terminal) return terminal
    return getHouseProfile({ houseId: resolved.house.id || resolved.house._id })
  } catch (err) {
    console.error('[ai-mode] house-skill getHouseProfileByKeyword error:', err.message)
    return errorResult('匹配房屋综合档案失败：' + err.message)
  }
}

async function previewCreateHouse(params = {}) {
  let code = String(params.code || '').trim()
  let address = String(params.address || '').trim()
  // 普通页面地址是固定楼栋枚举，AI 常将“东楼211”整体误填到两个字段。
  // 仅对当前页面已支持的楼栋做确定性拆分，未知地址不猜测。
  const buildingAliases = {
    东楼: '东楼', 都楼: '东楼', 东lou: '东楼', 东路: '东楼',
    里召: '里召', 李召: '里召', 里照: '里召'
  }
  const knownBuilding = /^(东楼|都楼|东lou|东路|里召|李召|里照)\s*([A-Za-z]?\d+)$/i
  const compound = knownBuilding.exec(code) || knownBuilding.exec(address)
  if (compound) {
    address = buildingAliases[compound[1]] || compound[1]
    code = compound[2]
  }
  const rent = params.rent === '' || params.rent === undefined ? '' : Number(params.rent)
  if (!code) return errorResult('请先提供房屋编号。')
  if (!address) return errorResult('请先提供房屋地址。')
  if (!Number.isFinite(rent) || rent <= 0) return errorResult('请提供大于 0 的月租金。')
  const fields = { code, address, rent, status: params.status || 'available' }
  try {
    const data = await callRentalDomain('searchHouses', { keyword: code, page: 1, pageSize: 100 })
    const normalize = value => String(value || '').trim().replace(/\s+/g, '').toLowerCase()
    const existing = (data.houses || []).find(item => normalize(item.code) === normalize(code) && normalize(item.address) === normalize(address))
    if (existing) return errorResult(`${existing.label || `${address}${code}`} 已存在，不能重复创建；请使用已有房屋。`)
  } catch (err) {
    return errorResult('校验房屋是否已存在失败：' + err.message)
  }
  return { isError: false, content: [{ type: 'text', text: '已整理房屋信息，请点击下方小程序卡片核对并创建。' }], structuredContent: { mode: 'create_house', fields, missingFields: [] }, handoff: { query: 'mode=create_house', payload: { mode: 'create_house', fields } } }
}

async function confirmCreateHouse(params = {}) {
  console.info('[ai-mode] house-skill confirmCreateHouse params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('confirmCreateHouse', params)
    return successResult('房屋新增成功。', data)
  } catch (err) {
    console.error('[ai-mode] house-skill confirmCreateHouse error:', err.message)
    return errorResult('新增房屋失败：' + err.message)
  }
}

module.exports = { searchHouses, getHouseAvailability, getHouseDetail, getHouseDetailByKeyword, getHouseProfile, getHouseProfileByKeyword, previewCreateHouse, confirmCreateHouse }
