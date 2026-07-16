describe('缴费记录统计筛选', () => {
  function loadPage() {
    let pageDef = null;
    const oldPage = global.Page;
    global.Page = (def) => { pageDef = def; };
    delete require.cache[require.resolve('../../miniprogram/pages/payments/index.js')];
    require('../../miniprogram/pages/payments/index.js');
    global.Page = oldPage;
    return pageDef;
  }

  function createContext(filters = {}) {
    const pageDef = loadPage();
    return {
      ...pageDef,
      data: {
        ...JSON.parse(JSON.stringify(pageDef.data)),
        filters: { status: '', type: '', ...filters },
        houseFilterId: '',
        allLeases: [
          { _id: 'l1', houseId: 'h1', status: 'terminated', damageAmount: 500, deposit: 1000 }
        ]
      },
      setData(patch) {
        this.data = { ...this.data, ...patch };
      }
    };
  }

  const bills = [
    { _id: 'r1', leaseId: 'l1', houseId: 'h1', type: 'rent', amount: 3000, paidAmount: 3000, status: 'paid' },
    { _id: 'r2', leaseId: 'l1', houseId: 'h1', type: 'rent', amount: 3000, paidAmount: 3000, status: 'paid' },
    { _id: 'r3', leaseId: 'l1', houseId: 'h1', type: 'rent', amount: 3000, paidAmount: 3000, status: 'paid' },
    { _id: 'r4', leaseId: 'l1', houseId: 'h1', type: 'rent', amount: 6000, paidAmount: 6000, status: 'paid' },
    { _id: 'u1', leaseId: 'l1', houseId: 'h1', type: 'utility', amount: 430, paidAmount: 430, status: 'paid' },
    { _id: 'loss_ref', leaseId: 'l1', houseId: 'h1', type: 'deposit_return', amount: 70, paidAmount: 70, status: 'paid' },
    { _id: 'rr1', leaseId: 'l1', houseId: 'h1', type: 'rent_refund', amount: 6000, paidAmount: 6000, status: 'paid' }
  ];

  it('未筛选时实收合计=租金净收+水电+损失费', () => {
    const ctx = createContext();
    ctx._calcStats(bills);

    expect(ctx.data.stats.rentPaid).toBe(9000);
    expect(ctx.data.stats.utilityPaid).toBe(430);
    expect(ctx.data.stats.lossPaid).toBe(500);
    expect(ctx.data.stats.totalPaid).toBe(9930);
  });

  it('筛选租金时租金退款仍参与抵扣，损失费不混入实收合计', () => {
    const ctx = createContext({ type: 'rent' });
    ctx._calcStats(bills);

    expect(ctx.data.stats.rentPaid).toBe(9000);
    expect(ctx.data.stats.utilityPaid).toBe(0);
    expect(ctx.data.stats.lossPaid).toBe(0);
    expect(ctx.data.stats.totalPaid).toBe(9000);
  });

  it('筛选水电时实收合计只计算水电费', () => {
    const ctx = createContext({ type: 'utility' });
    ctx._calcStats(bills);

    expect(ctx.data.stats.rentPaid).toBe(0);
    expect(ctx.data.stats.utilityPaid).toBe(430);
    expect(ctx.data.stats.lossPaid).toBe(0);
    expect(ctx.data.stats.totalPaid).toBe(430);
  });

  it('筛选已缴+租金时仍显示租金净收，不把退款过滤掉', () => {
    const ctx = createContext({ status: 'paid', type: 'rent' });
    ctx._calcStats(bills);

    expect(ctx.data.stats.rentPaid).toBe(9000);
    expect(ctx.data.stats.totalPaid).toBe(9000);
  });
});
