const { number } = require('./presenters')

function parseDateInput(value) {
  if (!value) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})$/)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  if (value && value.$date) return new Date(value.$date)
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function addMonths(date, months) {
  const base = parseDateInput(date)
  if (!base) return null
  const targetMonth = base.getMonth() + Number(months || 0)
  const lastDay = new Date(base.getFullYear(), targetMonth + 1, 0).getDate()
  return new Date(base.getFullYear(), targetMonth, Math.min(base.getDate(), lastDay))
}

function addDays(date, days) {
  const base = parseDateInput(date)
  if (!base) return null
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + Number(days || 0))
}

function formatDateKey(value) {
  const date = parseDateInput(value)
  if (!date) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function billingMonths(cycle) {
  return { month: 1, quarter: 3, half_year: 6, year: 12 }[cycle] || 1
}

function parsePeriodEnd(period) {
  if (typeof period !== 'string' || !period.includes('~')) return null
  const dateMatches = period.match(/\d{4}-\d{2}-\d{2}/g)
  if (dateMatches && dateMatches.length) return parseDateInput(dateMatches[dateMatches.length - 1])
  const monthMatches = period.match(/\d{4}-\d{2}/g)
  if (monthMatches && monthMatches.length) {
    const [year, month] = monthMatches[monthMatches.length - 1].split('-').map(Number)
    return new Date(year, month, 0)
  }
  const [, end] = period.split('~')
  return end ? parseDateInput(end.trim()) : null
}

function inferBillMonthsFromAmount(bill, lease) {
  const monthlyRent = number(lease && lease.rent)
  const amount = number(bill && bill.amount)
  if (monthlyRent <= 0 || amount <= 0) return billingMonths(lease && lease.paymentCycle)
  return Math.max(1, Math.round(amount / monthlyRent))
}

function inferRentBillCoverage(bill, lease) {
  const start = parseDateInput(bill.rentCoverageStart || bill.dueDate)
  let end = bill.rentCoverageEnd ? parseDateInput(bill.rentCoverageEnd) : parsePeriodEnd(bill.period)
  if (!start) return null
  if (!end || Number.isNaN(end.getTime())) {
    if (Number(bill.coverageMonths || 0) > 0) {
      end = addDays(addMonths(start, Number(bill.coverageMonths)), -1)
    } else if (Number(bill.coverageDays || 0) > 0) {
      end = addDays(start, Number(bill.coverageDays) - 1)
    } else {
      end = addDays(addMonths(start, inferBillMonthsFromAmount(bill, lease)), -1)
    }
  }
  return { start, end }
}

function coverageKey(period) {
  return `${formatDateKey(period.start)}~${formatDateKey(period.end)}`
}

function sameDate(left, right) {
  return formatDateKey(left) === formatDateKey(right)
}

function compareDate(left, right) {
  const l = parseDateInput(left)
  const r = parseDateInput(right)
  if (!l && !r) return 0
  if (!l) return -1
  if (!r) return 1
  return new Date(l.getFullYear(), l.getMonth(), l.getDate()).getTime()
    - new Date(r.getFullYear(), r.getMonth(), r.getDate()).getTime()
}

function buildCoverageRows(lease, rentBills = [], plannedAllocations = []) {
  const plannedByKey = new Map(plannedAllocations.map((item) => [
    coverageKey({ start: parseDateInput(item.periodStart), end: parseDateInput(item.periodEnd) }),
    item
  ]))
  const rows = rentBills
    .filter((bill) => bill && bill.type === 'rent')
    .map((bill) => {
      const coverage = inferRentBillCoverage(bill, lease)
      if (!coverage || !coverage.start || !coverage.end) return null
      const planned = plannedByKey.get(coverageKey(coverage))
      const paidAmount = number(bill.paidAmount) + number(planned && planned.allocationAmount)
      const amount = number(bill.amount)
      return {
        billId: bill._id || '',
        start: coverage.start,
        end: coverage.end,
        key: coverageKey(coverage),
        amount,
        paidAmount,
        status: paidAmount >= amount && amount > 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
        paid: amount > 0 && paidAmount >= amount,
        source: 'bill'
      }
    })
    .filter(Boolean)

  plannedAllocations
    .filter((item) => item.source === 'new')
    .forEach((item) => {
      const start = parseDateInput(item.periodStart)
      const end = parseDateInput(item.periodEnd)
      const amount = number(item.receivableAmount)
      const paidAmount = number(item.allocationAmount)
      rows.push({
        billId: '',
        start,
        end,
        key: coverageKey({ start, end }),
        amount,
        paidAmount,
        status: paidAmount >= amount && amount > 0 ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
        paid: amount > 0 && paidAmount >= amount,
        source: 'planned'
      })
    })

  return rows.sort((a, b) => a.start.getTime() - b.start.getTime() || a.end.getTime() - b.end.getTime())
}

function detectAnomalies(rows) {
  const anomalies = []
  const byKey = new Map()
  rows.forEach((row) => {
    const list = byKey.get(row.key) || []
    list.push(row)
    byKey.set(row.key, list)
  })
  byKey.forEach((list, key) => {
    if (list.length > 1) anomalies.push({ type: 'duplicate_coverage', key, billIds: list.map(item => item.billId).filter(Boolean) })
  })
  for (let i = 0; i < rows.length; i += 1) {
    for (let j = i + 1; j < rows.length; j += 1) {
      if (rows[i].key === rows[j].key) continue
      if (rows[i].start <= rows[j].end && rows[i].end >= rows[j].start) {
        anomalies.push({
          type: 'overlap_coverage',
          left: rows[i].key,
          right: rows[j].key,
          billIds: [rows[i].billId, rows[j].billId].filter(Boolean)
        })
      }
    }
  }
  return anomalies
}

function recalculateContinuousRentCoverage(lease = {}, rentBills = [], plannedAllocations = []) {
  const rows = buildCoverageRows(lease, rentBills, plannedAllocations)
  const anomalies = detectAnomalies(rows)
  // 历史导入的已缴截止日是人工核对基准，并不对应一张历史已付账单。
  // 有明确 nextRentDueDate 时，从该基准继续覆盖，避免后续收款把基准回退到起租日。
  const hasHistoricalBaseline = lease.coverageBaselineSource === 'historical_import'
  const storedCoveredUntil = hasHistoricalBaseline ? parseDateInput(lease.rentCoveredUntil) : null
  let cursor = (hasHistoricalBaseline ? parseDateInput(lease.nextRentDueDate) : null) || parseDateInput(lease.startDate)
  if (!cursor) {
    return {
      rentCoveredUntil: null,
      nextRentDueDate: null,
      firstUnpaidPeriod: null,
      continuousPaidPeriods: [],
      anomalies: [{ type: 'missing_lease_start_date' }, ...anomalies]
    }
  }
  let coveredUntil = storedCoveredUntil || null
  const continuousPaidPeriods = []
  let advanced = true

  while (advanced) {
    advanced = false
    for (const row of rows) {
      if (!row.paid) continue
      if (compareDate(row.start, cursor) <= 0 && compareDate(row.end, cursor) >= 0) {
        if (!coveredUntil || compareDate(row.end, coveredUntil) > 0) {
          coveredUntil = row.end
          cursor = addDays(row.end, 1)
          continuousPaidPeriods.push({
            billId: row.billId,
            periodStart: formatDateKey(row.start),
            periodEnd: formatDateKey(row.end),
            source: row.source
          })
          advanced = true
        }
      }
    }
  }

  const firstUnpaid = rows.find(row => compareDate(row.start, cursor) <= 0 && compareDate(row.end, cursor) >= 0 && !row.paid)
  return {
    rentCoveredUntil: coveredUntil,
    nextRentDueDate: cursor,
    firstUnpaidPeriod: firstUnpaid ? {
      billId: firstUnpaid.billId,
      periodStart: formatDateKey(firstUnpaid.start),
      periodEnd: formatDateKey(firstUnpaid.end),
      amount: firstUnpaid.amount,
      paidAmount: firstUnpaid.paidAmount,
      status: firstUnpaid.status
    } : null,
    continuousPaidPeriods,
    anomalies
  }
}

module.exports = {
  parseDateInput,
  addMonths,
  addDays,
  formatDateKey,
  billingMonths,
  sameDate,
  compareDate,
  inferRentBillCoverage,
  coverageKey,
  recalculateContinuousRentCoverage
}
