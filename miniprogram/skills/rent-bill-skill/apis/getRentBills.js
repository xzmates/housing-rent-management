const {
  isPreviewMode,
  successResult,
  errorResult,
  getArgs,
  money,
  loadRentContext,
  toRentBillItem,
  filterRentItems,
  buildFilterText,
  defaultRentBills
} = require('../utils/util')

async function getRentBills(params = {}) {
  console.info('[ai-mode] getRentBills 入口, params=', JSON.stringify(params || {}))
  try {
    const args = getArgs(params)
    console.info('[ai-mode] getRentBills 入参=', JSON.stringify(args))

    let items
    if (isPreviewMode()) {
      items = filterRentItems(defaultRentBills(), args)
      console.info('[ai-mode] getRentBills 使用预览数据 count=', items.length)
    } else {
      const { bills, maps } = await loadRentContext()
      items = bills
        .filter((bill) => bill.type === 'rent' && bill.status !== 'paid')
        .map((bill) => toRentBillItem(bill, maps))
      items = filterRentItems(items, args)
      console.info('[ai-mode] getRentBills 云端账单 count=', items.length)
    }

    items.sort((left, right) => {
      if (left.overdue !== right.overdue) return left.overdue ? -1 : 1
      if (left.dueDate !== right.dueDate) return String(left.dueDate).localeCompare(String(right.dueDate))
      return String(left.houseCode).localeCompare(String(right.houseCode), 'zh-CN', { numeric: true })
    })

    const totalAmount = money(items.reduce((sum, item) => sum + Number(item.remaining || 0), 0))
    const overdueCount = items.filter((item) => item.overdue).length
    const data = {
      items,
      total: items.length,
      totalAmount,
      overdueCount,
      filterText: buildFilterText(args)
    }
    const msg = items.length > 0
      ? `查询到 ${items.length} 笔待收租金，合计 ¥${totalAmount}`
      : '暂无待收租金账单'
    console.info('[ai-mode] getRentBills 出口 data=', JSON.stringify(data))
    return successResult(msg, data)
  } catch (err) {
    console.error('[ai-mode] getRentBills 出错:', err.message)
    return errorResult(`查询待收租金失败：${err.message}`)
  }
}

module.exports = getRentBills
