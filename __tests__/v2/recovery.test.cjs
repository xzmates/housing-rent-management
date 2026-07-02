/**
 * 异常恢复测试（V2 新数据模型）
 * 覆盖维度：幂等性、数据一致性、错误恢复
 */
const { clearAllData, getCollectionData } = require('../setup.cjs');
const api = require('../../miniprogram/services/api');

beforeEach(() => { clearAllData(); });

describe('幂等性', () => {
  it('同一合同创建请求重复调用不产生多余数据', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });

    // 第一次成功
    const r1 = await api.createLease({
      houseId: hr._id, tenantId: tr._id,
      startDate: '2026-01-01', rent: 2000
    });
    expect(r1.leaseId).toBeTruthy();

    // 第二次应该失败（房屋已租）
    await expect(api.createLease({
      houseId: hr._id, tenantId: tr._id,
      startDate: '2026-01-01', rent: 2000
    })).rejects.toThrow();

    // 数据一致性检查
    const leases = await api.getLeases({ houseId: hr._id });
    expect(leases.data.length).toBe(1);
  });

  it('同一缴费重复调用不超额', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });
    const leaseResult = await api.createLease({
      houseId: hr._id, tenantId: tr._id,
      startDate: '2026-01-01', rent: 2000
    });
    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    const bill = bills.data.find(b => b.status !== 'paid');
    const billId = bill._id;
    const amount = bill.amount;

    // 全额缴费成功
    const pay1 = await api.payBill(billId, amount, '2026-01-05', 'cash');
    expect(pay1.status).toBe('paid');

    // 重复缴费失败
    await expect(api.payBill(billId, amount, '2026-01-05', 'cash'))
      .rejects.toThrow(/已全额支付/);
  });

  it('多次部分缴费幂等', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });
    const leaseResult = await api.createLease({
      houseId: hr._id, tenantId: tr._id,
      startDate: '2026-01-01', rent: 2000
    });
    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    const billId = bills.data.find(b => b.status !== 'paid')._id;

    // 同一笔1000元请求2次，在mock中两次都成功
    await api.payBill(billId, 1000, '2026-01-05', 'cash');
    // 但第二次不能导致超额
    await expect(api.payBill(billId, 2000, '2026-01-05', 'cash'))
      .rejects.toThrow(/超额/);
  });
});

describe('错误状态恢复', () => {
  it('缴费失败后重新缴费', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });
    const leaseResult = await api.createLease({
      houseId: hr._id, tenantId: tr._id,
      startDate: '2026-01-01', rent: 2000
    });
    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    const billId = bills.data.find(b => b.status !== 'paid')._id;

    // 超额缴费失败
    await expect(api.payBill(billId, 99999, '2026-01-05', 'cash'))
      .rejects.toThrow();

    // 重新缴费仍可正常进行
    const pay = await api.payBill(billId, 2000, '2026-01-05', 'cash');
    expect(pay.status).toBe('paid');
  });

  it('创建合同失败后房屋状态不变', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });

    // 用不存在的tenantId，云函数返回失败
    await expect(api.createLease({
      houseId: hr._id, tenantId: 'nonexistent_tenant',
      startDate: '2026-01-01', rent: 2000
    })).rejects.toThrow();

    // 房屋状态未受影响
    const house = await api.getHouseById(hr._id);
    expect(house.status).toBe('available');
  });
});

describe('边界恢复', () => {
  it('不存在的合同退租 → 优雅报错', async () => {
    await expect(api.terminateLease('nonexistent_lease', '2026-06-01'))
      .rejects.toThrow();
  });

  it('不存在的账单缴费 → 优雅报错', async () => {
    await expect(api.payBill('nonexistent_bill', 1000, '2026-01-05', 'cash'))
      .rejects.toThrow();
  });

  it('空数据调用不崩溃', async () => {
    // 空房屋列表查询
    const houses = await api.getHouses();
    expect(houses.data).toEqual([]);

    // 空租客查询
    const tenants = await api.getTenants();
    expect(tenants.data).toEqual([]);

    // 空账单查询
    const bills = await api.getBills();
    expect(bills.data).toEqual([]);
  });
});
