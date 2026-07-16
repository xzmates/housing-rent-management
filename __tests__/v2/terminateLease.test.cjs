/**
 * terminateLease 退租结算场景测试
 * 覆盖：无损坏、有水电、有损坏赔偿、提前交租退还、复合场景等
 */
const { getCollectionData, clearAllData } = require('../setup.cjs');
const api = require('../../miniprogram/services/api');

let house, tenant;

beforeEach(() => {
  clearAllData();
  house = { _id: 'h1', code: '101', address: '东楼北', rent: 1000, status: 'available' };
  getCollectionData('houses').push(house);
  tenant = { _id: 't1', name: '张三', phone: '13800000000', status: 'inactive' };
  getCollectionData('tenants').push(tenant);
  getCollectionData('system_settings').push({ _id: 'global', electricityPrice: 0.8, waterPrice: 3.5 });
});

describe('terminateLease 退租结算场景', () => {

  // ═══════════════════════════════════════════════════════════
  // 场景1：无损坏、无水电、无预付租金（最简单场景）
  // ═══════════════════════════════════════════════════════════
  describe('场景1：无损坏无水电无预付 - 简单退租', () => {
    it('入住1个月退租，无损坏，押金全额退还', async () => {
      const leaseResult = await api.createLease({
        houseId: house._id, tenantId: tenant._id,
        startDate: '2026-06-01', rent: 1000, deposit: 1000
      });
      const leaseId = leaseResult.leaseId;

      // 退租：入住1个月，首期付了1个月租金
      const result = await api.terminateLease({
        leaseId,
        endDate: '2026-06-30',
        damageAmount: 0,
        electricityReading: 0,
        waterReading: 0
      });

      // 已付租金1000，入住1个月应付1000，无多付
      expect(result.rentRefund.overpaidRent).toBe(0);
      // 无损坏，押金全额退还
      expect(result.refundAmount).toBe(1000);
      expect(result.damageAmount).toBe(0);
      expect(result.extraPayment).toBe(0);
      expect(result.cashSettlementAmount).toBe(0);

      const lease = await api.getLeaseById(leaseId);
      expect(lease.status).toBe('terminated');
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 场景2：有水电费未结清
  // ═══════════════════════════════════════════════════════════
  describe('场景2：有水电费未结清', () => {
    it('退租时水电费由押金抵扣', async () => {
      const leaseResult = await api.createLease({
        houseId: house._id, tenantId: tenant._id,
        startDate: '2026-06-01', rent: 1000, deposit: 1000,
        moveInElectricity: 100, moveInWater: 50
      });

      const result = await api.terminateLease({
        leaseId: leaseResult.leaseId,
        endDate: '2026-06-30',
        damageAmount: 0,
        electricityReading: 110,
        waterReading: 60
      });

      // 水电费：10*0.8 + 10*3.5 = 43元
      expect(result.utilityCost).toBe(43);
      expect(result.depositOffsetAmount).toBe(43);
      expect(result.refundAmount).toBe(957);
      expect(result.damageAmount).toBe(0);
    });

    it('水电费超过押金，需补缴差额', async () => {
      const leaseResult = await api.createLease({
        houseId: house._id, tenantId: tenant._id,
        startDate: '2026-06-01', rent: 1000, deposit: 100,
        moveInElectricity: 0, moveInWater: 0
      });

      const result = await api.terminateLease({
        leaseId: leaseResult.leaseId,
        endDate: '2026-06-30',
        damageAmount: 0,
        electricityReading: 100,
        waterReading: 100
      });

      // 水电费：100*0.8 + 100*3.5 = 430元
      expect(result.utilityCost).toBe(430);
      expect(result.depositOffsetAmount).toBe(100);
      expect(result.extraPayment).toBe(330);
      expect(result.refundAmount).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 场景3：有损坏赔偿
  // ═══════════════════════════════════════════════════════════
  describe('场景3：有损坏赔偿', () => {
    it('损坏2000，押金1000，需补缴1000', async () => {
      const leaseResult = await api.createLease({
        houseId: house._id, tenantId: tenant._id,
        startDate: '2026-06-01', rent: 1000, deposit: 1000
      });

      const result = await api.terminateLease({
        leaseId: leaseResult.leaseId,
        endDate: '2026-06-30',
        damageAmount: 2000,
        electricityReading: 0,
        waterReading: 0
      });

      expect(result.damageAmount).toBe(2000);
      expect(result.depositOffsetAmount).toBe(0);
      expect(result.refundAmount).toBe(0);
      expect(result.extraPayment).toBe(1000);
      expect(result.cashSettlementAmount).toBe(1000);

      const lease = await api.getLeaseById(leaseResult.leaseId);
      expect(lease.damageAmount).toBe(2000);
    });

    it('损坏500，押金1000，退还500', async () => {
      const leaseResult = await api.createLease({
        houseId: house._id, tenantId: tenant._id,
        startDate: '2026-06-01', rent: 1000, deposit: 1000
      });

      const result = await api.terminateLease({
        leaseId: leaseResult.leaseId,
        endDate: '2026-06-30',
        damageAmount: 500,
        electricityReading: 0,
        waterReading: 0
      });

      expect(result.damageAmount).toBe(500);
      expect(result.refundAmount).toBe(500);
      expect(result.extraPayment).toBe(0);
      expect(result.cashSettlementAmount).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 场景4：提前交租后退租
  // ═══════════════════════════════════════════════════════════
  describe('场景4：提前交租后退租', () => {
    it('预付3个月租金，入住1个月退租，退还多付租金', async () => {
      const leaseResult = await api.createLease({
        houseId: house._id, tenantId: tenant._id,
        startDate: '2026-06-01', rent: 1000, deposit: 1000
      });
      const leaseId = leaseResult.leaseId;

      // 提前交3个月租金
      await api.createNextRentBill(leaseId, { amount: 3000, coverageMonths: 3 });
      const bills = await api.getBills({ leaseId });
      const prepaidBill = bills.data.find(b => b.type === 'rent' && b.status === 'unpaid');
      await api.payBill(prepaidBill._id, 3000, '2026-06-15', 'cash');

      const result = await api.terminateLease({
        leaseId,
        endDate: '2026-06-30',
        damageAmount: 0,
        electricityReading: 0,
        waterReading: 0
      });

      // 已付：首期1000 + 预付3000 = 4000，入住1个月应付1000，多付3000
      expect(result.rentRefund.totalPaidRent).toBe(4000);
      expect(result.rentRefund.actualRentDue).toBe(1000);
      expect(result.rentRefund.overpaidRent).toBe(3000);
      expect(result.refundAmount).toBe(1000);
      expect(result.totalRefund).toBe(4000);
    });

    it('预付租金+损坏，退款抵扣损坏后退还余额', async () => {
      const leaseResult = await api.createLease({
        houseId: house._id, tenantId: tenant._id,
        startDate: '2026-06-01', rent: 1000, deposit: 1000
      });
      const leaseId = leaseResult.leaseId;

      await api.createNextRentBill(leaseId, { amount: 2000, coverageMonths: 2 });
      const bills = await api.getBills({ leaseId });
      const prepaidBill = bills.data.find(b => b.type === 'rent' && b.status === 'unpaid');
      await api.payBill(prepaidBill._id, 2000, '2026-06-15', 'cash');

      const result = await api.terminateLease({
        leaseId,
        endDate: '2026-06-30',
        damageAmount: 1500,
        electricityReading: 0,
        waterReading: 0
      });

      expect(result.rentRefund.overpaidRent).toBe(2000);
      expect(result.damageAmount).toBe(1500);
      // 押金1000抵扣损坏1500，还差500
      expect(result.extraPayment).toBe(500);
      // totalRefund = 0(押金退还) + 2000(租金退款) - 500(补缴) = 1500
      expect(result.totalRefund).toBe(1500);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 场景5：复合场景（损坏+水电+预付租金）
  // ═══════════════════════════════════════════════════════════
  describe('场景5：复合场景', () => {
    it('损坏+水电+预付租金，完整结算', async () => {
      const leaseResult = await api.createLease({
        houseId: house._id, tenantId: tenant._id,
        startDate: '2026-06-01', rent: 1000, deposit: 2000,
        moveInElectricity: 0, moveInWater: 0
      });
      const leaseId = leaseResult.leaseId;

      // 提前交2个月租金
      await api.createNextRentBill(leaseId, { amount: 2000, coverageMonths: 2 });
      const bills = await api.getBills({ leaseId });
      const prepaidBill = bills.data.find(b => b.type === 'rent' && b.status === 'unpaid');
      await api.payBill(prepaidBill._id, 2000, '2026-06-15', 'cash');

      const result = await api.terminateLease({
        leaseId,
        endDate: '2026-06-30',
        damageAmount: 500,
        electricityReading: 50,
        waterReading: 160
      });

      // 水电费：50*0.8 + 160*3.5 = 40+560 = 600
      expect(result.utilityCost).toBe(600);
      expect(result.damageAmount).toBe(500);
      expect(result.rentRefund.overpaidRent).toBe(2000);
      // 押金2000先扣损坏500，剩余1500抵扣水电600，剩余900退还
      expect(result.depositOffsetAmount).toBe(600);
      expect(result.refundAmount).toBe(900);
      expect(result.totalRefund).toBe(2900);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 场景6：账单已结清退租
  // ═══════════════════════════════════════════════════════════
  describe('场景6：账单已结清退租', () => {
    it('所有账单已缴清，无损坏，押金全额退还', async () => {
      const leaseResult = await api.createLease({
        houseId: house._id, tenantId: tenant._id,
        startDate: '2026-01-01', rent: 1000, deposit: 1000
      });
      const leaseId = leaseResult.leaseId;

      // 缴清所有账单
      const bills = await api.getBills({ leaseId });
      for (const bill of bills.data.filter(b => b.status !== 'paid')) {
        await api.payBill(bill._id, bill.amount - (bill.paidAmount || 0), '2026-01-05', 'cash');
      }

      const result = await api.terminateLease({
        leaseId,
        endDate: '2026-06-01',
        damageAmount: 0,
        electricityReading: 0,
        waterReading: 0
      });

      expect(result.refundAmount).toBe(1000);
      expect(result.extraPayment).toBe(0);
      expect(result.cashSettlementAmount).toBe(0);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 场景7：账单与流水一致性验证
  // ═══════════════════════════════════════════════════════════
  describe('场景7：账单与流水一致性', () => {
    it('退租后每笔账单都有对应流水，金额一致', async () => {
      const leaseResult = await api.createLease({
        houseId: house._id, tenantId: tenant._id,
        startDate: '2026-06-01', rent: 1000, deposit: 1000,
        moveInElectricity: 0, moveInWater: 0
      });
      const leaseId = leaseResult.leaseId;

      // 提前交1个月租金
      await api.createNextRentBill(leaseId, { amount: 1000, coverageMonths: 1 });
      const bills = await api.getBills({ leaseId });
      const prepaidBill = bills.data.find(b => b.type === 'rent' && b.status === 'unpaid');
      await api.payBill(prepaidBill._id, 1000, '2026-06-15', 'cash');

      // 退租：损坏2000，水电430
      const result = await api.terminateLease({
        leaseId,
        endDate: '2026-06-30',
        damageAmount: 2000,
        electricityReading: 100,
        waterReading: 100
      });

      // 获取所有账单和流水
      const allBills = (await api.getBills({ leaseId })).data;
      const allPayments = getCollectionData('payments').filter(p => p.leaseId === leaseId);
      const billMap = {};
      allBills.forEach(b => { billMap[b._id] = b; });

      // 每笔in方向的流水，对应账单应已结清
      const incomePayments = allPayments.filter(p => p.direction === 'in');
      for (const payment of incomePayments) {
        const bill = billMap[payment.billId];
        if (bill) {
          expect(bill.status).toBe('paid');
          expect(bill.paidAmount).toBe(bill.amount);
        }
      }

      // 验证总金额平衡
      const totalIncome = allPayments
        .filter(p => p.direction === 'in')
        .reduce((sum, p) => sum + p.amount, 0);
      const totalExpense = allPayments
        .filter(p => p.direction === 'out')
        .reduce((sum, p) => sum + p.amount, 0);
      const netCash = totalIncome - totalExpense;

      // 净收款 = 首期租1000 + 押金1000 + 预付1000 + 水电430 + 额外赔偿1000 - 退租金1000
      expect(netCash).toBe(3430);

      // 验证合同记录的damageAmount是总额2000
      const lease = await api.getLeaseById(leaseId);
      expect(lease.damageAmount).toBe(2000);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // 场景8：季付合同退租
  // ═══════════════════════════════════════════════════════════
  describe('场景8：季付合同退租', () => {
    it('季付入住1个月退租，不满一季度按一季度计', async () => {
      const leaseResult = await api.createLease({
        houseId: house._id, tenantId: tenant._id,
        startDate: '2026-06-01', rent: 1000, deposit: 1000,
        paymentCycle: 'quarter'
      });

      const result = await api.terminateLease({
        leaseId: leaseResult.leaseId,
        endDate: '2026-06-30',
        damageAmount: 0,
        electricityReading: 0,
        waterReading: 0
      });

      // 季付首期3000，未住满一季度也按一季度计，应付3000，不退租金
      expect(result.rentRefund.totalPaidRent).toBe(3000);
      expect(result.rentRefund.actualRentDue).toBe(3000);
      expect(result.rentRefund.overpaidRent).toBe(0);
      expect(result.refundAmount).toBe(1000);
      expect(result.totalRefund).toBe(1000);
    });
  });
});
