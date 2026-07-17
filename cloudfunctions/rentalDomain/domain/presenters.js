function number(value) {
  const result = Number(value || 0)
  return Number.isFinite(result) ? Math.round(result * 100) / 100 : 0
}

function dateText(value) {
  if (!value) return ''
  const raw = value.$date || value
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return String(raw)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function houseView(house = {}) {
  return {
    id: house._id || '',
    code: house.code || '',
    address: house.address || '',
    label: house.code ? `${house.code} - ${house.address || ''}` : (house.address || '未命名房屋'),
    rent: number(house.rent),
    status: house.status || 'available',
    statusText: { available: '可租', rented: '已租', maintenance: '维护中' }[house.status] || house.status || '未知'
  }
}

function tenantView(tenant = {}) {
  return {
    id: tenant._id || '',
    name: tenant.name || '',
    phone: tenant.phone || '',
    status: tenant.status || 'inactive',
    statusText: tenant.status === 'active' ? '在租' : '未在租'
  }
}

function leaseView(lease = {}, house = {}, tenant = {}) {
  return {
    id: lease._id || '',
    house: houseView(house),
    tenant: tenantView(tenant),
    rent: number(lease.rent),
    deposit: number(lease.deposit),
    paymentCycle: lease.paymentCycle || 'month',
    startDate: dateText(lease.startDate),
    endDate: dateText(lease.endDate),
    rentCoveredUntil: dateText(lease.rentCoveredUntil),
    nextRentDueDate: dateText(lease.nextRentDueDate),
    status: lease.status || '',
    statusText: lease.status === 'active' ? '生效中' : lease.status === 'terminated' ? '已退租' : lease.status || '未知'
  }
}

function billView(bill = {}, lease = {}, house = {}, tenant = {}) {
  const amount = number(bill.amount)
  const paidAmount = number(bill.paidAmount)
  const remaining = number(Math.max(0, amount - paidAmount))
  const status = remaining <= 0 && paidAmount >= amount
    ? 'paid'
    : paidAmount > 0
      ? 'partial'
      : (bill.status || 'unpaid')
  return {
    id: bill._id || '',
    leaseId: bill.leaseId || '',
    houseLabel: houseView(house).label,
    tenantName: tenant.name || '',
    type: bill.type || '',
    typeText: { rent: '租金', deposit: '押金', utility: '水电费', deposit_return: '押金退还', rent_refund: '租金退还', extra_due: '补缴', other: '补缴' }[bill.type] || bill.type || '账单',
    amount,
    paidAmount,
    remaining,
    status,
    statusText: status === 'paid' ? '已缴' : status === 'partial' ? '部分缴' : '待缴',
    period: bill.period || '',
    dueDate: dateText(bill.dueDate)
  }
}

module.exports = { number, dateText, houseView, tenantView, leaseView, billView }
