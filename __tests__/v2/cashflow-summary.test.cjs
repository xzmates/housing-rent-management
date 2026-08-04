const { summarizeCashflow, isCashIncoming } = require('../../cloudfunctions/rentalDomain/domain/cashflow-summary')

describe('统一收付款口径', () => {
  const billMap = {
    rent: { type: 'rent' }, utility: { type: 'utility' }, deposit: { type: 'deposit' },
    settlement: { type: 'extra_due' }, damage: { type: 'damage' },
    depositRefund: { type: 'deposit_return' }, rentRefund: { type: 'rent_refund' }
  }

  it('按真实流水拆分收款、退款和现金净变化', () => {
    const result = summarizeCashflow([
      { billId: 'rent', amount: 1000, direction: 'in' },
      { billId: 'utility', amount: 80, direction: 'in' },
      { billId: 'deposit', amount: 500, direction: 'in' },
      { billId: 'settlement', amount: 180, direction: 'in' },
      { billId: 'damage', amount: 20, direction: 'in' },
      { billId: 'unknown', amount: 30, direction: 'in' },
      { billId: 'depositRefund', amount: 400, direction: 'out' },
      { billId: 'rentRefund', amount: 50, direction: 'out' },
      { billId: 'unknownRefund', amount: 10, direction: 'out' }
    ], billMap)

    expect(result).toMatchObject({
      cashReceived: 1810, rentReceived: 1000, utilityReceived: 80,
      depositReceived: 500, settlementReceived: 200, otherReceived: 30,
      cashRefunded: 460, depositRefund: 400, rentRefund: 50, otherRefund: 10,
      netCashChange: 1350, unclassifiedIncomingCount: 1, unclassifiedRefundCount: 1
    })
  })

  it('内部押金抵扣不属于新增收款，兼容历史 paymentMethod', () => {
    const payments = [
      { billId: 'rent', amount: 300, direction: 'in', cashImpact: false },
      { billId: 'utility', amount: 200, direction: 'in', paymentMethod: 'deposit_offset' },
      { billId: 'rent', amount: 100, direction: 'internal' },
      { billId: 'rent', amount: 50, direction: 'in' }
    ]
    const result = summarizeCashflow(payments, billMap)
    expect(isCashIncoming(payments[0])).toBe(false)
    expect(isCashIncoming(payments[1])).toBe(false)
    expect(isCashIncoming(payments[2])).toBe(false)
    expect(result).toMatchObject({ cashReceived: 50, rentReceived: 50, internalOffsetTotal: 500 })
  })
})
