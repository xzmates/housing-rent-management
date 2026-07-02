const { successResult, errorResult, getArgs, createConfirmPayload } = require('../utils/util')

async function createRentalLease(params = {}) {
  console.info('[ai-mode] createRentalLease 入口, params=', JSON.stringify(params || {}))
  try {
    const args = getArgs(params)
    const slots = {
      houseAddress: args.houseAddress,
      houseCode: args.houseCode,
      tenantName: args.tenantName,
      tenantPhone: args.tenantPhone,
      tenantIdCard: args.tenantIdCard,
      rent: args.rent,
      deposit: args.deposit,
      startDate: args.startDate,
      paymentCycle: args.paymentCycle,
      moveInElectricity: args.moveInElectricity,
      moveInWater: args.moveInWater
    }
    const data = createConfirmPayload('createRentalLease', '新建合同', slots, [
      { label: '房屋', value: `${args.houseAddress || ''}${args.houseCode || ''}` },
      { label: '租客', value: args.tenantName || '未填写' },
      { label: '月租', value: `¥${args.rent || 0}` },
      { label: '押金', value: `¥${args.deposit || 0}` },
      { label: '起租', value: args.startDate || '未填写' }
    ], `准备为 ${args.houseAddress || ''}${args.houseCode || ''} 与 ${args.tenantName || ''} 新建合同。`)
    console.info('[ai-mode] createRentalLease 出口 data=', JSON.stringify(data))
    return successResult('请确认合同信息，确认后再创建合同。', data)
  } catch (err) {
    console.error('[ai-mode] createRentalLease 出错:', err.message)
    return errorResult(`新建合同失败：${err.message}`)
  }
}

module.exports = createRentalLease
