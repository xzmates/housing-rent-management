const dbService = require('../services/database');

describe('DatabaseService', () => {
  // 清空 mock store 在每次测试前
  beforeEach(async () => {
    // Clean store via db operations
    const d = dbService._db();
    for (const col of ['houses', 'tenants', 'payments', 'utility_records', 'system_settings']) {
      const existing = await d.collection(col).get();
      for (const item of existing.data) {
        await d.collection(col).doc(item._id).remove();
      }
    }
  });

  // ============ 房屋管理 ============

  describe('addHouse / getHouses', () => {
    it('creates and retrieves a house', async () => {
      const result = await dbService.addHouse({
        code: 'A101', address: '东楼北', rent: 2000
      });
      expect(result._id).toBeTruthy();

      const houses = await dbService.getHouses();
      expect(houses.data.length).toBe(1);
      expect(houses.data[0].code).toBe('A101');
      expect(houses.data[0].status).toBe('available');
    });

    it('filters houses by status', async () => {
      const h1 = await dbService.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
      const h2 = await dbService.addHouse({ code: 'A102', address: '东楼北', rent: 2500 });
      await dbService.updateHouseStatus(h2._id, 'rented');

      const available = await dbService.getHouses({ status: 'available' });
      expect(available.data.length).toBe(1);
      expect(available.data[0].code).toBe('A101');
    });
  });

  describe('updateHouse', () => {
    it('updates house rent', async () => {
      const r = await dbService.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
      await dbService.updateHouse(r._id, { rent: 2200 });

      const houses = await dbService.getHouses();
      expect(houses.data[0].rent).toBe(2200);
    });
  });

  describe('deleteHouse', () => {
    it('removes house', async () => {
      const r = await dbService.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
      await dbService.deleteHouse(r._id);

      const houses = await dbService.getHouses();
      expect(houses.data.length).toBe(0);
    });
  });

  describe('getHouseById', () => {
    it('returns single house by id', async () => {
      const r = await dbService.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
      const house = await dbService.getHouseById(r._id);
      expect(house).toBeTruthy();
      expect(house.code).toBe('A101');
    });
  });

  // ============ 租客管理 ============

  describe('addTenant', () => {
    it('creates tenant, deposit payment, first rent payment, and updates house status', async () => {
      const house = await dbService.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });

      const result = await dbService.addTenant({
        name: '张三',
        houseId: house._id,
        deposit: 4000,
        rent: 2000,
        paymentCycle: 'month',
        moveInDate: '2026-01-01'
      });

      expect(result.success).toBe(true);
      expect(result.id).toBeTruthy();

      // Check tenant created
      const tenants = await dbService.getTenants();
      expect(tenants.data.length).toBe(1);
      expect(tenants.data[0].name).toBe('张三');
      expect(tenants.data[0].status).toBe('active');

      // Check house status updated to rented
      const h = await dbService.getHouseById(house._id);
      expect(h.status).toBe('rented');

      // Check 2 payments created (deposit + rent)
      const payments = await dbService.getPayments({ tenantId: result.id });
      expect(payments.data.length).toBe(2);
      const types = payments.data.map(p => p.paymentType).sort();
      expect(types).toEqual(['deposit', 'rent']);
    });

    it('throws error when house already rented', async () => {
      const house = await dbService.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
      await dbService.addTenant({ name: '张三', houseId: house._id, deposit: 4000, rent: 2000, moveInDate: '2026-01-01' });

      await expect(
        dbService.addTenant({ name: '李四', houseId: house._id, deposit: 4000, rent: 2000, moveInDate: '2026-01-01' })
      ).rejects.toThrow('该房屋已有租客入住，无法重复绑定');
    });
  });

  describe('moveOutTenant', () => {
    it('moves out tenant and sets house to available', async () => {
      const house = await dbService.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
      const tenant = await dbService.addTenant({ name: '张三', houseId: house._id, deposit: 4000, rent: 2000, moveInDate: '2026-01-01' });

      await dbService.moveOutTenant(tenant.id, new Date('2026-06-01'));

      const tenants = await dbService.getTenants();
      expect(tenants.data[0].status).toBe('moved_out');

      const h = await dbService.getHouseById(house._id);
      expect(h.status).toBe('available');
    });
  });

  describe('getTenantById', () => {
    it('returns single tenant by id', async () => {
      const house = await dbService.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
      const t = await dbService.addTenant({ name: '张三', houseId: house._id, rent: 2000, moveInDate: '2026-01-01' });
      const tenant = await dbService.getTenantById(t.id);
      expect(tenant).toBeTruthy();
      expect(tenant.name).toBe('张三');
    });
  });

  // ============ 缴费记录 ============

  describe('addPayment / getPayments', () => {
    it('creates payment and retrieves it', async () => {
      const r = await dbService.addPayment({
        houseId: 'h1', tenantId: 't1',
        paymentType: 'rent', amount: 2000,
        description: 'test rent', status: 'paid'
      });
      expect(r.success).toBe(true);

      const payments = await dbService.getPayments({ tenantId: 't1' });
      expect(payments.data.length).toBe(1);
      expect(payments.data[0].amount).toBe(2000);
    });

    it('filters payments by type', async () => {
      await dbService.addPayment({ houseId: 'h1', tenantId: 't1', paymentType: 'rent', amount: 2000, status: 'paid' });
      await dbService.addPayment({ houseId: 'h1', tenantId: 't1', paymentType: 'deposit', amount: 4000, status: 'paid' });

      const rents = await dbService.getPayments({ tenantId: 't1', paymentType: 'rent' });
      expect(rents.data.length).toBe(1);
      expect(rents.data[0].paymentType).toBe('rent');
    });
  });

  describe('deletePayment', () => {
    it('deletes payment', async () => {
      const r = await dbService.addPayment({
        houseId: 'h1', tenantId: 't1',
        paymentType: 'rent', amount: 2000, status: 'paid'
      });
      await dbService.deletePayment(r.id);

      const payments = await dbService.getPayments();
      expect(payments.data.length).toBe(0);
    });
  });

  // ============ 系统设置 ============

  describe('getSystemSettings', () => {
    it('returns default settings when none exist', async () => {
      const r = await dbService.getSystemSettings();
      expect(r.data.length).toBe(1);
      expect(r.data[0].electricityPrice).toBe(0.8);
      expect(r.data[0].waterPrice).toBe(3.5);
    });
  });

  describe('getUtilityPrices', () => {
    it('returns defaults when no settings saved', async () => {
      const prices = await dbService.getUtilityPrices();
      expect(prices.electricityPrice).toBe(0.8);
      expect(prices.waterPrice).toBe(3.5);
    });

    it('returns saved prices after update', async () => {
      await dbService.updateSystemSettings({ electricityPrice: 1.0, waterPrice: 4.0 });
      const prices = await dbService.getUtilityPrices();
      expect(prices.electricityPrice).toBe(1.0);
      expect(prices.waterPrice).toBe(4.0);
    });
  });

  // ============ 预付租金核心逻辑 ============

  describe('_calcRentCoverage', () => {
    it('calculates coverage for exact month payment', () => {
      const moveIn = new Date('2026-01-01');
      const result = dbService._calcRentCoverage(null, moveIn, 2000, 2000);
      expect(result.monthsCovered).toBe(1);
      expect(result.depositIncrease).toBe(0);
      // Covers from 2026-01-01 to 2026-01-31 (1 month - 1 day)
      expect(result.newCoveredUntil.getFullYear()).toBe(2026);
      expect(result.newCoveredUntil.getMonth()).toBe(0); // Jan = 0
      expect(result.newCoveredUntil.getDate()).toBe(31);
    });

    it('adds half month when remaining >= half rent', () => {
      const moveIn = new Date('2026-01-01');
      const result = dbService._calcRentCoverage(null, moveIn, 3000, 2000);
      expect(result.monthsCovered).toBe(1.5);
    });

    it('calculates overflow deposit when remaining > half rent', () => {
      const moveIn = new Date('2026-01-01');
      const result = dbService._calcRentCoverage(null, moveIn, 3200, 2000);
      expect(result.monthsCovered).toBe(1.5);
      // remaining = 1200, halfThreshold = 1000, depositIncrease = 1200 - 1000 = 200
      expect(result.depositIncrease).toBe(200);
    });

    it('adds small remaining to deposit', () => {
      const moveIn = new Date('2026-01-01');
      const result = dbService._calcRentCoverage(null, moveIn, 2100, 2000);
      expect(result.monthsCovered).toBe(1);
      expect(result.depositIncrease).toBe(100);
    });

    it('handles multiple months', () => {
      const moveIn = new Date('2026-01-01');
      const result = dbService._calcRentCoverage(null, moveIn, 6000, 2000);
      expect(result.monthsCovered).toBe(3);
      expect(result.depositIncrease).toBe(0);
    });

    it('continues from existing coverage', () => {
      const coveredUntil = new Date('2026-03-31');
      const moveIn = new Date('2026-01-01');
      const result = dbService._calcRentCoverage(coveredUntil, moveIn, 2000, 2000);
      // Starts from 2026-04-01, covers 1 month until 2026-04-30
      expect(result.newCoveredUntil.getMonth()).toBe(3); // April = 3
      expect(result.newCoveredUntil.getDate()).toBe(30);
      expect(result.monthsCovered).toBe(1);
    });
  });

  // ============ 水电费计算 ============

  describe('calculateUtilityBill', () => {
    it('calculates bill from 0 baseline with no prior records', async () => {
      const result = await dbService.calculateUtilityBill('h1', 't1', 100, 50);
      expect(result.electricityUsage).toBe(100);
      expect(result.waterUsage).toBe(50);
      expect(result.electricityCost).toBe(80); // 100 * 0.8
      expect(result.waterCost).toBe(175); // 50 * 3.5
      expect(result.totalCost).toBe(255);
    });

    it('calculates usage from last reading', async () => {
      // First reading: elec=100, water=50
      await dbService.calculateUtilityBill('h1', 't1', 100, 50);
      // Second reading: elec=150, water=70
      const result = await dbService.calculateUtilityBill('h1', 't1', 150, 70);
      expect(result.electricityUsage).toBe(50);
      expect(result.waterUsage).toBe(20);
    });

    it('creates utility record and payment', async () => {
      await dbService.calculateUtilityBill('h1', 't1', 100, 50);
      const records = await dbService.getUtilityRecords({ tenantId: 't1' });
      expect(records.data.length).toBe(1);
      expect(records.data[0].totalCost).toBe(255);

      const payments = await dbService.getPayments({ tenantId: 't1', paymentType: 'utility' });
      expect(payments.data.length).toBe(1);
      expect(payments.data[0].amount).toBe(255);
    });

    it('uses dynamic prices from system settings', async () => {
      await dbService.updateSystemSettings({ electricityPrice: 1.2, waterPrice: 5.0 });
      const result = await dbService.calculateUtilityBill('h1', 't1', 100, 50);
      expect(result.electricityCost).toBe(120); // 100 * 1.2
      expect(result.waterCost).toBe(250); // 50 * 5.0
    });
  });

  // ============ 退租结算 ============

  describe('calculateMoveOutSettlement', () => {
    it('calculates settlement with refund when overpaid', async () => {
      const house = await dbService.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
      const tenant = await dbService.addTenant({
        name: '张三', houseId: house._id, deposit: 4000, rent: 2000,
        paymentCycle: 'month', moveInDate: '2026-01-01'
      });

      // Jan 1 → Jan 15 = 按日历月算归为1个月
      const settlement = await dbService.calculateMoveOutSettlement(tenant.id, new Date('2026-01-15'));
      expect(settlement.daysUsed).toBe(14);
      expect(settlement.owedRent).toBe(2000);
      expect(settlement.refundAmount).toBeGreaterThan(0);
      expect(settlement.adjustRentRefund).toBe(0);
    });

    it('calculates settlement with extra due when underpaid', async () => {
      const house = await dbService.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
      // Only pay 1 month rent (2000), no deposit
      const r = await dbService.addPayment({
        houseId: house._id, tenantId: 'manual_tenant',
        paymentType: 'rent', amount: 2000,
        description: 'test', status: 'paid'
      });

      // Store a manual tenant with no deposit
      const d = dbService._db();
      const tenantResult = await d.collection('tenants').add({
        data: {
          name: '李四', houseId: house._id, status: 'active',
          deposit: 0, rent: 2000, paymentCycle: 'month',
          moveInDate: new Date('2026-01-01'),
          moveInElectricity: 0, moveInWater: 0,
          createdAt: new Date(), updatedAt: new Date()
        }
      });
      const tenantId = tenantResult._id;

      // Move-out after 45 days: 1 full month + 15 remaining days → 2 months = 4000
      const settlement = await dbService.calculateMoveOutSettlement(tenantId, new Date('2026-02-15'));
      expect(settlement.daysUsed).toBe(45);
      expect(settlement.owedRent).toBe(4000);
      expect(settlement.adjustRentRefund).toBe(0);
      expect(settlement.extraDue).toBeGreaterThan(0);
    });
  });

  // ============ 下次收租 ============

  describe('getNextRentDueDate', () => {
    it('returns rent info for active tenant', async () => {
      const house = await dbService.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
      const tenant = await dbService.addTenant({
        name: '张三', houseId: house._id, deposit: 4000, rent: 2000,
        paymentCycle: 'month', moveInDate: '2026-01-01'
      });

      const info = await dbService.getNextRentDueDate(tenant.id);
      expect(info.monthlyRent).toBe(2000);
      expect(info.amount).toBe(2000);
      expect(info.houseCode).toBe('A101');
    });
  });
});
