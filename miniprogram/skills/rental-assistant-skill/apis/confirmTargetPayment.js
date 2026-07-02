const { successResult, errorResult, getArgs, createConfirmPayload, todayText } = require('../utils/util')

async function confirmTargetPayment(params = {}) {
  console.info('[ai-mode] confirmTargetPayment 入口, params=', JSON.stringify(params || {}))
  try {
    const args = getArgs(params)
    const slots = {
      houseAddress: args.houseAddress,
      houseCode: args.houseCode,
      tenantName: args.tenantName,
      amount: args.amount,
      paymentMethod: args.paymentMethod,
      paymentDate: args.paymentDate || todayText()
    }
    const data = createConfirmPayload('confirmTargetPayment', '缴费确认', slots, [
      { label: '对象', value: args.tenantName || `${args.houseAddress || ''}${args.houseCode || ''}` || '未填写' },
      { label: '金额', value: `¥${args.amount || 0}` },
      { label: '方式', value: args.paymentMethod || '现金' },
      { label: '日期', value: slots.paymentDate }
    ], `准备确认缴费 ¥${args.amount || 0}。`)
    console.info('[ai-mode] confirmTargetPayment 出口 data=', JSON.stringify(data))
    return successResult('请确认缴费信息，确认后再收款入账。', data)
  } catch (err) {
    console.error('[ai-mode] confirmTargetPayment 出错:', err.message)
    return errorResult(`缴费确认失败：${err.message}`)
  }
}

module.exports = confirmTargetPayment
