/**
 * 安全测试（V2 新数据模型）
 * 覆盖维度：参数注入防护、越权操作防护、输入校验
 */
const { clearAllData, getCollectionData } = require('../setup.cjs');
const api = require('../../miniprogram/services/api');

beforeEach(() => { clearAllData(); });

describe('参数注入防护', () => {
  it('房屋编号含特殊字符自动容错', async () => {
    const result = await api.addHouse({
      code: '<script>alert("xss")</script>',
      address: '测试地址',
      rent: 2000
    });
    expect(result._id).toBeTruthy();

    const houses = await api.getHouses();
    expect(houses.data.length).toBe(1);
    // 数据保持原样存入，不做过滤（由前端展示时负责转义）
    expect(houses.data[0].code).toContain('script');
  });

  it('租客姓名含特殊字符', async () => {
    const result = await api.addTenant({
      name: '张三"; drop table tenants; --',
      phone: '13800138000'
    });
    expect(result._id).toBeTruthy();

    const tenants = await api.getTenants();
    expect(tenants.data.length).toBe(1);
  });
});

describe('合约安全', () => {
  it('房屋已租后不可再创建合同', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr1 = await api.addTenant({ name: '张三' });
    const tr2 = await api.addTenant({ name: '李四' });

    // 第一个合同成功
    await api.createLease({
      houseId: hr._id, tenantId: tr1._id,
      startDate: '2026-01-01', rent: 2000
    });

    // 第二个合同被拒绝
    await expect(api.createLease({
      houseId: hr._id, tenantId: tr2._id,
      startDate: '2026-02-01', rent: 2000
    })).rejects.toThrow();
  });

  it('已结束合同不可退租', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });
    const leaseResult = await api.createLease({
      houseId: hr._id, tenantId: tr._id,
      startDate: '2026-01-01', rent: 2000, deposit: 4000
    });

    // 先缴清再退租
    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    for (const bill of bills.data.filter(b => b.status !== 'paid')) {
      await api.payBill(bill._id, bill.amount - (bill.paidAmount || 0), '2026-01-05', 'cash');
    }
    await api.terminateLease(leaseResult.leaseId, '2026-06-01');

    // 重复退租被拒绝
    await expect(api.terminateLease(leaseResult.leaseId, '2026-07-01'))
      .rejects.toThrow();
  });

  it('未结清账单退租时必须通过押金抵扣流水结算', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });
    const leaseResult = await api.createLease({
      houseId: hr._id, tenantId: tr._id,
      startDate: '2026-01-01', rent: 2000, deposit: 4000
    });

    const result = await api.terminateLease({
      leaseId: leaseResult.leaseId,
      endDate: '2026-06-01',
      refundDepositValue: 4000
    });

    expect(result.depositOffsetAmount).toBe(4000);
    expect(result.extraPayment).toBeGreaterThan(0);

    const offsetPayments = getCollectionData('payments')
      .filter(p => p.leaseId === leaseResult.leaseId && p.paymentMethod === 'deposit_offset');
    expect(offsetPayments.length).toBeGreaterThan(0);
    expect(offsetPayments.reduce((sum, p) => sum + p.amount, 0)).toBe(4000);
    expect(offsetPayments.every(p => p.cashImpact === false)).toBe(true);

    const lease = await api.getLeaseById(leaseResult.leaseId);
    expect(lease.status).toBe('terminated');
  });
});

describe('数据权限', () => {
  it('缴费不能操作其他合同的账单', async () => {
    const hr1 = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const hr2 = await api.addHouse({ code: 'A102', address: '东楼北', rent: 2500 });
    const tr1 = await api.addTenant({ name: '张三' });
    const tr2 = await api.addTenant({ name: '李四' });

    const l1 = await api.createLease({
      houseId: hr1._id, tenantId: tr1._id, startDate: '2026-01-01', rent: 2000
    });
    const l2 = await api.createLease({
      houseId: hr2._id, tenantId: tr2._id, startDate: '2026-01-15', rent: 2500
    });

    const bills1 = await api.getBills({ leaseId: l1.leaseId });
    const bills2 = await api.getBills({ leaseId: l2.leaseId });
    const bill1 = bills1.data.find(b => b.status !== 'paid');
    const bill2 = bills2.data.find(b => b.status !== 'paid');

    // 对 bill1 缴费，验证只影响 bill1
    await api.payBill(bill1._id, bill1.amount - (bill1.paidAmount || 0), '2026-01-05', 'cash');

    const allBills = getCollectionData('bills');
    expect(allBills.find(b => b._id === bill1._id).status).toBe('paid');
    expect(allBills.find(b => b._id === bill2._id).status).toBe('unpaid');
  });

  it('抄表记录按合同隔离', async () => {
    const hr1 = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const hr2 = await api.addHouse({ code: 'A102', address: '东楼北', rent: 2500 });
    const tr1 = await api.addTenant({ name: '张三' });
    const tr2 = await api.addTenant({ name: '李四' });

    const l1 = await api.createLease({
      houseId: hr1._id, tenantId: tr1._id, startDate: '2026-01-01', rent: 2000
    });
    const l2 = await api.createLease({
      houseId: hr2._id, tenantId: tr2._id, startDate: '2026-01-15', rent: 2500
    });

    await api.addMeterReading({ leaseId: l1.leaseId, electricityReading: 100, waterReading: 50 });
    await api.addMeterReading({ leaseId: l2.leaseId, electricityReading: 200, waterReading: 100 });

    // 验证合同1的水电记录
    const records1 = await api.getUtilityRecords({ leaseId: l1.leaseId });
    const actualRecords1 = records1.data.filter(r => r.recordType !== 'move_in_baseline');
    expect(actualRecords1.length).toBe(1);
    expect(actualRecords1[0].electricityReading).toBe(100);

    // 验证合同2的水电记录
    const records2 = await api.getUtilityRecords({ leaseId: l2.leaseId });
    const actualRecords2 = records2.data.filter(r => r.recordType !== 'move_in_baseline');
    expect(actualRecords2.length).toBe(1);
    expect(actualRecords2[0].electricityReading).toBe(200);
  });
});

describe('输入校验', () => {
  it('getHouseById 传入不存在的ID返回null', async () => {
    const house = await api.getHouseById('nonexistent');
    expect(house).toBeNull();
  });

  it('getTenantById 传入不存在的ID返回null', async () => {
    const tenant = await api.getTenantById('nonexistent');
    expect(tenant).toBeNull();
  });

  it('删除不存在的房屋优雅报错', async () => {
    await expect(api.deleteHouse('nonexistent')).rejects.toThrow();
  });

  it('已有活跃合同时删除房屋被拒绝', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });
    await api.createLease({
      houseId: hr._id, tenantId: tr._id, startDate: '2026-01-01', rent: 2000
    });

    await expect(api.deleteHouse(hr._id)).rejects.toThrow(/出租中/);
  });
});
