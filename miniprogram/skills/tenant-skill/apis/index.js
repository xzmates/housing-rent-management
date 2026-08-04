const { callRentalDomain, successResult, errorResult } = require('../../_shared/domain-client')

async function searchTenants(params = {}) {
  console.info('[ai-mode] tenant-skill searchTenants params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('searchTenants', {
      keyword: params.keyword || '',
      status: params.status || ''
    })
    const tenants = (data && data.tenants) || []
    const text = tenants.length > 0
      ? `找到 ${tenants.length} 位租客：${tenants.map(t => `${t.name || ''}（${t.phone || '—'}）`).join('、')}`
      : '没有找到匹配的租客。'
    return successResult(text, data)
  } catch (err) {
    console.error('[ai-mode] tenant-skill searchTenants error:', err.message)
    return errorResult('查询租客列表失败：' + err.message)
  }
}

async function getTenantOccupancy(params = {}) {
  try {
    const mode = params.mode === 'current' ? 'current' : 'history'
    const data = await callRentalDomain('getTenantOccupancy', { mode, page: params.page, pageSize: params.pageSize })
    const tenants = data.tenants || []
    return successResult(`${mode === 'current' ? '当前在租' : '历史/无合同'}租客共 ${tenants.length} 位。`, { title: mode === 'current' ? '当前租客' : '历史租客', fields: tenants.map(item => ({ label: item.name || '未命名', value: item.phone || '未留手机号' })) })
  } catch (err) { return errorResult('查询租客状态失败：' + err.message) }
}

async function getTenantDetailByKeyword(params = {}) {
  const keyword = String(params.keyword || '').trim()
  if (!keyword) return errorResult('请提供租客姓名或手机号。')
  try {
    const resolved = await callRentalDomain('resolveTenant', { keyword })
    if (resolved.status === 'not_found') return errorResult(`没有找到“${keyword}”对应的租客。`)
    if (resolved.status === 'ambiguous') {
      const candidates = resolved.candidates || []
      return successResult(`找到 ${candidates.length} 位匹配租客，请根据手机号或房屋进一步确认；不会自动选择其中一位。`, {
        title: '需要确认租客',
        candidates,
        fields: candidates.map(item => ({ label: item.name || '未命名租客', value: item.phone || '当前数据库未记录手机号' })),
        evidenceLevel: 'direct',
        limitations: '存在多个匹配租客，当前数据库不足以确认用户指的是哪一位。'
      })
    }
    if (!resolved.tenant?._id) return errorResult('未能确认唯一租客，无法查询详情。')
    return getTenantDetail({ tenantId: resolved.tenant._id })
  } catch (err) {
    console.error('[ai-mode] tenant-skill getTenantDetailByKeyword error:', err.message)
    return errorResult('匹配租客详情失败：' + err.message)
  }
}

async function getTenantDetail(params = {}) {
  console.info('[ai-mode] tenant-skill getTenantDetail params=', JSON.stringify(params || {}))
  try {
    const { tenantId } = params
    if (!tenantId) return errorResult('缺少租客 ID。')
    const data = await callRentalDomain('getTenantDetail', { tenantId })
    const tenant = data && data.tenant
    if (!tenant) return errorResult('未找到该租客。')
    const leases = (data && data.leases) || []
    const fields = [
      { label: '姓名', value: tenant.name || '—' },
      { label: '电话', value: tenant.phone || '—' },
      { label: '身份证', value: tenant.idCard || '—' },
      { label: '合同数', value: `${leases.length} 份` }
    ]
    const activeLease = leases.find(l => l.status === 'active')
    const currentHouse = activeLease?.house?.label || ''
    // 数据库默认顺序不能代表历史居住先后；仅排序历史合同，并保留当前合同原有优先级。
    const historyLeases = leases.filter(l => l.status !== 'active').sort((left, right) => {
      const byStartDate = String(left.startDate || '').localeCompare(String(right.startDate || ''))
      return byStartDate || String(left.id || '').localeCompare(String(right.id || ''))
    })
    // 保留 A→B→A 的重复居住，不用 Set 丢失真实历史顺序。
    const historyHouses = historyLeases.map(l => l.house?.label).filter(Boolean)
    const actualMoveOutUnknown = historyLeases.filter(l => l.actualMoveOutEvidence === 'insufficient')
    fields.push({ label: '当前房屋', value: currentHouse || '当前无生效合同' })
    fields.push({ label: '历史房屋', value: historyHouses.length ? historyHouses.join('、') : '未记录已结束合同' })
    leases.forEach((lease, index) => {
      fields.push({
        label: `合同 ${index + 1} · ${lease.house?.label || '未标注房屋'}`,
        value: `${lease.statusText || lease.status || '未知状态'}，${lease.startDate || '未记录起租日'} 至 ${lease.endDate || '未记录结束日'}`
      })
    })
    historyLeases.forEach(lease => {
      fields.push({
        label: `${lease.house?.label || '历史合同'} 实际搬离日`,
        value: lease.actualMoveOutDate || '当前数据库记录不足以确认（合同结束日不能证明实际搬离日）'
      })
    })
    const limitations = actualMoveOutUnknown.length
      ? '部分历史合同未记录 actualMoveOutDate；当前数据库记录不足以确认准确实际搬离日期，合同结束日不能替代实际搬离日。'
      : ''
    const historySummary = historyHouses.length
      ? `；历史住过 ${historyHouses.join('、')}，共 ${historyLeases.length} 份历史合同`
      : '；当前未记录已结束合同'
    const text = activeLease
      ? `${tenant.name}，当前住在 ${currentHouse || '房屋信息未记录'}，有生效合同${historySummary}`
      : `${tenant.name}，当前无生效合同${historySummary}`
    const summary = `${text}${limitations ? `。${limitations}` : ''}`
    const activeLeaseText = activeLease
      ? `${activeLease.startDate || '未记录起租日'} 至 ${activeLease.endDate || '未记录结束日'}`
      : '当前无生效合同'
    const detailLines = [
      `租客：${tenant.name || '未命名租客'}`,
      `电话：${tenant.phone || '—'}`,
      `身份证：${tenant.idCard || '—'}`,
      `当前房屋：${currentHouse || '当前无生效合同'}`,
      `当前合同：${activeLeaseText}`,
      `历史房屋：${historyHouses.length ? historyHouses.join('、') : '未记录已结束合同'}`
    ]
    historyLeases.forEach((lease, index) => {
      detailLines.push(`历史合同 ${index + 1}：${lease.house?.label || '未标注房屋'}，${lease.startDate || '未记录起租日'} 至 ${lease.endDate || '未记录结束日'}`)
    })
    if (limitations) detailLines.push(`说明：${limitations}`)
    // content 是 Agent 组织最终自然语言的直接事实来源，必须本身完整，不能只留下卡片标题。
    return successResult(detailLines.join('\n'), {
      title: '租客详情',
      subtitle: tenant.name || '',
      // 卡片直接展示完整结论，避免 Agent 二次概括时丢失历史房屋。
      summary,
      fields,
      leases,
      evidenceLevel: actualMoveOutUnknown.length ? 'partial' : 'direct',
      limitations
    })
  } catch (err) {
    console.error('[ai-mode] tenant-skill getTenantDetail error:', err.message)
    return errorResult('查询租客详情失败：' + err.message)
  }
}

async function previewCreateTenant(params = {}) {
  const name = String(params.name || '').trim()
  const phone = String(params.phone || '').replace(/[\s-]/g, '')
  const idCard = String(params.idCard || '').trim()
  if (!name) return errorResult('请先提供租客姓名。')
  if (phone && !/^1\d{10}$/.test(phone)) return errorResult('手机号格式不正确，请提供 11 位手机号。')
  if (idCard && !/(^\d{15}$)|(^\d{17}[\dXx]$)/.test(idCard)) return errorResult('身份证号格式不正确，请核对后再试。')
  const fields = { name, phone, idCard }
  const missingFields = phone ? [] : ['phone']
  try {
    const keyword = phone || idCard || name
    const data = await callRentalDomain('searchTenants', { keyword, page: 1, pageSize: 100 })
    const normalizeText = value => String(value || '').trim().replace(/\s+/g, '').toLowerCase()
    const normalizePhone = value => String(value || '').replace(/[\s-]/g, '')
    const normalizeIdCard = value => String(value || '').trim().replace(/\s+/g, '').toUpperCase()
    const existing = (data.tenants || []).find(item => (
      (phone && normalizePhone(item.phone) === phone) ||
      (idCard && normalizeIdCard(item.idCard) === normalizeIdCard(idCard)) ||
      (!phone && !idCard && normalizeText(item.name) === normalizeText(name) && !normalizePhone(item.phone) && !normalizeIdCard(item.idCard))
    ))
    if (existing) return errorResult(`${existing.name || name} 已存在，不能重复创建；请使用已有租客。`)
  } catch (err) {
    return errorResult('校验租客是否已存在失败：' + err.message)
  }
  return {
    isError: false,
    content: [{ type: 'text', text: missingFields.length ? '已整理租客姓名，请点击小程序卡片补充手机号后创建。' : '已整理租客信息，请点击下方小程序卡片核对并创建。' }],
    structuredContent: { mode: 'create_tenant', fields, missingFields },
    handoff: { query: 'mode=create_tenant', payload: { mode: 'create_tenant', fields } }
  }
}

async function confirmCreateTenant(params = {}) {
  console.info('[ai-mode] tenant-skill confirmCreateTenant params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('confirmCreateTenant', params)
    return successResult('租客新增成功。', data)
  } catch (err) {
    console.error('[ai-mode] tenant-skill confirmCreateTenant error:', err.message)
    return errorResult('新增租客失败：' + err.message)
  }
}

module.exports = { searchTenants, getTenantOccupancy, getTenantDetailByKeyword, getTenantDetail, previewCreateTenant, confirmCreateTenant }
