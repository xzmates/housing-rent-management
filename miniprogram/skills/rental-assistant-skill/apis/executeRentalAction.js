const {
  isPreviewMode,
  successResult,
  errorResult,
  getArgs,
  takeConfirmPayload,
  runScenario,
  previewResult,
  resultText
} = require('../utils/util')

const ACTION_MAP = {
  addRentalHouse: { scene: 'house', title: '新增房屋' },
  addRentalTenant: { scene: 'tenant', title: '新增租客' },
  createRentalLease: { scene: 'lease', title: '新建合同' },
  confirmTargetPayment: { scene: 'payment', title: '缴费确认' },
  addSingleMeterReading: { scene: 'meter', title: '单次抄表' },
  prepayTargetRent: { scene: 'prepay_rent', title: '提前收租' },
  settleMoveOut: { scene: 'move_out', title: '退租结算' }
}

async function executeRentalAction(params = {}) {
  console.info('[ai-mode] executeRentalAction 入口, params=', JSON.stringify(params || {}))
  try {
    const args = getArgs(params)
    const pending = takeConfirmPayload(args.confirmToken, args.actionName)
    const config = ACTION_MAP[pending.actionName]
    if (!config) throw new Error('未知办理事项')

    const data = isPreviewMode()
      ? previewResult(config.title)
      : await runScenario(config.scene, pending.slots, config.title)

    console.info('[ai-mode] executeRentalAction 出口 data=', JSON.stringify(data))
    return successResult(resultText(data), data)
  } catch (err) {
    console.error('[ai-mode] executeRentalAction 出错:', err.message)
    return errorResult(`确认办理失败：${err.message}`)
  }
}

module.exports = executeRentalAction
