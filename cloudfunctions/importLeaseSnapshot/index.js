const cloud = require('@cloudbase/node-sdk');

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

function generateLeaseId() {
  const now = new Date();
  const dateStr = now.getFullYear().toString()
    + String(now.getMonth() + 1).padStart(2, '0')
    + String(now.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 900 + 100);
  return `LA_${dateStr}_${random}`;
}

function getBillingMonths(cycle) {
  return {
    month: 1,
    quarter: 3,
    half_year: 6,
    year: 12
  }[cycle] || 1;
}

function parseDateInput(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    const dayMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dayMatch) {
      return new Date(Number(dayMatch[1]), Number(dayMatch[2]) - 1, Number(dayMatch[3]));
    }
    const monthMatch = trimmed.match(/^(\d{4})-(\d{2})$/);
    if (monthMatch) {
      return new Date(Number(monthMatch[1]), Number(monthMatch[2]) - 1, 1);
    }
  }
  const fallback = new Date(value);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

function addMonths(date, months) {
  return new Date(date.getFullYear(), date.getMonth() + months, date.getDate());
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatRentPeriod(start, months) {
  const end = addDays(addMonths(start, months), -1);
  return `${formatDateKey(start)}~${formatDateKey(end)}`;
}

function buildMeta(event, source = {}) {
  const meta = {};
  if (event.test !== undefined) meta.test = event.test;
  if (event.testRunId) meta.testRunId = event.testRunId;
  if (event.createdBy) meta.createdBy = event.createdBy;
  if (event.source === 'voice') meta.source = 'voice';
  if (source._openid) meta._openid = source._openid;
  return meta;
}

function deriveRentCoveredUntil(lastPaymentDate, paymentCycle) {
  const start = parseDateInput(lastPaymentDate);
  if (!start) return null;
  return addDays(addMonths(start, getBillingMonths(paymentCycle)), -1);
}

async function safeLog(payload) {
  try {
    await db.collection('voice_command_logs').add({
      type: 'snapshot_import',
      ...payload,
      createdAt: new Date()
    });
  } catch (error) {
    // 忽略日志集合不存在
  }
}

exports.main = async (event = {}) => {
  const {
    houseId,
    tenantId,
    startDate,
    rent,
    deposit,
    paymentCycle = 'month',
    rentCoveredUntil,
    nextRentDueDate,
    lastPaymentDate,
    lastRentAmount,
    electricityReading = 0,
    waterReading = 0,
    lastUtilityDate,
    utilityAmount = 0,
    remark = '历史建档快照'
  } = event;

  if (!houseId || !tenantId || !startDate || rent === undefined || deposit === undefined) {
    return { code: 400, message: '缺少必要参数：houseId, tenantId, startDate, rent, deposit' };
  }

  const transaction = await db.startTransaction();
  try {
    const houseRes = await transaction.collection('houses').where({ _id: houseId }).get();
    const tenantRes = await transaction.collection('tenants').where({ _id: tenantId }).get();

    if (!houseRes.data || houseRes.data.length === 0) {
      await transaction.rollback();
      return { code: 404, message: '房屋不存在' };
    }
    if (!tenantRes.data || tenantRes.data.length === 0) {
      await transaction.rollback();
      return { code: 404, message: '租客不存在' };
    }

    const house = houseRes.data[0];
    if (house.status === 'maintenance') {
      await transaction.rollback();
      return { code: 400, message: '房屋当前为维修状态，无法导入合同' };
    }

    const houseLeaseRes = await transaction.collection('lease_agreements').where({ houseId, status: 'active' }).get();
    if (houseLeaseRes.data && houseLeaseRes.data.length > 0) {
      await transaction.rollback();
      return { code: 400, message: '该房屋已有生效中的合同' };
    }

    const tenantLeaseRes = await transaction.collection('lease_agreements').where({ tenantId, status: 'active' }).get();
    if (tenantLeaseRes.data && tenantLeaseRes.data.length > 0) {
      await transaction.rollback();
      return { code: 400, message: '该租客已有生效中的合同' };
    }

    const startAt = parseDateInput(startDate);
    if (!startAt) {
      await transaction.rollback();
      return { code: 400, message: '起租日期格式不正确' };
    }

    const coveredUntil = parseDateInput(rentCoveredUntil) || deriveRentCoveredUntil(lastPaymentDate, paymentCycle) || addDays(addMonths(startAt, getBillingMonths(paymentCycle)), -1);
    const dueDate = parseDateInput(nextRentDueDate) || addDays(coveredUntil, 1);
    const utilityDate = parseDateInput(lastUtilityDate) || dueDate || coveredUntil || new Date();

    const finalRent = Number(rent || 0);
    const finalDeposit = Number(deposit || 0);
    const currentElectricity = Number(electricityReading || 0);
    const currentWater = Number(waterReading || 0);
    const finalUtilityAmount = Number(utilityAmount || 0);
    const cycleMonths = getBillingMonths(paymentCycle);
    const nextRentAmount = Math.round(finalRent * cycleMonths * 100) / 100;
    const now = new Date();
    const leaseId = generateLeaseId();
    const meta = buildMeta(event, house);

    await transaction.collection('lease_agreements').add({
      ...meta,
      _id: leaseId,
      houseId,
      tenantId,
      startDate: startAt,
      endDate: null,
      rent: finalRent,
      deposit: finalDeposit,
      paymentCycle,
      moveInElectricity: currentElectricity,
      moveInWater: currentWater,
      meterReplaced: false,
      status: 'active',
      rentCoveredUntil: coveredUntil,
      nextRentDueDate: dueDate,
      endedAt: null,
      lastPaymentDate: parseDateInput(lastPaymentDate),
      lastRentAmount: lastRentAmount === undefined || lastRentAmount === null || lastRentAmount === ''
        ? null
        : Number(lastRentAmount),
      importMode: 'snapshot',
      remark,
      createdAt: now,
      updatedAt: now
    });

    await transaction.collection('utility_records').add({
      ...meta,
      leaseId,
      houseId,
      tenantId,
      electricityReading: currentElectricity,
      waterReading: currentWater,
      electricityUsage: 0,
      waterUsage: 0,
      electricityCost: 0,
      waterCost: 0,
      totalCost: 0,
      calculationDate: startAt,
      recordType: 'move_in_baseline',
      meterReplaced: false,
      remark: '历史建档基准读数',
      createdAt: now
    });

    if (formatDateKey(utilityDate) !== formatDateKey(startAt) || finalUtilityAmount > 0) {
      await transaction.collection('utility_records').add({
        ...meta,
        leaseId,
        houseId,
        tenantId,
        electricityReading: currentElectricity,
        waterReading: currentWater,
        electricityUsage: 0,
        waterUsage: 0,
        electricityCost: 0,
        waterCost: 0,
        totalCost: finalUtilityAmount,
        calculationDate: utilityDate,
        recordType: 'history_snapshot',
        meterReplaced: false,
        remark: '历史建档最近抄表快照',
        createdAt: now
      });
    }

    const rentCoverageEnd = addDays(addMonths(dueDate, cycleMonths), -1);
    const billRes = await transaction.collection('bills').add({
      ...meta,
      leaseId,
      houseId,
      tenantId,
      type: 'rent',
      period: formatRentPeriod(dueDate, cycleMonths),
      amount: nextRentAmount,
      paidAmount: 0,
      status: 'unpaid',
      dueDate,
      rentCoverageStart: dueDate,
      rentCoverageEnd,
      coverageMonths: cycleMonths,
      coverageDays: 0,
      remark: '历史建档快照生成的当前待收租金',
      createdAt: now,
      updatedAt: now
    });

    await transaction.collection('houses').where({ _id: houseId }).update({
      rent: finalRent,
      status: 'rented',
      updatedAt: now
    });
    await transaction.collection('tenants').where({ _id: tenantId }).update({
      status: 'active',
      updatedAt: now
    });

    await transaction.commit();

    await safeLog({
      leaseId,
      houseId,
      tenantId,
      startDate: formatDateKey(startAt),
      rentCoveredUntil: formatDateKey(coveredUntil),
      nextRentDueDate: formatDateKey(dueDate)
    });

    return {
      code: 200,
      message: '历史建档快照导入成功',
      data: {
        leaseId,
        billId: billRes.id || billRes._id,
        rentCoveredUntil: coveredUntil,
        nextRentDueDate: dueDate
      }
    };
  } catch (error) {
    await transaction.rollback();
    return { code: 500, message: `历史建档导入失败：${error.message}` };
  }
};
