const { callRentalDomain, successResult, errorResult } = require('../../_shared/domain-client')

async function getUnpaidBills(params = {}) {
  console.info('[ai-mode] rent-collection-skill getUnpaidBills params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('getUnpaidBills', { keyword: params.keyword || '' })
    const bills = (data && data.bills) || []
    const text = bills.length > 0 ? `找到 ${bills.length} 笔待收租金，合计 ¥${data.totalRemaining || 0}` : '当前没有待收租金。'
    return successResult(text, data)
  } catch (err) {
    console.error('[ai-mode] rent-collection-skill getUnpaidBills error:', err.message)
    return errorResult('查询待收租金失败：' + err.message)
  }
}

async function previewCollectRent(params = {}) {
  console.info('[ai-mode] rent-collection-skill previewCollectRent params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewCollectRent', params)
    return successResult('已生成收租确认卡，请核对金额后确认。', data)
  } catch (err) {
    console.error('[ai-mode] rent-collection-skill previewCollectRent error:', err.message)
    return errorResult('预览收租失败：' + err.message)
  }
}

async function confirmCollectRent(params = {}) {
  console.info('[ai-mode] rent-collection-skill confirmCollectRent params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('confirmCollectRent', params)
    return successResult('收租确认成功。', data)
  } catch (err) {
    console.error('[ai-mode] rent-collection-skill confirmCollectRent error:', err.message)
    return errorResult('确认收租失败：' + err.message)
  }
}

async function getPaymentHistory(params = {}) {
  console.info('[ai-mode] rent-collection-skill getPaymentHistory params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('getPaymentHistory', params)
    const payments = (data && data.payments) || []
    return successResult(`找到 ${payments.length} 条付款记录。`, data)
  } catch (err) {
    console.error('[ai-mode] rent-collection-skill getPaymentHistory error:', err.message)
    return errorResult('查询付款记录失败：' + err.message)
  }
}

module.exports = { getUnpaidBills, previewCollectRent, confirmCollectRent, getPaymentHistory }
