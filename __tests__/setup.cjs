/**
 * WeChat Mini Program / CloudBase mock for vitest (V2 - 新数据模型)
 * 支持 wx.cloud.database() 直接查询 + wx.cloud.callFunction() 云函数调用
 */
const store = new Map();
const rentCoverage = require('../cloudfunctions/rentalDomain/domain/rent-coverage');
let mockClock = 0;
const FIXED_TEST_NOW = new Date('2026-06-24T08:00:00+08:00').getTime();
const DEFAULT_OPENID = 'test-openid';
const OWNED_COLLECTIONS = new Set([
  'houses',
  'tenants',
  'lease_agreements',
  'bills',
  'payments',
  'utility_records',
  'operation_confirmations',
  'operation_logs',
  'admins',
  'system_settings'
]);

function nextDate() {
  mockClock += 1;
  return new Date(FIXED_TEST_NOW + mockClock);
}

function withDefaultOwner(name, item) {
  if (!item || typeof item !== 'object' || !OWNED_COLLECTIONS.has(name)) return item;
  if (Object.prototype.hasOwnProperty.call(item, '_openid')) return item;
  return { _openid: DEFAULT_OPENID, ...item };
}

function createCollectionArray(name, initial = []) {
  const arr = [];
  Object.defineProperty(arr, '__mockCollectionName', { value: name, enumerable: false });
  const rawPush = Array.prototype.push;
  Object.defineProperty(arr, 'push', {
    value(...items) {
      return rawPush.apply(this, items.map(item => withDefaultOwner(name, item)));
    },
    enumerable: false
  });
  if (initial.length) arr.push(...initial);
  return arr;
}

function getCollectionData(name) {
  const existing = store.get(name);
  if (!existing || existing.__mockCollectionName !== name) {
    store.set(name, createCollectionArray(name, existing || []));
  }
  return store.get(name);
}

function copyObj(obj) {
  if (!obj) return obj;
  return JSON.parse(JSON.stringify(obj, (k, v) => {
    if (typeof v === 'object' && v !== null && v.serverDate) return new Date();
    if (k === 'serverDate' && typeof v === 'function') return undefined;
    return v;
  }));
}

// 云函数调用模拟器
const cloudFunctionHandlers = {};

function registerCloudFunction(name, handler) {
  cloudFunctionHandlers[name] = handler;
}

function clearAllData() {
  store.clear();
  mockClock = 0;
}

const mockCommand = {
  gte(val) { return { gte: val }; },
  lte(val) { return { lte: val }; },
  and(arr) { return { and: arr }; },
  in(arr) { return { in: arr }; },
  set(val) { return { _set: val }; },
  inc(val) { return { _inc: val }; }
};

const collectionAPI = (name) => {
  let _filtered = null;
  let _limit = 20;
  let _skip = 0;

  const dataSource = () => (_filtered !== null ? _filtered : getCollectionData(name));

  return {
    doc(id) {
      return {
        get() {
          const col = getCollectionData(name);
          const item = col.find(d => d._id === id) || null;
          return Promise.resolve({ data: copyObj(item), errMsg: 'document.get:ok' });
        },
        update(patch) {
          const data = patch && Object.prototype.hasOwnProperty.call(patch, 'data') ? patch.data : patch;
          const col = getCollectionData(name);
          const item = col.find(d => d._id === id);
          if (item) {
            for (const [key, val] of Object.entries(data)) {
              if (val && typeof val === 'object' && val._inc !== undefined) {
                item[key] = (item[key] || 0) + val._inc;
              } else if (val && typeof val === 'object' && val._set !== undefined) {
                item[key] = val._set;
              } else {
                item[key] = val;
              }
            }
          }
          return Promise.resolve({ stats: { updated: item ? 1 : 0 }, errMsg: 'document.update:ok' });
        },
        remove() {
          const col = getCollectionData(name);
          store.set(name, col.filter(d => d._id !== id));
          return Promise.resolve({ stats: { removed: 1 }, errMsg: 'document.remove:ok' });
        }
      };
    },

    add(payload) {
      const data = payload && Object.prototype.hasOwnProperty.call(payload, 'data') ? payload.data : payload;
      const col = getCollectionData(name);
      const doc = Object.assign({ _id: 'id_' + name + '_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6) }, copyObj(data));
      col.push(doc);
      return Promise.resolve({ _id: doc._id, errMsg: 'collection.add:ok' });
    },

    where(conditions) {
      const col = getCollectionData(name);
      _filtered = col.filter(item => {
        return Object.entries(conditions).every(([key, val]) => {
          if (val && typeof val === 'object' && val.in) return val.in.includes(item[key]);
          if (val && typeof val === 'object' && val.gte !== undefined) return item[key] >= val.gte;
          if (val && typeof val === 'object' && val.lte !== undefined) return item[key] <= val.lte;
          if (val && typeof val === 'object' && val.and) {
            return val.and.every(c => {
              const k = Object.keys(c)[0];
              const v = Object.values(c)[0];
              if (typeof v === 'object' && v.gte !== undefined) return item[k] >= v.gte;
              if (typeof v === 'object' && v.lte !== undefined) return item[k] <= v.lte;
              return item[k] === v;
            });
          }
          if (val instanceof RegExp) return val.test(item[key]);
          return item[key] === val;
        });
      });
      return this;
    },

    orderBy(field, dir) {
      const source = dataSource();
      const dirNum = dir === 'desc' ? -1 : 1;
      source.sort((a, b) => {
        const va = a[field], vb = b[field];
        if (va === undefined || va === null) return 1;
        if (vb === undefined || vb === null) return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * dirNum;
      });
      return this;
    },

    skip(n) {
      _skip = n;
      return this;
    },

    limit(n) {
      _limit = n;
      return this;
    },

    get() {
      const source = dataSource();
      const slice = source.slice(_skip, _skip + _limit);
      return Promise.resolve({ data: copyObj(slice), errMsg: 'collection.get:ok' });
    },

    update(patch) {
      const data = patch && Object.prototype.hasOwnProperty.call(patch, 'data') ? patch.data : patch;
      const rows = dataSource();
      rows.forEach(item => {
        for (const [key, val] of Object.entries(data)) {
          if (val && typeof val === 'object' && val._inc !== undefined) {
            item[key] = (item[key] || 0) + val._inc;
          } else if (val && typeof val === 'object' && val._set !== undefined) {
            item[key] = val._set;
          } else {
            item[key] = val;
          }
        }
      });
      return Promise.resolve({ stats: { updated: rows.length }, errMsg: 'collection.update:ok' });
    },

    count() {
      const source = dataSource();
      return Promise.resolve({ total: source.length, errMsg: 'collection.count:ok' });
    }
  };
};

async function startMockTransaction() {
  return {
    collection(name) { return collectionAPI(name); },
    async commit() {},
    async rollback() {}
  };
}

// Mock wx global
global.wx = {
  cloud: {
    init() {},
    database() {
      return {
        collection(name) { return collectionAPI(name); },
        startTransaction: startMockTransaction,
        command: mockCommand,
        serverDate() { return nextDate(); },
        RegExp({ regexp, options }) {
          return new RegExp(regexp, options || 'i');
        }
      };
    },
    async callFunction({ name, data }) {
      const handler = cloudFunctionHandlers[name];
      if (!handler) {
        return Promise.resolve({ result: { code: -1, message: '未注册的云函数: ' + name } });
      }
      return { result: await handler(data) };
    }
  },
  showToast() {},
  showModal({ success }) { if (success) success({ confirm: true }); },
  showLoading() {},
  hideLoading() {},
  getStorageSync() { return []; },
  setStorageSync() {},
  removeStorageSync() {}
};

global.getApp = () => ({
  globalData: { envId: 'test-env' }
});

function parseDateInput(value) {
  return rentCoverage.parseDateInput(value) || new Date(value);
}

function addMonths(date, months) {
  return rentCoverage.addMonths(date, months);
}

function addDays(date, days) {
  return rentCoverage.addDays(date, days);
}

function formatDateKey(date) {
  return rentCoverage.formatDateKey(date);
}

function formatMonthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function billingMonths(cycle) {
  return rentCoverage.billingMonths(cycle);
}

function rentPeriod(start, months) {
  const end = addDays(addMonths(start, months), -1);
  return `${formatDateKey(start)}~${formatDateKey(end)}`;
}

function calcOccupiedMonths(startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate) return 0;
  const months = (endDate.getFullYear() - startDate.getFullYear()) * 12
               + endDate.getMonth() - startDate.getMonth();
  if (endDate.getDate() >= startDate.getDate()) return months + 1;
  return months;
}

function calcOccupiedBillingMonths(startDate, endDate, paymentCycle) {
  const occupiedMonths = calcOccupiedMonths(startDate, endDate);
  const cycleMonths = billingMonths(paymentCycle);
  if (occupiedMonths <= 0) return 0;
  return Math.ceil(occupiedMonths / cycleMonths) * cycleMonths;
}

function createInitialBills({ leaseId, houseId, tenantId, startDate, rent, deposit, paymentCycle, now, meta = {} }) {
  const months = billingMonths(paymentCycle);
  const start = parseDateInput(startDate);
  const cycleAmount = rent * months;
  const rentCoveredUntil = addDays(addMonths(start, months), -1);
  const nextRentDueDate = addMonths(start, months);
  const bills = [
    {
      ...meta,
      _id: 'bill_rent_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      leaseId, houseId, tenantId, type: 'rent',
      period: rentPeriod(start, months),
      amount: cycleAmount, paidAmount: cycleAmount, status: 'paid',
      dueDate: start, paidAt: now,
      rentCoverageStart: start,
      rentCoverageEnd: rentCoveredUntil,
      coverageMonths: months,
      coverageDays: 0,
      remark: `首期${months}个月租金，覆盖至${formatDateKey(rentCoveredUntil)}`,
      createdAt: now, updatedAt: now
    },
    {
      ...meta,
      _id: 'bill_deposit_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      leaseId, houseId, tenantId, type: 'deposit',
      period: formatDateKey(start),
      amount: deposit, paidAmount: deposit, status: 'paid',
      dueDate: start, paidAt: now,
      remark: '入住押金',
      createdAt: now, updatedAt: now
    }
  ];

  let dueDate = nextRentDueDate;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  while (dueDate <= today) {
    const periodStart = dueDate;
    const periodEnd = addDays(addMonths(periodStart, months), -1);
    bills.push({
      ...meta,
      _id: 'bill_overdue_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      leaseId, houseId, tenantId, type: 'rent',
      period: rentPeriod(periodStart, months),
      amount: cycleAmount, paidAmount: 0, status: 'unpaid',
      dueDate: periodStart,
      rentCoverageStart: periodStart,
      rentCoverageEnd: periodEnd,
      coverageMonths: months,
      coverageDays: 0,
      remark: `逾期租金，覆盖${formatDateKey(periodStart)}至${formatDateKey(periodEnd)}`,
      createdAt: now, updatedAt: now
    });
    dueDate = addMonths(dueDate, months);
  }

  return { bills, rentCoveredUntil, nextRentDueDate };
}

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

function filterExistingLeaseRecords(houseId, records) {
  const leaseIds = new Set(getCollectionData('lease_agreements')
    .filter(l => l.houseId === houseId)
    .map(l => l._id));
  return (records || []).filter(record => record.leaseId && leaseIds.has(record.leaseId));
}

// 注册默认云函数处理器
registerCloudFunction('createLeaseAgreement', ({ houseId, tenantId, startDate, rent, deposit, paymentCycle, moveInElectricity = 0, moveInWater = 0, meterReplaced = false, test, testRunId, createdBy }) => {
  const db = global.wx.cloud.database();
  const houses = getCollectionData('houses');
  const house = houses.find(h => h._id === houseId);
  if (!house) return { code: -1, message: '房屋不存在' };
  const houseLease = getCollectionData('lease_agreements')
    .find(l => l.houseId === houseId && l.status === 'active');
  if (houseLease) return { code: -1, message: '该房屋已有活跃合同' };

  const tenants = getCollectionData('tenants');
  const tenant = tenants.find(t => t._id === tenantId);
  if (!tenant) return { code: -1, message: '租客不存在' };

  const tenantLease = getCollectionData('lease_agreements')
    .find(l => l.tenantId === tenantId && l.status === 'active');
  if (tenantLease) return { code: -1, message: '该租客已有活跃合同' };

  // 创建合同
  const currentElectricity = Number(moveInElectricity) || 0;
  const currentWater = Number(moveInWater) || 0;
  const lastRecord = sortUtilityRecords(filterExistingLeaseRecords(houseId, getCollectionData('utility_records').filter(r => r.houseId === houseId)))[0] || null;
  if (lastRecord && !meterReplaced) {
    const lastElectricity = Number(lastRecord.electricityReading || 0);
    const lastWater = Number(lastRecord.waterReading || 0);
    if (currentElectricity < lastElectricity || currentWater < lastWater) {
      return { code: -1, message: `入住水电读数不能低于房屋上次读数：电表${lastElectricity}，水表${lastWater}` };
    }
  }

  const leaseId = 'lease_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  const now = nextDate();
  const finalDeposit = deposit === undefined || deposit === null || deposit === '' ? rent : deposit;
  const meta = {
    ...(test !== undefined ? { test } : {}),
    ...(testRunId ? { testRunId } : {}),
    ...(createdBy ? { createdBy } : {}),
    ...(house._openid ? { _openid: house._openid } : {})
  };
  const initialBilling = createInitialBills({
    leaseId,
    houseId,
    tenantId,
    startDate,
    rent: rent || house.rent,
    deposit: finalDeposit,
    paymentCycle: paymentCycle || 'month',
    now,
    meta
  });
  const lease = {
    ...meta,
    _id: leaseId, houseId, tenantId, startDate: parseDateInput(startDate),
    rent: rent || house.rent, deposit: finalDeposit,
    moveInElectricity: currentElectricity, moveInWater: currentWater,
    meterReplaced: !!meterReplaced,
    paymentCycle: paymentCycle || 'month', status: 'active',
    rentCoveredUntil: initialBilling.rentCoveredUntil,
    nextRentDueDate: initialBilling.nextRentDueDate,
    createdAt: now, updatedAt: now
  };
  getCollectionData('lease_agreements').push(lease);
  getCollectionData('utility_records').push({
    ...meta,
    _id: 'util_baseline_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
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

  // 更新房屋状态
  house.status = 'rented';
  tenant.status = 'active';

  initialBilling.bills.forEach(bill => {
    getCollectionData('bills').push(bill);
    if (bill.status === 'paid') {
      getCollectionData('payments').push({
        ...meta,
        _id: 'payment_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        billId: bill._id,
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
    }
  });

  return {
    code: 0,
    data: {
      leaseId,
      billsCreated: initialBilling.bills.length,
      paymentsCreated: 2,
      rentCoveredUntil: initialBilling.rentCoveredUntil,
      nextRentDueDate: initialBilling.nextRentDueDate
    }
  };
});

registerCloudFunction('payBill', ({ billId, amount, paymentDate, paymentMethod }) => {
  const bills = getCollectionData('bills');
  const bill = bills.find(b => b._id === billId);
  if (!bill) return { code: -1, message: '账单不存在' };
  if (bill.status === 'paid') return { code: -1, message: '该账单已全额支付' };

  const remaining = bill.amount - (bill.paidAmount || 0);
  if (amount > remaining) return { code: -1, message: `超额缴费，剩余应缴 ¥${remaining}` };

  bill.paidAmount = (bill.paidAmount || 0) + amount;
  bill.status = bill.paidAmount >= bill.amount ? 'paid' : 'partial';
  if (bill.status === 'paid') bill.paidAt = nextDate();

  // 记录支付
  const paymentId = 'payment_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  getCollectionData('payments').push({
    _id: paymentId, billId,
    leaseId: bill.leaseId,
    houseId: bill.houseId,
    tenantId: bill.tenantId,
    amount,
    paymentDate: paymentDate || new Date().toISOString().slice(0, 10),
    direction: 'in', paymentMethod: paymentMethod || 'cash', createdAt: new Date()
  });

  if (bill.type === 'rent' && bill.status === 'paid') {
    const lease = getCollectionData('lease_agreements').find(l => l._id === bill.leaseId);
    if (lease) {
      const rentBills = getCollectionData('bills').filter(b => b.leaseId === bill.leaseId && b.type === 'rent');
      const coverage = rentCoverage.recalculateContinuousRentCoverage(lease, rentBills);
      lease.rentCoveredUntil = coverage.rentCoveredUntil;
      lease.nextRentDueDate = coverage.nextRentDueDate;
    }
  }

  return { code: 0, data: { paidAmount: bill.paidAmount, status: bill.status, remaining: bill.amount - bill.paidAmount } };
});

registerCloudFunction('createNextRentBill', ({ leaseId, amount, coverageMonths, coverageDays }) => {
  const lease = getCollectionData('lease_agreements').find(l => l._id === leaseId);
  if (!lease) return { code: 404, message: '合同不存在' };
  if (lease.status !== 'active') return { code: 400, message: '只有生效中的合同可以提前收租' };

  const dueDate = lease.nextRentDueDate ? parseDateInput(lease.nextRentDueDate) : addDays(parseDateInput(lease.rentCoveredUntil), 1);
  const monthlyRent = Number(lease.rent || 0);
  const months = Number(coverageMonths || 0);
  let days = Number(coverageDays || 0);
  let finalAmount = Number(amount || 0);
  let coverageEnd;

  if (months > 0) {
    coverageEnd = addDays(addMonths(dueDate, months), -1);
    if (finalAmount <= 0) finalAmount = monthlyRent * months;
    days = 0;
  } else {
    if (days <= 0) days = finalAmount > 0 ? Math.max(1, Math.round(finalAmount / monthlyRent * 30)) : 30;
    coverageEnd = addDays(dueDate, days - 1);
    if (finalAmount <= 0) finalAmount = Math.round(monthlyRent / 30 * days * 100) / 100;
  }

  const period = `${formatDateKey(dueDate)}~${formatDateKey(coverageEnd)}`;
  const existing = getCollectionData('bills').find(b => b.leaseId === leaseId && b.type === 'rent' && b.period === period);
  if (existing) return { code: 200, data: { bill: existing, created: false } };

  const now = nextDate();
  const bill = {
    _id: 'bill_next_rent_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    leaseId,
    houseId: lease.houseId,
    tenantId: lease.tenantId,
    type: 'rent',
    period,
    amount: finalAmount,
    paidAmount: 0,
    status: 'unpaid',
    dueDate,
    rentCoverageStart: dueDate,
    rentCoverageEnd: coverageEnd,
    coverageMonths: months,
    coverageDays: days,
    remark: '提前收租',
    createdAt: now,
    updatedAt: now
  };
  getCollectionData('bills').push(bill);
  return { code: 200, data: { bill, created: true } };
});

registerCloudFunction('terminateLease', ({ leaseId, endDate, damageDeduction, refundDepositValue, damageAmount: inputDamageAmount, electricityReading, waterReading }) => {
  const leases = getCollectionData('lease_agreements');
  const lease = leases.find(l => l._id === leaseId);
  if (!lease) return { code: -1, message: '合同不存在' };
  if (lease.status !== 'active') return { code: -1, message: '合同已结束' };

  const now = nextDate();
  const actualEndDate = endDate || new Date().toISOString().slice(0, 10);
  const bills = getCollectionData('bills');
  const unsettledBills = bills
    .filter(b => b.leaseId === leaseId && b.status !== 'paid')
    .map(b => ({ ...b, remaining: b.amount - (b.paidAmount || 0) }))
    .filter(b => b.remaining > 0);

  let utilityCost = 0;
  let utilityRecordId = null;
  if (electricityReading !== undefined || waterReading !== undefined) {
    if (electricityReading === undefined || waterReading === undefined) {
      return { code: -1, message: '退租抄表需同时提供电表和水表读数' };
    }
    const currentLeaseRecord = sortUtilityRecords(getCollectionData('utility_records').filter(r => r.leaseId === leaseId))[0] || null;
    const lastRecord = currentLeaseRecord || sortUtilityRecords(filterExistingLeaseRecords(lease.houseId, getCollectionData('utility_records').filter(r => r.houseId === lease.houseId)))[0] || null;
    const lastElec = lastRecord ? lastRecord.electricityReading : (lease.moveInElectricity || 0);
    const lastWater = lastRecord ? lastRecord.waterReading : (lease.moveInWater || 0);
    const elecUsed = electricityReading - lastElec;
    const waterUsed = waterReading - lastWater;
    if (elecUsed < 0 || waterUsed < 0) return { code: -1, message: '退租抄表读数不能小于上次读数' };
    const settings = getCollectionData('system_settings')[0] || { electricityPrice: 0.8, waterPrice: 3.5 };
    utilityCost = Math.round((elecUsed * settings.electricityPrice + waterUsed * settings.waterPrice) * 100) / 100;
    utilityRecordId = 'util_checkout_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    getCollectionData('utility_records').push({
      _id: utilityRecordId,
      leaseId,
      houseId: lease.houseId,
      tenantId: lease.tenantId,
      electricityReading,
      waterReading,
      electricityUsage: elecUsed,
      waterUsage: waterUsed,
      totalCost: utilityCost,
      calculationDate: actualEndDate,
      createdAt: now
    });
    if (utilityCost > 0) {
      const utilityBill = {
        _id: 'bill_checkout_utility_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
        leaseId,
        houseId: lease.houseId,
        tenantId: lease.tenantId,
        type: 'utility',
        amount: utilityCost,
        paidAmount: 0,
        status: 'unpaid',
        period: actualEndDate,
        dueDate: actualEndDate,
        utilityRecordId,
        createdAt: now,
        updatedAt: now
      };
      bills.push(utilityBill);
      unsettledBills.push({ ...utilityBill, remaining: utilityCost });
    }
  }

  const deposit = lease.deposit || 0;
  // 与真实云函数一致：优先使用 damageAmount，否则用 refundDepositValue 或 damageDeduction
  const damageAmount = inputDamageAmount !== undefined
    ? Number(inputDamageAmount)
    : (refundDepositValue !== undefined ? deposit - Number(refundDepositValue) : Number(damageDeduction || 0));
  const actualRefundDeposit = deposit - damageAmount;
  let depositBalance = Math.max(0, actualRefundDeposit);
  let depositOffsetAmount = 0;
  const offsetDetails = [];
  for (const billRef of unsettledBills) {
    if (depositBalance <= 0) break;
    const bill = bills.find(b => b._id === billRef._id);
    if (!bill) continue;
    const remaining = bill.amount - (bill.paidAmount || 0);
    const offsetAmount = Math.min(remaining, depositBalance);
    bill.paidAmount = (bill.paidAmount || 0) + offsetAmount;
    bill.status = bill.paidAmount >= bill.amount ? 'paid' : 'partial';
    bill.updatedAt = now;
    depositBalance -= offsetAmount;
    depositOffsetAmount += offsetAmount;
    offsetDetails.push({ billId: bill._id, type: bill.type, amount: offsetAmount });
    getCollectionData('payments').push({
      _id: 'payment_offset_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      billId: bill._id,
      leaseId,
      houseId: lease.houseId,
      tenantId: lease.tenantId,
      amount: offsetAmount,
      direction: 'in',
      cashImpact: false,
      paymentDate: actualEndDate,
      paymentMethod: 'deposit_offset',
      remark: '退租押金自动抵扣',
      createdAt: now
    });
  }

  lease.status = 'terminated';
  lease.endDate = actualEndDate;
  lease.damageAmount = damageAmount;
  lease.depositOffsetAmount = depositOffsetAmount;
  lease.refundDepositValue = actualRefundDeposit;

  // 更新房屋状态
  const houses = getCollectionData('houses');
  const house = houses.find(h => h._id === lease.houseId);
  if (house) house.status = 'available';
  const tenant = getCollectionData('tenants').find(t => t._id === lease.tenantId);
  if (tenant) tenant.status = 'inactive';

  const remainingDueAfterDeposit = unsettledBills.reduce((sum, b) => {
    const current = bills.find(item => item._id === b._id);
    return sum + (current ? current.amount - (current.paidAmount || 0) : 0);
  }, 0);
  const damageExtraDue = actualRefundDeposit < 0 ? Math.abs(actualRefundDeposit) : 0;
  const refundAmount = Math.max(0, depositBalance);
  const extraPayment = remainingDueAfterDeposit + damageExtraDue;
  let cashSettlementAmount = 0;
  const cashSettlementDetails = [];

  for (const billRef of unsettledBills) {
    const bill = bills.find(item => item._id === billRef._id);
    if (!bill) continue;
    const remaining = bill.amount - (bill.paidAmount || 0);
    if (remaining <= 0) continue;
    bill.paidAmount = bill.amount;
    bill.status = 'paid';
    bill.paidAt = now;
    bill.updatedAt = now;
    cashSettlementAmount += remaining;
    cashSettlementDetails.push({ billId: bill._id, type: bill.type, amount: remaining });
    getCollectionData('payments').push({
      _id: 'payment_settlement_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      billId: bill._id,
      leaseId,
      houseId: lease.houseId,
      tenantId: lease.tenantId,
      amount: remaining,
      direction: 'in',
      paymentDate: actualEndDate,
      paymentMethod: 'settlement_payment',
      remark: '退租结算收款',
      createdAt: now
    });
  }

  const paidRentBills = bills.filter(b => b.leaseId === leaseId && b.type === 'rent' && ['paid', 'partial'].includes(b.status));
  const totalPaidRent = Math.round(paidRentBills.reduce((sum, b) => sum + Number(b.paidAmount || 0), 0) * 100) / 100;
  const actualOccupiedMonths = calcOccupiedBillingMonths(parseDateInput(lease.startDate), parseDateInput(actualEndDate), lease.paymentCycle);
  const billingCycleMonths = billingMonths(lease.paymentCycle);
  const actualRentDue = Math.round(actualOccupiedMonths * Number(lease.rent || 0) * 100) / 100;
  const overpaidRent = Math.max(0, Math.round((totalPaidRent - actualRentDue) * 100) / 100);
  let rentRefundBillId = null;
  if (overpaidRent > 0) {
    rentRefundBillId = 'bill_rent_refund_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    bills.push({
      _id: rentRefundBillId,
      leaseId,
      houseId: lease.houseId,
      tenantId: lease.tenantId,
      type: 'rent_refund',
      amount: overpaidRent,
      paidAmount: overpaidRent,
      status: 'paid',
      period: actualEndDate,
      dueDate: actualEndDate,
      paidAt: now,
      remark: `退租多收租金退还：实际入住${actualOccupiedMonths}个月应付${actualRentDue}元，已付${totalPaidRent}元，退还${overpaidRent}元`,
      createdAt: now,
      updatedAt: now
    });
    getCollectionData('payments').push({
      _id: 'payment_rent_refund_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      billId: rentRefundBillId,
      leaseId,
      houseId: lease.houseId,
      tenantId: lease.tenantId,
      amount: overpaidRent,
      direction: 'out',
      paymentDate: actualEndDate,
      paymentMethod: 'refund_offset',
      remark: '退租多收租金退款流水',
      createdAt: now
    });
  }

  if (damageExtraDue > 0) {
    const extraBillId = 'bill_extra_due_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    bills.push({
      _id: extraBillId,
      leaseId,
      houseId: lease.houseId,
      tenantId: lease.tenantId,
      type: 'extra_due',
      amount: damageExtraDue,
      paidAmount: damageExtraDue,
      status: 'paid',
      period: actualEndDate,
      dueDate: actualEndDate,
      paidAt: now,
      createdAt: now,
      updatedAt: now
    });
    cashSettlementAmount += damageExtraDue;
    cashSettlementDetails.push({ billId: extraBillId, type: 'extra_due', amount: damageExtraDue });
    getCollectionData('payments').push({
      _id: 'payment_extra_due_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      billId: extraBillId,
      leaseId,
      houseId: lease.houseId,
      tenantId: lease.tenantId,
      amount: damageExtraDue,
      direction: 'in',
      paymentDate: actualEndDate,
      paymentMethod: 'settlement_payment',
      remark: '退租额外赔偿收款',
      createdAt: now
    });
  }

  lease.extraPayment = extraPayment;
  lease.cashSettlementAmount = cashSettlementAmount;
  lease.settlementAmount = 0;
  lease.overpaidRent = overpaidRent;
  lease.totalRefund = Math.round((refundAmount + overpaidRent - extraPayment) * 100) / 100;

  if (refundAmount > 0) {
    const refundBillId = 'bill_refund_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    bills.push({
      _id: refundBillId,
      leaseId,
      houseId: lease.houseId,
      tenantId: lease.tenantId,
      type: 'deposit_return',
      amount: refundAmount,
      paidAmount: refundAmount,
      status: 'paid',
      period: actualEndDate,
      dueDate: actualEndDate,
      createdAt: now,
      updatedAt: now
    });
    getCollectionData('payments').push({
      _id: 'payment_refund_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      billId: refundBillId,
      leaseId,
      houseId: lease.houseId,
      tenantId: lease.tenantId,
      amount: refundAmount,
      direction: 'out',
      paymentDate: actualEndDate,
      paymentMethod: 'refund',
      remark: '押金退还',
      createdAt: now
    });
  }

  return {
    code: 0,
    data: {
      refundAmount,
      extraPayment,
      damageAmount,
      cashSettlementAmount,
      depositOffsetAmount,
      utilityCost,
      utilityRecordId,
      offsetDetails,
      cashSettlementDetails,
      rentRefund: {
        actualOccupiedMonths,
        occupiedMonths: actualOccupiedMonths,
        billingCycleMonths,
        actualRentDue,
        totalPaidRent,
        overpaidRent,
        rentRefundBillId
      },
      totalRefund: lease.totalRefund
    }
  };
});

registerCloudFunction('addUtilityRecord', ({ leaseId, electricityReading, waterReading, calculationDate }) => {
  const leases = getCollectionData('lease_agreements');
  const lease = leases.find(l => l._id === leaseId);
  if (!lease) return { code: -1, message: '合同不存在' };

  // 查上次读数
  const records = getCollectionData('utility_records').filter(r => r.leaseId === leaseId);
  const currentLeaseRecord = sortUtilityRecords(getCollectionData('utility_records').filter(r => r.leaseId === leaseId))[0] || null;
  const lastRecord = currentLeaseRecord || sortUtilityRecords(filterExistingLeaseRecords(lease.houseId, getCollectionData('utility_records').filter(r => r.houseId === lease.houseId)))[0] || null;
  const lastElec = lastRecord ? lastRecord.electricityReading : 0;
  const lastWater = lastRecord ? lastRecord.waterReading : 0;

  const elecUsed = electricityReading - lastElec;
  const waterUsed = waterReading - lastWater;
  if (elecUsed < 0 || waterUsed < 0) {
    return { code: -1, message: '抄表读数不能低于上次读数' };
  }

  const prices = getCollectionData('system_settings');
  const elecPrice = (prices[0] && prices[0].electricityPrice) || 0.8;
  const waterPrice = (prices[0] && prices[0].waterPrice) || 3.5;

  const recordId = 'util_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
  getCollectionData('utility_records').push({
    _id: recordId, leaseId, houseId: lease.houseId,
    electricityReading, waterReading,
    electricityUsage: elecUsed, waterUsage: waterUsed,
    electricityCost: elecUsed * elecPrice,
    waterCost: waterUsed * waterPrice,
    totalCost: elecUsed * elecPrice + waterUsed * waterPrice,
    calculationDate: calculationDate || nextDate(),
    createdAt: nextDate()
  });

  // 生成水电账单
  if (elecUsed > 0 || waterUsed > 0) {
    const billId = 'bill_util_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6);
    getCollectionData('bills').push({
      _id: billId, leaseId, houseId: lease.houseId, tenantId: lease.tenantId,
      type: 'utility', amount: elecUsed * elecPrice + waterUsed * waterPrice,
      paidAmount: 0, status: 'unpaid',
      period: (calculationDate || new Date().toISOString().slice(0, 10)).slice(0, 7),
      dueDate: calculationDate || new Date().toISOString().slice(0, 10),
      createdAt: nextDate()
    });
  }

  return {
    code: 0,
    data: {
      recordId, electricityUsage: elecUsed, waterUsage: waterUsed,
      lastElectricity: lastElec, lastWater,
      electricityCost: elecUsed * elecPrice, waterCost: waterUsed * waterPrice,
      totalCost: elecUsed * elecPrice + waterUsed * waterPrice
    }
  };
});

registerCloudFunction('generateMonthlyRentBills', ({ targetMonth }) => {
  const month = targetMonth || new Date().toISOString().slice(0, 7);
  const leases = getCollectionData('lease_agreements').filter(l => l.status === 'active');
  const bills = getCollectionData('bills');
  let generated = 0, skipped = 0;

  for (const lease of leases) {
    const exists = bills.find(b => b.leaseId === lease._id && b.type === 'rent' && b.period === month);
    if (exists) { skipped++; continue; }

    const billId = 'bill_' + Date.now() + '_' + Math.random().toString(36).slice(2, 4);
    bills.push({
      _id: billId, leaseId: lease._id, houseId: lease.houseId, tenantId: lease.tenantId,
      type: 'rent', amount: lease.rent, paidAmount: 0, status: 'unpaid',
      period: month, dueDate: month + '-05', createdAt: new Date()
    });
    generated++;
  }

  return { code: 0, data: { generated, skipped } };
});

registerCloudFunction('getHouseCurrentLease', ({ houseId }) => {
  const houses = getCollectionData('houses');
  const house = houses.find(h => h._id === houseId);
  if (!house) return { code: -1, message: '房屋不存在' };

  const lease = getCollectionData('lease_agreements').find(l => l.houseId === houseId && l.status === 'active');
  const tenant = lease ? getCollectionData('tenants').find(t => t._id === lease.tenantId) : null;
  const recentBills = lease ? getCollectionData('bills').filter(b => b.leaseId === lease._id).slice(-5) : [];
  const leaseRecords = lease ? sortUtilityRecords(getCollectionData('utility_records').filter(r => r.leaseId === lease._id)) : [];
  const utilityRecords = lease
    ? (leaseRecords.length > 0 ? leaseRecords : sortUtilityRecords(filterExistingLeaseRecords(houseId, getCollectionData('utility_records').filter(r => r.houseId === houseId)))).slice(0, 5)
    : [];

  return {
    code: 0,
    data: { house, currentLease: lease || null, tenant: tenant || null, recentBills, utilityRecords, billStats: {} }
  };
});

registerCloudFunction('getTenantBills', ({ tenantId }) => {
  const leases = getCollectionData('lease_agreements').filter(l => l.tenantId === tenantId);
  const leaseIds = leases.map(l => l._id);
  const bills = getCollectionData('bills').filter(b => leaseIds.includes(b.leaseId));
  const totalPaid = bills.filter(b => b.status === 'paid').reduce((s, b) => s + b.amount, 0);
  const totalUnpaid = bills.filter(b => b.status !== 'paid').reduce((s, b) => s + (b.amount - (b.paidAmount || 0)), 0);

  // 填充 house 信息
  const enrichedLeases = leases.map(l => {
    const house = getCollectionData('houses').find(h => h._id === l.houseId);
    return { ...l, house: house || null };
  });

  return {
    code: 0,
    data: {
      leases: enrichedLeases,
      bills,
      statistics: { totalBills: bills.length, totalAmount: totalPaid + totalUnpaid, totalPaid, totalUnpaid }
    }
  };
});

registerCloudFunction('deleteLeaseAgreement', ({ leaseId }) => {
  const leases = getCollectionData('lease_agreements');
  const lease = leases.find(l => l._id === leaseId);
  if (!lease) return { code: 404, message: '合同不存在' };

  const removeByLease = (name) => {
    const rows = getCollectionData(name);
    const kept = rows.filter(row => row.leaseId !== leaseId);
    const removed = rows.length - kept.length;
    store.set(name, kept);
    return removed;
  };

  const deletedPayments = removeByLease('payments');
  const deletedBills = removeByLease('bills');
  const deletedUtilityRecords = removeByLease('utility_records');
  store.set('lease_agreements', leases.filter(l => l._id !== leaseId));

  if (lease.status === 'active') {
    const hasOtherHouseLease = getCollectionData('lease_agreements')
      .some(l => l.houseId === lease.houseId && l.status === 'active');
    const house = getCollectionData('houses').find(h => h._id === lease.houseId);
    if (house && !hasOtherHouseLease) house.status = 'available';

    const hasOtherTenantLease = getCollectionData('lease_agreements')
      .some(l => l.tenantId === lease.tenantId && l.status === 'active');
    const tenant = getCollectionData('tenants').find(t => t._id === lease.tenantId);
    if (tenant && !hasOtherTenantLease) tenant.status = 'inactive';
  }

  return {
    code: 200,
    data: {
      leaseId,
      deletedLeases: 1,
      deletedBills,
      deletedPayments,
      deletedUtilityRecords
    }
  };
});

function sortRows(rows, field, direction = 'desc') {
  const dir = direction === 'desc' ? -1 : 1;
  return rows.slice().sort((a, b) => {
    const va = a[field];
    const vb = b[field];
    if (va === undefined || va === null) return 1;
    if (vb === undefined || vb === null) return -1;
    return (va < vb ? -1 : va > vb ? 1 : 0) * dir;
  });
}

function sortBills(rows) {
  const statusOrder = { unpaid: 0, partial: 1, paid: 2 };
  return rows.slice().sort((a, b) => {
    const statusDiff = (statusOrder[a.status] ?? 9) - (statusOrder[b.status] ?? 9);
    if (statusDiff !== 0) return statusDiff;
    const da = new Date(a.dueDate || a.createdAt || 0).getTime();
    const db = new Date(b.dueDate || b.createdAt || 0).getTime();
    return da - db;
  });
}

function roundMoney(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function normalizeBillStatus(bill = {}) {
  const amount = roundMoney(bill.amount);
  const paidAmount = roundMoney(bill.paidAmount);
  const remaining = roundMoney(Math.max(0, amount - paidAmount));
  const status = remaining <= 0 && paidAmount >= amount
    ? 'paid'
    : paidAmount > 0
      ? 'partial'
      : (bill.status || 'unpaid');
  return { ...bill, amount, paidAmount, remaining, status };
}

registerCloudFunction('queryLeaseData', ({ action, filters = {}, id }) => {
  if (action === 'listLeases') {
    let rows = getCollectionData('lease_agreements');
    if (filters.houseId) rows = rows.filter(l => l.houseId === filters.houseId);
    if (filters.tenantId) rows = rows.filter(l => l.tenantId === filters.tenantId);
    if (filters.status) rows = rows.filter(l => l.status === filters.status);
    return { code: 200, data: { data: copyObj(sortRows(rows, 'createdAt', 'desc')) } };
  }

  if (action === 'getLeaseById') {
    const lease = getCollectionData('lease_agreements').find(l => l._id === id) || null;
    return { code: 200, data: copyObj(lease) };
  }

  if (action === 'listBills') {
    let rows = getCollectionData('bills');
    if (filters.leaseIds) {
      rows = Array.isArray(filters.leaseIds) && filters.leaseIds.length > 0
        ? rows.filter(b => filters.leaseIds.includes(b.leaseId))
        : [];
    }
    rows = rows.map(normalizeBillStatus);
    if (filters.leaseId) rows = rows.filter(b => b.leaseId === filters.leaseId);
    if (filters.type) rows = rows.filter(b => b.type === filters.type);
    if (filters.status) rows = rows.filter(b => b.status === filters.status);
    return { code: 200, data: { data: copyObj(sortBills(rows)) } };
  }

  if (action === 'listUtilityRecords') {
    let rows = getCollectionData('utility_records');
    if (filters.leaseId) rows = rows.filter(r => r.leaseId === filters.leaseId);
    if (filters.houseId) rows = rows.filter(r => r.houseId === filters.houseId);
    if (filters.houseId) rows = filterExistingLeaseRecords(filters.houseId, rows);
    return { code: 200, data: { data: copyObj(sortUtilityRecords(rows)) } };
  }

  return { code: 400, message: '未知查询动作：' + action };
});

const { DomainError } = require('../cloudfunctions/rentalDomain/infrastructure/errors');
const { createRepository } = require('../cloudfunctions/rentalDomain/repositories/rental-repository');
const { createQueryService } = require('../cloudfunctions/rentalDomain/application/query-service');
const { createPreviewService } = require('../cloudfunctions/rentalDomain/application/preview-service');
const { createCommandService } = require('../cloudfunctions/rentalDomain/application/command-service');
const { safeAudit } = require('../cloudfunctions/rentalDomain/infrastructure/audit');

const mockDb = {
  collection(name) { return collectionAPI(name); },
  startTransaction: startMockTransaction,
  command: mockCommand
};

const mockRentalApp = {
  callFunction({ name, data }) {
    return global.wx.cloud.callFunction({ name, data });
  }
};

const rentalRepo = createRepository(mockDb);
const rentalCommand = createCommandService(mockRentalApp, mockDb);
const auditableRentalActions = new Set([
  'previewCreateHouse', 'previewCreateTenant', 'previewCreateLease', 'previewHistoricalLeaseImport', 'previewRenewLease', 'previewPrepayRent', 'previewRentCollection',
  'previewCollectRent', 'previewMeterReading', 'previewMoveOutSettlement',
  'confirmCreateHouse', 'confirmCreateTenant', 'confirmCreateLease', 'confirmHistoricalLeaseImport', 'confirmRenewLease', 'confirmPrepayRent', 'confirmRentCollection',
  'confirmCollectRent', 'confirmCollectBillBatch', 'confirmMeterReading', 'settleMoveOut'
]);

function createRentalActions(caller) {
  const scopedRepo = rentalRepo.forOwner(caller.openId);
  const query = createQueryService(scopedRepo, mockDb.command);
  const preview = createPreviewService(mockDb, scopedRepo);

  async function getOperationConfirmation(params = {}) {
    const confirmationId = params.confirmationId || '';
    if (!confirmationId) throw new DomainError('VALIDATION_ERROR', '缺少确认记录 ID');
    const res = await mockDb.collection('operation_confirmations').doc(confirmationId).get();
    const confirmation = res && res.data && (Array.isArray(res.data) ? res.data[0] : res.data);
    if (!confirmation) throw new DomainError('NOT_FOUND', '确认记录不存在');
    if (confirmation._openid !== caller.openId) throw new DomainError('FORBIDDEN', '不能读取他人的确认记录');
    return {
      confirmation: {
        id: confirmation._id || confirmationId,
        action: confirmation.action,
        actionName: confirmation.actionName || confirmation.action,
        targetId: confirmation.targetId || '',
        sourceDigest: confirmation.sourceDigest || '',
        normalizedInput: confirmation.normalizedInput || {},
        snapshot: confirmation.snapshot || null,
        status: confirmation.status,
        expiresAt: confirmation.expiresAt,
        createdAt: confirmation.createdAt,
        executedAt: confirmation.executedAt
      }
    };
  }

  return {
    searchHouses: query.searchHouses,
    getHouseDetail: query.getHouseDetail,
    searchTenants: query.searchTenants,
    resolveTenant: query.resolveTenant,
    getTenantDetail: query.getTenantDetail,
    getActiveLeases: query.getActiveLeases,
    getUnpaidBills: query.getUnpaidBills,
    getPaymentHistory: query.getPaymentHistory,
    getMeterTargets: query.getMeterTargets,
    getMoveOutTargets: query.getMoveOutTargets,
    getSubjectProfile: query.getSubjectProfile,
    auditLeaseRentCoverage: query.auditLeaseRentCoverage,
    getFinancialReport: query.getFinancialReport,
    getLeaseActivity: query.getLeaseActivity,
    getSettlementReport: query.getSettlementReport,
    getLeaseReport: query.getLeaseReport,
    getArrearsReport: query.getArrearsReport,
    getFutureReceivables: query.getFutureReceivables,
    getOperatingOverview: query.getOperatingOverview,
    getOperationConfirmation,
    previewCreateHouse: preview.previewCreateHouse,
    previewCreateTenant: preview.previewCreateTenant,
    previewCreateLease: preview.previewCreateLease,
    previewHistoricalLeaseImport: preview.previewHistoricalLeaseImport,
    previewRenewLease: preview.previewRenewLease,
    previewPrepayRent: preview.previewPrepayRent,
    previewRentCollection: preview.previewRentCollection,
    previewCollectRent: preview.previewCollectRent,
    previewMeterReading: preview.previewMeterReading,
    previewMoveOutSettlement: preview.previewMoveOutSettlement,
    confirmCreateHouse: rentalCommand.confirmCreateHouse,
    confirmCreateTenant: rentalCommand.confirmCreateTenant,
    confirmCreateLease: rentalCommand.confirmCreateLease,
    confirmHistoricalLeaseImport: rentalCommand.confirmHistoricalLeaseImport,
    confirmRenewLease: rentalCommand.confirmRenewLease,
    confirmRentCollection: rentalCommand.confirmRentCollection,
    confirmPrepayRent: rentalCommand.confirmPrepayRent,
    confirmCollectRent: rentalCommand.confirmCollectRent,
    confirmCollectBillBatch: rentalCommand.confirmCollectBillBatch,
    confirmMeterReading: rentalCommand.confirmMeterReading,
    settleMoveOut: rentalCommand.settleMoveOut
  };
}

registerCloudFunction('rentalDomain', async (event = {}) => {
  const action = String(event.action || '');
  const caller = { openId: event.__openid || DEFAULT_OPENID };
  try {
    const actions = createRentalActions(caller);
    if (!actions[action]) throw new DomainError('VALIDATION_ERROR', `未知业务动作：${action || '空'}`);
    const params = event.params && typeof event.params === 'object' ? event.params : event;
    const data = await actions[action](params, caller);
    if (auditableRentalActions.has(action)) {
      const phase = action.startsWith('preview') ? 'preview' : 'confirm';
      await safeAudit(mockDb, caller, {
        action,
        phase,
        status: 'success',
        targetId: data.confirmationId || '',
        idempotencyKey: data.idempotencyKey || '',
        summary: { confirmationId: data.confirmationId, result: data }
      });
    }
    return { code: 0, message: 'ok', data };
  } catch (error) {
    const errorCode = error instanceof DomainError ? error.code : 'INTERNAL_ERROR';
    if (action && auditableRentalActions.has(action)) {
      const phase = action.startsWith('preview') ? 'preview' : 'confirm';
      await safeAudit(mockDb, caller, { action, phase, status: 'failed', errorCode, errorMessage: error.message });
    }
    return { code: -1, errorCode, message: error.message || '服务异常', data: null };
  }
});

module.exports = {
  getCollectionData,
  clearAllData,
  registerCloudFunction,
  mockDb,
  DEFAULT_OPENID
};
