function money(value) {
  const amount = Number(value || 0)
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0
}

function isInternalOffset(payment = {}) {
  return payment.cashImpact === false || payment.paymentMethod === 'deposit_offset'
}

function isCashIncoming(payment = {}) {
  return payment.direction === 'in' && !isInternalOffset(payment)
}

function billTypeFor(payment = {}, billMap = {}) {
  return billMap[payment.billId]?.type || ''
}

function summarizeCashflow(payments = [], billMap = {}) {
  const totals = {
    cashReceived: 0,
    rentReceived: 0,
    utilityReceived: 0,
    depositReceived: 0,
    settlementReceived: 0,
    otherReceived: 0,
    cashRefunded: 0,
    depositRefund: 0,
    rentRefund: 0,
    otherRefund: 0,
    internalOffsetTotal: 0,
    unclassifiedIncomingCount: 0,
    unclassifiedRefundCount: 0
  }

  payments.forEach(payment => {
    const amount = money(payment.amount)
    const type = billTypeFor(payment, billMap)

    if (isInternalOffset(payment)) {
      totals.internalOffsetTotal = money(totals.internalOffsetTotal + amount)
      return
    }

    if (isCashIncoming(payment)) {
      totals.cashReceived = money(totals.cashReceived + amount)
      if (type === 'rent') totals.rentReceived = money(totals.rentReceived + amount)
      else if (type === 'utility') totals.utilityReceived = money(totals.utilityReceived + amount)
      else if (type === 'deposit') totals.depositReceived = money(totals.depositReceived + amount)
      else if (type === 'extra_due' || type === 'damage') totals.settlementReceived = money(totals.settlementReceived + amount)
      else {
        totals.otherReceived = money(totals.otherReceived + amount)
        totals.unclassifiedIncomingCount += 1
      }
      return
    }

    if (payment.direction === 'out') {
      totals.cashRefunded = money(totals.cashRefunded + amount)
      if (type === 'deposit_return') totals.depositRefund = money(totals.depositRefund + amount)
      else if (type === 'rent_refund') totals.rentRefund = money(totals.rentRefund + amount)
      else {
        totals.otherRefund = money(totals.otherRefund + amount)
        totals.unclassifiedRefundCount += 1
      }
    }
  })

  return {
    ...totals,
    netCashChange: money(totals.cashReceived - totals.cashRefunded)
  }
}

module.exports = { money, isInternalOffset, isCashIncoming, billTypeFor, summarizeCashflow }
