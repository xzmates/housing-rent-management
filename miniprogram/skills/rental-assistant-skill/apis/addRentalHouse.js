const { successResult, errorResult, getArgs, createConfirmPayload } = require('../utils/util')

async function addRentalHouse(params = {}) {
  console.info('[ai-mode] addRentalHouse 入口, params=', JSON.stringify(params || {}))
  try {
    const args = getArgs(params)
    const slots = {
      houseAddress: args.houseAddress,
      houseCode: args.houseCode,
      rent: args.rent
    }
    const data = createConfirmPayload('addRentalHouse', '新增房屋', slots, [
      { label: '位置', value: args.houseAddress || '未填写' },
      { label: '编号', value: args.houseCode || '未填写' },
      { label: '月租', value: `¥${args.rent || 0}` }
    ], `准备新增房屋 ${args.houseAddress || ''}${args.houseCode || ''}，月租 ¥${args.rent || 0}。`)
    console.info('[ai-mode] addRentalHouse 出口 data=', JSON.stringify(data))
    return successResult('请确认新增房屋信息，确认后再写入。', data)
  } catch (err) {
    console.error('[ai-mode] addRentalHouse 出错:', err.message)
    return errorResult(`新增房屋失败：${err.message}`)
  }
}

module.exports = addRentalHouse
