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
    const data = await callRentalDomain('getTenantOccupancy', { mode })
    const tenants = data.tenants || []
    return successResult(`${mode === 'current' ? '当前在租' : '历史/无合同'}租客共 ${tenants.length} 位。`, { title: mode === 'current' ? '当前租客' : '历史租客', fields: tenants.map(item => ({ label: item.name || '未命名', value: item.phone || '未留手机号' })) })
  } catch (err) { return errorResult('查询租客状态失败：' + err.message) }
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
    const text = activeLease
      ? `${tenant.name}，当前有生效合同`
      : `${tenant.name}，当前无生效合同`
    return successResult(text, { title: '租客详情', subtitle: tenant.name || '', fields })
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

module.exports = { searchTenants, getTenantOccupancy, getTenantDetail, previewCreateTenant, confirmCreateTenant }
