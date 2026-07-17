const cloud = require('@cloudbase/node-sdk');

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();
const _ = db.command;
const PAGE_SIZE = 100;

async function queryAll(collectionName, options = {}) {
  const { where = {}, orderBy, pageSize = PAGE_SIZE } = options;
  const all = [];
  let offset = 0;

  while (true) {
    let query = db.collection(collectionName);
    if (Object.keys(where).length > 0) query = query.where(where);
    if (Array.isArray(orderBy)) {
      orderBy.forEach(item => {
        query = query.orderBy(item.field, item.direction);
      });
    } else if (orderBy) {
      query = query.orderBy(orderBy.field, orderBy.direction);
    }

    const res = await query.skip(offset).limit(pageSize).get();
    const rows = res.data || [];
    all.push(...rows);

    if (rows.length < pageSize) break;
    offset += rows.length;
  }

  return all;
}

function ok(data) {
  return { code: 200, message: '查询成功', data };
}

function fail(code, message) {
  return { code, message, data: null };
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

function buildLeaseWhere(filters = {}) {
  const where = {};
  if (filters.houseId) where.houseId = filters.houseId;
  if (filters.tenantId) where.tenantId = filters.tenantId;
  if (filters.status) where.status = filters.status;
  return where;
}

function buildBillWhere(filters = {}) {
  const where = {};
  if (filters.leaseIds) {
    if (!Array.isArray(filters.leaseIds) || filters.leaseIds.length === 0) return null;
    where.leaseId = _.in(filters.leaseIds);
  }
  if (filters.leaseId) where.leaseId = filters.leaseId;
  if (filters.type) where.type = filters.type;
  if (filters.status) where.status = filters.status;
  return where;
}

function buildUtilityWhere(filters = {}) {
  const where = {};
  if (filters.leaseId) where.leaseId = filters.leaseId;
  if (filters.houseId) where.houseId = filters.houseId;
  return where;
}

function buildIdWhere(filters = {}) {
  const ids = Array.isArray(filters.ids) ? filters.ids.filter(Boolean) : [];
  if (ids.length === 0) return {};
  return { _id: _.in(ids) };
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

async function filterExistingLeaseRecords(filters, records) {
  if (!filters.houseId || !records || records.length === 0) return records || [];
  const leases = await queryAll('lease_agreements', { where: { houseId: filters.houseId } });
  const leaseIds = new Set((leases || []).map(item => item._id));
  return records.filter(record => record.leaseId && leaseIds.has(record.leaseId));
}

exports.main = async (event = {}) => {
  const { action, filters = {}, id } = event;

  try {
    if (action === 'listLeases') {
      const rows = await queryAll('lease_agreements', {
        where: buildLeaseWhere(filters),
        orderBy: { field: 'createdAt', direction: 'desc' }
      });
      return ok({ data: rows });
    }

    if (action === 'getLeaseById') {
      if (!id) return fail(400, '缺少必要参数：id');
      const rows = await queryAll('lease_agreements', { where: { _id: id } });
      return ok(rows[0] || null);
    }

    if (action === 'listBills') {
      const where = buildBillWhere(filters);
      if (where === null) return ok({ data: [] });

      const rows = await queryAll('bills', {
        where,
        orderBy: { field: 'createdAt', direction: 'desc' }
      });
      return ok({ data: sortBills(rows.map(normalizeBillStatus)) });
    }

    if (action === 'listUtilityRecords') {
      const rows = await queryAll('utility_records', {
        where: buildUtilityWhere(filters),
        orderBy: [
          { field: 'calculationDate', direction: 'desc' },
          { field: 'createdAt', direction: 'desc' }
        ]
      });
      const validRows = await filterExistingLeaseRecords(filters, rows);
      return ok({ data: sortUtilityRecords(validRows) });
    }

    if (action === 'listTenants') {
      const rows = await queryAll('tenants', { where: buildIdWhere(filters) });
      return ok({ data: rows });
    }

    if (action === 'listHouses') {
      const rows = await queryAll('houses', { where: buildIdWhere(filters) });
      return ok({ data: rows });
    }

    if (action === 'getSystemSettings') {
      const rows = await queryAll('system_settings', { where: { _id: 'global' } });
      return ok(rows[0] || { electricityPrice: 0.8, waterPrice: 3.5 });
    }

    return fail(400, '未知查询动作：' + action);
  } catch (error) {
    return fail(500, '查询租赁数据失败：' + error.message);
  }
};
