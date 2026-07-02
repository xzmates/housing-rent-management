const {
  isPreviewMode,
  successResult,
  errorResult,
  getArgs,
  todayText,
  money,
  methodText,
  normalizePaymentMethod,
  createRentConfirmPayload,
  loadRentContext,
  toRentBillItem,
  defaultRentBills
} = require('../utils/util')

function buildConfirmation(item, args) {
  const remaining = money(item.remaining)
  const amount = money(args.amount || remaining)
  const paymentMethod = normalizePaymentMethod(args.paymentMethod)
  return {
    billId: item.billId,
    leaseId: item.leaseId,
    houseLabel: item.houseLabel,
    tenantName: item.tenantName,
    period: item.period,
    amount,
    billAmount: money(item.amount),
    paidAmount: money(item.paidAmount),
    remaining,
    dueDate: item.dueDate,
    paymentDate: args.paymentDate || todayText(),
    paymentMethod,
    paymentMethodText: methodText(paymentMethod),
    statusText: item.statusText
  }
}

async function confirmRentPayment(params = {}) {
  console.info('[ai-mode] confirmRentPayment 入口, params=', JSON.stringify(params || {}))
  try {
    const args = getArgs(params)
    console.info('[ai-mode] confirmRentPayment 入参=', JSON.stringify(args))
    if (!args.billId) return errorResult('请选择要收租的账单')

    let item
    if (isPreviewMode()) {
      item = defaultRentBills().find((bill) => bill.billId === args.billId)
      console.info('[ai-mode] confirmRentPayment 使用预览数据 billId=', args.billId)
    } else {
      const { bills, maps } = await loadRentContext()
      const bill = bills.find((row) => row._id === args.billId)
      item = bill ? toRentBillItem(bill, maps) : null
    }

    if (!item) return errorResult('未找到该租金账单')
    if (item.status === 'paid' || item.remaining <= 0) return errorResult('该租金账单已结清，无需重复收款')

    const confirmation = buildConfirmation(item, args)
    if (confirmation.amount <= 0) return errorResult('收款金额必须大于 0')
    if (confirmation.amount > confirmation.remaining) return errorResult(`收款金额超出待收金额，最多可收 ${confirmation.remaining} 元`)

    const data = createRentConfirmPayload(confirmation)
    console.info('[ai-mode] confirmRentPayment 出口 data=', JSON.stringify(data))
    return successResult(`请确认收取 ${data.houseLabel} ${data.tenantName} 租金 ¥${data.amount}`, data)
  } catch (err) {
    console.error('[ai-mode] confirmRentPayment 出错:', err.message)
    return errorResult(`生成收款确认失败：${err.message}`)
  }
}

module.exports = confirmRentPayment
