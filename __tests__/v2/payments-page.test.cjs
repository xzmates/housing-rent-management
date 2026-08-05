describe('缴费记录收付款汇总', () => {
  const { clearAllData, getCollectionData } = require('../setup.cjs')
  const api = require('../../miniprogram/services/api')

  function loadPage() {
    let pageDef = null
    const oldPage = global.Page
    global.Page = (def) => { pageDef = def }
    delete require.cache[require.resolve('../../miniprogram/pages/payments/index.js')]
    require('../../miniprogram/pages/payments/index.js')
    global.Page = oldPage
    return pageDef
  }

  function createContext(filters = {}) {
    const pageDef = loadPage()
    return {
      ...pageDef,
      data: {
        ...JSON.parse(JSON.stringify(pageDef.data)),
        filters: { status: '', type: '', dateStart: '', dateEnd: '', ...filters },
        houseFilterId: '',
        allLeases: [
          { _id: 'l1', houseId: 'h1', status: 'active', deposit: 1000 },
          { _id: 'l2', houseId: 'h2', status: 'terminated', deposit: 500 }
        ]
      },
      setData(patch) { this.data = { ...this.data, ...patch } }
    }
  }

  it('收付款汇总由 rentalDomain 返回，页面只补充在管押金', async () => {
    const ctx = createContext({ dateStart: '2026-07-01', dateEnd: '2026-07-31' })
    ctx.data.allBills = [{ _id: 'deposit-bill', leaseId: 'l1', type: 'deposit' }]
    ctx.data.allPayments = [{ billId: 'deposit-bill', leaseId: 'l1', direction: 'in', amount: 1000 }]
    const original = api.callRentalDomain
    const calls = []
    api.callRentalDomain = async (action, params) => {
      calls.push({ action, params })
      return {
        cashReceived: 2300,
        rentReceived: 1000,
        utilityReceived: 300,
        depositReceived: 800,
        settlementReceived: 200,
        otherReceived: 0,
        cashRefunded: 120,
        depositRefund: 100,
        rentRefund: 20,
        otherRefund: 0,
        overdueAmount: 600,
        upcomingAmount: 1000,
        undatedOutstandingAmount: 0
      }
    }
    try {
      await ctx.loadFinancialSummary()
      expect(calls).toEqual([{ action: 'getFinancialReport', params: { startDate: '2026-07-01', endDate: '2026-07-31' } }])
      expect(ctx.data.stats).toMatchObject({ cashReceived: 2300, cashRefunded: 120, managedDeposit: 1000 })
    } finally {
      api.callRentalDomain = original
    }
  })

  it('房屋筛选仅作为云端汇总的主体条件', async () => {
    const ctx = createContext()
    ctx.data.houseFilterId = 'h1'
    ctx.data.allBills = [{ _id: 'deposit-bill', leaseId: 'l1', type: 'deposit' }]
    ctx.data.allPayments = [{ billId: 'deposit-bill', leaseId: 'l1', direction: 'in', amount: 1000 }]
    const original = api.callRentalDomain
    let params = null
    api.callRentalDomain = async (_, input) => {
      params = input
      return {}
    }
    try {
      await ctx.loadFinancialSummary()
      expect(params).toEqual({ houseId: 'h1' })
      expect(ctx.data.stats.managedDeposit).toBe(1000)
    } finally {
      api.callRentalDomain = original
    }
  })

  it('日期筛选仍以付款日期优先、无付款账单以到期日兜底', () => {
    const ctx = createContext({ dateStart: '2026-07-01', dateEnd: '2026-07-31' })
    ctx.data.allPayments = [{ billId: 'rent', paymentDate: '2026-07-05' }]
    const rows = [
      { _id: 'rent', dueDate: '2026-06-01' },
      { _id: 'utility', dueDate: '2026-07-31' },
      { _id: 'future', dueDate: '2026-08-01' }
    ]
    expect(ctx.filterBillsByDateRange(rows).map(item => item._id)).toEqual(['rent', 'utility'])
  })

  it('账单明细默认显示10条，并可切换为20条或50条', () => {
    const ctx = createContext()
    ctx.data.bills = Array.from({ length: 27 }, (_, index) => ({ _id: `b${index}` }))
    ctx.onDisplayLimitChange.call(ctx, { detail: { value: '1' } })
    expect(ctx.data).toMatchObject({ displayLimit: 20, displayLimitIndex: 1 })
    expect(ctx.data.visibleBills).toHaveLength(20)

    ctx.onDisplayLimitChange.call(ctx, { detail: { value: '2' } })
    expect(ctx.data).toMatchObject({ displayLimit: 50, displayLimitIndex: 2 })
    expect(ctx.data.visibleBills).toHaveLength(27)
  })

  it('押金抵扣按其关联账单类型拆分，不会把水电写成租金', async () => {
    const ctx = createContext({ dateStart: '2026-07-01', dateEnd: '2026-07-31' })
    ctx.data.allBills = [
      { _id: 'rent-bill', houseId: 'h1', type: 'rent' },
      { _id: 'utility-bill', houseId: 'h1', type: 'utility' },
      { _id: 'other-bill', houseId: 'h1', type: 'extra_due' }
    ]
    ctx.data.allPayments = [
      { billId: 'rent-bill', amount: 100, paymentMethod: 'deposit_offset', paymentDate: '2026-07-03' },
      { billId: 'utility-bill', amount: 680, paymentMethod: 'deposit_offset', paymentDate: '2026-07-04' },
      { billId: 'other-bill', amount: 20, paymentMethod: 'deposit_offset', paymentDate: '2026-07-05' }
    ]
    const original = api.callRentalDomain
    api.callRentalDomain = async () => ({})
    try {
      await ctx.loadFinancialSummary()
      expect(ctx.data.stats).toMatchObject({
        depositOffsetRent: 100,
        depositOffsetUtility: 680,
        depositOffsetOther: 20
      })
    } finally {
      api.callRentalDomain = original
    }
  })

  it('经营结算的租金扣除已实际退还的预收租金', async () => {
    const ctx = createContext({ dateStart: '2026-08-04', dateEnd: '2026-08-04' })
    ctx.data.allLeases = [{ _id: 'l1', houseId: 'h1', status: 'terminated', deposit: 900, damageAmount: 200, endedAt: '2026-08-04' }]
    ctx.data.allBills = [
      { _id: 'rent-bill', houseId: 'h1', type: 'rent' },
      { _id: 'utility-bill', houseId: 'h1', type: 'utility' },
      { _id: 'rent-refund-bill', houseId: 'h1', type: 'rent_refund' }
    ]
    ctx.data.allPayments = [
      { billId: 'rent-bill', amount: 8100, direction: 'in', paymentDate: '2026-08-04' },
      { billId: 'utility-bill', amount: 680, direction: 'in', paymentMethod: 'deposit_offset', paymentDate: '2026-08-04' },
      { billId: 'rent-refund-bill', amount: 2700, direction: 'out', paymentMethod: 'refund_offset', paymentDate: '2026-08-04' }
    ]
    const original = api.callRentalDomain
    api.callRentalDomain = async () => ({})
    try {
      await ctx.loadFinancialSummary()
      expect(ctx.data.stats).toMatchObject({
        rentSettled: 5400,
        utilitySettled: 680,
        damageSettled: 200,
        operatingSettlementTotal: 6280
      })
    } finally {
      api.callRentalDomain = original
    }
  })

  it('paidAmount 已覆盖 amount 时，即使原 status=partial，API 也规范为已缴', async () => {
    clearAllData()
    getCollectionData('bills').push({
      _id: 'dirty_partial', leaseId: 'l1', houseId: 'h1', type: 'rent',
      amount: 1000, paidAmount: 1000, status: 'partial', dueDate: '2026-03-11'
    })
    const res = await api.getBills()
    expect(res.data[0].status).toBe('paid')
    expect(res.data[0].remaining).toBe(0)
  })

  it('首页多周期待收可一次确认，云端按最早租金账期依次入账', async () => {
    clearAllData()
    const owner = 'test-openid'
    getCollectionData('lease_agreements').push({ _id: 'batch_lease', _openid: owner, status: 'active', houseId: 'h1', tenantId: 't1', rent: 1000 })
    getCollectionData('bills').push(
      { _id: 'rent_early', _openid: owner, leaseId: 'batch_lease', houseId: 'h1', tenantId: 't1', type: 'rent', amount: 1000, paidAmount: 0, status: 'unpaid', dueDate: '2026-04-04', rentCoverageStart: '2026-04-04', rentCoverageEnd: '2026-05-03' },
      { _id: 'rent_late', _openid: owner, leaseId: 'batch_lease', houseId: 'h1', tenantId: 't1', type: 'rent', amount: 1000, paidAmount: 0, status: 'unpaid', dueDate: '2026-05-04', rentCoverageStart: '2026-05-04', rentCoverageEnd: '2026-06-03' }
    )

    const result = await api.payBillBatch(['rent_late', 'rent_early'], 1500, '2026-08-03', 'cash')
    expect(result).toMatchObject({ paidAmount: 1500, remaining: 500, settledCount: 2 })
    const bills = getCollectionData('bills')
    expect(bills.find(item => item._id === 'rent_early')).toMatchObject({ paidAmount: 1000, status: 'paid' })
    expect(bills.find(item => item._id === 'rent_late')).toMatchObject({ paidAmount: 500, status: 'partial' })
  })
})
