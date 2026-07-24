const { callRentalDomain, successResult, errorResult } = require('../../_shared/domain-client')

async function getMeterTargets(params = {}) {
  console.info('[ai-mode] meter-reading-skill getMeterTargets params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('getMeterTargets', { keyword: params.keyword || '' })
    const leases = (data && data.leases) || []
    return successResult(leases.length ? `找到 ${leases.length} 个可抄表对象。` : '当前没有可抄表对象。', data)
  } catch (err) {
    console.error('[ai-mode] meter-reading-skill getMeterTargets error:', err.message)
    return errorResult('查询抄表对象失败：' + err.message)
  }
}

async function previewMeterReading(params = {}) {
  console.info('[ai-mode] meter-reading-skill previewMeterReading params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewMeterReading', params)
    const result = successResult('已生成水电费预览，请点击小程序卡片进入页面核对后确认。', data)
    result.handoff = { query: `action=meterReading&confirmationId=${encodeURIComponent(data.confirmationId || '')}`, payload: { type: 'meterReading', confirmationId: data.confirmationId || '', expiresAt: data.expiresAt || '', input: params, meterView: data.meterView || data, lease: data.lease || null } }
    return result
  } catch (err) {
    console.error('[ai-mode] meter-reading-skill previewMeterReading error:', err.message)
    return errorResult('预览水电费失败：' + err.message)
  }
}

async function confirmMeterReading(params = {}) {
  console.info('[ai-mode] meter-reading-skill confirmMeterReading params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('confirmMeterReading', params)
    return successResult('抄表记录已保存。', data)
  } catch (err) {
    console.error('[ai-mode] meter-reading-skill confirmMeterReading error:', err.message)
    return errorResult('确认抄表失败：' + err.message)
  }
}

module.exports = { getMeterTargets, previewMeterReading, confirmMeterReading }
