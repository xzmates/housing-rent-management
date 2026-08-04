const { clearAllData, getCollectionData } = require('../setup.cjs');

function loadPage() {
  let pageDef = null;
  const oldPage = global.Page;
  global.Page = (def) => { pageDef = def; };
  delete require.cache[require.resolve('../../miniprogram/pages/dashboard/index.js')];
  require('../../miniprogram/pages/dashboard/index.js');
  global.Page = oldPage;
  return pageDef;
}

function createContext() {
  const pageDef = loadPage();
  return {
    ...pageDef,
    data: JSON.parse(JSON.stringify(pageDef.data)),
    setData(patch, cb) {
      this.data = { ...this.data, ...patch };
      if (cb) cb();
    }
  };
}

function seedLeaseWithJulyRentBill(status = 'paid') {
  clearAllData();
  getCollectionData('houses').push({ _id: 'h1', code: '201', address: '东楼', rent: 1000, status: 'rented' });
  getCollectionData('tenants').push({ _id: 't1', name: '麦粥', status: 'active' });
  getCollectionData('lease_agreements').push({
    _id: 'l1',
    houseId: 'h1',
    tenantId: 't1',
    status: 'active',
    rent: 1000,
    deposit: 1000,
    startDate: '2026-01-11',
    rentCoveredUntil: status === 'paid' ? '2026-08-10' : '2026-07-10',
    nextRentDueDate: '2026-07-11',
    createdAt: new Date('2026-01-11')
  });
  getCollectionData('bills').push({
    _id: 'rent_july',
    leaseId: 'l1',
    houseId: 'h1',
    tenantId: 't1',
    type: 'rent',
    period: '2026-07-11~2026-08-10',
    amount: 1000,
    paidAmount: status === 'paid' ? 1000 : 0,
    status,
    dueDate: '2026-07-11',
    rentCoverageStart: '2026-07-11',
    rentCoverageEnd: '2026-08-10',
    createdAt: new Date('2026-07-01')
  });
}

describe('首页临近收费提醒', () => {
  it('nextRentDueDate 指向已缴租金账单时，不再生成合同应缴提醒', async () => {
    seedLeaseWithJulyRentBill('paid');
    const ctx = createContext();

    await ctx.loadBills.call(ctx);

    expect(ctx.data.reminderSummary.count).toBe(0);
    expect(ctx.data.reminderSummary.currentCount).toBe(0);
    expect(ctx.data.reminderSummary.futureCount).toBe(0);
    expect(ctx.data.visibleReminderBills).toEqual([]);
  });

  it('nextRentDueDate 指向未缴租金账单时，只展示账单提醒，不重复生成合同提醒', async () => {
    seedLeaseWithJulyRentBill('unpaid');
    const ctx = createContext();

    await ctx.loadBills.call(ctx);

    expect(ctx.data.reminderSummary.count).toBe(1);
    expect(ctx.data.reminderSummary.currentCount).toBe(1);
    expect(ctx.data.reminderSummary.futureCount).toBe(0);
    expect(ctx.data.visibleReminderBills[0].reminderKind).toBe('bill');
    expect(ctx.data.visibleReminderBills[0].billId).toBe('rent_july');
  });
});
