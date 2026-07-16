const { getCollectionData, clearAllData, DEFAULT_OPENID } = require('../setup.cjs');
const api = require('../../miniprogram/services/api');
const leaseApis = require('../../miniprogram/skills/lease-skill/apis');
const leaseMcp = require('../../miniprogram/skills/lease-skill/mcp.json');
const rentMcp = require('../../miniprogram/skills/rent-collection-skill/mcp.json');

function seedBase() {
  clearAllData();
  getCollectionData('houses').push({ _id: 'h1', code: '101', address: '东楼', rent: 1000, status: 'available' });
  getCollectionData('tenants').push({ _id: 't1', name: '麦粥', phone: '18858585854', status: 'inactive' });
  getCollectionData('system_settings').push({ _id: 'global', electricityPrice: 0.8, waterPrice: 3.5 });
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

async function callRental(action, params, openid = DEFAULT_OPENID) {
  const res = await wx.cloud.callFunction({ name: 'rentalDomain', data: { __openid: openid, action, params } });
  return res.result;
}

function rentBills(leaseId) {
  return getCollectionData('bills')
    .filter(item => item.leaseId === leaseId && item.type === 'rent')
    .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
}

async function payRange(leaseId, start, count) {
  const preview = await api.previewRentCollection({
    leaseId,
    periodStart: start,
    periodCount: count,
    paymentMethod: 'cash',
    paymentDate: '2026-06-24'
  });
  return api.confirmRentCollection({ confirmationId: preview.confirmationId });
}

describe('统一租金收款 RentCollection Handoff 链路', () => {
  it('previewRentCollection 返回顶层 handoff，query 只包含短 ID', async () => {
    const leaseId = await createMonthlyLease();
    const result = await leaseApis.previewRentCollection({
      leaseId,
      periodStart: '2026-06-01',
      periodCount: 1,
      paymentMethod: 'wechat',
      paymentDate: '2026-06-24'
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.confirmationId).toBeTruthy();
    expect(result.structuredContent.rentCollectionView.totalCollectionAmount).toBe(1000);
    expect(result.handoff.query).toContain('action=rentCollection');
    expect(result.handoff.query).toContain('confirmationId=');
    expect(result.handoff.query).toContain(`leaseId=${leaseId}`);
    expect(result.handoff.query).not.toMatch(/amount|periodStart|periodEnd|periodCount|paymentMethod|phone|idCard/);
    expect(result.handoff.payload.confirmationId).toBe(result.structuredContent.confirmationId);
  });

  it('预览阶段只创建 confirmation，不创建正式账单、不写 payment、不更新合同', async () => {
    const leaseId = await createMonthlyLease();
    const before = {
      bills: getCollectionData('bills').length,
      payments: getCollectionData('payments').length,
      covered: api.formatDate((await api.getLeaseById(leaseId)).rentCoveredUntil)
    };

    const preview = await api.previewRentCollection({
      leaseId,
      periodStart: '2026-07-01',
      periodCount: 3,
      paymentMethod: 'alipay',
      paymentDate: '2026-06-24'
    });

    expect(preview.confirmationId).toBeTruthy();
    expect(getCollectionData('operation_confirmations')).toHaveLength(1);
    expect(getCollectionData('bills')).toHaveLength(before.bills);
    expect(getCollectionData('payments')).toHaveLength(before.payments);
    expect(api.formatDate((await api.getLeaseById(leaseId)).rentCoveredUntil)).toBe(before.covered);
  });

  it('当期收租匹配已有账单，不重复创建账单', async () => {
    const leaseId = await createMonthlyLease();
    await payRange(leaseId, '2026-02-01', 4);
    const beforeBills = getCollectionData('bills').length;

    const preview = await api.previewRentCollection({
      leaseId,
      periodStart: '2026-06-01',
      periodCount: 1,
      paymentMethod: 'wechat',
      paymentDate: '2026-06-24'
    });
    expect(preview.rentCollectionView.mode).toBe('current');
    expect(preview.rentCollectionView.allocations[0].source).toBe('existing');

    const result = await api.confirmRentCollection({ confirmationId: preview.confirmationId });
    const juneBill = rentBills(leaseId).find(item => api.formatDate(item.dueDate) === '2026/6/1');
    const lease = await api.getLeaseById(leaseId);

    expect(result.createdBillIds).toHaveLength(0);
    expect(getCollectionData('bills')).toHaveLength(beforeBills);
    expect(juneBill.status).toBe('paid');
    expect(juneBill.paidAmount).toBe(1000);
    expect(api.formatDate(lease.rentCoveredUntil)).toBe('2026/6/30');
  });

  it('补交历史欠租后连续缴清日期推进到已补齐的最后账期', async () => {
    const leaseId = await createMonthlyLease();
    const preview = await api.previewRentCollection({
      leaseId,
      periodStart: '2026-02-01',
      periodCount: 2,
      paymentMethod: 'cash',
      paymentDate: '2026-06-24'
    });
    expect(preview.rentCollectionView.mode).toBe('arrears');
    await api.confirmRentCollection({ confirmationId: preview.confirmationId });

    const lease = await api.getLeaseById(leaseId);
    expect(api.formatDate(lease.rentCoveredUntil)).toBe('2026/3/31');
  });

  it('提前三个月缺少未来账单时才创建新账单', async () => {
    const leaseId = await createMonthlyLease();
    await payRange(leaseId, '2026-02-01', 5);
    const beforeBills = getCollectionData('bills').length;

    const preview = await api.previewRentCollection({
      leaseId,
      periodStart: '2026-07-01',
      periodCount: 3,
      paymentMethod: 'alipay',
      paymentDate: '2026-06-24'
    });
    expect(preview.rentCollectionView.mode).toBe('advance');
    expect(preview.rentCollectionView.billsToCreate).toHaveLength(3);

    const result = await api.confirmRentCollection({ confirmationId: preview.confirmationId });
    const lease = await api.getLeaseById(leaseId);

    expect(result.createdBillIds).toHaveLength(3);
    expect(getCollectionData('bills')).toHaveLength(beforeBills + 3);
    expect(getCollectionData('payments').filter(p => p.confirmationId === preview.confirmationId)).toHaveLength(3);
    expect(api.formatDate(lease.rentCoveredUntil)).toBe('2026/9/30');
  });

  it('欠租 + 当期 + 未来混合账期使用同一分配逻辑', async () => {
    const leaseId = await createMonthlyLease();
    const preview = await api.previewRentCollection({
      leaseId,
      periodStart: '2026-05-01',
      periodCount: 3,
      paymentMethod: 'bank',
      paymentDate: '2026-06-24'
    });

    expect(preview.rentCollectionView.mode).toBe('mixed');
    expect(preview.rentCollectionView.allocations.map(item => item.source)).toEqual(['existing', 'existing', 'new']);

    const result = await api.confirmRentCollection({ confirmationId: preview.confirmationId });
    const lease = await api.getLeaseById(leaseId);

    expect(result.createdBillIds).toHaveLength(1);
    expect(result.settledBillIds).toHaveLength(2);
    expect(api.formatDate(lease.rentCoveredUntil)).toBe('2026/1/31');
  });

  it('中间有欠租缺口时，未来已缴不能越过缺口推进 rentCoveredUntil；补齐缺口后再推进', async () => {
    const leaseId = await createMonthlyLease();
    await payRange(leaseId, '2026-07-01', 2);
    let lease = await api.getLeaseById(leaseId);
    expect(api.formatDate(lease.rentCoveredUntil)).toBe('2026/1/31');

    await payRange(leaseId, '2026-02-01', 5);
    lease = await api.getLeaseById(leaseId);
    expect(api.formatDate(lease.rentCoveredUntil)).toBe('2026/8/31');
  });

  it('只输入金额且账期不明确时返回 need_period，不创建 confirmation', async () => {
    const leaseId = await createMonthlyLease();
    const result = await api.previewRentCollection({
      leaseId,
      amount: 3000,
      paymentMethod: 'wechat'
    });

    expect(result.needPeriod).toBe(true);
    expect(result.confirmationId).toBeFalsy();
    expect(getCollectionData('operation_confirmations')).toHaveLength(0);
  });

  it('金额与权威应收金额不一致时拒绝', async () => {
    const leaseId = await createMonthlyLease();
    const result = await callRental('previewRentCollection', {
      leaseId,
      periodStart: '2026-06-01',
      periodCount: 1,
      amount: 3000,
      paymentMethod: 'wechat'
    });

    expect(result.code).toBe(-1);
    expect(result.errorCode).toBe('VALIDATION_ERROR');
  });

  it('最终确认只接受 confirmationId，重复确认幂等回放', async () => {
    const leaseId = await createMonthlyLease();
    const preview = await api.previewRentCollection({
      leaseId,
      periodStart: '2026-06-01',
      periodCount: 1,
      paymentMethod: 'wechat'
    });

    const first = await api.confirmRentCollection({ confirmationId: preview.confirmationId });
    const billCount = getCollectionData('bills').length;
    const paymentCount = getCollectionData('payments').length;
    const second = await api.confirmRentCollection({ confirmationId: preview.confirmationId });

    expect(first.paymentIds).toHaveLength(1);
    expect(second.replayed).toBe(true);
    expect(getCollectionData('bills')).toHaveLength(billCount);
    expect(getCollectionData('payments')).toHaveLength(paymentCount);
  });

  it('其他 openid、过期 confirmation、错误 leaseId 覆盖都会被拒绝', async () => {
    const leaseId = await createMonthlyLease();
    const preview = await api.previewRentCollection({
      leaseId,
      periodStart: '2026-06-01',
      periodCount: 1,
      paymentMethod: 'cash'
    });

    const otherUser = await callRental('confirmRentCollection', { confirmationId: preview.confirmationId }, 'other-openid');
    expect(otherUser.code).toBe(-1);
    expect(otherUser.errorCode).toBe('FORBIDDEN');

    const wrongLease = await callRental('confirmRentCollection', { confirmationId: preview.confirmationId, leaseId: 'wrong-lease' });
    expect(wrongLease.code).toBe(-1);
    expect(wrongLease.errorCode).toBe('VALIDATION_ERROR');

    const confirmation = getCollectionData('operation_confirmations').find(item => item._id === preview.confirmationId);
    confirmation.expiresAt = new Date(Date.now() - 1000);
    const expired = await callRental('confirmRentCollection', { confirmationId: preview.confirmationId });
    expect(expired.code).toBe(-1);
    expect(expired.errorCode).toBe('CONFLICT');
  });

  it('账单或合同租金变化后旧 confirmation 失效', async () => {
    const leaseId = await createMonthlyLease();
    const preview = await api.previewRentCollection({
      leaseId,
      periodStart: '2026-06-01',
      periodCount: 1,
      paymentMethod: 'cash'
    });
    const june = rentBills(leaseId).find(item => api.formatDate(item.dueDate) === '2026/6/1');
    june.amount = 1200;

    const staleByBill = await callRental('confirmRentCollection', { confirmationId: preview.confirmationId });
    expect(staleByBill.code).toBe(-1);
    expect(staleByBill.errorCode).toBe('STALE_CONFIRMATION');

    const fresh = await api.previewRentCollection({
      leaseId,
      periodStart: '2026-05-01',
      periodCount: 1,
      paymentMethod: 'cash'
    });
    getCollectionData('lease_agreements').find(item => item._id === leaseId).rent = 1500;

    const staleByLease = await callRental('confirmRentCollection', { confirmationId: fresh.confirmationId });
    expect(staleByLease.code).toBe(-1);
    expect(staleByLease.errorCode).toBe('STALE_CONFIRMATION');
  });

  it('非租金账单不进入 RentCollection，非租金缴费不更新 rentCoveredUntil', async () => {
    const leaseId = await createMonthlyLease();
    const before = api.formatDate((await api.getLeaseById(leaseId)).rentCoveredUntil);
    getCollectionData('bills').push({
      _id: 'utility_1',
      leaseId,
      houseId: 'h1',
      tenantId: 't1',
      type: 'utility',
      amount: 430,
      paidAmount: 0,
      status: 'unpaid',
      dueDate: '2026-06-24',
      createdAt: new Date()
    });

    await api.payBill('utility_1', 430, '2026-06-24', 'cash');
    expect(api.formatDate((await api.getLeaseById(leaseId)).rentCoveredUntil)).toBe(before);
  });

  it('旧 previewPrepayRent / confirmPrepayRent 仍兼容统一核心', async () => {
    const leaseId = await createMonthlyLease();
    const preview = await api.previewPrepayRent({
      leaseId,
      coverageMonths: 3,
      paymentMethod: 'wechat',
      paymentDate: '2026-06-24'
    });
    expect(preview.prepayView.amount).toBe(3000);
    expect(preview.rentCollectionView.totalCollectionAmount).toBe(3000);

    const result = await api.confirmPrepayRent({ confirmationId: preview.confirmationId });
    expect(result.paidAmount).toBe(3000);
    expect(result.confirmationId).toBe(preview.confirmationId);
  });

  it('prepay-rent 手动入口无 pageId 时仍能加载合同，Handoff payload 只作预填', async () => {
    const leaseId = await createMonthlyLease();
    let pageDef = null;
    const oldPage = global.Page;
    global.Page = (def) => { pageDef = def; };
    delete require.cache[require.resolve('../../miniprogram/pages/prepay-rent/index.js')];
    require('../../miniprogram/pages/prepay-rent/index.js');

    const ctx = {
      ...pageDef,
      data: JSON.parse(JSON.stringify(pageDef.data)),
      setData(patch, cb) {
        this.data = { ...this.data, ...patch };
        if (cb) cb();
      }
    };
    await pageDef.loadFromHandoff.call(ctx, { leaseId });

    expect(ctx.data.loading).toBe(false);
    expect(ctx.data.selectedLease._id).toBe(leaseId);
    expect(ctx.data.periodStart).toBeTruthy();

    global.Page = oldPage;
  });

  it('最终写入 API 不暴露给 AI', () => {
    const leaseTools = leaseMcp.apis.map(item => item.name);
    const rentTools = rentMcp.apis.map(item => item.name);

    expect(leaseTools).toContain('previewRentCollection');
    expect(leaseTools).toContain('previewPrepayRent');
    expect(leaseTools).not.toContain('confirmRentCollection');
    expect(leaseTools).not.toContain('confirmPrepayRent');
    expect(rentTools).not.toContain('confirmCollectRent');
  });
});
