const cloud = require('@cloudbase/node-sdk');

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

function parseDateInput(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  if (value && value.$date) return new Date(value.$date);
  return value ? new Date(value) : new Date();
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

function formatPeriod(start, end) {
  if (start.getTime() === end.getTime()) return formatDateKey(start);
  return `${formatDateKey(start)}~${formatDateKey(end)}`;
}

function buildMeta(event, lease) {
  const meta = {};
  if (event.test !== undefined) meta.test = event.test;
  if (event.testRunId) meta.testRunId = event.testRunId;
  if (event.createdBy) meta.createdBy = event.createdBy;
  if (lease && lease._openid) meta._openid = lease._openid;
  return meta;
}

exports.main = async (event = {}) => {
  const { leaseId, amount, coverageMonths, coverageDays } = event;
  if (!leaseId) return { code: 400, message: '缺少必要参数：leaseId' };

  const transaction = await db.startTransaction();
  try {
    const leaseRes = await transaction.collection('lease_agreements').where({ _id: leaseId }).get();
    const lease = leaseRes.data && leaseRes.data[0];
    if (!lease) {
      await transaction.rollback();
      return { code: 404, message: '合同不存在' };
    }
    if (lease.status !== 'active') {
      await transaction.rollback();
      return { code: 400, message: '只有生效中的合同可以提前收租' };
    }

    const monthlyRent = Number(lease.rent || 0);
    if (monthlyRent <= 0) {
      await transaction.rollback();
      return { code: 400, message: '合同月租金无效' };
    }

    const coverageStart = lease.nextRentDueDate
      ? parseDateInput(lease.nextRentDueDate)
      : addDays(parseDateInput(lease.rentCoveredUntil), 1);
    const months = Number(coverageMonths || 0);
    let days = Number(coverageDays || 0);
    let finalAmount = Number(amount || 0);
    let coverageEnd;

    if (months > 0) {
      coverageEnd = addDays(addMonths(coverageStart, months), -1);
      if (finalAmount <= 0) finalAmount = Math.round(monthlyRent * months * 100) / 100;
      days = 0;
    } else {
      if (days <= 0) {
        days = finalAmount > 0 ? Math.max(1, Math.round(finalAmount / monthlyRent * 30)) : 30;
      }
      coverageEnd = addDays(coverageStart, days - 1);
      if (finalAmount <= 0) finalAmount = Math.round(monthlyRent / 30 * days * 100) / 100;
    }

    if (finalAmount <= 0) {
      await transaction.rollback();
      return { code: 400, message: '请填写有效的预收租金金额' };
    }

    const period = formatPeriod(coverageStart, coverageEnd);
    const existingRes = await transaction.collection('bills')
      .where({ leaseId, type: 'rent', period })
      .get();
    if (existingRes.data && existingRes.data.length > 0) {
      await transaction.commit();
      return {
        code: 200,
        message: '该预收租金账单已存在',
        data: { bill: existingRes.data[0], created: false }
      };
    }

    const now = new Date();
    const billData = {
      ...buildMeta(event, lease),
      leaseId,
      houseId: lease.houseId,
      tenantId: lease.tenantId,
      type: 'rent',
      period,
      amount: finalAmount,
      paidAmount: 0,
      status: 'unpaid',
      dueDate: coverageStart,
      rentCoverageStart: coverageStart,
      rentCoverageEnd: coverageEnd,
      coverageMonths: months,
      coverageDays: days,
      remark: '提前收租',
      createdAt: now,
      updatedAt: now
    };
    const billRes = await transaction.collection('bills').add(billData);
    await transaction.commit();
    return {
      code: 200,
      message: '提前收租账单已生成',
      data: {
        bill: { ...billData, _id: billRes.id || billRes._id },
        created: true
      }
    };
  } catch (error) {
    await transaction.rollback();
    return { code: 500, message: '生成提前收租账单失败：' + error.message };
  }
};
