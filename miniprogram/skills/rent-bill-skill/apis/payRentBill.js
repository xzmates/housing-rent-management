const {
  isPreviewMode,
  successResult,
  errorResult,
  getArgs,
  todayText,
  money,
  methodText,
  normalizePaymentMethod,
  takeRentConfirmPayload,
  statusText,
  callFunction,
  loadRentContext,
  toRentBillItem,
  defaultRentBills
} = require('../utils/util')

async function findRentItem(billId) {
  if (isPreviewMode()) {
    return defaultRentBills().find((bill) => bill.billId === billId) || null
  }
  const { bills, maps } = await loadRentContext()
  const bill = bills.find((row) => row._id === billId)
  return bill ? toRentBillItem(bill, maps) : null
}

async function payRentBill(params = {}) {
  console.info('[ai-mode] payRentBill 入口, params=', JSON.stringify(params || {}))
  try {
    const args = getArgs(params)
    console.info('[ai-mode] payRentBill 入参=', JSON.stringify(args))
    const confirmed = takeRentConfirmPayload(args.confirmToken)
    const billId = confirmed.billId
    if (!billId) return errorResult('缺少租金账单 ID')

    const item = await findRentItem(billId)
    if (!item) return errorResult('未找到该租金账单')
    if (item.status === 'paid' || item.remaining <= 0) return errorResult('该租金账单已结清，无需重复收款')

    const amount = money(confirmed.amount || item.remaining)
    if (amount <= 0) return errorResult('收款金额必须大于 0')
    if (amount > item.remaining) return errorResult(`收款金额超出待收金额，最多可收 ${item.remaining} 元`)

    const paymentMethod = normalizePaymentMethod(confirmed.paymentMethod)
    const paymentDate = confirmed.paymentDate || todayText()

    let payResult
    if (isPreviewMode()) {
      const totalPaid = money(item.paidAmount + amount)
      const remaining = money(item.amount - totalPaid)
      payResult = {
        billId: item.billId,
        paidAmount: totalPaid,
        totalAmount: item.amount,
        status: remaining <= 0 ? 'paid' : 'partial',
        remaining
      }
      console.info('[ai-mode] payRentBill 使用预览数据 result=', JSON.stringify(payResult))
    } else {
      payResult = await callFunction('payBill', {
        billId: item.billId,
        amount,
        paymentDate,
        paymentMethod,
        remark: '小程序 AI 收租'
      })
    }

    const remaining = money(payResult.remaining)
    const data = {
      billId: item.billId,
      houseLabel: item.houseLabel,
      tenantName: item.tenantName,
      period: item.period,
      paymentAmount: amount,
      totalPaid: money(payResult.paidAmount),
      totalAmount: money(payResult.totalAmount),
      remaining,
      paymentDate,
      paymentMethod,
      paymentMethodText: methodText(paymentMethod),
      status: payResult.status || (remaining <= 0 ? 'paid' : 'partial'),
      statusText: statusText(payResult.status, remaining)
    }
    console.info('[ai-mode] payRentBill 出口 data=', JSON.stringify(data))
    return successResult(`收租成功，${data.houseLabel} ${data.tenantName} 已收 ¥${amount}`, data)
  } catch (err) {
    console.error('[ai-mode] payRentBill 出错:', err.message)
    return errorResult(`收租失败：${err.message}`)
  }
}

module.exports = payRentBill
