const { callRentalDomain, successResult, errorResult } = require('../../_shared/domain-client')

function encodeQuery(params = {}) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&')
}

function normalizeMoveOutInput(params = {}, data = {}) {
  const settlement = data.settlementView || {}
  const lease = settlement.lease || {}
  return {
    leaseId: params.leaseId || lease.id || '',
    moveOutDate: params.moveOutDate || settlement.moveOutDate || '',
    electricityReading: params.electricityReading,
    waterReading: params.waterReading,
    damageAmount: params.damageAmount === undefined ? 0 : params.damageAmount,
    remark: params.remark || ''
  }
}

function moveOutHandoff(data = {}, params = {}) {
  const input = normalizeMoveOutInput(params, data)
  return {
    query: encodeQuery({
      confirmationId: data.confirmationId || '',
      leaseId: input.leaseId
    }),
    payload: {
      type: 'moveOutSettlement',
      action: 'settleMoveOut',
      confirmationId: data.confirmationId || '',
      expiresAt: data.expiresAt || '',
      input,
      settlementView: data.settlementView || null
    }
  }
}

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
    const result = successResult('退租结算已生成，请点击小程序卡片进入详情页核对并确认。', data)
    result.handoff = moveOutHandoff(data, params)
    return result
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
