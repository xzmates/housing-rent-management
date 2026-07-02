/**
 * api.js 服务层测试（V2 新数据模型）
 * 覆盖维度：功能测试（房屋、租客、合同、账单、缴费、水电）
 */
const { clearAllData, getCollectionData } = require('../setup.cjs');
const api = require('../../miniprogram/services/api');

beforeEach(() => { clearAllData(); });

// ============ 房屋管理 ============

describe('房屋管理', () => {
  it('添加房屋成功', async () => {
    const result = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    expect(result._id).toBeTruthy();

    const houses = await api.getHouses();
    expect(houses.data.length).toBe(1);
    expect(houses.data[0].code).toBe('A101');
    expect(houses.data[0].status).toBe('available');
  });

  it('按状态筛选房屋', async () => {
    await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    await api.addHouse({ code: 'A102', address: '东楼北', rent: 2500 });
    // 手动设置 A102 为已租
    const houses = await api.getHouses();
    const h2 = houses.data.find(h => h.code === 'A102');
    const db = wx.cloud.database();
    await db.collection('houses').doc(h2._id).update({ data: { status: 'rented' } });

    const available = await api.getHouses({ status: 'available' });
    expect(available.data.length).toBe(1);
    expect(available.data[0].code).toBe('A101');
  });

  it('修改房屋信息', async () => {
    const r = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    await api.updateHouse(r._id, { rent: 2200 });

    const house = await api.getHouseById(r._id);
    expect(house.rent).toBe(2200);
  });

  it('删除房屋', async () => {
    const r = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    await api.deleteHouse(r._id);

    const houses = await api.getHouses();
    expect(houses.data.length).toBe(0);
  });

  it('按ID获取房屋', async () => {
    const r = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const house = await api.getHouseById(r._id);
    expect(house).toBeTruthy();
    expect(house.code).toBe('A101');
  });
});

// ============ 租客管理 ============

describe('租客管理', () => {
  it('添加租客（纯人员信息）', async () => {
    const result = await api.addTenant({ name: '张三', phone: '13800138000', idCard: '110101199001011234' });
    expect(result._id).toBeTruthy();

    const tenants = await api.getTenants();
    expect(tenants.data.length).toBe(1);
    expect(tenants.data[0].name).toBe('张三');
    expect(tenants.data[0].phone).toBe('13800138000');
  });

  it('按姓名搜索租客', async () => {
    await api.addTenant({ name: '张三', phone: '13800138000' });
    await api.addTenant({ name: '李四', phone: '13900139000' });

    const tenants = await api.getTenants({ name: '张三' });
    expect(tenants.data.length).toBe(1);
    expect(tenants.data[0].name).toBe('张三');
  });

  it('修改租客信息', async () => {
    const r = await api.addTenant({ name: '张三', phone: '13800138000' });
    await api.updateTenant(r._id, { phone: '13800000000' });

    const tenant = await api.getTenantById(r._id);
    expect(tenant.phone).toBe('13800000000');
  });

  it('按ID获取租客', async () => {
    const r = await api.addTenant({ name: '张三' });
    const tenant = await api.getTenantById(r._id);
    expect(tenant).toBeTruthy();
    expect(tenant.name).toBe('张三');
  });
});

// ============ 合同管理（云函数） ============

describe('合同管理', () => {
  let house, tenant;

  beforeEach(async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    house = await api.getHouseById(hr._id);
    const tr = await api.addTenant({ name: '张三', phone: '13800138000' });
    tenant = await api.getTenantById(tr._id);
  });

  it('创建合同成功 + 房屋变已租 + 生成首期已缴与逾期账单', async () => {
    const result = await api.createLease({
      houseId: house._id,
      tenantId: tenant._id,
      startDate: '2025-01-01',
      rent: 1000,
      paymentCycle: 'quarter'
    });

    expect(result.leaseId).toBeTruthy();
    expect(result.billsCreated).toBe(7);
    expect(result.paymentsCreated).toBe(2);

    // 房屋状态变 rented
    const h = await api.getHouseById(house._id);
    expect(h.status).toBe('rented');

    // 合同可查
    const leases = await api.getLeases({ houseId: house._id });
    expect(leases.data.length).toBe(1);
    expect(leases.data[0].status).toBe('active');

    // 账单已生成
    const bills = await api.getBills({ leaseId: result.leaseId });
    expect(bills.data.length).toBe(7);
    const paidRent = bills.data.find(b => b.type === 'rent' && b.status === 'paid');
    const depositBill = bills.data.find(b => b.type === 'deposit' && b.status === 'paid');
    const unpaidRent = bills.data.filter(b => b.type === 'rent' && b.status === 'unpaid');
    expect(paidRent.amount).toBe(3000);
    expect(paidRent.paidAmount).toBe(3000);
    expect(depositBill.amount).toBe(1000);
    expect(depositBill.paidAmount).toBe(1000);
    expect(unpaidRent.length).toBe(5);
    expect(unpaidRent.reduce((sum, bill) => sum + bill.amount, 0)).toBe(15000);

    const lease = await api.getLeaseById(result.leaseId);
    expect(api.formatDate(lease.rentCoveredUntil)).toBe('2025/3/31');
    expect(api.formatDate(lease.nextRentDueDate)).toBe('2025/4/1');

    const payments = getCollectionData('payments').filter(p => p.leaseId === result.leaseId);
    expect(payments.length).toBe(2);
    expect(payments.reduce((sum, p) => sum + p.amount, 0)).toBe(4000);
  });

  it('房屋已有活跃合同时创建失败', async () => {
    await api.createLease({
      houseId: house._id, tenantId: tenant._id,
      startDate: '2026-01-01', rent: 2000
    });

    const tr2 = await api.addTenant({ name: '李四' });
    await expect(api.createLease({
      houseId: house._id, tenantId: tr2._id,
      startDate: '2026-02-01', rent: 2000
    })).rejects.toThrow();
  });

  it('租客已有活跃合同时不能再绑定其他房屋', async () => {
    await api.createLease({
      houseId: house._id, tenantId: tenant._id,
      startDate: '2026-01-01', rent: 2000
    });

    const hr2 = await api.addHouse({ code: 'A102', address: '东楼区', rent: 2500 });
    await expect(api.createLease({
      houseId: hr2._id, tenantId: tenant._id,
      startDate: '2026-02-01', rent: 2500
    })).rejects.toThrow();
  });

  it('按活跃合同计算房屋占用状态，修正脏状态展示', async () => {
    const db = wx.cloud.database();
    await db.collection('houses').doc(house._id).update({ data: { status: 'rented' } });

    const occupancy = await api.getHousesWithOccupancy({ status: 'available' });
    expect(occupancy.data.length).toBe(1);
    expect(occupancy.data[0]._id).toBe(house._id);
    expect(occupancy.data[0].status).toBe('available');
    expect(occupancy.data[0].relationMismatch).toBe(true);
  });

  it('合同超过单页限制时仍能正确计算房屋和租客占用', async () => {
    for (let i = 0; i < 25; i++) {
      const hr = await api.addHouse({ code: `P${i}`, address: '东楼区', rent: 2000 + i });
      const tr = await api.addTenant({ name: `租客${i}` });
      await api.createLease({
        houseId: hr._id,
        tenantId: tr._id,
        startDate: '2026-01-01',
        rent: 2000 + i
      });
    }

    const activeLeases = await api.getActiveLeases();
    expect(activeLeases.length).toBe(25);

    const houses = await api.getHousesWithOccupancy();
    expect(houses.data.filter(h => h.hasActiveLease).length).toBe(25);

    const tenants = await api.getTenantsWithOccupancy();
    expect(tenants.data.filter(t => t.isActive).length).toBe(25);
  });

  it('按房屋查当前合同', async () => {
    await api.createLease({
      houseId: house._id, tenantId: tenant._id,
      startDate: '2026-01-01', rent: 2000
    });

    const leases = await api.getLeases({ houseId: house._id, status: 'active' });
    expect(leases.data.length).toBe(1);
    expect(leases.data[0].tenantId).toBe(tenant._id);
  });

  it('按租客查所有合同（含历史）', async () => {
    await api.createLease({
      houseId: house._id, tenantId: tenant._id,
      startDate: '2026-01-01', rent: 2000
    });

    const leases = await api.getLeases({ tenantId: tenant._id });
    expect(leases.data.length).toBe(1);
  });

  it('退租成功（账单已结清）', async () => {
    const leaseResult = await api.createLease({
      houseId: house._id, tenantId: tenant._id,
      startDate: '2026-01-01', rent: 2000, deposit: 4000
    });

    // 先缴清账单
    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    for (const bill of bills.data.filter(b => b.status !== 'paid')) {
      await api.payBill(bill._id, bill.amount - (bill.paidAmount || 0), '2026-01-05', 'cash');
    }

    // 退租
    const result = await api.terminateLease(leaseResult.leaseId, '2026-06-01');
    expect(result.refundAmount).toBeGreaterThanOrEqual(0);

    // 合同状态变 terminated
    const lease = await api.getLeaseById(leaseResult.leaseId);
    expect(lease.status).toBe('terminated');

    // 房屋恢复可租
    const h = await api.getHouseById(house._id);
    expect(h.status).toBe('available');
  });

  it('退租可用押金自动抵扣未结清租金', async () => {
    const leaseResult = await api.createLease({
      houseId: house._id,
      tenantId: tenant._id,
      startDate: '2026-01-01',
      rent: 900,
      deposit: 900,
      paymentCycle: 'quarter'
    });

    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    const overdueRent = bills.data.find(b => b.type === 'rent' && b.status === 'unpaid');
    expect(overdueRent.amount).toBe(2700);

    await api.payBill(overdueRent._id, 1800, '2026-06-23', 'cash');

    const result = await api.terminateLease({
      leaseId: leaseResult.leaseId,
      endDate: '2026-06-23',
      refundDepositValue: 900,
      electricityReading: 0,
      waterReading: 0
    });

    expect(result.depositOffsetAmount).toBe(900);
    expect(result.refundAmount).toBe(0);
    expect(result.extraPayment).toBe(0);

    const updatedBills = await api.getBills({ leaseId: leaseResult.leaseId });
    const updatedRent = updatedBills.data.find(b => b._id === overdueRent._id);
    expect(updatedRent.status).toBe('paid');
    expect(updatedRent.paidAmount).toBe(2700);

    const offsetPayment = getCollectionData('payments')
      .find(p => p.billId === overdueRent._id && p.paymentMethod === 'deposit_offset');
    expect(offsetPayment).toBeTruthy();
    expect(offsetPayment.amount).toBe(900);
  });

  it('退租水电抄表参与结算并可由押金抵扣', async () => {
    const leaseResult = await api.createLease({
      houseId: house._id,
      tenantId: tenant._id,
      startDate: '2026-06-01',
      rent: 1000,
      deposit: 500,
      moveInElectricity: 100,
      moveInWater: 50
    });

    const result = await api.terminateLease({
      leaseId: leaseResult.leaseId,
      endDate: '2026-06-23',
      refundDepositValue: 500,
      electricityReading: 110,
      waterReading: 60
    });

    expect(result.utilityCost).toBe(43);
    expect(result.depositOffsetAmount).toBe(43);
    expect(result.refundAmount).toBe(457);

    const utilityBill = getCollectionData('bills')
      .find(b => b.leaseId === leaseResult.leaseId && b.type === 'utility');
    expect(utilityBill.status).toBe('paid');
    expect(utilityBill.paidAmount).toBe(43);

    const refundBill = getCollectionData('bills')
      .find(b => b.leaseId === leaseResult.leaseId && b.type === 'deposit_return');
    expect(refundBill).toBeTruthy();
    expect(refundBill.amount).toBe(457);
  });

  it('新合同入住读数不能低于房屋上次读数，换表后可重置基准', async () => {
    const firstLease = await api.createLease({
      houseId: house._id,
      tenantId: tenant._id,
      startDate: '2026-06-01',
      rent: 1000,
      deposit: 1000,
      moveInElectricity: 100,
      moveInWater: 50
    });

    await api.terminateLease({
      leaseId: firstLease.leaseId,
      endDate: '2026-06-23',
      refundDepositValue: 1000,
      electricityReading: 120,
      waterReading: 70
    });

    const nextTenant = await api.addTenant({ name: '下一名租客' });
    await expect(api.createLease({
      houseId: house._id,
      tenantId: nextTenant._id,
      startDate: '2026-06-24',
      rent: 1000,
      moveInElectricity: 0,
      moveInWater: 0
    })).rejects.toThrow();

    const nextLease = await api.createLease({
      houseId: house._id,
      tenantId: nextTenant._id,
      startDate: '2026-06-24',
      rent: 1000,
      moveInElectricity: 0,
      moveInWater: 0,
      meterReplaced: true
    });

    const utility = await api.addMeterReading({
      leaseId: nextLease.leaseId,
      electricityReading: 100,
      waterReading: 100
    });
    expect(utility.electricityUsage).toBe(100);
    expect(utility.waterUsage).toBe(100);
  });

  it('同一天连续换租时新合同必须识别房屋最新退租读数', async () => {
    const firstLease = await api.createLease({
      houseId: house._id,
      tenantId: tenant._id,
      startDate: '2026-06-24',
      rent: 1000,
      deposit: 1000,
      moveInElectricity: 0,
      moveInWater: 0
    });

    await api.terminateLease({
      leaseId: firstLease.leaseId,
      endDate: '2026-06-24',
      refundDepositValue: 1000,
      electricityReading: 120,
      waterReading: 140
    });
    getCollectionData('utility_records')
      .filter(r => r.leaseId === firstLease.leaseId && r.electricityReading === 120)
      .forEach(r => { r.createdAt = new Date('2026-06-24T10:00:00'); });

    const secondTenant = await api.addTenant({ name: '同日第二租客' });
    const secondLease = await api.createLease({
      houseId: house._id,
      tenantId: secondTenant._id,
      startDate: '2026-06-24',
      rent: 1000,
      deposit: 1000,
      moveInElectricity: 120,
      moveInWater: 140
    });
    await api.terminateLease({
      leaseId: secondLease.leaseId,
      endDate: '2026-06-24',
      refundDepositValue: 1000,
      electricityReading: 250,
      waterReading: 250
    });
    getCollectionData('utility_records')
      .filter(r => r.leaseId === secondLease.leaseId && r.electricityReading === 250)
      .forEach(r => { r.createdAt = new Date('2026-06-24T12:00:00'); });

    const thirdTenant = await api.addTenant({ name: '同日第三租客' });
    await expect(api.createLease({
      houseId: house._id,
      tenantId: thirdTenant._id,
      startDate: '2026-06-24',
      rent: 1000,
      deposit: 1000,
      moveInElectricity: 120,
      moveInWater: 140
    })).rejects.toThrow();

    const thirdLease = await api.createLease({
      houseId: house._id,
      tenantId: thirdTenant._id,
      startDate: '2026-06-24',
      rent: 1000,
      deposit: 1000,
      moveInElectricity: 250,
      moveInWater: 250
    });
    expect(thirdLease.leaseId).toBeTruthy();
  });

  it('入住基准和退租抄表记录按业务日期展示', async () => {
    const leaseResult = await api.createLease({
      houseId: house._id,
      tenantId: tenant._id,
      startDate: '2026-01-01',
      rent: 1000,
      deposit: 1000,
      moveInElectricity: 100,
      moveInWater: 100
    });

    const baseline = (await api.getUtilityRecords({ leaseId: leaseResult.leaseId })).data
      .find(r => r.recordType === 'move_in_baseline');
    expect(api.formatDate(baseline.calculationDate)).toBe('2026/1/1');

    await api.terminateLease({
      leaseId: leaseResult.leaseId,
      endDate: '2026-06-23',
      refundDepositValue: 1000,
      electricityReading: 110,
      waterReading: 115
    });

    const records = (await api.getUtilityRecords({ leaseId: leaseResult.leaseId })).data;
    const checkout = records.find(r => r.electricityReading === 110 && r.waterReading === 115);
    expect(api.formatDate(checkout.calculationDate)).toBe('2026/6/23');
  });

  it('删除误建合同时同步删除账单流水和水电记录', async () => {
    const leaseResult = await api.createLease({
      houseId: house._id,
      tenantId: tenant._id,
      startDate: '2026-06-24',
      rent: 1000,
      deposit: 1000,
      moveInElectricity: 10,
      moveInWater: 20
    });
    await api.addMeterReading({
      leaseId: leaseResult.leaseId,
      electricityReading: 30,
      waterReading: 40
    });

    expect((await api.getBills({ leaseId: leaseResult.leaseId })).data.length).toBeGreaterThan(0);
    expect(getCollectionData('payments').some(p => p.leaseId === leaseResult.leaseId)).toBe(true);
    expect((await api.getUtilityRecords({ leaseId: leaseResult.leaseId })).data.length).toBeGreaterThan(0);

    const result = await api.deleteLease(leaseResult.leaseId);
    expect(result.deletedLeases).toBe(1);
    expect(result.deletedBills).toBeGreaterThan(0);
    expect(result.deletedPayments).toBeGreaterThan(0);
    expect(result.deletedUtilityRecords).toBeGreaterThan(0);
    expect(await api.getLeaseById(leaseResult.leaseId)).toBeNull();
    expect((await api.getBills({ leaseId: leaseResult.leaseId })).data).toHaveLength(0);
    expect(getCollectionData('payments').filter(p => p.leaseId === leaseResult.leaseId)).toHaveLength(0);
    expect((await api.getUtilityRecords({ leaseId: leaseResult.leaseId })).data).toHaveLength(0);
    expect((await api.getHouseById(house._id)).status).toBe('available');
    expect((await api.getTenantById(tenant._id)).status).toBe('inactive');
  });

  it('创建合同派生数据保留测试标识', async () => {
    const leaseResult = await api.createLease({
      houseId: house._id,
      tenantId: tenant._id,
      startDate: '2026-06-01',
      rent: 1000,
      test: true,
      testRunId: 'UNIT_TEST_RUN',
      createdBy: 'vitest'
    });

    const lease = await api.getLeaseById(leaseResult.leaseId);
    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    const payments = getCollectionData('payments').filter(p => p.leaseId === leaseResult.leaseId);

    expect(lease.testRunId).toBe('UNIT_TEST_RUN');
    expect(bills.data.every(b => b.testRunId === 'UNIT_TEST_RUN')).toBe(true);
    expect(payments.every(p => p.testRunId === 'UNIT_TEST_RUN')).toBe(true);
  });
});

// ============ 账单与缴费（云函数） ============

describe('账单与缴费', () => {
  let leaseId;

  beforeEach(async () => {
    clearAllData();
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });
    const leaseResult = await api.createLease({
      houseId: hr._id, tenantId: tr._id,
      startDate: '2026-01-01', rent: 2000, deposit: 4000
    });
    leaseId = leaseResult.leaseId;
  });

  it('全额缴费 → 状态变 paid', async () => {
    const bills = await api.getBills({ leaseId });
    const bill = bills.data.find(b => b.status !== 'paid');

    const result = await api.payBill(bill._id, bill.amount, '2026-01-05', 'cash');
    expect(result.status).toBe('paid');
    expect(result.remaining).toBe(0);
  });

  it('部分缴费 → partial → 再缴 → paid', async () => {
    const bills = await api.getBills({ leaseId });
    const bill = bills.data.find(b => b.status !== 'paid');

    // 部分缴费
    const r1 = await api.payBill(bill._id, 1000, '2026-01-05', 'cash');
    expect(r1.status).toBe('partial');
    expect(r1.remaining).toBe(1000);

    // 补缴
    const r2 = await api.payBill(bill._id, 1000, '2026-01-10', 'cash');
    expect(r2.status).toBe('paid');
    expect(r2.remaining).toBe(0);
  });

  it('超额缴费 → 拒绝', async () => {
    const bills = await api.getBills({ leaseId });
    const bill = bills.data.find(b => b.status !== 'paid');

    await expect(api.payBill(bill._id, bill.amount + 1000, '2026-01-05', 'cash'))
      .rejects.toThrow(/超额/);
  });

  it('对已付账单缴费 → 拒绝', async () => {
    const bills = await api.getBills({ leaseId });
    const bill = bills.data.find(b => b.status === 'paid');

    await expect(api.payBill(bill._id, 100, '2026-01-06', 'cash'))
      .rejects.toThrow(/已全额支付/);
  });

  it('生成月租账单，不重复', async () => {
    const r1 = await api.generateMonthlyBills('2026-07');
    expect(r1.generated).toBe(1);
    expect(r1.skipped).toBe(0);

    // 重复生成
    const r2 = await api.generateMonthlyBills('2026-07');
    expect(r2.generated).toBe(0);
    expect(r2.skipped).toBe(1);
  });

  it('未到期时也可以主动生成下一期租金账单并缴费', async () => {
    clearAllData();
    const hr = await api.addHouse({ code: 'A105', address: '东楼北', rent: 1000 });
    const tr = await api.addTenant({ name: '提前交租租客' });
    const leaseResult = await api.createLease({
      houseId: hr._id,
      tenantId: tr._id,
      startDate: '2026-05-26',
      rent: 1000,
      paymentCycle: 'month'
    });

    let bills = await api.getBills({ leaseId: leaseResult.leaseId });
    expect(bills.data.filter(b => b.type === 'rent' && b.status !== 'paid')).toHaveLength(0);

    const generated = await api.createNextRentBill(leaseResult.leaseId, { coverageDays: 15 });
    expect(generated.created).toBe(true);
    expect(generated.bill.amount).toBe(500);
    expect(generated.bill.status).toBe('unpaid');

    await api.payBill(generated.bill._id, 500, '2026-06-24', 'cash');
    bills = await api.getBills({ leaseId: leaseResult.leaseId });
    const nextRent = bills.data.find(b => b._id === generated.bill._id);
    expect(nextRent.status).toBe('paid');

    const lease = await api.getLeaseById(leaseResult.leaseId);
    expect(api.formatDate(lease.rentCoveredUntil)).toBe('2026/7/10');
    expect(api.formatDate(lease.nextRentDueDate)).toBe('2026/7/11');

    const custom = await api.createNextRentBill(leaseResult.leaseId, { amount: 2000 });
    expect(custom.created).toBe(true);
    expect(custom.bill.amount).toBe(2000);
    expect(custom.bill.coverageDays).toBe(60);
    await api.payBill(custom.bill._id, 2000, '2026-06-24', 'wechat');

    const updatedLease = await api.getLeaseById(leaseResult.leaseId);
    expect(api.formatDate(updatedLease.rentCoveredUntil)).toBe('2026/9/8');
    expect(api.formatDate(updatedLease.nextRentDueDate)).toBe('2026/9/9');
  });

  it('提前收租后退租会生成明确的租金退款流水', async () => {
    clearAllData();
    const house = await api.addHouse({ code: 'A106', address: '东楼北', rent: 1000 });
    const tenant = await api.addTenant({ name: '提前退款租客' });
    const leaseResult = await api.createLease({
      houseId: house._id,
      tenantId: tenant._id,
      startDate: '2026-05-27',
      rent: 1000,
      deposit: 1000,
      paymentCycle: 'month'
    });

    const prepay = await api.createNextRentBill(leaseResult.leaseId, { amount: 10000 });
    await api.payBill(prepay.bill._id, 10000, '2026-06-25', 'cash');

    const result = await api.terminateLease({
      leaseId: leaseResult.leaseId,
      endDate: '2026-06-25',
      refundDepositValue: 0
    });

    expect(result.rentRefund.overpaidRent).toBe(10000);

    const bills = getCollectionData('bills').filter(b => b.leaseId === leaseResult.leaseId);
    const rentRefundBill = bills.find(b => b.type === 'rent_refund');
    expect(rentRefundBill).toBeTruthy();
    expect(rentRefundBill.amount).toBe(10000);

    const payments = getCollectionData('payments').filter(p => p.leaseId === leaseResult.leaseId);
    const refundPayment = payments.find(p => p.billId === rentRefundBill._id);
    expect(refundPayment).toBeTruthy();
    expect(refundPayment.amount).toBe(10000);
    expect(refundPayment.direction).toBe('out');

    const rentIncome = payments.reduce((sum, payment) => {
      const bill = bills.find(item => item._id === payment.billId);
      if (!bill || !['rent', 'rent_refund'].includes(bill.type)) return sum;
      return sum + (payment.direction === 'out' ? -payment.amount : payment.amount);
    }, 0);
    expect(rentIncome).toBe(1000);
  });
});

// ============ 水电抄表（云函数） ============

describe('水电抄表', () => {
  let leaseId;

  beforeEach(async () => {
    clearAllData();
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });
    const leaseResult = await api.createLease({
      houseId: hr._id, tenantId: tr._id,
      startDate: '2026-01-01', rent: 2000
    });
    leaseId = leaseResult.leaseId;
  });

  it('首次抄表（无历史记录）', async () => {
    const result = await api.addMeterReading({
      leaseId, electricityReading: 100, waterReading: 50
    });
    expect(result.electricityUsage).toBe(100);
    expect(result.waterUsage).toBe(50);
    expect(result.totalCost).toBe(100 * 0.8 + 50 * 3.5);
  });

  it('后续抄表正确计算用量', async () => {
    await api.addMeterReading({ leaseId, electricityReading: 100, waterReading: 50 });
    const result = await api.addMeterReading({ leaseId, electricityReading: 150, waterReading: 70 });
    expect(result.electricityUsage).toBe(50);
    expect(result.waterUsage).toBe(20);
  });

  it('抄表后自动生成水电账单', async () => {
    await api.addMeterReading({ leaseId, electricityReading: 100, waterReading: 50 });
    const bills = await api.getBills({ leaseId, type: 'utility' });
    expect(bills.data.length).toBe(1);
    expect(bills.data[0].type).toBe('utility');
  });

  it('读数倒转 → 拒绝抄表', async () => {
    await api.addMeterReading({ leaseId, electricityReading: 100, waterReading: 50 });
    await expect(api.addMeterReading({ leaseId, electricityReading: 50, waterReading: 30 })).rejects.toThrow();
  });
});

// ============ 系统设置 ============

describe('系统设置', () => {
  it('获取默认设置', async () => {
    const settings = await api.getSystemSettings();
    expect(settings.data.length).toBe(1);
    expect(settings.data[0].electricityPrice).toBe(0.8);
    expect(settings.data[0].waterPrice).toBe(3.5);
  });

  it('更新设置后获取新值', async () => {
    await api.updateSystemSettings({ electricityPrice: 1.0, waterPrice: 4.0 });
    const prices = await api.getUtilityPrices();
    expect(prices.electricityPrice).toBe(1.0);
    expect(prices.waterPrice).toBe(4.0);
  });
});

// ============ 辅助方法 ============

describe('formatDate', () => {
  it('格式化日期对象', () => {
    const d = new Date('2026-01-15');
    expect(api.formatDate(d)).toBe('2026/1/15');
  });

  it('处理 null/undefined', () => {
    expect(api.formatDate(null)).toBe('');
    expect(api.formatDate(undefined)).toBe('');
  });
});

describe('checkout settlement regressions', () => {
  it('退租押金不足时自动收取剩余应收并结清账单', async () => {
    const house = await api.addHouse({ code: 'SETTLE101', address: '结算回归房', rent: 900 });
    const tenant = await api.addTenant({ name: '结算回归租客' });
    const leaseResult = await api.createLease({
      houseId: house._id,
      tenantId: tenant._id,
      startDate: '2026-01-01',
      rent: 900,
      deposit: 900,
      paymentCycle: 'quarter',
      moveInElectricity: 0,
      moveInWater: 0
    });

    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    const overdueRent = bills.data.find(b => b.type === 'rent' && b.status === 'unpaid');
    await api.payBill(overdueRent._id, 1800, '2026-06-23', 'cash');

    const result = await api.terminateLease({
      leaseId: leaseResult.leaseId,
      endDate: '2026-06-23',
      refundDepositValue: 500,
      electricityReading: 100,
      waterReading: 100
    });

    expect(result.depositOffsetAmount).toBe(500);
    expect(result.extraPayment).toBe(830);
    expect(result.cashSettlementAmount).toBe(830);

    const updatedBills = await api.getBills({ leaseId: leaseResult.leaseId });
    expect(updatedBills.data.filter(b => ['unpaid', 'partial'].includes(b.status))).toHaveLength(0);

    const settlementPayments = getCollectionData('payments')
      .filter(p => p.leaseId === leaseResult.leaseId && p.paymentMethod === 'settlement_payment');
    expect(settlementPayments.reduce((sum, p) => sum + p.amount, 0)).toBe(830);
  });
});
