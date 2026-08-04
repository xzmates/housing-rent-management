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

async function getPaymentsByDateRange(params = {}) {
  console.info('[ai-mode] rent-collection-skill getPaymentsByDateRange params=', JSON.stringify(params || {}))
  try {
    if (!params.startDate || !params.endDate) return errorResult('请同时提供付款查询的开始日期和结束日期。')
    const startDate = String(params.startDate)
    const endDate = String(params.endDate)
    if (/^\d{4}-\d{2}-\d{2}$/.test(startDate) && /^\d{4}-\d{2}-\d{2}$/.test(endDate) && startDate > endDate) {
      // 这是用户输入校验的终止结果，而非需要 Agent 自行修复的工具异常。
      return successResult('开始日期不能晚于结束日期，未执行付款查询；请由用户确认正确的日期范围后再查询。不会自动交换日期。', {
        title: '日期范围需要确认',
        startDate,
        endDate,
        invalidDateRange: true,
        queryExecuted: false,
        limitations: '开始日期晚于结束日期，当前数据库未被查询；不得自动交换日期或选择其他合同重试。'
      })
    }
    const data = await callRentalDomain('getPaymentHistory', params)
    const payments = (data && data.payments) || []
    const incoming = payments.filter(item => item.direction !== 'out')
    const outgoing = payments.filter(item => item.direction === 'out')
    const incomingTotal = incoming.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const outgoingTotal = outgoing.reduce((sum, item) => sum + Number(item.amount || 0), 0)
    const rangeText = data.startDate && data.endDate ? `${data.startDate} 至 ${data.endDate}` : '所选条件下'
    const typeText = { rent: '租金', deposit: '押金', utility: '水电费', deposit_return: '押金退还', rent_refund: '租金退还', extra_due: '补缴' }
    return successResult(`${rangeText}找到 ${payments.length} 条付款流水：实际收款 ¥${incomingTotal}${outgoing.length ? `；实际退款/支出 ¥${outgoingTotal}` : ''}。`, {
      ...data,
      title: '付款记录',
      fields: [
        { label: '实际收款合计', value: `¥${incomingTotal}` },
        ...(outgoing.length ? [{ label: '实际退款/支出', value: `¥${outgoingTotal}` }] : []),
        ...payments.map(item => ({
          label: `${item.direction === 'out' ? '退款/支出' : '收款'} · ${typeText[item.billType] || item.billType || '未分类'} · ${item.paymentDate || '未标注日期'}`,
          value: `¥${item.amount || 0}`
        }))
      ],
      incomingTotal,
      outgoingTotal
    })
  } catch (err) {
    console.error('[ai-mode] rent-collection-skill getPaymentsByDateRange error:', err.message)
    return errorResult('按日期范围查询付款记录失败：' + err.message)
  }
}

module.exports = { getUnpaidBills, previewCollectRent, confirmCollectRent, getPaymentsByDateRange }
