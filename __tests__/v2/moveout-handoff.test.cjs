const { getCollectionData, clearAllData, DEFAULT_OPENID } = require('../setup.cjs');
const api = require('../../miniprogram/services/api');
const moveOutApis = require('../../miniprogram/skills/move-out-skill/apis');
const moveOutMcp = require('../../miniprogram/skills/move-out-skill/mcp.json');

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
    startDate: '2026-01-01',
    rent: 1000,
    deposit: 1000,
    moveInElectricity: 100,
    moveInWater: 50
  });
  return result.leaseId;
}

function businessSnapshot() {
  return {
    leases: getCollectionData('lease_agreements').map(item => ({ id: item._id, status: item.status, endDate: item.endDate || '' })),
    houses: getCollectionData('houses').map(item => ({ id: item._id, status: item.status })),
    tenants: getCollectionData('tenants').map(item => ({ id: item._id, status: item.status })),
    bills: getCollectionData('bills').map(item => ({ id: item._id, status: item.status, amount: item.amount, paidAmount: item.paidAmount || 0 })),
    payments: getCollectionData('payments').length,
    utilityRecords: getCollectionData('utility_records').length
  };
}

async function callRental(action, params, openid = DEFAULT_OPENID) {
  const res = await wx.cloud.callFunction({ name: 'rentalDomain', data: { __openid: openid, action, params } });
  return res.result;
}

describe('退租 Handoff 收尾验收', () => {
  it('previewMoveOutSettlement 返回顶层 handoff，query 最小化且不带最终金额', async () => {
    const leaseId = await createLease();
    const result = await moveOutApis.previewMoveOutSettlement({
      leaseId,
      moveOutDate: '2026-02-01',
      electricityReading: 110,
      waterReading: 60,
      damageAmount: 0
    });

    expect(result.isError).toBe(false);
    expect(result.structuredContent.confirmationId).toBeTruthy();
    expect(result.handoff).toBeTruthy();
    expect(result.handoff.query).toContain('confirmationId=');
    expect(result.handoff.query).toContain(`leaseId=${leaseId}`);
    expect(result.handoff.query).not.toMatch(/outstandingAmount|utilityCost|depositOffset|refundAmount|extraPayment|totalRefund|phone|idCard/);
    expect(result.handoff.payload.confirmationId).toBe(result.structuredContent.confirmationId);
    expect(result.handoff.payload.settlementView).toBeTruthy();
  });

  it('预览阶段只创建 confirmation，不修改正式业务数据', async () => {
    const leaseId = await createLease();
    const before = businessSnapshot();
    const preview = await api.previewMoveOutSettlement({
      leaseId,
      moveOutDate: '2026-02-01',
      electricityReading: 110,
      waterReading: 60,
      damageAmount: 0
    });
    const after = businessSnapshot();

    expect(preview.confirmationId).toBeTruthy();
    expect(getCollectionData('operation_confirmations')).toHaveLength(1);
    expect(after).toEqual(before);
  });

  it('页面确认后完成退租，同一 confirmationId 重复确认只回放一次结果', async () => {
    const leaseId = await createLease();
    const preview = await api.previewMoveOutSettlement({
      leaseId,
      moveOutDate: '2026-02-01',
      electricityReading: 110,
      waterReading: 60,
      damageAmount: 0
    });

    const first = await api.terminateLease({ confirmationId: preview.confirmationId });
    const second = await api.terminateLease({ confirmationId: preview.confirmationId });
    const lease = getCollectionData('lease_agreements').find(item => item._id === leaseId);

    expect(first.totalRefund).toBeDefined();
    expect(second.replayed).toBe(true);
    expect(lease.status).toBe('terminated');
    expect(getCollectionData('lease_agreements').filter(item => item.status === 'terminated')).toHaveLength(1);
  });

  it('其他 openid、过期 confirmation、错误 leaseId 覆盖都会被拒绝', async () => {
    const leaseId = await createLease();
    const preview = await api.previewMoveOutSettlement({
      leaseId,
      moveOutDate: '2026-02-01',
      electricityReading: 110,
      waterReading: 60,
      damageAmount: 0
    });

    const otherUser = await callRental('settleMoveOut', { confirmationId: preview.confirmationId }, 'other-openid');
    expect(otherUser.code).toBe(-1);
    expect(otherUser.errorCode).toBe('FORBIDDEN');

    const wrongLease = await callRental('settleMoveOut', { confirmationId: preview.confirmationId, leaseId: 'wrong-lease' });
    expect(wrongLease.code).toBe(-1);
    expect(wrongLease.errorCode).toBe('VALIDATION_ERROR');

    const confirmation = getCollectionData('operation_confirmations').find(item => item._id === preview.confirmationId);
    confirmation.expiresAt = new Date(Date.now() - 1000);
    const expired = await callRental('settleMoveOut', { confirmationId: preview.confirmationId });
    expect(expired.code).toBe(-1);
    expect(expired.errorCode).toBe('CONFLICT');
  });

  it('预览后账单变化时旧 confirmation 被拒绝，不静默使用旧金额执行', async () => {
    const leaseId = await createLease();
    const preview = await api.previewMoveOutSettlement({
      leaseId,
      moveOutDate: '2026-02-01',
      electricityReading: 110,
      waterReading: 60,
      damageAmount: 0
    });

    getCollectionData('bills').push({
      _id: 'bill_new_unpaid',
      leaseId,
      houseId: 'h1',
      tenantId: 't1',
      type: 'rent',
      amount: 300,
      paidAmount: 0,
      status: 'unpaid',
      dueDate: '2026-02-01',
      createdAt: new Date()
    });

    const result = await callRental('settleMoveOut', { confirmationId: preview.confirmationId });
    const lease = getCollectionData('lease_agreements').find(item => item._id === leaseId);

    expect(result.code).toBe(-1);
    expect(result.errorCode).toBe('STALE_CONFIRMATION');
    expect(lease.status).toBe('active');
  });

  it('预览后账单金额、水电记录、合同状态或押金变化时旧 confirmation 都不能直接执行', async () => {
    const cases = [
      {
        name: '账单金额变化',
        mutate(leaseId) {
          const bill = getCollectionData('bills').find(item => item.leaseId === leaseId && item.status !== 'paid');
          bill.amount += 1;
        },
        errors: ['STALE_CONFIRMATION']
      },
      {
        name: '水电记录变化',
        mutate(leaseId) {
          getCollectionData('utility_records').push({
            _id: 'util_changed_' + leaseId,
            leaseId,
            houseId: 'h1',
            tenantId: 't1',
            electricityReading: 111,
            waterReading: 61,
            calculationDate: '2026-02-01',
            createdAt: new Date(Date.now() + 1000)
          });
        },
        errors: ['STALE_CONFIRMATION', 'VALIDATION_ERROR']
      },
      {
        name: '合同已被其他入口退租',
        mutate(leaseId) {
          const lease = getCollectionData('lease_agreements').find(item => item._id === leaseId);
          lease.status = 'terminated';
        },
        errors: ['CONFLICT']
      },
      {
        name: '押金被修改',
        mutate(leaseId) {
          const lease = getCollectionData('lease_agreements').find(item => item._id === leaseId);
          lease.deposit += 100;
        },
        errors: ['STALE_CONFIRMATION']
      }
    ];

    for (const item of cases) {
      const leaseId = await createLease();
      const preview = await api.previewMoveOutSettlement({
        leaseId,
        moveOutDate: '2026-02-01',
        electricityReading: 110,
        waterReading: 60,
        damageAmount: 0
      });

      item.mutate(leaseId);
      const result = await callRental('settleMoveOut', { confirmationId: preview.confirmationId });
      const lease = getCollectionData('lease_agreements').find(row => row._id === leaseId);

      expect(item.errors).toContain(result.errorCode);
      if (item.name !== '合同已被其他入口退租') expect(lease.status).toBe('active');
    }
  });

  it('move-out Skill 不暴露最终写入 API', () => {
    const toolNames = moveOutMcp.apis.map(item => item.name);
    expect(toolNames).toContain('getMoveOutTargets');
    expect(toolNames).toContain('previewMoveOutSettlement');
    expect(toolNames).not.toContain('settleMoveOut');
    expect(toolNames).not.toContain('confirmMoveOut');
    expect(toolNames).not.toContain('executeMoveOut');
  });

  it('takeAgentHandoff 按 pageId 一次性读取，其他 pageId 不能读取', () => {
    let appDef = null;
    let handoffHandler = null;
    const oldApp = global.App;
    const oldOnAgentHandoff = wx.onAgentHandoff;
    global.App = (def) => { appDef = def; };
    wx.onAgentHandoff = (handler) => { handoffHandler = handler; };
    delete require.cache[require.resolve('../../miniprogram/app.js')];
    require('../../miniprogram/app.js');

    appDef.registerAgentHandoff();
    handoffHandler({
      pageId: 'page-1',
      path: '/pages/ai-moveout-detail/index',
      query: 'confirmationId=c1',
      payload: { confirmationId: 'c1' }
    });

    expect(appDef.takeAgentHandoff('page-2')).toBe(null);
    expect(appDef.takeAgentHandoff('page-1').payload.confirmationId).toBe('c1');
    expect(appDef.takeAgentHandoff('page-1')).toBe(null);

    global.App = oldApp;
    wx.onAgentHandoff = oldOnAgentHandoff;
  });

  it('ai-moveout-detail 无 pageId 的手动入口可通过路由参数重新加载云端预览', async () => {
    const leaseId = await createLease();
    let pageDef = null;
    const oldPage = global.Page;
    global.Page = (def) => { pageDef = def; };
    delete require.cache[require.resolve('../../miniprogram/pages/ai-moveout-detail/index.js')];
    require('../../miniprogram/pages/ai-moveout-detail/index.js');

    const ctx = {
      ...pageDef,
      data: JSON.parse(JSON.stringify(pageDef.data)),
      setData(patch) { this.data = { ...this.data, ...patch }; }
    };
    await pageDef.loadFromHandoff.call(ctx, {
      leaseId,
      moveOutDate: '2026-02-01',
      electricityReading: 110,
      waterReading: 60,
      damageAmount: 0
    });

    expect(ctx.data.loaded).toBe(true);
    expect(ctx.data.leaseId).toBe(leaseId);
    expect(ctx.data.confirmToken).toBeTruthy();
    expect(ctx.data.canConfirm).toBe(true);

    global.Page = oldPage;
  });
});
