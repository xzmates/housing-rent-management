const cloud = require('@cloudbase/node-sdk');
const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

function buildMeta(event, bill) {
  const meta = {};
  if (event.test !== undefined) meta.test = event.test;
  if (event.testRunId) meta.testRunId = event.testRunId;
  if (event.createdBy) meta.createdBy = event.createdBy;
  if (bill && bill._openid) meta._openid = bill._openid;
  return meta;
}

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

function billingMonths(cycle) {
  return { month: 1, quarter: 3, half_year: 6, year: 12 }[cycle] || 1;
}

async function advanceLeaseRentDates(transaction, bill, now) {
  if (bill.type !== 'rent') return;
  const leaseRes = await transaction.collection('lease_agreements').where({ _id: bill.leaseId }).get();
  const lease = leaseRes.data && leaseRes.data[0];
  if (!lease) return;

  const months = billingMonths(lease.paymentCycle);
  const dueDate = parseDateInput(bill.dueDate);
  const coveredUntil = bill.rentCoverageEnd
    ? parseDateInput(bill.rentCoverageEnd)
    : addDays(addMonths(dueDate, months), -1);
  const nextRentDueDate = addDays(coveredUntil, 1);
  const oldCoveredUntil = lease.rentCoveredUntil ? parseDateInput(lease.rentCoveredUntil) : null;
  if (oldCoveredUntil && oldCoveredUntil.getTime() > coveredUntil.getTime()) return;

  await transaction.collection('lease_agreements').where({ _id: bill.leaseId }).update({
    rentCoveredUntil: coveredUntil,
    nextRentDueDate,
    updatedAt: now
  });
}

exports.main = async (event) => {
  const { billId, amount, paymentDate, paymentMethod = 'cash', remark = '' } = event;
  if (!billId || !amount || amount <= 0) return { code: 400, message: '缺少必要参数' };

  const transaction = await db.startTransaction();
  try {
    const billRes = await transaction.collection('bills').where({ _id: billId }).get();
    if (!billRes.data || billRes.data.length === 0) {
      await transaction.rollback();
      return { code: 404, message: '账单不存在' };
    }
    const bill = billRes.data[0];
    if (bill.status === 'paid') {
      await transaction.rollback();
      return { code: 400, message: '该账单已全额支付' };
    }

    const newPaidAmount = Number(bill.paidAmount || 0) + Number(amount);
    if (newPaidAmount > Number(bill.amount || 0)) {
      await transaction.rollback();
      return { code: 400, message: `缴费金额超出应缴金额，最多可缴 ${Number(bill.amount || 0) - Number(bill.paidAmount || 0)} 元` };
    }

    const now = new Date();
    const meta = buildMeta(event, bill);
    await transaction.collection('payments').add({
      ...meta,
      billId,
      leaseId: bill.leaseId,
      houseId: bill.houseId,
      tenantId: bill.tenantId,
      amount: Number(amount),
      direction: 'in',
      paymentDate: paymentDate ? new Date(paymentDate) : now,
      paymentMethod,
      remark,
      createdAt: now
    });

    const newStatus = newPaidAmount >= Number(bill.amount || 0) ? 'paid' : 'partial';
    await transaction.collection('bills').where({ _id: billId }).update({
      paidAmount: newPaidAmount,
      status: newStatus,
      paidAt: newStatus === 'paid' ? now : bill.paidAt,
      updatedAt: now
    });

    if (newStatus === 'paid') {
      await advanceLeaseRentDates(transaction, bill, now);
    }

    await transaction.commit();
    return {
      code: 200,
      message: '缴费成功',
      data: {
        billId,
        paidAmount: newPaidAmount,
        totalAmount: bill.amount,
        status: newStatus,
        remaining: Number(bill.amount || 0) - newPaidAmount
      }
    };
  } catch (error) {
    await transaction.rollback();
    return { code: 500, message: '缴费失败：' + error.message };
  }
};
