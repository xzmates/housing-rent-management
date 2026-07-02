const { successResult, errorResult, getArgs, createConfirmPayload } = require('../utils/util')

async function addRentalTenant(params = {}) {
  console.info('[ai-mode] addRentalTenant 入口, params=', JSON.stringify(params || {}))
  try {
    const args = getArgs(params)
    const slots = {
      tenantName: args.tenantName,
      tenantPhone: args.tenantPhone,
      tenantIdCard: args.tenantIdCard
    }
    const data = createConfirmPayload('addRentalTenant', '新增租客', slots, [
      { label: '姓名', value: args.tenantName || '未填写' },
      { label: '电话', value: args.tenantPhone || '未填写' },
      { label: '身份证', value: args.tenantIdCard || '未填写' }
    ], `准备新增租客 ${args.tenantName || ''}。`)
    console.info('[ai-mode] addRentalTenant 出口 data=', JSON.stringify(data))
    return successResult('请确认新增租客信息，确认后再写入。', data)
  } catch (err) {
    console.error('[ai-mode] addRentalTenant 出错:', err.message)
    return errorResult(`新增租客失败：${err.message}`)
  }
}

module.exports = addRentalTenant
