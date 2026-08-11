/**
 * V2 API 服务层
 * - 写操作通过云函数（事务保障）
 * - 读操作直接查询 wx.cloud.database()
 */

const db = () => wx.cloud.database();
const _ = () => db().command;
const PAGE_SIZE = 20;

async function queryAll(collectionName, options = {}) {
  const { where = {}, orderBy, pageSize = PAGE_SIZE } = options;
  const all = [];
  let offset = 0;

  while (true) {
    let q = db().collection(collectionName);
    if (Object.keys(where).length > 0) q = q.where(where);
    if (orderBy) q = q.orderBy(orderBy.field, orderBy.direction);

    const res = await q.skip(offset).limit(pageSize).get();
    const rows = res.data || [];
    all.push(...rows);

    if (rows.length < pageSize) break;
    offset += rows.length;
  }

  return { data: all };
}

// ==================== 云函数调用（写操作）====================

async function _callCloud(name, data = {}) {
  try {
    const res = await wx.cloud.callFunction({ name, data });
    const result = res.result;
    if (result.code && result.code !== 200) {
      throw new Error(result.message || `云函数 ${name} 返回错误`);
    }
    if (Object.prototype.hasOwnProperty.call(result, 'data')) return result.data;
    return result;
  } catch (e) {
    console.error(`云函数 ${name} 调用失败`, e);
    throw e;
  }
}

async function callRentalDomain(action, params = {}) {
  return _callCloud('rentalDomain', { action, params });
}

/** 创建租赁合同（自动生成租金账单） */
async function createLease(params) {
  await assertLeaseCreatable(params.houseId, params.tenantId);
  return callRentalDomain('confirmCreateLease', params);
}

/** 添加水电抄表记录（自动生成水电账单） */
async function addMeterReading(params) {
  return callRentalDomain('confirmMeterReading', params);
}

/** 缴费（更新账单状态） */
async function payBill(billId, amount, paymentDate, paymentMethod) {
  return callRentalDomain('confirmCollectRent', { billId, amount, paymentDate, paymentMethod });
}

/** 对首页同一待收分组内的多笔账单一次确认缴费，云端事务按账期顺序分配金额。 */
async function payBillBatch(billIds, amount, paymentDate, paymentMethod) {
  return callRentalDomain('confirmCollectBillBatch', { billIds, amount, paymentDate, paymentMethod });
}

/** 退租结算 */
async function terminateLease(paramsOrLeaseId, endDate, damageDeduction) {
  if (typeof paramsOrLeaseId === 'object') {
    return callRentalDomain('settleMoveOut', paramsOrLeaseId);
  }
  return callRentalDomain('settleMoveOut', { leaseId: paramsOrLeaseId, endDate, damageDeduction });
}

async function previewCollectRent(params) {
  return callRentalDomain('previewCollectRent', params);
}

async function previewCreateHouse(params) {
  return callRentalDomain('previewCreateHouse', params);
}

async function previewCreateTenant(params) {
  return callRentalDomain('previewCreateTenant', params);
}

async function previewCreateLease(params) {
  return callRentalDomain('previewCreateLease', params);
}

async function previewHistoricalLeaseImport(params) {
  return callRentalDomain('previewHistoricalLeaseImport', params);
}

async function confirmHistoricalLeaseImport(confirmationId) {
  return callRentalDomain('confirmHistoricalLeaseImport', { confirmationId });
}

async function recognizeHistoricalLeaseImages(fileIds) {
  return _callCloud('recognizeHistoricalLeaseImages', { fileIds });
}

async function previewRenewLease(params) {
  return callRentalDomain('previewRenewLease', params);
}

async function previewPrepayRent(params) {
  return callRentalDomain('previewPrepayRent', params);
}

async function confirmPrepayRent(params) {
  return callRentalDomain('confirmPrepayRent', params);
}

async function previewRentCollection(params) {
  return callRentalDomain('previewRentCollection', params);
}

async function confirmRentCollection(params) {
  return callRentalDomain('confirmRentCollection', params);
}

async function previewMeterReading(params) {
  return callRentalDomain('previewMeterReading', params);
}

async function previewMoveOutSettlement(params) {
  return callRentalDomain('previewMoveOutSettlement', params);
}

async function auditLeaseRentCoverage(leaseId) {
  return callRentalDomain('auditLeaseRentCoverage', { leaseId });
}

async function getOperationConfirmation(confirmationId) {
  if (!confirmationId) throw new Error('缺少确认记录 ID');
  const data = await callRentalDomain('getOperationConfirmation', { confirmationId });
  return data.confirmation || data;
}

/** 删除合同，并同步删除该合同对应的账单、流水和水电记录 */
async function deleteLease(leaseId) {
  return _callCloud('deleteLeaseAgreement', { leaseId });
}

/** 生成月租账单 */
async function generateMonthlyBills(targetMonth) {
  return _callCloud('generateMonthlyRentBills', targetMonth ? { targetMonth } : {});
}

/** 为生效合同生成下一期租金账单，可用于提前收租 */
async function createNextRentBill(leaseId, options = {}) {
  return callRentalDomain('confirmRenewLease', { leaseId, ...options });
}

/** 获取房屋当前租客信息 */
async function getHouseCurrentLease(houseId) {
  return _callCloud('getHouseCurrentLease', { houseId });
}

/** 获取租客账单（含合同列表） */
async function getTenantBills(tenantId, opts = {}) {
  return _callCloud('getTenantBills', { tenantId, ...opts });
}

async function queryLeaseData(action, params = {}) {
  return _callCloud('queryLeaseData', { action, ...params });
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
  return {
    ...bill,
    amount,
    paidAmount,
    remaining,
    status
  };
}

async function voiceTranscribe(params = {}) {
  return _callCloud('voiceTranscribe', params);
}

async function voicePlanCommand(params = {}) {
  return _callCloud('voicePlanCommand', params);
}

async function voiceDialogueTurn(params = {}) {
  return _callCloud('voiceDialogueTurn', params);
}

async function voiceSynthesize(params = {}) {
  return _callCloud('voiceSynthesize', params);
}

// ==================== 直接查询（读操作）====================

// ---- 房屋 ----

async function getHouses(filters) {
  const where = {};
  if (filters) {
    if (filters.status) where.status = filters.status;
    if (filters.code) where.code = filters.code;
  }
  return queryAll('houses', {
    where,
    orderBy: { field: 'createdAt', direction: 'desc' }
  });
}

async function getActiveLeases() {
  const res = await getLeases({ status: 'active' });
  return res.data || [];
}

async function getHousesWithOccupancy(filters) {
  const [houseRes, activeLeases] = await Promise.all([
    getHouses(filters && filters.code ? { code: filters.code } : undefined),
    getActiveLeases()
  ]);
  const activeByHouse = {};
  activeLeases.forEach(lease => {
    if (!activeByHouse[lease.houseId]) activeByHouse[lease.houseId] = lease;
  });

  let houses = (houseRes.data || []).map(house => {
    const activeLease = activeByHouse[house._id] || null;
    const status = activeLease ? 'rented' : (house.status === 'maintenance' ? 'maintenance' : 'available');
    return {
      ...house,
      status,
      rawStatus: house.status,
      activeLease,
      hasActiveLease: !!activeLease,
      relationMismatch: house.status !== status
    };
  });

  if (filters && filters.status) {
    houses = houses.filter(house => house.status === filters.status);
  }

  return { data: houses };
}

async function getHouseById(id) {
  const res = await db().collection('houses').doc(id).get();
  return res.data;
}

function normalizeCreatedHouseResult(result = {}) {
  const houseId = result.houseId || result._id || result.id || (result.house && result.house._id);
  const house = {
    ...(result.house || {}),
    ...(houseId ? { _id: houseId, id: houseId } : {})
  };
  return {
    ...result,
    ...house,
    _id: houseId,
    id: houseId,
    houseId,
    house
  };
}

async function addHouse(data) {
  const result = await callRentalDomain('confirmCreateHouse', data);
  return normalizeCreatedHouseResult(result);
}

async function updateHouse(id, data) {
  if (data.status !== undefined) {
    const leases = await getLeases({ houseId: id, status: 'active' });
    const hasActiveLease = leases.data && leases.data.length > 0;
    if (data.status === 'rented' && !hasActiveLease) {
      throw new Error('不能手动设为已租，请通过创建租赁合同绑定租客');
    }
    if (data.status === 'available' && hasActiveLease) {
      throw new Error('该房屋已有生效合同，请先退租后再设为可租');
    }
  }
  return db().collection('houses').doc(id).update({
    data: { ...data, updatedAt: db().serverDate() }
  });
}

async function deleteHouse(id) {
  const house = await getHouseById(id);
  if (!house) throw new Error('房屋不存在');
  const leases = await getLeases({ houseId: id, status: 'active' });
  if ((leases.data && leases.data.length > 0) || house.status === 'rented') {
    throw new Error('该房屋正在出租中，请先退租再删除');
  }
  return db().collection('houses').doc(id).remove();
}

// ---- 租客（纯人员信息）----

async function getTenants(filters) {
  const where = {};
  if (filters) {
    if (filters.name) where.name = db().RegExp({ regexp: filters.name, options: 'i' });
    if (filters.phone) where.phone = filters.phone;
  }
  return queryAll('tenants', {
    where,
    orderBy: { field: 'createdAt', direction: 'desc' }
  });
}

async function getTenantById(id) {
  const res = await db().collection('tenants').doc(id).get();
  return res.data;
}

function normalizeCreatedTenantResult(result = {}) {
  const tenantId = result.tenantId || result._id || result.id || (result.tenant && result.tenant._id);
  const tenant = {
    ...(result.tenant || {}),
    ...(tenantId ? { _id: tenantId, id: tenantId } : {})
  };
  return {
    ...result,
    ...tenant,
    _id: tenantId,
    id: tenantId,
    tenantId,
    tenant
  };
}

async function addTenant(data) {
  const result = await callRentalDomain('confirmCreateTenant', data);
  return normalizeCreatedTenantResult(result);
}

async function updateTenant(id, data) {
  const update = {};
  if (data.name !== undefined) update.name = data.name;
  if (data.idCard !== undefined) update.idCard = data.idCard;
  if (data.phone !== undefined) update.phone = data.phone;
  if (data.remark !== undefined) update.remark = data.remark;
  update.updatedAt = db().serverDate();
  return db().collection('tenants').doc(id).update({ data: update });
}

async function deleteTenant(id) {
  // 检查是否有活跃合同
  const leases = await getLeases({ tenantId: id, status: 'active' });
  if (leases.data && leases.data.length > 0) {
    throw new Error('该租客有未结束的合同，无法删除');
  }
  return db().collection('tenants').doc(id).remove();
}

async function getTenantsWithOccupancy(filters) {
  const [tenantRes, activeLeases] = await Promise.all([
    getTenants(filters),
    getActiveLeases()
  ]);
  const activeByTenant = {};
  activeLeases.forEach(lease => {
    if (!activeByTenant[lease.tenantId]) activeByTenant[lease.tenantId] = lease;
  });

  return {
    data: (tenantRes.data || []).map(tenant => {
      const activeLease = activeByTenant[tenant._id] || null;
      return {
        ...tenant,
        activeLease,
        isActive: !!activeLease
      };
    })
  };
}

async function assertLeaseCreatable(houseId, tenantId) {
  const [house, tenant, houseLeases, tenantLeases] = await Promise.all([
    getHouseById(houseId),
    getTenantById(tenantId),
    getLeases({ houseId, status: 'active' }),
    getLeases({ tenantId, status: 'active' })
  ]);

  if (!house) throw new Error('房屋不存在');
  if (!tenant) throw new Error('租客不存在');
  if (houseLeases.data && houseLeases.data.length > 0) {
    throw new Error('该房屋已有生效中的租赁合同');
  }
  if (tenantLeases.data && tenantLeases.data.length > 0) {
    throw new Error('该租客已有生效中的租赁合同');
  }
  if (house.status === 'maintenance') {
    throw new Error(`房屋当前状态为 ${house.status}，无法创建租赁合同`);
  }
}

// ---- 租赁合同 ----

async function getLeases(filters) {
  return queryLeaseData('listLeases', { filters });
}

async function getLeaseById(id) {
  return queryLeaseData('getLeaseById', { id });
}

// ---- 账单 ----

async function getBills(filters) {
  const res = await queryLeaseData('listBills', { filters });
  return { ...res, data: (res.data || []).map(normalizeBillStatus) };
}

async function getPayments(filters) {
  const where = {};
  if (filters) {
    if (filters.leaseIds) {
      if (!Array.isArray(filters.leaseIds) || filters.leaseIds.length === 0) return { data: [] };
      where.leaseId = _().in(filters.leaseIds);
    }
    if (filters.leaseId) where.leaseId = filters.leaseId;
    if (filters.billId) where.billId = filters.billId;
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.houseId) where.houseId = filters.houseId;
  }
  return queryAll('payments', {
    where,
    orderBy: { field: 'createdAt', direction: 'desc' }
  });
}

// ---- 水电抄表记录 ----

async function getUtilityRecords(filters) {
  return queryLeaseData('listUtilityRecords', { filters });
}

// ---- 系统设置 ----

async function getSystemSettings() {
  const res = await db().collection('system_settings').where({ _id: 'global' }).get();
  if (res.data && res.data.length > 0) {
    return { data: [res.data[0]] };
  }
  // 不存在则创建默认
  await db().collection('system_settings').add({
    data: { _id: 'global', electricityPrice: 0.8, waterPrice: 3.5, updatedAt: db().serverDate() }
  });
  const created = await db().collection('system_settings').where({ _id: 'global' }).get();
  return { data: created.data || [{ electricityPrice: 0.8, waterPrice: 3.5 }] };
}

async function updateSystemSettings(data) {
  const current = await getSystemSettings();
  if (current.data && current.data[0] && current.data[0]._id) {
    return db().collection('system_settings').doc('global').update({
      data: { ...data, updatedAt: db().serverDate() }
    });
  }
  return db().collection('system_settings').add({
    data: { _id: 'global', ...data, updatedAt: db().serverDate() }
  });
}

async function getUtilityPrices() {
  const settings = await getSystemSettings();
  return {
    electricityPrice: settings.data[0]?.electricityPrice || 0.8,
    waterPrice: settings.data[0]?.waterPrice || 3.5
  };
}

// ==================== 辅助方法 ====================

function formatDate(date) {
  if (!date) return '';
  const value = date && date.$date ? date.$date : date;
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// ==================== 导出 ====================

module.exports = {
  // 云函数
  createLease,
  addMeterReading,
  payBill,
  payBillBatch,
  terminateLease,
  deleteLease,
  generateMonthlyBills,
  createNextRentBill,
  getHouseCurrentLease,
  getTenantBills,
  voiceTranscribe,
  voicePlanCommand,
  voiceDialogueTurn,
  voiceSynthesize,
  recognizeHistoricalLeaseImages,
  callRentalDomain,
  previewCreateHouse,
  previewCreateTenant,
  previewCreateLease,
  previewHistoricalLeaseImport,
  confirmHistoricalLeaseImport,
  previewRenewLease,
  previewPrepayRent,
  confirmPrepayRent,
  previewRentCollection,
  confirmRentCollection,
  previewCollectRent,
  previewMeterReading,
  previewMoveOutSettlement,
  auditLeaseRentCoverage,
  getOperationConfirmation,
  // 房屋
  getHouses, getHousesWithOccupancy, getHouseById, addHouse, updateHouse, deleteHouse,
  // 租客
  getTenants, getTenantsWithOccupancy, getTenantById, addTenant, updateTenant, deleteTenant,
  // 合同
  getLeases, getActiveLeases, getLeaseById,
  // 账单
  getBills, getPayments,
  // 水电
  getUtilityRecords,
  // 设置
  getSystemSettings, updateSystemSettings, getUtilityPrices,
  // 辅助
  formatDate
};
