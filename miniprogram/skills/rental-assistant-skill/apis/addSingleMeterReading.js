const { successResult, errorResult, getArgs, createConfirmPayload, todayText } = require('../utils/util')

async function addSingleMeterReading(params = {}) {
  console.info('[ai-mode] addSingleMeterReading 入口, params=', JSON.stringify(params || {}))
  try {
    const args = getArgs(params)
    const slots = {
      houseAddress: args.houseAddress,
      houseCode: args.houseCode,
      tenantName: args.tenantName,
      electricityReading: args.electricityReading,
      waterReading: args.waterReading,
      calculationDate: args.calculationDate || todayText()
    }
    const data = createConfirmPayload('addSingleMeterReading', '单次抄表', slots, [
      { label: '对象', value: args.tenantName || `${args.houseAddress || ''}${args.houseCode || ''}` || '未填写' },
      { label: '电表', value: String(args.electricityReading || 0) },
      { label: '水表', value: String(args.waterReading || 0) },
      { label: '日期', value: slots.calculationDate }
    ], '准备记录本次水电表读数，并自动生成水电费账单。')
    console.info('[ai-mode] addSingleMeterReading 出口 data=', JSON.stringify(data))
    return successResult('请确认抄表读数，确认后再生成水电账单。', data)
  } catch (err) {
    console.error('[ai-mode] addSingleMeterReading 出错:', err.message)
    return errorResult(`单次抄表失败：${err.message}`)
  }
}

module.exports = addSingleMeterReading
