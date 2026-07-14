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
  console.info('[ai-mode] tenant-skill previewCreateTenant params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewCreateTenant', params)
    return successResult('已生成新增租客确认卡，请核对后确认。', data)
  } catch (err) {
    console.error('[ai-mode] tenant-skill previewCreateTenant error:', err.message)
    return errorResult('预览新增租客失败：' + err.message)
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

module.exports = { searchTenants, getTenantDetail, previewCreateTenant, confirmCreateTenant }
