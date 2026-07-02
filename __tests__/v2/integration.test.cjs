const { clearAllData, getCollectionData } = require('../setup.cjs');
const api = require('../../miniprogram/services/api');

beforeEach(() => { clearAllData(); });

describe('tenant lifecycle integration', () => {
  it('creates house, tenant, lease, meter bill, payments, and termination', async () => {
    const houseResult = await api.addHouse({ code: 'A101', address: 'East 1F', rent: 2000 });
    expect(houseResult._id).toBeTruthy();

    const tenantResult = await api.addTenant({ name: 'Tenant A', phone: '13800138000' });
    expect(tenantResult._id).toBeTruthy();

    const leaseResult = await api.createLease({
      houseId: houseResult._id,
      tenantId: tenantResult._id,
      startDate: '2025-01-01',
      rent: 2000,
      paymentCycle: 'quarter'
    });
    expect(leaseResult.leaseId).toBeTruthy();
    expect(leaseResult.billsCreated).toBe(7);
    expect(leaseResult.paymentsCreated).toBe(2);

    let house = await api.getHouseById(houseResult._id);
    expect(house.status).toBe('rented');

    const meterResult = await api.addMeterReading({
      leaseId: leaseResult.leaseId,
      electricityReading: 100,
      waterReading: 50
    });
    expect(meterResult.electricityUsage).toBe(100);
    expect(meterResult.waterUsage).toBe(50);

    const utilityBills = await api.getBills({ leaseId: leaseResult.leaseId, type: 'utility' });
    expect(utilityBills.data.length).toBe(1);

    const allBills = await api.getBills({ leaseId: leaseResult.leaseId });
    expect(allBills.data.length).toBe(8);

    for (const bill of allBills.data.filter(b => b.status !== 'paid')) {
      const payResult = await api.payBill(
        bill._id,
        bill.amount - (bill.paidAmount || 0),
        '2026-01-10',
        'cash'
      );
      expect(payResult.status).toBe('paid');
    }

    const unpaidBills = await api.getBills({ leaseId: leaseResult.leaseId, status: 'unpaid' });
    expect(unpaidBills.data.length).toBe(0);

    const terminateResult = await api.terminateLease(leaseResult.leaseId, '2026-06-01');
    expect(terminateResult.refundAmount).toBeGreaterThanOrEqual(0);

    const lease = await api.getLeaseById(leaseResult.leaseId);
    expect(lease.status).toBe('terminated');
    expect(lease.endDate).toBe('2026-06-01');

    house = await api.getHouseById(houseResult._id);
    expect(house.status).toBe('available');

    const tenant = await api.getTenantById(tenantResult._id);
    expect(tenant.name).toBe('Tenant A');
  });

  it('getTenantBills returns complete data', async () => {
    const hr = await api.addHouse({ code: 'A101', address: 'East 1F', rent: 2000 });
    const tr = await api.addTenant({ name: 'Tenant A' });
    await api.createLease({
      houseId: hr._id,
      tenantId: tr._id,
      startDate: '2026-01-01',
      rent: 2000
    });

    const data = await api.getTenantBills(tr._id);
    expect(data.leases.length).toBe(1);
    expect(data.leases[0].house).toBeTruthy();
    expect(data.bills.length).toBe(7);
    expect(data.statistics.totalBills).toBe(7);
  });

  it('getHouseCurrentLease returns complete data', async () => {
    const hr = await api.addHouse({ code: 'A101', address: 'East 1F', rent: 2000 });
    const tr = await api.addTenant({ name: 'Tenant A' });
    await api.createLease({
      houseId: hr._id,
      tenantId: tr._id,
      startDate: '2026-01-01',
      rent: 2000
    });

    const data = await api.getHouseCurrentLease(hr._id);
    expect(data.house).toBeTruthy();
    expect(data.currentLease).toBeTruthy();
    expect(data.tenant).toBeTruthy();
    expect(data.recentBills.length).toBe(5);
  });
});

describe('monthly bill generation', () => {
  it('batch generation is idempotent', async () => {
    const hr1 = await api.addHouse({ code: 'A101', address: 'East 1F', rent: 2000 });
    const hr2 = await api.addHouse({ code: 'A102', address: 'East 1F', rent: 2500 });
    const tr1 = await api.addTenant({ name: 'Tenant A' });
    const tr2 = await api.addTenant({ name: 'Tenant B' });

    await api.createLease({ houseId: hr1._id, tenantId: tr1._id, startDate: '2026-01-01', rent: 2000 });
    await api.createLease({ houseId: hr2._id, tenantId: tr2._id, startDate: '2026-01-15', rent: 2500 });

    const r1 = await api.generateMonthlyBills('2026-07');
    expect(r1.generated).toBe(2);
    expect(r1.skipped).toBe(0);

    const r2 = await api.generateMonthlyBills('2026-07');
    expect(r2.generated).toBe(0);
    expect(r2.skipped).toBe(2);
  });
});

describe('data consistency', () => {
  it('keeps houses, lease_agreements, and bills consistent after lease creation', async () => {
    const hr = await api.addHouse({ code: 'A101', address: 'East 1F', rent: 2000 });
    const tr = await api.addTenant({ name: 'Tenant A' });
    const leaseResult = await api.createLease({
      houseId: hr._id,
      tenantId: tr._id,
      startDate: '2026-01-01',
      rent: 2000,
      deposit: 4000
    });

    const house = await api.getHouseById(hr._id);
    expect(house.status).toBe('rented');

    const leases = await api.getLeases({ houseId: hr._id });
    expect(leases.data.length).toBe(1);
    expect(leases.data[0].status).toBe('active');

    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    expect(bills.data.length).toBeGreaterThanOrEqual(1);
    expect(bills.data.some(b => b.type === 'rent')).toBe(true);
  });

  it('accumulates bill paidAmount correctly', async () => {
    const hr = await api.addHouse({ code: 'A101', address: 'East 1F', rent: 2000 });
    const tr = await api.addTenant({ name: 'Tenant A' });
    const leaseResult = await api.createLease({
      houseId: hr._id,
      tenantId: tr._id,
      startDate: '2026-01-01',
      rent: 2000
    });

    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    const billId = bills.data.find(b => b.status !== 'paid')._id;

    await api.payBill(billId, 1000, '2026-01-05', 'cash');
    await api.payBill(billId, 500, '2026-01-10', 'cash');

    const updatedBill = getCollectionData('bills').find(b => b._id === billId);
    expect(updatedBill.paidAmount).toBe(1500);
    expect(updatedBill.status).toBe('partial');
  });

  it('keeps statuses consistent after termination', async () => {
    const hr = await api.addHouse({ code: 'A101', address: 'East 1F', rent: 2000 });
    const tr = await api.addTenant({ name: 'Tenant A' });
    const leaseResult = await api.createLease({
      houseId: hr._id,
      tenantId: tr._id,
      startDate: '2026-01-01',
      rent: 2000,
      deposit: 4000
    });

    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    for (const bill of bills.data.filter(b => b.status !== 'paid')) {
      await api.payBill(bill._id, bill.amount - (bill.paidAmount || 0), '2026-01-05', 'cash');
    }

    await api.terminateLease(leaseResult.leaseId, '2026-06-01');

    const lease = await api.getLeaseById(leaseResult.leaseId);
    expect(lease.status).toBe('terminated');

    const house = await api.getHouseById(hr._id);
    expect(house.status).toBe('available');

    const tenant = await api.getTenantById(tr._id);
    expect(tenant).toBeTruthy();
  });
});

describe('edge cases', () => {
  it('returns null for nonexistent records', async () => {
    expect(await api.getHouseById('nonexistent')).toBeNull();
    expect(await api.getTenantById('nonexistent')).toBeNull();
    expect(await api.getLeaseById('nonexistent')).toBeNull();
  });

  it('returns empty arrays for empty collections', async () => {
    expect((await api.getHouses()).data).toEqual([]);
    expect((await api.getTenants()).data).toEqual([]);
    expect((await api.getLeases()).data).toEqual([]);
  });

  it('returns zero generation without active leases', async () => {
    const result = await api.generateMonthlyBills('2026-07');
    expect(result.generated).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('calculates zero usage when meter readings are unchanged', async () => {
    const hr = await api.addHouse({ code: 'A101', address: 'East 1F', rent: 2000 });
    const tr = await api.addTenant({ name: 'Tenant A' });
    const leaseResult = await api.createLease({
      houseId: hr._id,
      tenantId: tr._id,
      startDate: '2026-01-01',
      rent: 2000
    });

    await api.addMeterReading({ leaseId: leaseResult.leaseId, electricityReading: 100, waterReading: 50 });
    const r = await api.addMeterReading({ leaseId: leaseResult.leaseId, electricityReading: 100, waterReading: 50 });
    expect(r.electricityUsage).toBe(0);
    expect(r.waterUsage).toBe(0);
    expect(r.totalCost).toBe(0);
  });
});
