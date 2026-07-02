/**
 * parser.js 解析引擎测试（V2 新数据模型）
 * 覆盖维度：功能测试 + 边界条件
 */
const { clearAllData } = require('../setup.cjs');
const api = require('../../miniprogram/services/api');
const parser = require('../../miniprogram/utils/parser');

beforeEach(() => { clearAllData(); });

// ============ 正则解析 ============

describe('正则解析 - extract 系列', () => {
  const t = parser._test;

  it('extractCode - 标准编号', () => {
    expect(t.extractCode('东楼北101')).toBe('101');
    expect(t.extractCode('A101')).toBe('A101');
    expect(t.extractCode('2-101')).toBe('2-101');
  });

  it('extractCode - 排除年份', () => {
    expect(t.extractCode('2023年3月入住')).toBeNull();
  });

  it('extractAddress - 已知地址', () => {
    expect(t.extractAddress('东楼北101')).toBe('东楼北');
    expect(t.extractAddress('东楼南201')).toBe('东楼南');
  });

  it('extractRent - 月租', () => {
    expect(t.extractRent('月租1000')).toBe(1000);
    expect(t.extractRent('租金2500元')).toBe(2500);
    expect(t.extractRent('无信息')).toBeNull();
  });

  it('extractDeposit - 押金', () => {
    expect(t.extractDeposit('押金2000')).toBe(2000);
    expect(t.extractDeposit('押金¥3000')).toBe(3000);
  });

  it('extractDate - 完整日期', () => {
    const d = t.extractDate('2023年3月15日');
    expect(d.year).toBe(2023);
    expect(d.month).toBe(3);
    expect(d.day).toBe(15);
    expect(d.str).toBe('2023-03-15');
  });

  it('extractDate - 无日期返回null', () => {
    expect(t.extractDate('无日期')).toBeNull();
  });

  it('extractName - 中文姓名', () => {
    expect(t.extractName('张三住的')).toBe('张三');
    expect(t.extractName('麦粥租的')).toBe('麦粥');
  });

  it('extractName - 排除非姓名词', () => {
    expect(t.extractName('月租1000')).toBeNull();
    expect(t.extractName('押金2000')).toBeNull();
  });

  it('extractPaymentCycle', () => {
    expect(t.extractPaymentCycle('季付')).toEqual({ label: '季付', value: 'quarter' });
    expect(t.extractPaymentCycle('年付')).toEqual({ label: '年付', value: 'year' });
    expect(t.extractPaymentCycle('无')).toBeNull();
  });

  it('extractLastPaymentDate', () => {
    const d = t.extractLastPaymentDate('已交到2024年12月');
    expect(d.year).toBe(2024);
    expect(d.month).toBe(12);
  });
});

// ============ 解析流水线 ============

describe('parseInput 完整解析', () => {
  it('解析完整记录', () => {
    const results = parser.parseInput('东楼北101，月租1000，张三住的，2023年3月入住，季付，押金2000');
    expect(results.length).toBe(1);
    expect(results[0].house.code).toBe('101');
    expect(results[0].house.address).toBe('东楼北');
    expect(results[0].house.rent).toBe(1000);
    expect(results[0].tenant.name).toBe('张三');
    expect(results[0].tenant.paymentCycle).toBe('quarter');
    expect(results[0].tenant.deposit).toBe(2000);
  });

  it('分号分隔多条记录', () => {
    const results = parser.parseInput('东楼北101，月租1000，张三住的；东楼北102，月租1200，李四住的');
    expect(results.length).toBe(2);
  });

  it('无房屋编号返回空', () => {
    const results = parser.parseInput('张三住的，月租1000');
    expect(results.length).toBe(0);
  });
});

describe('mergeFragments 片段合并', () => {
  it('合并地址片段和租客片段', () => {
    const merged = parser._test.mergeFragments(['东楼北101，月租1000', '张三住的']);
    expect(merged.length).toBe(1);
    expect(merged[0]).toContain('东楼北101');
    expect(merged[0]).toContain('张三');
  });
});

// ============ 操作解析（查库匹配） ============

describe('resolveOperations 操作解析', () => {
  beforeEach(async () => {
    // 预置房屋和租客
    await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    await api.addHouse({ code: 'A102', address: '东楼北', rent: 2500 });
    await api.addTenant({ name: '张三', phone: '13800138000' });
  });

  it('已有房屋 → create_house 转为 update_house', async () => {
    const rawOps = [{
      action: 'create_house',
      data: { code: 'A101', address: '东楼北', rent: 2200 },
      match: { houseCode: 'A101', houseAddress: '东楼北' },
      warnings: []
    }];

    const ops = await parser.resolveOperations(rawOps, api);
    expect(ops[0].action).toBe('update_house');
    expect(ops[0].warnings.some(w => w.includes('已存在'))).toBe(true);
  });

  it('不存在的房屋 → create_house 保持不变', async () => {
    const rawOps = [{
      action: 'create_house',
      data: { code: 'A999', address: '东楼北', rent: 2000 },
      match: { houseCode: 'A999', houseAddress: '东楼北' },
      warnings: []
    }];

    const ops = await parser.resolveOperations(rawOps, api);
    expect(ops[0].action).toBe('create_house');
  });

  it('同名租客已存在 → create_tenant 转为 update_tenant', async () => {
    const rawOps = [{
      action: 'create_tenant',
      data: { name: '张三' },
      match: { tenantName: '张三' },
      warnings: []
    }];

    const ops = await parser.resolveOperations(rawOps, api);
    expect(ops[0].action).toBe('update_tenant');
  });

  it('有房屋和租金信息 → 标记 _needsLease', async () => {
    const rawOps = [{
      action: 'create_tenant',
      data: { name: '王五', rent: 2000, moveInDate: '2026-01-01' },
      match: { houseAddress: '东楼北', houseCode: 'A102' },
      warnings: []
    }];

    const ops = await parser.resolveOperations(rawOps, api);
    expect(ops[0].action).toBe('create_tenant');
    expect(ops[0]._needsLease).toBe(true);
  });

  it('退租操作 → 匹配活跃合同获取 leaseId', async () => {
    // 先创建合同
    const houses = await api.getHouses();
    const tenants = await api.getTenants();
    await api.createLease({
      houseId: houses.data[0]._id,
      tenantId: tenants.data[0]._id,
      startDate: '2026-01-01', rent: 2000
    });

    const rawOps = [{
      action: 'checkout_tenant',
      data: { moveOutDate: '2026-06-01' },
      match: { houseAddress: '东楼北', houseCode: 'A101' },
      warnings: []
    }];

    const ops = await parser.resolveOperations(rawOps, api);
    expect(ops[0].data.leaseId).toBeTruthy();
  });

  it('create_lease 匹配已有活跃合同 → 标记 _skip', async () => {
    const houses = await api.getHouses();
    const tenants = await api.getTenants();
    await api.createLease({
      houseId: houses.data[0]._id,
      tenantId: tenants.data[0]._id,
      startDate: '2026-01-01', rent: 2000
    });

    const rawOps = [{
      action: 'create_lease',
      data: { rent: 2000 },
      match: { houseAddress: '东楼北', houseCode: 'A101' },
      warnings: []
    }];

    const ops = await parser.resolveOperations(rawOps, api);
    expect(ops[0]._skip).toBe(true);
  });

  it('create_payment 匹配未缴账单', async () => {
    const houses = await api.getHouses();
    const tenants = await api.getTenants();
    const leaseResult = await api.createLease({
      houseId: houses.data[0]._id,
      tenantId: tenants.data[0]._id,
      startDate: '2026-01-01', rent: 2000
    });

    const rawOps = [{
      action: 'create_payment',
      data: { amount: 2000 },
      match: { houseAddress: '东楼北', houseCode: 'A101' },
      warnings: []
    }];

    const ops = await parser.resolveOperations(rawOps, api);
    expect(ops[0].data.billId).toBeTruthy();
    expect(ops[0].data.leaseId).toBe(leaseResult.leaseId);
  });
});

// ============ 操作执行器 ============

describe('executeOperations 操作执行', () => {
  it('执行 create_house', async () => {
    const ops = [{
      action: 'create_house',
      data: { code: 'A101', address: '东楼北', rent: 2000 },
      match: {}, warnings: [], rawText: 'test'
    }];

    const result = await parser.executeOperations(ops, api);
    expect(result.success).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.details[0].status).toBe('success');
  });

  it('执行 create_tenant（纯人员信息）', async () => {
    const ops = [{
      action: 'create_tenant',
      data: { name: '张三', phone: '13800138000' },
      match: {}, warnings: [], rawText: 'test'
    }];

    const result = await parser.executeOperations(ops, api);
    expect(result.success).toBe(1);
    expect(result.details[0].status).toBe('success');
  });

  it('执行 create_tenant + _needsLease 自动创建合同', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });

    const ops = [{
      action: 'create_tenant',
      data: { name: '王五', rent: 2000, moveInDate: '2026-01-01' },
      match: { houseAddress: '东楼北', houseCode: 'A101' },
      _needsLease: true, warnings: [], rawText: 'test'
    }];

    const result = await parser.executeOperations(ops, api);
    expect(result.success).toBe(1);
    expect(result.details[0].steps.some(s => s.action === 'create_lease' && s.status === 'success')).toBe(true);
  });

  it('跳过 _skip 操作', async () => {
    const ops = [{
      action: 'create_lease', _skip: true,
      data: {}, match: {}, warnings: [], rawText: 'test'
    }];

    const result = await parser.executeOperations(ops, api);
    expect(result.details[0].status).toBe('skipped');
  });

  it('执行 create_payment', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });
    const leaseResult = await api.createLease({
      houseId: hr._id, tenantId: tr._id, startDate: '2026-01-01', rent: 2000
    });
    const bills = await api.getBills({ leaseId: leaseResult.leaseId });

    const ops = [{
      action: 'create_payment',
      data: { billId: bills.data.find(b => b.status !== 'paid')._id, amount: 2000, paymentDate: '2026-01-05' },
      match: {}, warnings: [], rawText: 'test'
    }];

    const result = await parser.executeOperations(ops, api);
    expect(result.success).toBe(1);
  });

  it('执行 checkout_tenant', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });
    const leaseResult = await api.createLease({
      houseId: hr._id, tenantId: tr._id, startDate: '2026-01-01', rent: 2000, deposit: 4000
    });
    // 缴清账单
    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    for (const bill of bills.data.filter(b => b.status !== 'paid')) {
      await api.payBill(bill._id, bill.amount - (bill.paidAmount || 0), '2026-01-05', 'cash');
    }

    const ops = [{
      action: 'checkout_tenant',
      data: { leaseId: leaseResult.leaseId, moveOutDate: '2026-06-01' },
      match: {}, warnings: [], rawText: 'test'
    }];

    const result = await parser.executeOperations(ops, api);
    expect(result.success).toBe(1);
  });

  it('无 billId 的 create_payment → 失败', async () => {
    const ops = [{
      action: 'create_payment',
      data: { amount: 2000 },
      match: {}, warnings: [], rawText: 'test'
    }];

    const result = await parser.executeOperations(ops, api);
    expect(result.failed).toBe(1);
    expect(result.details[0].error).toContain('未找到');
  });

  it('无 leaseId 的 checkout_tenant → 失败', async () => {
    const ops = [{
      action: 'checkout_tenant',
      data: { moveOutDate: '2026-06-01' },
      match: {}, warnings: [], rawText: 'test'
    }];

    const result = await parser.executeOperations(ops, api);
    expect(result.failed).toBe(1);
  });
});

// ============ 边界条件 ============

describe('边界条件', () => {
  it('空输入 → 空结果', () => {
    expect(parser.parseInput('')).toEqual([]);
    expect(parser.parseInput(null)).toEqual([]);
  });

  it('无效文本 → 空结果', () => {
    expect(parser.parseInput('无意义的文本没有编号')).toEqual([]);
  });

  it('租金异常高 → 警告', () => {
    const results = parser.parseInput('东楼北101，月租50000，张三住的');
    expect(results[0].warnings.some(w => w.includes('异常高'))).toBe(true);
  });

  it('_calcRentCoveredUntil 月末溢出修正', () => {
    // 1月31日 + 1个月 → 2月28日
    const result = parser._test._calcRentCoveredUntil('2026-01-31', 'month');
    expect(result).toBe('2026-02-28');
  });

  it('_calcRentCoveredUntil 季付', () => {
    const result = parser._test._calcRentCoveredUntil('2026-01-15', 'quarter');
    expect(result).toBe('2026-04-14');
  });

  it('_calcNextDueDate', () => {
    const result = parser._test._calcNextDueDate('2026-01-01', 'month');
    expect(result).toBe('2026-02-01');
  });

  it('未知操作类型 → 失败', async () => {
    const ops = [{
      action: 'unknown_action',
      data: {}, match: {}, warnings: [], rawText: 'test'
    }];

    const result = await parser.executeOperations(ops, api);
    expect(result.failed).toBe(1);
    expect(result.details[0].error).toContain('未知操作类型');
  });
});
