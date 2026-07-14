const { callRentalDomain, successResult, errorResult } = require('../../_shared/domain-client')

async function getActiveLeases(params = {}) {
  console.info('[ai-mode] lease-skill getActiveLeases params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('getActiveLeases', {
      keyword: params.keyword || ''
    })
    const leases = (data && data.leases) || []
    const text = leases.length > 0
      ? `找到 ${leases.length} 份生效合同：${leases.map(l => `${l.tenant ? l.tenant.name : ''}（${l.house ? l.house.label : ''}）`).join('、')}`
      : '当前没有生效的租赁合同。'
    return successResult(text, { title: '生效合同', subtitle: '', fields: leases.map(l => ({
      label: l.tenant ? l.tenant.name : '—',
      value: l.house ? l.house.label : '—'
    })) })
  } catch (err) {
    console.error('[ai-mode] lease-skill getActiveLeases error:', err.message)
    return errorResult('查询生效合同失败：' + err.message)
  }
}

async function previewCreateLease(params = {}) {
  console.info('[ai-mode] lease-skill previewCreateLease params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewCreateLease', params)
    return successResult('已生成创建合同确认卡，请核对后确认。', data)
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

module.exports = { getActiveLeases, previewCreateLease, confirmCreateLease, previewRenewLease, confirmRenewLease }
