const { callRentalDomain, successResult, errorResult } = require('../../_shared/domain-client')

async function getMoveOutTargets(params = {}) {
  console.info('[ai-mode] move-out-skill getMoveOutTargets params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('getMoveOutTargets', { keyword: params.keyword || '' })
    const leases = (data && data.leases) || []
    return successResult(leases.length ? `找到 ${leases.length} 个可退租对象。` : '当前没有可退租对象。', data)
  } catch (err) {
    console.error('[ai-mode] move-out-skill getMoveOutTargets error:', err.message)
    return errorResult('查询退租对象失败：' + err.message)
  }
}

async function previewMoveOutSettlement(params = {}) {
  console.info('[ai-mode] move-out-skill previewMoveOutSettlement params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewMoveOutSettlement', params)
    return successResult('已生成退租结算确认卡，请核对后确认。', data)
  } catch (err) {
    console.error('[ai-mode] move-out-skill previewMoveOutSettlement error:', err.message)
    return errorResult('预览退租结算失败：' + err.message)
  }
}

async function settleMoveOut(params = {}) {
  console.info('[ai-mode] move-out-skill settleMoveOut params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('settleMoveOut', params)
    return successResult('退租办理成功。', data)
  } catch (err) {
    console.error('[ai-mode] move-out-skill settleMoveOut error:', err.message)
    return errorResult('确认退租失败：' + err.message)
  }
}

module.exports = { getMoveOutTargets, previewMoveOutSettlement, settleMoveOut }
