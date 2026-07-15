const { getCollectionData, clearAllData, DEFAULT_OPENID } = require('../setup.cjs');
const api = require('../../miniprogram/services/api');
const leaseApis = require('../../miniprogram/skills/lease-skill/apis');
const leaseMcp = require('../../miniprogram/skills/lease-skill/mcp.json');

function seedBase() {
  clearAllData();
  getCollectionData('houses').push({ _id: 'h1', code: '101', address: '幸福小区', rent: 1000, status: 'available' });
  getCollectionData('tenants').push({ _id: 't1', name: '张阿姨', phone: '13800000000', status: 'inactive' });
  getCollectionData('system_settings').push({ _id: 'global', electricityPrice: 0.8, waterPrice: 3.5 });
}

async function createLease() {
  seedBase();
  const result = await api.createLease({
    houseId: 'h1',
    tenantId: 't1',
    startDate: '2026-06-01',
    rent: 1000,
    deposit: 1000,
    paymentCycle: 'month'
  });
  return result.leaseId;
}

function businessSnapshot() {
  return {
    leases: getCollectionData('lease_agreements').map(item => ({
      id: item._id,
      status: item.status,
      rent: item.rent,
      rentCoveredUntil: api.formatDate(item.rentCoveredUntil),
      nextRentDueDate: api.formatDate(item.nextRentDueDate)
    })),
    bills: getCollectionData('bills').map(item => ({
      id: item._id,
      type: item.type,
      period: item.period,
      amount: item.amount,
      paidAmount: item.paidAmount || 0,
      status: item.status
    })),
    payments: getCollectionData('payments').length
  };
}

function apiTextFromDateKey(key) {
  const [year, month, day] = String(key).split('-').map(Number);
  return `${year}/${month}/${day}`;
}

async function callRental(action, params, openid = DEFAULT_OPENID) {
  const res = await wx.cloud.callFunction({ name: 'rentalDomain', data: { __openid: openid, action, params } });
  return res.result;
}

describe('提前收租 Handoff 链路', () => {
  it('previewPrepayRent 返回顶层 handoff，query 最小化且不包含金额和收款方式', async () => {
    const leaseId = await createLease();
    const result = await leaseApis.previewPrepayRent({
      leaseId,
      coverageMonths: 3,
      paymentMethod: 'wechat',
      paymentDate: '2026-07-15'
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.confirmationId).toBeTruthy();
    expect(result.structuredContent.prepayView.amount).toBe(3000);
    expect(result.structuredContent.prepayView.paymentMethodText).toBe('微信转账');
    expect(result.handoff).toBeTruthy();
    expect(result.handoff.query).toContain('action=prepayRent');
    expect(result.handoff.query).toContain('confirmationId=');
    expect(result.handoff.query).toContain(`leaseId=${leaseId}`);
    expect(result.handoff.query).not.toMatch(/amount|paymentMethod|coverageMonths|coverageDays|phone|idCard/);
    expect(result.handoff.payload.confirmationId).toBe(result.structuredContent.confirmationId);
    expect(result.handoff.payload.prepayView).toBeTruthy();
  });

  it('预览阶段只创建 confirmation，不创建未来账单、不写 payment、不推进合同日期', async () => {
    const leaseId = await createLease();
    const before = businessSnapshot();
    const preview = await api.previewPrepayRent({
      leaseId,
      coverageMonths: 3,
      paymentMethod: 'wechat',
      paymentDate: '2026-07-15'
    });
    const after = businessSnapshot();

    expect(preview.confirmationId).toBeTruthy();
    expect(getCollectionData('operation_confirmations')).toHaveLength(1);
    expect(after).toEqual(before);
  });

  it('页面最终确认后创建未来租金账单和线下收款记录，并推进合同缴至日期', async () => {
    const leaseId = await createLease();
    const preview = await api.previewPrepayRent({
      leaseId,
      coverageMonths: 3,
      paymentMethod: 'wechat',
      paymentDate: '2026-07-15'
    });

    const result = await api.confirmPrepayRent({ confirmationId: preview.confirmationId });
    const bill = getCollectionData('bills').find(item => item._id === result.billId);
    const payment = getCollectionData('payments').find(item => item._id === result.paymentId);
    const lease = await api.getLeaseById(leaseId);

    expect(result.billCreated).toBe(true);
    expect(bill.type).toBe('rent');
    expect(bill.period).toBe(preview.prepayView.period);
    expect(bill.amount).toBe(3000);
    expect(bill.paidAmount).toBe(3000);
    expect(bill.status).toBe('paid');
    expect(payment.amount).toBe(3000);
    expect(payment.paymentMethod).toBe('wechat');
    expect(api.formatDate(lease.rentCoveredUntil)).toBe(apiTextFromDateKey(preview.prepayView.coverageEnd));
    expect(api.formatDate(lease.nextRentDueDate)).toBeTruthy();
  });

  it('同一 confirmationId 重复确认只回放一次结果，不重复账单或收款', async () => {
    const leaseId = await createLease();
    const preview = await api.previewPrepayRent({ leaseId, coverageMonths: 3, paymentMethod: 'cash' });
    const first = await api.confirmPrepayRent({ confirmationId: preview.confirmationId });
    const billCount = getCollectionData('bills').length;
    const paymentCount = getCollectionData('payments').length;
    const second = await api.confirmPrepayRent({ confirmationId: preview.confirmationId });

    expect(first.billId).toBeTruthy();
    expect(second.replayed).toBe(true);
    expect(getCollectionData('bills')).toHaveLength(billCount);
    expect(getCollectionData('payments')).toHaveLength(paymentCount);
  });

  it('其他 openid、过期 confirmation、错误 leaseId 覆盖都会被拒绝', async () => {
    const leaseId = await createLease();
    const preview = await api.previewPrepayRent({ leaseId, coverageMonths: 3, paymentMethod: 'cash' });

    const otherUser = await callRental('confirmPrepayRent', { confirmationId: preview.confirmationId }, 'other-openid');
    expect(otherUser.code).toBe(-1);
    expect(otherUser.errorCode).toBe('FORBIDDEN');

    const wrongLease = await callRental('confirmPrepayRent', { confirmationId: preview.confirmationId, leaseId: 'wrong-lease' });
    expect(wrongLease.code).toBe(-1);
    expect(wrongLease.errorCode).toBe('VALIDATION_ERROR');

    const confirmation = getCollectionData('operation_confirmations').find(item => item._id === preview.confirmationId);
    confirmation.expiresAt = new Date(Date.now() - 1000);
    const expired = await callRental('confirmPrepayRent', { confirmationId: preview.confirmationId });
    expect(expired.code).toBe(-1);
    expect(expired.errorCode).toBe('CONFLICT');
  });

  it('预览后合同租金或对应周期账单变化时，旧 confirmation 被拒绝', async () => {
    const leaseId = await createLease();
    const rentChanged = await api.previewPrepayRent({ leaseId, coverageMonths: 3, paymentMethod: 'cash' });
    const paymentCount = getCollectionData('payments').length;
    const lease = getCollectionData('lease_agreements').find(item => item._id === leaseId);
    lease.rent = 1200;

    const staleByRent = await callRental('confirmPrepayRent', { confirmationId: rentChanged.confirmationId });
    expect(staleByRent.code).toBe(-1);
    expect(staleByRent.errorCode).toBe('STALE_CONFIRMATION');
    expect(getCollectionData('payments')).toHaveLength(paymentCount);

    const freshLeaseId = await createLease();
    const billChanged = await api.previewPrepayRent({ leaseId: freshLeaseId, coverageMonths: 3, paymentMethod: 'cash' });
    getCollectionData('bills').push({
      _id: 'external_future_bill',
      leaseId: freshLeaseId,
      houseId: 'h1',
      tenantId: 't1',
      type: 'rent',
      period: '2026-07-01~2026-09-30',
      amount: 3000,
      paidAmount: 0,
      status: 'unpaid',
      dueDate: '2026-07-01',
      createdAt: new Date()
    });

    const staleByBill = await callRental('confirmPrepayRent', { confirmationId: billChanged.confirmationId });
    expect(staleByBill.code).toBe(-1);
    expect(staleByBill.errorCode).toBe('STALE_CONFIRMATION');
  });

  it('prepay-rent 无 pageId 的手动入口仍能读取路由 leaseId 并加载合同', async () => {
    const leaseId = await createLease();
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
    expect(ctx.data.leaseIndex).toBe(0);

    global.Page = oldPage;
  });

  it('prepay-rent Handoff 入口会按 confirmationId 重新生成权威预览', async () => {
    const leaseId = await createLease();
    const preview = await api.previewPrepayRent({ leaseId, coverageMonths: 3, paymentMethod: 'wechat' });
    let pageDef = null;
    const oldPage = global.Page;
    const oldGetApp = global.getApp;
    global.Page = (def) => { pageDef = def; };
    global.getApp = () => ({
      takeAgentHandoff(pageId) {
        if (pageId !== 'page-prepay') return null;
        return {
          query: `action=prepayRent&confirmationId=${preview.confirmationId}&leaseId=${leaseId}`,
          payload: {
            confirmationId: preview.confirmationId,
            input: preview.normalizedInput,
            prepayView: preview.prepayView
          }
        };
      }
    });
    delete require.cache[require.resolve('../../miniprogram/pages/prepay-rent/index.js')];
    require('../../miniprogram/pages/prepay-rent/index.js');

    const ctx = {
      ...pageDef,
      data: JSON.parse(JSON.stringify(pageDef.data)),
      getPageId() { return 'page-prepay'; },
      setData(patch, cb) {
        this.data = { ...this.data, ...patch };
        if (cb) cb();
      }
    };
    await pageDef.loadFromHandoff.call(ctx, {});

    expect(ctx.data.loading).toBe(false);
    expect(ctx.data.selectedLease._id).toBe(leaseId);
    expect(ctx.data.confirmationId).toBeTruthy();
    expect(ctx.data.confirmationId).not.toBe(preview.confirmationId);
    expect(ctx.data.preview.amountText).toBe(3000);

    global.Page = oldPage;
    global.getApp = oldGetApp;
  });

  it('Skill 只暴露提前收租预览，不暴露最终入账动作', () => {
    const toolNames = leaseMcp.apis.map(item => item.name);
    const prepayTool = leaseMcp.apis.find(item => item.name === 'previewPrepayRent');

    expect(prepayTool._meta.ui.pagePath).toBe('/pages/prepay-rent/index');
    expect(toolNames).toContain('previewPrepayRent');
    expect(toolNames).not.toContain('confirmPrepayRent');
    expect(toolNames).not.toContain('confirmRenewLease');
    expect(toolNames).not.toContain('executePrepayRent');
  });
});
