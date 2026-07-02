const cloud = require('@cloudbase/node-sdk');

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

function ok(data) {
  return { code: 200, message: '合同已删除', data };
}

function fail(code, message) {
  return { code, message, data: null };
}

async function removeWhere(transaction, collectionName, where) {
  const res = await transaction.collection(collectionName).where(where).get();
  const rows = res.data || [];
  for (const row of rows) {
    await transaction.collection(collectionName).doc(row._id).remove();
  }
  return rows.length;
}

exports.main = async (event = {}) => {
  const { leaseId } = event;
  if (!leaseId) return fail(400, '缺少必要参数：leaseId');

  const transaction = await db.startTransaction();
  try {
    const leaseRes = await transaction.collection('lease_agreements').where({ _id: leaseId }).get();
    const lease = leaseRes.data && leaseRes.data[0];
    if (!lease) {
      await transaction.rollback();
      return fail(404, '合同不存在');
    }

    const now = new Date();
    const deletedPayments = await removeWhere(transaction, 'payments', { leaseId });
    const deletedBills = await removeWhere(transaction, 'bills', { leaseId });
    const deletedUtilityRecords = await removeWhere(transaction, 'utility_records', { leaseId });
    await transaction.collection('lease_agreements').doc(leaseId).remove();

    if (lease.status === 'active') {
      const otherHouseLeaseRes = await transaction
        .collection('lease_agreements')
        .where({ houseId: lease.houseId, status: 'active' })
        .get();
      const hasOtherHouseLease = (otherHouseLeaseRes.data || []).some(item => item._id !== leaseId);
      if (!hasOtherHouseLease) {
        await transaction.collection('houses').where({ _id: lease.houseId }).update({
          status: 'available',
          updatedAt: now
        });
      }

      const otherTenantLeaseRes = await transaction
        .collection('lease_agreements')
        .where({ tenantId: lease.tenantId, status: 'active' })
        .get();
      const hasOtherTenantLease = (otherTenantLeaseRes.data || []).some(item => item._id !== leaseId);
      if (!hasOtherTenantLease) {
        await transaction.collection('tenants').where({ _id: lease.tenantId }).update({
          status: 'inactive',
          updatedAt: now
        });
      }
    }

    await transaction.commit();
    return ok({
      leaseId,
      deletedLeases: 1,
      deletedBills,
      deletedPayments,
      deletedUtilityRecords
    });
  } catch (error) {
    await transaction.rollback();
    return fail(500, '删除合同失败：' + error.message);
  }
};
