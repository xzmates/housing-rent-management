const cloud = require('@cloudbase/node-sdk');
const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();
const _ = db.command;

function dateMs(value) {
  if (!value) return 0;
  if (value.$date) return Number(value.$date) || new Date(value.$date).getTime() || 0;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function sortUtilityRecords(rows) {
  return (rows || []).slice().sort((a, b) => {
    const calcDiff = dateMs(b.calculationDate) - dateMs(a.calculationDate);
    if (calcDiff !== 0) return calcDiff;
    return dateMs(b.createdAt) - dateMs(a.createdAt);
  });
}

async function filterExistingLeaseRecords(houseId, records) {
  if (!records || records.length === 0) return [];
  const leaseRes = await db.collection('lease_agreements').where({ houseId }).get();
  const leaseIds = new Set((leaseRes.data || []).map(item => item._id));
  return records.filter(record => record.leaseId && leaseIds.has(record.leaseId));
}

exports.main = async (event, context) => {
  const { houseId } = event;
  if (!houseId) return { code: 400, message: '缺少必要参数：houseId' };

  try {
    const houseRes = await db.collection('houses').where({ _id: houseId }).get();
    if (!houseRes.data || houseRes.data.length === 0) return { code: 404, message: '房屋不存在' };
    const house = houseRes.data[0];

    const leaseRes = await db.collection('lease_agreements').where({ houseId, status: 'active' }).get();
    if (!leaseRes.data || leaseRes.data.length === 0) return { code: 200, message: '该房屋当前无租客', data: { house, currentLease: null, tenant: null, recentBills: [], utilityRecords: [] } };

    const lease = leaseRes.data[0];
    const tenantRes = await db.collection('tenants').where({ _id: lease.tenantId }).get();
    const tenant = tenantRes.data && tenantRes.data.length > 0 ? tenantRes.data[0] : null;

    const billsRes = await db.collection('bills').where({ leaseId: lease._id }).orderBy('createdAt', 'desc').limit(10).get();
    const currentLeaseUtilityRes = await db.collection('utility_records').where({ leaseId: lease._id }).orderBy('calculationDate', 'desc').orderBy('createdAt', 'desc').limit(20).get();
    const utilityRes = currentLeaseUtilityRes.data && currentLeaseUtilityRes.data.length > 0
      ? currentLeaseUtilityRes
      : await db.collection('utility_records').where({ houseId }).orderBy('calculationDate', 'desc').orderBy('createdAt', 'desc').limit(20).get();
    const validUtilityRecords = await filterExistingLeaseRecords(houseId, utilityRes.data || []);

    const allBillsRes = await db.collection('bills').where({ leaseId: lease._id }).get();
    const allBills = allBillsRes.data || [];
    const billStats = { total: allBills.length, totalAmount: 0, totalPaid: 0, unpaid: 0, unpaidAmount: 0, byStatus: { unpaid: 0, partial: 0, paid: 0 }, byType: {} };

    allBills.forEach(bill => {
      billStats.totalAmount += bill.amount;
      billStats.totalPaid += bill.paidAmount;
      billStats.byStatus[bill.status]++;
      if (bill.status !== 'paid') { billStats.unpaid++; billStats.unpaidAmount += (bill.amount - bill.paidAmount); }
      if (!billStats.byType[bill.type]) billStats.byType[bill.type] = { count: 0, amount: 0, paid: 0 };
      billStats.byType[bill.type].count++;
      billStats.byType[bill.type].amount += bill.amount;
      billStats.byType[bill.type].paid += bill.paidAmount;
    });

    return { code: 200, message: '查询成功', data: { house, currentLease: lease, tenant, recentBills: billsRes.data || [], utilityRecords: sortUtilityRecords(validUtilityRecords).slice(0, 5), billStats } };
  } catch (error) {
    return { code: 500, message: '查询房屋当前租客失败：' + error.message };
  }
};
