const {
  successResult,
  errorResult,
  getArgs,
  createConfirmPayload,
  loadActiveLeaseTargets,
  findActiveMoveOutTarget,
  activeTargetsText,
  activeTargetLabel,
  buildMoveOutPreview
} = require('../utils/util')

async function settleMoveOut(params = {}) {
  console.info('[ai-mode] settleMoveOut 入口, params=', JSON.stringify(params || {}))
  try {
    const args = getArgs(params)
    const activeTargets = await loadActiveLeaseTargets()
    const matched = findActiveMoveOutTarget(activeTargets, args)
    if (matched.status === 'missing') {
      return errorResult(activeTargetsText(activeTargets), {
        mode: 'question',
        actionName: 'settleMoveOut',
        actionTitle: '退租结算',
        status: 'need_target',
        statusText: '需要选择退租对象',
        summary: activeTargetsText(activeTargets),
        success: 0,
        failed: 0,
        fields: activeTargets.map((target) => ({ label: '活动合同', value: activeTargetLabel(target) })),
        details: []
      })
    }
    if (matched.status === 'none') {
      return errorResult(`没有在活动合同里找到这个退租对象。${activeTargetsText(activeTargets)}`, {
        mode: 'question',
        actionName: 'settleMoveOut',
        actionTitle: '退租结算',
        status: 'not_found',
        statusText: '未找到活动合同',
        summary: activeTargetsText(activeTargets),
        success: 0,
        failed: 0,
        fields: activeTargets.map((target) => ({ label: '活动合同', value: activeTargetLabel(target) })),
        details: []
      })
    }
    if (matched.status === 'ambiguous') {
      return errorResult(`匹配到多个活动合同，请说清楚房号或租客。${activeTargetsText(matched.targets)}`, {
        mode: 'question',
        actionName: 'settleMoveOut',
        actionTitle: '退租结算',
        status: 'ambiguous',
        statusText: '退租对象不唯一',
        summary: activeTargetsText(matched.targets),
        success: 0,
        failed: 0,
        fields: matched.targets.map((target) => ({ label: '候选合同', value: activeTargetLabel(target) })),
        details: []
      })
    }
    const target = matched.target
    const preview = await buildMoveOutPreview(target, args)
    const slots = {
      houseAddress: target.houseAddress,
      houseCode: target.houseCode,
      tenantName: target.tenantName,
      moveOutDate: preview.moveOutDate,
      moveOutElectricity: preview.moveOutElectricity,
      moveOutWater: preview.moveOutWater,
      damageAmount: preview.damageAmount
    }
    const data = createConfirmPayload('settleMoveOut', '退租结算', slots, [
      { label: '对象', value: activeTargetLabel(target) },
      { label: '退租日', value: preview.moveOutDate },
      { label: '电表', value: `${preview.moveOutElectricity}（上次 ${preview.lastElectricity}）` },
      { label: '水表', value: `${preview.moveOutWater}（上次 ${preview.lastWater}）` },
      { label: '房屋损失费', value: `¥${preview.damageAmount}` },
      { label: '退租前应结款', value: `¥${preview.payableBeforeDeposit}` },
      { label: preview.finalLabel, value: `¥${preview.finalAmount}` }
    ], `准备办理${activeTargetLabel(target)}退租，将结束合同并结算押金、水电和未缴账单。`)
    data.moveOutPreview = preview
    console.info('[ai-mode] settleMoveOut 出口 data=', JSON.stringify(data))
    return successResult('请确认退租结算信息，确认后再执行。', data)
  } catch (err) {
    console.error('[ai-mode] settleMoveOut 出错:', err.message)
    return errorResult(`退租结算失败：${err.message}`)
  }
}

module.exports = settleMoveOut
