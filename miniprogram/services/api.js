/**
 * V2 API 服务层
 * - 写操作通过云函数（事务保障）
 * - 读操作直接查询 wx.cloud.database()
 */

const db = () => wx.cloud.database();
const _ = () => db().command;

// ==================== 云函数调用（写操作）====================

async function _callCloud(name, data = {}) {
  try {
    const res = await wx.cloud.callFunction({ name, data });
    const result = res.result;
    if (result.code && result.code !== 200) {
      throw new Error(result.message || `云函数 ${name} 返回错误`);
    }
    return result.data || result;
  } catch (e) {
    console.error(`云函数 ${name} 调用失败`, e);
    throw e;
  }
}

/** 创建租赁合同（自动生成租金账单） */
async function createLease(params) {
  return _callCloud('createLeaseAgreement', params);
}

/** 添加水电抄表记录（自动生成水电账单） */
async function addMeterReading(params) {
  return _callCloud('addUtilityRecord', params);
}

/** 缴费（更新账单状态） */
async function payBill(billId, amount, paymentDate, paymentMethod) {
  return _callCloud('payBill', { billId, amount, paymentDate, paymentMethod });
}

/** 退租结算 */
async function terminateLease(leaseId, endDate, damageDeduction) {
  return _callCloud('terminateLease', { leaseId, endDate, damageDeduction });
}

/** 生成月租账单 */
async function generateMonthlyBills(targetMonth) {
  return _callCloud('generateMonthlyRentBills', targetMonth ? { targetMonth } : {});
}

/** 获取房屋当前租客信息 */
async function getHouseCurrentLease(houseId) {
  return _callCloud('getHouseCurrentLease', { houseId });
}

/** 获取租客账单（含合同列表） */
async function getTenantBills(tenantId, opts = {}) {
  return _callCloud('getTenantBills', { tenantId, ...opts });
}

// ==================== 直接查询（读操作）====================

// ---- 房屋 ----

async function getHouses(filters) {
  const where = {};
  if (filters) {
    if (filters.status) where.status = filters.status;
    if (filters.code) where.code = filters.code;
  }
  let q = db().collection('houses');
  if (Object.keys(where).length > 0) q = q.where(where);
  const res = await q.orderBy('createdAt', 'desc').get();
  return { data: res.data || [] };
}

async function getHouseById(id) {
  const res = await db().collection('houses').doc(id).get();
  return res.data;
}

async function addHouse(data) {
  return db().collection('houses').add({
    data: { ...data, createdAt: db().serverDate(), updatedAt: db().serverDate(), status: data.status || 'available' }
  });
}

async function updateHouse(id, data) {
  return db().collection('houses').doc(id).update({
    data: { ...data, updatedAt: db().serverDate() }
  });
}

async function deleteHouse(id) {
  const house = await getHouseById(id);
  if (!house) throw new Error('房屋不存在');
  if (house.status === 'rented') throw new Error('该房屋正在出租中，请先退租再删除');
  return db().collection('houses').doc(id).remove();
}

// ---- 租客（纯人员信息）----

async function getTenants(filters) {
  const where = {};
  if (filters) {
    if (filters.name) where.name = db().RegExp({ regexp: filters.name, options: 'i' });
    if (filters.phone) where.phone = filters.phone;
  }
  let q = db().collection('tenants');
  if (Object.keys(where).length > 0) q = q.where(where);
  const res = await q.orderBy('createdAt', 'desc').get();
  return { data: res.data || [] };
}

async function getTenantById(id) {
  const res = await db().collection('tenants').doc(id).get();
  return res.data;
}

async function addTenant(data) {
  return db().collection('tenants').add({
    data: {
      name: data.name,
      idCard: data.idCard || '',
      phone: data.phone || '',
      remark: data.remark || '',
      createdAt: db().serverDate(),
      updatedAt: db().serverDate()
    }
  });
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
  const leases = await db().collection('lease_agreements')
    .where({ tenantId: id, status: 'active' }).get();
  if (leases.data && leases.data.length > 0) {
    throw new Error('该租客有未结束的合同，无法删除');
  }
  return db().collection('tenants').doc(id).remove();
}

// ---- 租赁合同 ----

async function getLeases(filters) {
  const where = {};
  if (filters) {
    if (filters.houseId) where.houseId = filters.houseId;
    if (filters.tenantId) where.tenantId = filters.tenantId;
    if (filters.status) where.status = filters.status;
  }
  let q = db().collection('lease_agreements');
  if (Object.keys(where).length > 0) q = q.where(where);
  const res = await q.orderBy('createdAt', 'desc').get();
  return { data: res.data || [] };
}

async function getLeaseById(id) {
  const res = await db().collection('lease_agreements').doc(id).get();
  return res.data;
}

// ---- 账单 ----

async function getBills(filters) {
  const where = {};
  if (filters) {
    if (filters.leaseId) where.leaseId = filters.leaseId;
    if (filters.type) where.type = filters.type;
    if (filters.status) where.status = filters.status;
    if (filters.leaseIds) where.leaseId = _().in(filters.leaseIds);
  }
  let q = db().collection('bills');
  if (Object.keys(where).length > 0) q = q.where(where);
  const res = await q.orderBy('createdAt', 'desc').get();
  return { data: res.data || [] };
}

// ---- 水电抄表记录 ----

async function getUtilityRecords(filters) {
  const where = {};
  if (filters) {
    if (filters.leaseId) where.leaseId = filters.leaseId;
  }
  let q = db().collection('utility_records');
  if (Object.keys(where).length > 0) q = q.where(where);
  const res = await q.orderBy('calculationDate', 'desc').get();
  return { data: res.data || [] };
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
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

// ==================== 导出 ====================

module.exports = {
  // 云函数
  createLease,
  addMeterReading,
  payBill,
  terminateLease,
  generateMonthlyBills,
  getHouseCurrentLease,
  getTenantBills,
  // 房屋
  getHouses, getHouseById, addHouse, updateHouse, deleteHouse,
  // 租客
  getTenants, getTenantById, addTenant, updateTenant, deleteTenant,
  // 合同
  getLeases, getLeaseById,
  // 账单
  getBills,
  // 水电
  getUtilityRecords,
  // 设置
  getSystemSettings, updateSystemSettings, getUtilityPrices,
  // 辅助
  formatDate
};
