const cloud = require('@cloudbase/node-sdk');

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

async function getSystemSettings() {
  const res = await db.collection('system_settings').where({ _id: 'global' }).get();
  return res.data && res.data.length > 0
    ? res.data[0]
    : { electricityPrice: 0.8, waterPrice: 3.5 };
}

function buildMeta(event, lease) {
  const meta = {};
  if (event.test !== undefined) meta.test = event.test;
  if (event.testRunId) meta.testRunId = event.testRunId;
  if (event.createdBy) meta.createdBy = event.createdBy;
  if (lease && lease._openid) meta._openid = lease._openid;
  return meta;
}

function dateMs(value) {
  if (!value) return 0;
  if (value.$date) return Number(value.$date) || new Date(value.$date).getTime() || 0;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function latestUtilityRecord(rows) {
  return (rows || []).slice().sort((a, b) => {
    const calcDiff = dateMs(b.calculationDate) - dateMs(a.calculationDate);
    if (calcDiff !== 0) return calcDiff;
    return dateMs(b.createdAt) - dateMs(a.createdAt);
  })[0] || null;
}

async function filterExistingLeaseRecords(transaction, houseId, records) {
  if (!records || records.length === 0) return [];
  const leaseRes = await transaction.collection('lease_agreements').where({ houseId }).get();
  const leaseIds = new Set((leaseRes.data || []).map(item => item._id));
  return records.filter(record => record.leaseId && leaseIds.has(record.leaseId));
}

exports.main = async (event) => {
  const { leaseId, electricityReading, waterReading, calculationDate, remark = '' } = event;
  if (!leaseId || electricityReading === undefined || waterReading === undefined) {
    return { code: 400, message: '缺少必要参数：leaseId, electricityReading, waterReading' };
  }

  const transaction = await db.startTransaction();
  try {
    const leaseRes = await transaction.collection('lease_agreements').where({ _id: leaseId }).get();
    if (!leaseRes.data || leaseRes.data.length === 0) {
      await transaction.rollback();
      return { code: 404, message: '租赁合同不存在' };
    }

    const lease = leaseRes.data[0];
    if (lease.status !== 'active') {
      await transaction.rollback();
      return { code: 400, message: '合同已结束' };
    }

    const currentLeaseRecordRes = await transaction
      .collection('utility_records')
      .where({ leaseId })
      .orderBy('calculationDate', 'desc')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    const currentLeaseRecord = latestUtilityRecord(currentLeaseRecordRes.data || []);

    const lastRecordRes = await transaction
      .collection('utility_records')
      .where({ houseId: lease.houseId })
      .orderBy('calculationDate', 'desc')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();

    const validRecords = await filterExistingLeaseRecords(transaction, lease.houseId, lastRecordRes.data || []);
    const lastRecord = currentLeaseRecord || latestUtilityRecord(validRecords);
    const lastElectricity = Number(lastRecord ? lastRecord.electricityReading : (lease.moveInElectricity || 0));
    const lastWater = Number(lastRecord ? lastRecord.waterReading : (lease.moveInWater || 0));
    const electricityUsage = Number(electricityReading) - lastElectricity;
    const waterUsage = Number(waterReading) - lastWater;
    if (electricityUsage < 0 || waterUsage < 0) {
      await transaction.rollback();
      return { code: 400, message: `抄表读数不能低于上次读数：电表${lastElectricity}，水表${lastWater}` };
    }

    const settings = await getSystemSettings();
    const electricityCost = Math.round(electricityUsage * Number(settings.electricityPrice || 0.8) * 100) / 100;
    const waterCost = Math.round(waterUsage * Number(settings.waterPrice || 3.5) * 100) / 100;
    const totalCost = Math.round((electricityCost + waterCost) * 100) / 100;
    const now = new Date();
    const calcDate = calculationDate ? new Date(calculationDate) : now;
    const relation = {
      ...buildMeta(event, lease),
      leaseId,
      houseId: lease.houseId,
      tenantId: lease.tenantId
    };

    const recordRes = await transaction.collection('utility_records').add({
      ...relation,
      electricityReading: Number(electricityReading),
      waterReading: Number(waterReading),
      electricityUsage,
      waterUsage,
      electricityCost,
      waterCost,
      totalCost,
      calculationDate: calcDate,
      recordType: 'regular',
      remark,
      createdAt: now
    });

    let billId = null;
    if (totalCost > 0) {
      const dueDate = new Date(calcDate);
      dueDate.setDate(dueDate.getDate() + 7);
      const billRes = await transaction.collection('bills').add({
        ...relation,
        type: 'utility',
        period: calcDate.toISOString().split('T')[0],
        amount: totalCost,
        paidAmount: 0,
        status: 'unpaid',
        dueDate,
        utilityRecordId: recordRes.id || recordRes._id,
        remark: `电费:${electricityUsage}度*${settings.electricityPrice}=${electricityCost}元,水费:${waterUsage}吨*${settings.waterPrice}=${waterCost}元`,
        createdAt: now,
        updatedAt: now
      });
      billId = billRes.id || billRes._id;
    }

    await transaction.commit();
    return {
      code: 200,
      message: '抄表记录添加成功',
      data: {
        recordId: recordRes.id || recordRes._id,
        billId,
        lastElectricity,
        lastWater,
        electricityUsage,
        waterUsage,
        electricityCost,
        waterCost,
        totalCost
      }
    };
  } catch (error) {
    await transaction.rollback();
    return { code: 500, message: '添加抄表记录失败：' + error.message };
  }
};
