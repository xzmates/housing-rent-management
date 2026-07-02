/**
 * Scheduler tests for v2 lease bills.
 *
 * Lease creation now generates paid first-cycle rent, paid deposit, and overdue
 * rent bills up to the current test date. These tests generate future periods
 * so the scheduler still verifies non-duplicate monthly bill creation.
 */
const { clearAllData } = require('../setup.cjs');
const api = require('../../miniprogram/services/api');

beforeEach(() => { clearAllData(); });

describe('monthly rent bill scheduler', () => {
  it('generates a future monthly rent bill', async () => {
    const hr = await api.addHouse({ code: 'A101', address: 'East 1F', rent: 2000 });
    const tr = await api.addTenant({ name: 'Tenant A' });
    await api.createLease({
      houseId: hr._id,
      tenantId: tr._id,
      startDate: '2026-01-01',
      rent: 2000
    });

    const r1 = await api.generateMonthlyBills('2026-07');
    expect(r1.generated).toBe(1);
    expect(r1.skipped).toBe(0);

    const bills = await api.getBills({ leaseId: (await api.getLeases()).data[0]._id });
    expect(bills.data.length).toBe(8);
  });

  it('does not generate duplicate bills', async () => {
    const hr = await api.addHouse({ code: 'A101', address: 'East 1F', rent: 2000 });
    const tr = await api.addTenant({ name: 'Tenant A' });
    await api.createLease({
      houseId: hr._id,
      tenantId: tr._id,
      startDate: '2026-01-01',
      rent: 2000
    });

    const r1 = await api.generateMonthlyBills('2026-07');
    const r2 = await api.generateMonthlyBills('2026-07');
    const r3 = await api.generateMonthlyBills('2026-07');

    expect(r1.generated).toBe(1);
    expect(r1.skipped).toBe(0);
    expect(r2.generated).toBe(0);
    expect(r2.skipped).toBe(1);
    expect(r3.generated).toBe(0);
    expect(r3.skipped).toBe(1);
  });

  it('generates bills for three continuous future months', async () => {
    const hr = await api.addHouse({ code: 'A101', address: 'East 1F', rent: 2000 });
    const tr = await api.addTenant({ name: 'Tenant A' });
    await api.createLease({
      houseId: hr._id,
      tenantId: tr._id,
      startDate: '2026-01-01',
      rent: 2000
    });

    for (const month of ['2026-07', '2026-08', '2026-09']) {
      const r = await api.generateMonthlyBills(month);
      expect(r.generated).toBe(1);
      expect(r.skipped).toBe(0);
    }

    const bills = await api.getBills();
    expect(bills.data.length).toBe(10);
  });

  it('returns zero when there is no active lease', async () => {
    const r = await api.generateMonthlyBills('2026-07');
    expect(r.generated).toBe(0);
    expect(r.skipped).toBe(0);
  });
});

describe('large lease batch', () => {
  it('generates monthly bills for 100 leases', async () => {
    for (let i = 0; i < 100; i++) {
      const hr = await api.addHouse({
        code: 'B' + String(i + 100).padStart(3, '0'),
        address: 'East 1F',
        rent: 2000
      });
      const tr = await api.addTenant({ name: 'Tenant ' + i });
      await api.createLease({
        houseId: hr._id,
        tenantId: tr._id,
        startDate: '2026-01-01',
        rent: 2000
      });
    }

    const start = Date.now();
    const r = await api.generateMonthlyBills('2026-07');
    const elapsed = Date.now() - start;

    expect(r.generated).toBe(100);
    expect(r.skipped).toBe(0);
    expect(elapsed).toBeLessThan(10000);
  });

  it('does not duplicate monthly bills for 100 leases', async () => {
    for (let i = 0; i < 100; i++) {
      const hr = await api.addHouse({
        code: 'C' + String(i + 200).padStart(3, '0'),
        address: 'East 1F',
        rent: 2000
      });
      const tr = await api.addTenant({ name: 'Tenant ' + i });
      await api.createLease({
        houseId: hr._id,
        tenantId: tr._id,
        startDate: '2026-01-01',
        rent: 2000
      });
    }

    const r1 = await api.generateMonthlyBills('2026-07');
    expect(r1.generated).toBe(100);

    const r2 = await api.generateMonthlyBills('2026-07');
    expect(r2.generated).toBe(0);
    expect(r2.skipped).toBe(100);
  });
});

describe('cross year generation', () => {
  it('generates January bill from a December lease', async () => {
    const hr = await api.addHouse({ code: 'A101', address: 'East 1F', rent: 2000 });
    const tr = await api.addTenant({ name: 'Tenant A' });
    await api.createLease({
      houseId: hr._id,
      tenantId: tr._id,
      startDate: '2026-12-01',
      rent: 2000
    });

    const r = await api.generateMonthlyBills('2027-01');
    expect(r.generated).toBe(1);
    expect(r.skipped).toBe(0);
  });
});
