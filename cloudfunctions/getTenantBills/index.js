const cloud = require('@cloudbase/node-sdk');
const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();
const _ = db.command;

exports.main = async (event, context) => {
  const { tenantId, status, type, page = 1, pageSize = 20 } = event;
  if (!tenantId) return { code: 400, message: '缺少必要参数：tenantId' };

  try {
    const leasesRes = await db.collection('lease_agreements').where({ tenantId }).orderBy('createdAt', 'desc').get();
    const leases = leasesRes.data || [];
    if (leases.length === 0) return { code: 200, message: '该租客暂无租赁合同', data: { tenantId, leases: [], bills: [], statistics: { totalBills: 0, totalAmount: 0, totalPaid: 0, totalUnpaid: 0 } } };

    const leaseIds = leases.map(l => l._id);
    let billQuery = db.collection('bills').where({ leaseId: _.in(leaseIds) });
    if (status) billQuery = billQuery.where({ status });
    if (type) billQuery = billQuery.where({ type });

    const billsRes = await billQuery.orderBy('createdAt', 'desc').skip((page - 1) * pageSize).limit(pageSize).get();
    const bills = billsRes.data || [];

    const houseIds = [...new Set(leases.map(l => l.houseId))];
    const housesRes = await db.collection('houses').where({ _id: _.in(houseIds) }).get();
    const housesMap = {};
    housesRes.data.forEach(h => housesMap[h._id] = h);

    const leaseMap = {};
    leases.forEach(l => leaseMap[l._id] = { ...l, house: housesMap[l.houseId] || null });

    const allBillsRes = await db.collection('bills').where({ leaseId: _.in(leaseIds) }).get();
    const allBills = allBillsRes.data || [];
    const statistics = { totalBills: allBills.length, totalAmount: 0, totalPaid: 0, totalUnpaid: 0, byType: {} };

    allBills.forEach(bill => {
      statistics.totalAmount += bill.amount;
      statistics.totalPaid += bill.paidAmount;
      if (bill.status !== 'paid') { statistics.totalUnpaid += (bill.amount - bill.paidAmount); }
      if (!statistics.byType[bill.type]) statistics.byType[bill.type] = { count: 0, amount: 0, paid: 0 };
      statistics.byType[bill.type].count++;
      statistics.byType[bill.type].amount += bill.amount;
      statistics.byType[bill.type].paid += bill.paidAmount;
    });

    const enrichedBills = bills.map(bill => ({ ...bill, lease: leaseMap[bill.leaseId] || null }));
    return { code: 200, message: '查询成功', data: { tenantId, leases: leases.map(l => ({ ...l, house: housesMap[l.houseId] || null })), bills: enrichedBills, statistics, pagination: { page, pageSize, total: allBills.length } } };
  } catch (error) {
    return { code: 500, message: '查询租客账单失败：' + error.message };
  }
};