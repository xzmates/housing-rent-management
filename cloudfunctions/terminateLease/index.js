const cloud = require('@cloudbase/node-sdk');

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

function parseDateInput(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  return value ? new Date(value) : new Date();
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function monthEnd(year, month) {
  return new Date(year, month, 0);
}

function parseRentPeriodEnd(period) {
  if (typeof period !== 'string') return null;
  const matches = period.match(/\d{4}-\d{2}/g);
  if (!matches || matches.length === 0) return null;
  const last = matches[matches.length - 1];
  const [year, month] = last.split('-').map(Number);
  return monthEnd(year, month);
}

function formatMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function getBillingMonths(cycle) {
  return { month: 1, quarter: 3, half_year: 6, year: 12 }[cycle] || 1;
}

function formatRentPeriod(start, months) {
  const end = addDays(new Date(start.getFullYear(), start.getMonth() + months, start.getDate()), -1);
  return `${formatDate(start)}~${formatDate(end)}`;
}

function ceilMonthsInclusive(start, end) {
  if (!start || !end || end < start) return 0;
  const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1;
  return Math.max(0, months);
}

function calcOccupiedMonths(startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate) return 0;
  const months = (endDate.getFullYear() - startDate.getFullYear()) * 12
                 + endDate.getMonth() - startDate.getMonth();
  if (endDate.getDate() >= startDate.getDate()) {
    return months + 1;
  }
  return months;
}

function calcOccupiedBillingMonths(startDate, endDate, paymentCycle) {
  const occupiedMonths = calcOccupiedMonths(startDate, endDate);
  const cycleMonths = getBillingMonths(paymentCycle);
  if (occupiedMonths <= 0) return 0;
  return Math.ceil(occupiedMonths / cycleMonths) * cycleMonths;
}

function billRemaining(bill) {
  return Math.max(0, Number(bill.amount || 0) - Number(bill.paidAmount || 0));
}

function sortSettlementBills(a, b) {
  const typeOrder = { rent: 0, utility: 1, extra_due: 2, other: 3 };
  const typeDiff = (typeOrder[a.type] ?? 9) - (typeOrder[b.type] ?? 9);
  if (typeDiff !== 0) return typeDiff;
  return new Date(a.dueDate || a.createdAt || 0).getTime() - new Date(b.dueDate || b.createdAt || 0).getTime();
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

async function getSystemSettings(transaction) {
  const res = await transaction.collection('system_settings').where({ _id: 'global' }).get();
  return res.data && res.data.length > 0 ? res.data[0] : { electricityPrice: 0.8, waterPrice: 3.5 };
}

function buildMeta(event, lease) {
  const meta = {};
  if (event.test !== undefined) meta.test = event.test;
  if (event.testRunId) meta.testRunId = event.testRunId;
  if (event.createdBy) meta.createdBy = event.createdBy;
  if (lease._openid) meta._openid = lease._openid;
  return meta;
}

exports.main = async (event = {}) => {
  const {
    leaseId,
    endDate,
    damageDeduction = 0,
    refundDepositValue,
    damageAmount: inputDamageAmount,
    electricityReading,
    waterReading,
    remark = ''
  } = event;
  if (!leaseId) return { code: 400, message: '缺少必要参数：leaseId' };

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
      return { code: 400, message: '合同状态不正确' };
    }

    const now = new Date();
    const actualEndDate = parseDateInput(endDate);
    const meta = buildMeta(event, lease);
    const relation = {
      ...meta,
      leaseId,
      houseId: lease.houseId,
      tenantId: lease.tenantId
    };

    const allBillsRes = await transaction.collection('bills').where({ leaseId }).get();
    const allBills = allBillsRes.data || [];
    const rentPeriods = allBills
      .filter(b => b.type === 'rent')
      .map(b => parseRentPeriodEnd(b.period))
      .filter(Boolean);
    const latestRentBilledUntil = rentPeriods.length > 0
      ? new Date(Math.max(...rentPeriods.map(d => d.getTime())))
      : parseDateInput(lease.rentCoveredUntil);
    const supplementalRentStart = addDays(latestRentBilledUntil, 1);
    const supplementalRentMonths = ceilMonthsInclusive(supplementalRentStart, actualEndDate);
    const supplementalRent = Math.round(supplementalRentMonths * Number(lease.rent || 0) * 100) / 100;
    const settlementBills = allBills
      .filter(b => ['unpaid', 'partial'].includes(b.status) && billRemaining(b) > 0)
      .sort(sortSettlementBills);

    let supplementalRentBillId = null;
    if (supplementalRent > 0) {
      const supplementalRentRes = await transaction.collection('bills').add({
        ...relation,
        type: 'rent',
        period: formatRentPeriod(supplementalRentStart, supplementalRentMonths),
        amount: supplementalRent,
        paidAmount: 0,
        status: 'unpaid',
        dueDate: supplementalRentStart,
        remark: `退租补租，覆盖${formatDate(supplementalRentStart)}至${formatDate(actualEndDate)}`,
        createdAt: now,
        updatedAt: now
      });
      supplementalRentBillId = supplementalRentRes.id || supplementalRentRes._id;
      settlementBills.push({
        _id: supplementalRentBillId,
        type: 'rent',
        amount: supplementalRent,
        paidAmount: 0,
        status: 'unpaid',
        dueDate: supplementalRentStart
      });
    }

    let utilityCost = 0;
    let utilityRecordId = null;
    let utilityBillId = null;
    if (electricityReading !== undefined || waterReading !== undefined) {
      if (electricityReading === undefined || waterReading === undefined) {
        await transaction.rollback();
        return { code: 400, message: '退租抄表需同时提供 electricityReading 和 waterReading' };
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
        return { code: 400, message: '退租抄表读数不能小于上次读数' };
      }

      const settings = await getSystemSettings(transaction);
      const electricityCost = Math.round(electricityUsage * Number(settings.electricityPrice || 0.8) * 100) / 100;
      const waterCost = Math.round(waterUsage * Number(settings.waterPrice || 3.5) * 100) / 100;
      utilityCost = Math.round((electricityCost + waterCost) * 100) / 100;

      const utilityRecordRes = await transaction.collection('utility_records').add({
        ...relation,
        electricityReading,
        waterReading,
        electricityUsage,
        waterUsage,
        electricityCost,
        waterCost,
        totalCost: utilityCost,
        calculationDate: actualEndDate,
        recordType: 'move_out',
        remark: remark || '退租抄表',
        createdAt: now
      });
      utilityRecordId = utilityRecordRes.id;

      if (utilityCost > 0) {
        const utilityBillRes = await transaction.collection('bills').add({
          ...relation,
          type: 'utility',
          period: formatDate(actualEndDate),
          amount: utilityCost,
          paidAmount: 0,
          status: 'unpaid',
          dueDate: actualEndDate,
          utilityRecordId,
          remark: `退租水电：电费${electricityCost}元，水费${waterCost}元`,
          createdAt: now,
          updatedAt: now
        });
        utilityBillId = utilityBillRes.id || utilityBillRes._id;
        settlementBills.push({
          _id: utilityBillId,
          type: 'utility',
          amount: utilityCost,
          paidAmount: 0,
          status: 'unpaid',
          dueDate: actualEndDate
        });
      }
    }

    // 计算租金退还
    const paidRentBills = allBills.filter(b => b.type === 'rent' && ['paid', 'partial'].includes(b.status));
    const totalPaidRent = Math.round(paidRentBills.reduce((sum, b) => sum + Number(b.paidAmount || 0), 0) * 100) / 100;
    const paidRentDetails = paidRentBills.map(b => ({
      period: b.period,
      amount: Number(b.paidAmount || 0),
      coverageStart: b.rentCoverageStart ? formatDate(parseDateInput(b.rentCoverageStart)) : '',
      coverageEnd: b.rentCoverageEnd ? formatDate(parseDateInput(b.rentCoverageEnd)) : ''
    }));
    const leaseStartDate = parseDateInput(lease.startDate);
    const actualOccupiedMonths = calcOccupiedBillingMonths(leaseStartDate, actualEndDate, lease.paymentCycle);
    const billingCycleMonths = getBillingMonths(lease.paymentCycle);
    const actualRentDue = Math.round(actualOccupiedMonths * Number(lease.rent || 0) * 100) / 100;
    const overpaidRent = Math.max(0, totalPaidRent - actualRentDue);
    let rentRefundBillId = null;

    if (overpaidRent > 0) {
      const rentRefundRes = await transaction.collection('bills').add({
        ...relation,
        type: 'rent_refund',
        period: formatDate(actualEndDate),
        amount: overpaidRent,
        paidAmount: overpaidRent,
        status: 'paid',
        dueDate: actualEndDate,
        paidAt: now,
        remark: `退租多收租金退还：实际入住${actualOccupiedMonths}个月应付${actualRentDue}元，已付${totalPaidRent}元，退还${overpaidRent}元`,
        rentRefundDetail: {
          occupiedPeriod: `${formatDate(leaseStartDate)} 至 ${formatDate(actualEndDate)}`,
          occupiedMonths: actualOccupiedMonths,
          billingCycleMonths,
          actualRentDue,
          paidRentDetails,
          totalPaidRent,
          overpaidRent
        },
        createdAt: now,
        updatedAt: now
      });
      rentRefundBillId = rentRefundRes.id || rentRefundRes._id;
      await transaction.collection('payments').add({
        ...relation,
        billId: rentRefundBillId,
        amount: overpaidRent,
        direction: 'out',
        paymentDate: actualEndDate,
        paymentMethod: 'refund_offset',
        remark: '退租多收租金退款流水',
        createdAt: now
      });
    }

    const deposit = Number(lease.deposit || 0);
    const damageAmount = inputDamageAmount !== undefined
      ? Number(inputDamageAmount)
      : (refundDepositValue !== undefined ? deposit - Number(refundDepositValue) : Number(damageDeduction || 0));
    const actualRefundDeposit = deposit - damageAmount;
    const originalUnsettledAmount = Math.round(settlementBills.reduce((sum, bill) => sum + billRemaining(bill), 0) * 100) / 100;
    let depositBalance = Math.max(0, actualRefundDeposit);
    let depositOffsetAmount = 0;
    const offsetDetails = [];

    for (const bill of settlementBills.sort(sortSettlementBills)) {
      const remaining = billRemaining(bill);
      if (remaining <= 0 || depositBalance <= 0) continue;
      const offsetAmount = Math.round(Math.min(remaining, depositBalance) * 100) / 100;
      const newPaidAmount = Math.round((Number(bill.paidAmount || 0) + offsetAmount) * 100) / 100;
      const newStatus = newPaidAmount >= Number(bill.amount || 0) ? 'paid' : 'partial';
      await transaction.collection('payments').add({
        ...relation,
        billId: bill._id,
        amount: offsetAmount,
        direction: 'in',
        paymentDate: actualEndDate,
        paymentMethod: 'deposit_offset',
        remark: '退租押金自动抵扣',
        createdAt: now
      });
      await transaction.collection('bills').doc(bill._id).update({
        paidAmount: newPaidAmount,
        status: newStatus,
        updatedAt: now
      });
      bill.paidAmount = newPaidAmount;
      bill.status = newStatus;
      depositBalance = Math.round((depositBalance - offsetAmount) * 100) / 100;
      depositOffsetAmount = Math.round((depositOffsetAmount + offsetAmount) * 100) / 100;
      offsetDetails.push({ billId: bill._id, type: bill.type, amount: offsetAmount });
    }

    const remainingDueAfterDeposit = Math.round(Math.max(0, originalUnsettledAmount - depositOffsetAmount) * 100) / 100;
    const damageExtraDue = actualRefundDeposit < 0 ? Math.abs(actualRefundDeposit) : 0;
    const refundAmount = Math.round(depositBalance * 100) / 100;
    const extraPayment = Math.round((remainingDueAfterDeposit + damageExtraDue) * 100) / 100;
    let cashSettlementAmount = 0;
    const cashSettlementDetails = [];

    for (const bill of settlementBills.sort(sortSettlementBills)) {
      const remaining = billRemaining(bill);
      if (remaining <= 0) continue;
      await transaction.collection('payments').add({
        ...relation,
        billId: bill._id,
        amount: remaining,
        direction: 'in',
        paymentDate: actualEndDate,
        paymentMethod: 'settlement_payment',
        remark: '退租结算收款',
        createdAt: now
      });
      await transaction.collection('bills').doc(bill._id).update({
        paidAmount: Number(bill.amount || 0),
        status: 'paid',
        paidAt: now,
        updatedAt: now
      });
      bill.paidAmount = Number(bill.amount || 0);
      bill.status = 'paid';
      cashSettlementAmount = Math.round((cashSettlementAmount + remaining) * 100) / 100;
      cashSettlementDetails.push({ billId: bill._id, type: bill.type, amount: remaining });
    }

    const totalRefund = Math.round((refundAmount + overpaidRent - extraPayment) * 100) / 100;

    await transaction.collection('lease_agreements').where({ _id: leaseId }).update({
      status: 'terminated',
      endDate: actualEndDate,
      endedAt: now,
      refundDepositValue: actualRefundDeposit,
      damageAmount,
      depositOffsetAmount,
      extraPayment,
      cashSettlementAmount,
      supplementalRent,
      utilityCost,
      overpaidRent,
      totalRefund,
      settlementAmount: 0,
      remark: remark || lease.remark,
      updatedAt: now
    });
    await transaction.collection('houses').where({ _id: lease.houseId }).update({ status: 'available', updatedAt: now });
    await transaction.collection('tenants').where({ _id: lease.tenantId }).update({ status: 'inactive', updatedAt: now });

    let settlementBillId = null;
    if (refundAmount > 0) {
      const refundRes = await transaction.collection('bills').add({
        ...relation,
        type: 'deposit_return',
        period: formatDate(actualEndDate),
        amount: refundAmount,
        paidAmount: refundAmount,
        status: 'paid',
        dueDate: actualEndDate,
        paidAt: now,
        remark: `退租押金退还：押金${deposit}元，抵扣${depositOffsetAmount}元，实际退还${refundAmount}元`,
        createdAt: now,
        updatedAt: now
      });
      settlementBillId = refundRes.id;
      await transaction.collection('payments').add({
        ...relation,
        billId: settlementBillId,
        amount: refundAmount,
        direction: 'out',
        paymentDate: actualEndDate,
        paymentMethod: 'refund',
        remark: '押金退还',
        createdAt: now
      });
    }

    if (damageExtraDue > 0) {
      const extraRes = await transaction.collection('bills').add({
        ...relation,
        type: 'extra_due',
        period: formatDate(actualEndDate),
        amount: damageExtraDue,
        paidAmount: damageExtraDue,
        status: 'paid',
        dueDate: actualEndDate,
        paidAt: now,
        remark: `退租结算需补缴：额外赔偿${damageExtraDue}元`,
        createdAt: now,
        updatedAt: now,
        utilityRecordId
      });
      settlementBillId = extraRes.id;
      await transaction.collection('payments').add({
        ...relation,
        billId: settlementBillId,
        amount: damageExtraDue,
        direction: 'in',
        paymentDate: actualEndDate,
        paymentMethod: 'settlement_payment',
        remark: '退租额外赔偿收款',
        createdAt: now
      });
      cashSettlementAmount = Math.round((cashSettlementAmount + damageExtraDue) * 100) / 100;
      cashSettlementDetails.push({ billId: settlementBillId, type: 'extra_due', amount: damageExtraDue });
    }

    await transaction.commit();
    return {
      code: 200,
      message: '退租结算成功',
      data: {
        leaseId,
        houseId: lease.houseId,
        tenantId: lease.tenantId,
        endDate: actualEndDate,
        unsettledBills: 0,
        unsettledAmount: 0,
        deposit,
        refundDepositValue: actualRefundDeposit,
        damageAmount,
        originalUnsettledAmount,
        depositOffsetAmount,
        remainingDueAfterDeposit,
        cashSettlementAmount,
        supplementalRent,
        supplementalRentMonths,
        supplementalRentBillId,
        utilityCost,
        settlementAmount: Math.round((refundAmount - extraPayment) * 100) / 100,
        refundAmount,
        extraPayment,
        settlementBillId,
        utilityRecordId,
        utilityBillId,
        offsetDetails,
        cashSettlementDetails,
        rentRefund: {
          occupiedPeriod: `${formatDate(leaseStartDate)} 至 ${formatDate(actualEndDate)}`,
          occupiedMonths: actualOccupiedMonths,
          billingCycleMonths,
          actualRentDue,
          paidRentDetails,
          totalPaidRent,
          overpaidRent,
          rentRefundBillId
        },
        totalRefund
      }
    };
  } catch (error) {
    await transaction.rollback();
    return { code: 500, message: '退租结算失败：' + error.message };
  }
};
