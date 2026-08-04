const cloud = require('@cloudbase/node-sdk');
const rentCoverage = require('./rent-coverage');
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
  return rentCoverage.parseDateInput(value) || new Date();
}

function addMonths(date, months) {
  return rentCoverage.addMonths(date, months);
}

function addDays(date, days) {
  return rentCoverage.addDays(date, days);
}

function billingMonths(cycle) {
  return rentCoverage.billingMonths(cycle);
}

async function advanceLeaseRentDates(transaction, bill, now) {
  if (bill.type !== 'rent') return;
  const leaseRes = await transaction.collection('lease_agreements').where({ _id: bill.leaseId }).get();
  const lease = leaseRes.data && leaseRes.data[0];
  if (!lease) return;
  const rentBillRes = await transaction.collection('bills').where({ leaseId: bill.leaseId, type: 'rent' }).get();
  const rentBills = (rentBillRes.data || []).map(item => item._id === bill._id ? bill : item);
  const coverage = rentCoverage.recalculateContinuousRentCoverage(lease, rentBills);

  await transaction.collection('lease_agreements').where({ _id: bill.leaseId }).update({
    rentCoveredUntil: coverage.rentCoveredUntil,
    nextRentDueDate: coverage.nextRentDueDate,
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

    const newPaidAmount = Math.round((Number(bill.paidAmount || 0) + Number(amount)) * 100) / 100;
    if (newPaidAmount > Number(bill.amount || 0)) {
      await transaction.rollback();
      return { code: 400, message: `超额缴费，缴费金额超出应缴金额，最多可缴 ${Number(bill.amount || 0) - Number(bill.paidAmount || 0)} 元` };
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
    const updatedBill = {
      ...bill,
      paidAmount: newPaidAmount,
      status: newStatus,
      paidAt: newStatus === 'paid' ? now : bill.paidAt,
      updatedAt: now
    };
    await transaction.collection('bills').where({ _id: billId }).update({
      paidAmount: newPaidAmount,
      status: newStatus,
      paidAt: newStatus === 'paid' ? now : bill.paidAt,
      updatedAt: now
    });

    if (newStatus === 'paid') {
      await advanceLeaseRentDates(transaction, updatedBill, now);
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
