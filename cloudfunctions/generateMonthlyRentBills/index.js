const cloud = require('@cloudbase/node-sdk');
const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

function getNextMonth(yearMonth) {
  const [year, month] = yearMonth.split('-').map(Number);
  const nextDate = new Date(year, month, 1);
  return `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}`;
}

exports.main = async (event, context) => {
  const { targetMonth, leaseId } = event;
  try {
    let leaseQuery = db.collection('lease_agreements').where({ status: 'active' });
    if (leaseId) leaseQuery = db.collection('lease_agreements').where({ _id: leaseId, status: 'active' });

    const leasesRes = await leaseQuery.get();
    const leases = leasesRes.data || [];
    if (leases.length === 0) return { code: 200, message: '没有需要生成账单的活跃合同', data: { generated: 0, skipped: 0 } };

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const nextMonth = targetMonth || getNextMonth(currentMonth);
    const results = { generated: 0, skipped: 0, errors: [] };

    for (const lease of leases) {
      try {
        const existingBill = await db.collection('bills').where({ leaseId: lease._id, type: 'rent', period: nextMonth }).get();
        if (existingBill.data && existingBill.data.length > 0) { results.skipped++; continue; }
        const dueDate = new Date(nextMonth + '-05');
        await db.collection('bills').add({ leaseId: lease._id, type: 'rent', period: nextMonth, amount: lease.rent, paidAmount: 0, status: 'unpaid', dueDate, remark: '', createdAt: new Date(), updatedAt: new Date() });
        results.generated++;
      } catch (err) { results.errors.push({ leaseId: lease._id, error: err.message }); }
    }
    return { code: 200, message: `账单生成完成：成功 ${results.generated} 条，跳过 ${results.skipped} 条`, data: { targetMonth: nextMonth, ...results } };
  } catch (error) {
    return { code: 500, message: '生成月租账单失败：' + error.message };
  }
};