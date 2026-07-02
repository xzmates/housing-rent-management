const { successResult, errorResult, getArgs, createConfirmPayload, todayText } = require('../utils/util')

async function prepayTargetRent(params = {}) {
  console.info('[ai-mode] prepayTargetRent 入口, params=', JSON.stringify(params || {}))
  try {
    const args = getArgs(params)
    const slots = {
      houseAddress: args.houseAddress,
      houseCode: args.houseCode,
      tenantName: args.tenantName,
      coverageMonths: args.coverageMonths,
      coverageDays: args.coverageDays,
      amount: args.amount,
      paymentMethod: args.paymentMethod,
      payDate: args.payDate || todayText()
    }
    const data = createConfirmPayload('prepayTargetRent', '提前收租', slots, [
      { label: '对象', value: args.tenantName || `${args.houseAddress || ''}${args.houseCode || ''}` || '未填写' },
      { label: '月数', value: String(args.coverageMonths || 0) },
      { label: '天数', value: String(args.coverageDays || 0) },
      { label: '金额', value: args.amount ? `¥${args.amount}` : '按合同计算' },
      { label: '日期', value: slots.payDate }
    ], '准备生成提前收租账单并完成收款。')
    console.info('[ai-mode] prepayTargetRent 出口 data=', JSON.stringify(data))
    return successResult('请确认提前收租信息，确认后再生成账单并收款。', data)
  } catch (err) {
    console.error('[ai-mode] prepayTargetRent 出错:', err.message)
    return errorResult(`提前收租失败：${err.message}`)
  }
}

module.exports = prepayTargetRent
