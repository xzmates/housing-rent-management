const cloud = require('@cloudbase/node-sdk');
const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

function generateLeaseId() {
  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0');
  const random = Math.floor(Math.random() * 900 + 100);
  return `LA_${dateStr}_${random}`;
}

function getBillingMonths(cycle) {
  const cycleMap = { 'month': 1, 'quarter': 3, 'half_year': 6, 'year': 12 };
  return cycleMap[cycle] || 1;
}

function parseDateInput(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return new Date(value);
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
  if (months === 1) return formatMonthKey(start);
  return `${formatMonthKey(start)}~${formatMonthKey(end)}`;
}

function buildMeta(event, source = {}) {
  const meta = {};
  if (event.test !== undefined) meta.test = event.test;
  if (event.testRunId) meta.testRunId = event.testRunId;
  if (event.createdBy) meta.createdBy = event.createdBy;
  if (source._openid) meta._openid = source._openid;
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

function generateInitialBills({ leaseId, houseId, tenantId, startDate, rent, deposit, paymentCycle, now, meta }) {
  const bills = [];
  const months = getBillingMonths(paymentCycle);
  const start = parseDateInput(startDate);
  const firstRentAmount = rent * months;
  const firstRentDueDate = start;
  const rentCoveredUntil = addDays(addMonths(start, months), -1);
  const nextRentDueDate = addMonths(start, months);

  bills.push({
    ...meta,
    leaseId, houseId, tenantId, type: 'rent',
    period: formatRentPeriod(start, months),
    amount: firstRentAmount, paidAmount: firstRentAmount, status: 'paid',
    dueDate: firstRentDueDate, paidAt: now,
    remark: `首期${months}个月租金，覆盖至${formatDateKey(rentCoveredUntil)}`,
    createdAt: now, updatedAt: now
  });

  bills.push({
    ...meta,
    leaseId, houseId, tenantId, type: 'deposit',
    period: formatDateKey(start),
    amount: deposit, paidAmount: deposit, status: 'paid',
    dueDate: start, paidAt: now,
    remark: '入住押金',
    createdAt: now, updatedAt: now
  });

  let dueDate = nextRentDueDate;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  while (dueDate <= today) {
    const periodStart = dueDate;
    const periodEnd = addDays(addMonths(periodStart, months), -1);
    bills.push({
      ...meta,
      leaseId, houseId, tenantId, type: 'rent',
      period: formatRentPeriod(periodStart, months),
      amount: firstRentAmount, paidAmount: 0, status: 'unpaid',
      dueDate: periodStart,
      remark: `逾期租金，覆盖${formatDateKey(periodStart)}至${formatDateKey(periodEnd)}`,
      createdAt: now, updatedAt: now
    });
    dueDate = addMonths(dueDate, months);
  }

  return { bills, rentCoveredUntil, nextRentDueDate };
}

exports.main = async (event, context) => {
  const {
    houseId,
    tenantId,
    startDate,
    rent,
    deposit,
    paymentCycle = 'month',
    moveInElectricity = 0,
    moveInWater = 0,
    meterReplaced = false,
    remark = ''
  } = event;
  if (!houseId || !tenantId || !startDate || !rent) {
    return { code: 400, message: '缺少必要参数：houseId, tenantId, startDate, rent' };
  }

  const transaction = await db.startTransaction();
  try {
    const houseRes = await transaction.collection('houses').where({ _id: houseId }).get();
    if (!houseRes.data || houseRes.data.length === 0) {
      await transaction.rollback();
      return { code: 404, message: '房屋不存在' };
    }
    if (houseRes.data[0].status === 'maintenance') {
      await transaction.rollback();
      return { code: 400, message: `房屋当前状态为 ${houseRes.data[0].status}，无法创建租赁合同` };
    }

    const existingLease = await transaction.collection('lease_agreements').where({ houseId, status: 'active' }).get();
    if (existingLease.data && existingLease.data.length > 0) {
      await transaction.rollback();
      return { code: 400, message: '该房屋已有生效中的租赁合同' };
    }

    const tenantRes = await transaction.collection('tenants').where({ _id: tenantId }).get();
    if (!tenantRes.data || tenantRes.data.length === 0) {
      await transaction.rollback();
      return { code: 404, message: '租客不存在' };
    }

    const tenantActiveLease = await transaction.collection('lease_agreements').where({ tenantId, status: 'active' }).get();
    if (tenantActiveLease.data && tenantActiveLease.data.length > 0) {
      await transaction.rollback();
      return { code: 400, message: '该租客已有生效中的租赁合同' };
    }

    const currentElectricity = Number(moveInElectricity) || 0;
    const currentWater = Number(moveInWater) || 0;
    const lastRecordRes = await transaction
      .collection('utility_records')
      .where({ houseId })
      .orderBy('calculationDate', 'desc')
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    const validRecords = await filterExistingLeaseRecords(transaction, houseId, lastRecordRes.data || []);
    const lastRecord = latestUtilityRecord(validRecords);
    if (lastRecord && !meterReplaced) {
      const lastElectricity = Number(lastRecord.electricityReading || 0);
      const lastWater = Number(lastRecord.waterReading || 0);
      if (currentElectricity < lastElectricity || currentWater < lastWater) {
        await transaction.rollback();
        return {
          code: 400,
          message: `入住水电读数不能低于房屋上次读数：电表${lastElectricity}，水表${lastWater}；如已换表，请勾选“已更换水电表”`
        };
      }
    }

    const leaseId = generateLeaseId();
    const now = new Date();
    const finalDeposit = deposit === undefined || deposit === null || deposit === '' ? rent : deposit;
    const meta = buildMeta(event, houseRes.data[0]);
    const initialBilling = generateInitialBills({
      leaseId,
      houseId,
      tenantId,
      startDate,
      rent,
      deposit: finalDeposit,
      paymentCycle,
      now,
      meta
    });
    const leaseData = {
      ...meta,
      _id: leaseId,
      houseId,
      tenantId,
      startDate: parseDateInput(startDate),
      endDate: null,
      rent,
      deposit: finalDeposit,
      paymentCycle,
      moveInElectricity: currentElectricity,
      moveInWater: currentWater,
      meterReplaced: !!meterReplaced,
      status: 'active',
      rentCoveredUntil: initialBilling.rentCoveredUntil,
      nextRentDueDate: initialBilling.nextRentDueDate,
      endedAt: null,
      remark,
      createdAt: now,
      updatedAt: now
    };
    await transaction.collection('lease_agreements').add(leaseData);
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
      calculationDate: parseDateInput(startDate),
      recordType: 'move_in_baseline',
      meterReplaced: !!meterReplaced,
      remark: meterReplaced ? '换表后入住基准读数' : '入住基准读数',
      createdAt: now
    });
    await transaction.collection('houses').where({ _id: houseId }).update({ status: 'rented', updatedAt: now });
    await transaction.collection('tenants').where({ _id: tenantId }).update({ status: 'active', updatedAt: now });

    let paymentsCreated = 0;
    for (const bill of initialBilling.bills) {
      const billRes = await transaction.collection('bills').add(bill);
      const billId = billRes.id || billRes._id;
      if (bill.status === 'paid') {
        await transaction.collection('payments').add({
          ...meta,
          billId,
          leaseId,
          houseId,
          tenantId,
          amount: bill.paidAmount,
          direction: 'in',
          paymentDate: now,
          paymentMethod: 'cash',
          remark: bill.type === 'deposit' ? '合同创建自动收取押金' : '合同创建自动收取首期租金',
          createdAt: now
        });
        paymentsCreated++;
      }
    }

    await transaction.commit();
    return {
      code: 200,
      message: '租赁合同创建成功',
      data: {
        leaseId,
        billsCreated: initialBilling.bills.length,
        paymentsCreated,
        rentCoveredUntil: initialBilling.rentCoveredUntil,
        nextRentDueDate: initialBilling.nextRentDueDate
      }
    };
  } catch (error) {
    await transaction.rollback();
    return { code: 500, message: '创建租赁合同失败：' + error.message };
  }
};
