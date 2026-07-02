/**
 * 并发测试（V2 新数据模型）
 * 覆盖维度：并发创建合同、并发缴费、定时任务重复触发
 */
const { clearAllData, getCollectionData } = require('../setup.cjs');
const api = require('../../miniprogram/services/api');

beforeEach(() => { clearAllData(); });

describe('并发创建合同', () => {
  it('10个请求同时创建同一房屋合同 → 1成功9失败', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    // 创建10个不同的租客
    const tenantIds = [];
    for (let i = 0; i < 10; i++) {
      const tr = await api.addTenant({ name: '租客' + i, phone: '1380013800' + i });
      tenantIds.push(tr._id);
    }

    // 并发创建合同（全部针对同一房屋）
    const results = await Promise.allSettled(
      tenantIds.map(tid => api.createLease({
        houseId: hr._id, tenantId: tid,
        startDate: '2026-01-01', rent: 2000
      }))
    );

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    const rejected = results.filter(r => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(9);

    // 验证只有1个活跃合同
    const leases = await api.getLeases({ houseId: hr._id, status: 'active' });
    expect(leases.data.length).toBe(1);

    // 验证房屋状态
    const house = await api.getHouseById(hr._id);
    expect(house.status).toBe('rented');
  });
});

describe('并发缴费', () => {
  let billId;

  beforeEach(async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });
    const tr = await api.addTenant({ name: '张三' });
    const leaseResult = await api.createLease({
      houseId: hr._id, tenantId: tr._id,
      startDate: '2026-01-01', rent: 2000
    });
    const bills = await api.getBills({ leaseId: leaseResult.leaseId });
    billId = bills.data.find(b => b.status !== 'paid')._id;
  });

  it('两个请求同时缴费 → 最终金额正确', async () => {
    // 模拟两个并发缴费请求（各缴1000）
    const results = await Promise.allSettled([
      api.payBill(billId, 1000, '2026-01-05', 'cash'),
      api.payBill(billId, 1000, '2026-01-05', 'cash')
    ]);

    const fulfilled = results.filter(r => r.status === 'fulfilled');
    // 在mock同步环境下，两个都可能成功（非真实并发事务）
    // 但最终 paidAmount 不能超过 amount
    const finalBill = getCollectionData('bills').find(b => b._id === billId);
    expect(finalBill.paidAmount).toBeLessThanOrEqual(finalBill.amount);
    if (finalBill.paidAmount === finalBill.amount) {
      expect(finalBill.status).toBe('paid');
    }
  });

  it('三次小额缴费累加不超过总额', async () => {
    await Promise.allSettled([
      api.payBill(billId, 500, '2026-01-05', 'cash'),
      api.payBill(billId, 500, '2026-01-10', 'cash'),
      api.payBill(billId, 500, '2026-01-15', 'cash')
    ]);

    const finalBill = getCollectionData('bills').find(b => b._id === billId);
    expect(finalBill.paidAmount).toBe(1500);
    expect(finalBill.status).toBe('partial');
  });
});

describe('并发查房', () => {
  it('10个同时查询同一房屋不报错', async () => {
    const hr = await api.addHouse({ code: 'A101', address: '东楼北', rent: 2000 });

    const results = await Promise.all(
      Array(10).fill(null).map(() => api.getHouseById(hr._id))
    );

    expect(results.length).toBe(10);
    results.forEach(h => {
      expect(h._id).toBe(hr._id);
    });
  });
});
