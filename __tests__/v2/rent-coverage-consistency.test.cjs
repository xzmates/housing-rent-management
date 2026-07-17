const { getCollectionData, clearAllData } = require('../setup.cjs');
const api = require('../../miniprogram/services/api');

function seedBase() {
  clearAllData();
  getCollectionData('houses').push({ _id: 'h1', code: '201', address: '东楼', rent: 1000, status: 'available' });
  getCollectionData('tenants').push({ _id: 't1', name: '麦粥', phone: '18858585854', status: 'inactive' });
}

async function createMonthlyLease() {
  seedBase();
  const result = await api.createLease({
    houseId: 'h1',
    tenantId: 't1',
    startDate: '2026-01-01',
    rent: 1000,
    deposit: 1000,
    paymentCycle: 'month'
  });
  return result.leaseId;
}

function dateKey(value) {
  const raw = value && value.$date ? value.$date : value;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function rentBills(leaseId) {
  return getCollectionData('bills')
    .filter(item => item.leaseId === leaseId && item.type === 'rent')
    .sort((a, b) => new Date(a.rentCoverageStart || a.dueDate) - new Date(b.rentCoverageStart || b.dueDate));
}

function rentBillByStart(leaseId, start) {
  const bill = rentBills(leaseId).find(item => dateKey(item.rentCoverageStart || item.dueDate) === start);
  if (!bill) throw new Error(`缺少租金账单 ${start}`);
  return bill;
}

async function payBillByStart(leaseId, start, amount = 1000) {
  const bill = rentBillByStart(leaseId, start);
  return api.payBill(bill._id, amount, '2026-06-24', 'cash');
}

async function collectRange(leaseId, periodStart, periodCount) {
  const preview = await api.previewRentCollection({
    leaseId,
    periodStart,
    periodCount,
    paymentMethod: 'cash',
    paymentDate: '2026-06-24'
  });
  return api.confirmRentCollection({ confirmationId: preview.confirmationId });
}

async function expectCoverage(leaseId, coveredUntil, nextDue) {
  const lease = await api.getLeaseById(leaseId);
  expect(dateKey(lease.rentCoveredUntil)).toBe(coveredUntil);
  expect(dateKey(lease.nextRentDueDate)).toBe(nextDue);
}

function loadPaymentsPage() {
  let pageDef = null;
  const oldPage = global.Page;
  global.Page = (def) => { pageDef = def; };
  delete require.cache[require.resolve('../../miniprogram/pages/payments/index.js')];
  require('../../miniprogram/pages/payments/index.js');
  global.Page = oldPage;
  return pageDef;
}

describe('旧收租入口与 RentCollection 连续账期一致性', () => {
  it('旧账单入口允许先缴 5 月，但连续已缴日期不越过 2-4 月缺口', async () => {
    const leaseId = await createMonthlyLease();
    await expectCoverage(leaseId, '2026-01-31', '2026-02-01');

    await payBillByStart(leaseId, '2026-05-01');
    expect(rentBillByStart(leaseId, '2026-05-01').status).toBe('paid');
    await expectCoverage(leaseId, '2026-01-31', '2026-02-01');

    await payBillByStart(leaseId, '2026-02-01');
    await expectCoverage(leaseId, '2026-02-28', '2026-03-01');

    await payBillByStart(leaseId, '2026-03-01');
    await expectCoverage(leaseId, '2026-03-31', '2026-04-01');

    await payBillByStart(leaseId, '2026-04-01');
    await expectCoverage(leaseId, '2026-05-31', '2026-06-01');
  });

  it('1、2、5、6、7 月已缴但 3、4 月未缴时不能越过缺口；补齐后自动推进到 7 月', async () => {
    const leaseId = await createMonthlyLease();

    await collectRange(leaseId, '2026-02-01', 1);
    await collectRange(leaseId, '2026-05-01', 3);
    await expectCoverage(leaseId, '2026-02-28', '2026-03-01');

    await collectRange(leaseId, '2026-03-01', 2);
    await expectCoverage(leaseId, '2026-07-31', '2026-08-01');
  });

  it('单张旧入口和统一 RentCollection 对非连续未来账期得出相同连续覆盖结果', async () => {
    const legacyLeaseId = await createMonthlyLease();
    await payBillByStart(legacyLeaseId, '2026-05-01');
    const legacyAudit = await api.auditLeaseRentCoverage(legacyLeaseId);

    const collectionLeaseId = await createMonthlyLease();
    await collectRange(collectionLeaseId, '2026-05-01', 1);
    const collectionAudit = await api.auditLeaseRentCoverage(collectionLeaseId);

    expect(legacyAudit.calculatedRentCoveredUntil).toBe('2026-01-31');
    expect(collectionAudit.calculatedRentCoveredUntil).toBe('2026-01-31');
    expect(legacyAudit.calculatedNextRentDueDate).toBe(collectionAudit.calculatedNextRentDueDate);
  });

  it('旧 payBill 云函数 mock 也使用连续扫描，不再把最晚已缴账期当成连续已缴至', async () => {
    const leaseId = await createMonthlyLease();
    const may = rentBillByStart(leaseId, '2026-05-01');

    const res = await wx.cloud.callFunction({
      name: 'payBill',
      data: { billId: may._id, amount: 1000, paymentDate: '2026-06-24', paymentMethod: 'cash' }
    });

    expect(res.result.code).toBe(0);
    await expectCoverage(leaseId, '2026-01-31', '2026-02-01');
  });

  it('非租金账单缴费不修改租金连续覆盖日期', async () => {
    const leaseId = await createMonthlyLease();
    getCollectionData('bills').push({
      _id: 'utility_1',
      leaseId,
      houseId: 'h1',
      tenantId: 't1',
      type: 'utility',
      period: '2026-06-24',
      amount: 430,
      paidAmount: 0,
      status: 'unpaid',
      dueDate: '2026-06-24',
      createdAt: new Date()
    });

    await api.payBill('utility_1', 430, '2026-06-24', 'wechat');
    await expectCoverage(leaseId, '2026-01-31', '2026-02-01');
  });

  it('部分缴费租金账单不能被视为连续缴清', async () => {
    const leaseId = await createMonthlyLease();

    await payBillByStart(leaseId, '2026-02-01', 500);
    const feb = rentBillByStart(leaseId, '2026-02-01');

    expect(feb.status).toBe('partial');
    await expectCoverage(leaseId, '2026-01-31', '2026-02-01');
  });

  it('只给金额但没有明确账期时不能自动分配到未来账单', async () => {
    const leaseId = await createMonthlyLease();

    const preview = await api.previewRentCollection({
      leaseId,
      amount: 1000,
      paymentMethod: 'wechat'
    });

    expect(preview.needPeriod).toBe(true);
    expect(preview.confirmationId).toBeFalsy();
    expect(getCollectionData('operation_confirmations')).toHaveLength(0);
  });

  it('历史 lease 字段错误时，预览和审计都以账单重算值为准', async () => {
    const leaseId = await createMonthlyLease();
    const lease = getCollectionData('lease_agreements').find(item => item._id === leaseId);
    lease.rentCoveredUntil = new Date(2026, 4, 31);
    lease.nextRentDueDate = new Date(2026, 5, 1);

    const preview = await api.previewRentCollection({
      leaseId,
      periodStart: '2026-02-01',
      periodCount: 1,
      paymentMethod: 'cash'
    });
    expect(preview.rentCollectionView.currentRentCoveredUntil).toBe('2026-01-31');
    expect(preview.rentCollectionView.projectedRentCoveredUntil).toBe('2026-02-28');

    const audit = await api.auditLeaseRentCoverage(leaseId);
    expect(audit.isConsistent).toBe(false);
    expect(audit.storedRentCoveredUntil).toBe('2026-05-31');
    expect(audit.calculatedRentCoveredUntil).toBe('2026-01-31');
  });

  it('旧缴费弹窗遇到前置欠租时提示；取消不产生业务写入', async () => {
    const pageDef = loadPaymentsPage();
    const leaseId = await createMonthlyLease();
    const beforePayments = getCollectionData('payments').length;
    const may = { ...rentBillByStart(leaseId, '2026-05-01'), remaining: 1000, dueDateStr: '2026/5/1' };
    const allBills = rentBills(leaseId).map(item => ({ ...item, remaining: item.amount - item.paidAmount, dueDateStr: api.formatDate(item.dueDate) }));
    const ctx = {
      ...pageDef,
      data: { ...JSON.parse(JSON.stringify(pageDef.data)), allBills },
      setData(patch, cb) {
        this.data = { ...this.data, ...patch };
        if (cb) cb();
      }
    };

    pageDef.showPayModal.call(ctx, { currentTarget: { dataset: { bill: may } } });
    expect(ctx.data.rentGapWarning.count).toBe(3);
    expect(ctx.data.rentGapConfirmed).toBe(false);

    pageDef.closePay.call(ctx);
    expect(getCollectionData('payments')).toHaveLength(beforePayments);
    expect(rentBillByStart(leaseId, '2026-05-01').status).toBe('unpaid');
  });
});
