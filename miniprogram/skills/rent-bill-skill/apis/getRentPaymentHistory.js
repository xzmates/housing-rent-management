const {
  isPreviewMode,
  successResult,
  errorResult,
  getArgs,
  money,
  methodText,
  queryAll,
  loadRentContext,
  toRentBillItem,
  filterRentItems,
  buildFilterText,
  formatDate,
  defaultHistory
} = require('../utils/util')

async function getRentPaymentHistory(params = {}) {
  console.info('[ai-mode] getRentPaymentHistory 入口, params=', JSON.stringify(params || {}))
  try {
    const args = getArgs(params)
    console.info('[ai-mode] getRentPaymentHistory 入参=', JSON.stringify(args))

    let items
    if (isPreviewMode()) {
      items = defaultHistory()
      console.info('[ai-mode] getRentPaymentHistory 使用预览数据 count=', items.length)
    } else {
      const [{ bills, maps }, payments] = await Promise.all([
        loadRentContext(),
        queryAll('payments', { orderBy: { field: 'createdAt', direction: 'desc' } })
      ])
      const rentBillItems = bills
        .filter((bill) => bill.type === 'rent')
        .map((bill) => toRentBillItem(bill, maps))
      const filteredRentBills = filterRentItems(rentBillItems, args)
      const rentBillMap = {}
      filteredRentBills.forEach((item) => {
        rentBillMap[item.billId] = item
      })
      items = payments
        .filter((payment) => rentBillMap[payment.billId])
        .map((payment) => {
          const bill = rentBillMap[payment.billId]
          const method = payment.paymentMethod || 'cash'
          return {
            paymentId: String(payment._id || ''),
            billId: String(payment.billId || ''),
            houseLabel: bill.houseLabel,
            tenantName: bill.tenantName,
            period: bill.period,
            amount: money(payment.amount),
            paymentDate: formatDate(payment.paymentDate || payment.createdAt),
            paymentMethod: method,
            paymentMethodText: methodText(method)
          }
        })
    }

    const totalAmount = money(items.reduce((sum, item) => sum + Number(item.amount || 0), 0))
    const data = {
      items,
      total: items.length,
      totalAmount,
      filterText: buildFilterText(args)
    }
    console.info('[ai-mode] getRentPaymentHistory 出口 data=', JSON.stringify(data))
    return successResult(`查询到 ${items.length} 条收租记录，合计 ¥${totalAmount}`, data)
  } catch (err) {
    console.error('[ai-mode] getRentPaymentHistory 出错:', err.message)
    return errorResult(`查询收租记录失败：${err.message}`)
  }
}

module.exports = getRentPaymentHistory
