const cloud = require('@cloudbase/node-sdk');

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

const ADDRESS_OPTIONS = ['东楼北', '东楼南', '里召'];
const DIGIT_CHAR_MAP = {
  零: '0',
  〇: '0',
  一: '1',
  二: '2',
  两: '2',
  三: '3',
  四: '4',
  五: '5',
  六: '6',
  七: '7',
  八: '8',
  九: '9'
};

function ok(data, message = '执行成功') {
  return { code: 200, message, data };
}

function fail(message, code = 500) {
  return { code, message, data: null };
}

function trimString(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function toHalfWidth(text) {
  return String(text || '').replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248)).replace(/\u3000/g, ' ');
}

function normalizeHouseCode(value) {
  const raw = trimString(value);
  if (!raw) return '';
  const direct = raw.match(/[A-Za-z]?\d{1,4}(?:-\d{1,4})?/);
  if (direct) return direct[0].toUpperCase();
  const chinese = raw.match(/[零〇一二两三四五六七八九]{2,4}/);
  if (chinese) return chinese[0].split('').map((char) => DIGIT_CHAR_MAP[char] || char).join('');
  return raw.toUpperCase();
}

function parseChineseNumber(text) {
  const raw = trimString(text).replace(/个/g, '');
  if (!raw) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(raw)) return Number(raw);
  if (!/[零〇一二两三四五六七八九十百千万点]/.test(raw)) return null;
  if (/^[零〇一二两三四五六七八九]+$/.test(raw)) {
    return Number(raw.split('').map((char) => DIGIT_CHAR_MAP[char] || '').join(''));
  }

  let value = raw
    .replace(/([一二两三四五六七八九])千([一二两三四五六七八九])(?![百十])/g, '$1千$2百')
    .replace(/([一二两三四五六七八九])百([一二两三四五六七八九])(?!十)/g, '$1百$2十')
    .replace(/([一二两三四五六七八九])万([一二两三四五六七八九])(?!千百十)/g, '$1万$2千');

  if (value.includes('点')) {
    const parts = value.split('点');
    const left = parseChineseNumber(parts[0] || '零') || 0;
    const right = (parts[1] || '').split('').map((char) => DIGIT_CHAR_MAP[char] || '').join('');
    if (!right) return left;
    return Number(`${left}.${right}`);
  }

  const digitMap = {
    零: 0,
    〇: 0,
    一: 1,
    二: 2,
    两: 2,
    三: 3,
    四: 4,
    五: 5,
    六: 6,
    七: 7,
    八: 8,
    九: 9
  };
  const unitMap = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0;
  let section = 0;
  let number = 0;
  for (const char of value) {
    if (digitMap[char] !== undefined) {
      number = digitMap[char];
      continue;
    }
    const unit = unitMap[char];
    if (!unit) continue;
    if (unit === 10000) {
      section = (section + number) * unit;
      total += section;
      section = 0;
      number = 0;
      continue;
    }
    section += (number || 1) * unit;
    number = 0;
  }
  return total + section + number;
}

function normalizeNumber(value, fallback = 0) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return value;
  const text = trimString(value)
    .replace(/[¥￥,\s]/g, '')
    .replace(/(元|块|月|天|度|吨|个月|个月租|个月房租)/g, '');
  if (!text) return fallback;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const chinese = parseChineseNumber(text);
  return chinese === null ? fallback : chinese;
}

function normalizePaymentCycle(value) {
  const text = trimString(value);
  if (!text) return 'month';
  if (['month', 'quarter', 'half_year', 'year'].includes(text)) return text;
  if (/年付|按年|一年/.test(text)) return 'year';
  if (/半年|六个月/.test(text)) return 'half_year';
  if (/季付|按季|三个月/.test(text)) return 'quarter';
  if (/月付|按月|一个月|每月/.test(text)) return 'month';
  const payMatch = text.match(/押[一二两三四五六七八九十\d]+付([一二两三四五六七八九十\d]+)/);
  if (payMatch) {
    const months = normalizeNumber(payMatch[1], 1);
    if (months >= 12) return 'year';
    if (months >= 6) return 'half_year';
    if (months >= 3) return 'quarter';
  }
  return 'month';
}

function normalizePaymentMethod(value) {
  const text = trimString(value);
  if (!text) return 'cash';
  if (['cash', 'wechat', 'bank', 'other'].includes(text)) return text;
  if (/微信/.test(text)) return 'wechat';
  if (/银行|转账/.test(text)) return 'bank';
  if (/其他/.test(text)) return 'other';
  return 'cash';
}

function normalizeDateValue(value) {
  const text = trimString(value);
  if (!text) return '';
  const dayMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dayMatch) return text;
  const monthMatch = text.match(/^(\d{4})-(\d{2})$/);
  if (monthMatch) return `${text}-01`;
  return text;
}

function generateTenantOrderNo() {
  const random = Math.random().toString(36).slice(2, 8);
  return `T${Date.now()}_${random}`;
}

function getCallerOpenId() {
  try {
    const userInfo = app.auth().getUserInfo() || {};
    return userInfo.openId || userInfo.OPENID || userInfo.uid || '';
  } catch (error) {
    return '';
  }
}

function buildMeta(event, source = {}) {
  const meta = {};
  if (event.test !== undefined) meta.test = event.test;
  if (event.testRunId) meta.testRunId = event.testRunId;
  meta.createdBy = event.createdBy || 'voice_assistant';
  meta.source = 'voice';
  meta._openid = source._openid || event._openid || getCallerOpenId() || '';
  if (!meta._openid) delete meta._openid;
  return meta;
}

async function safeLog(payload) {
  try {
    await db.collection('voice_command_logs').add({
      type: 'execution',
      ...payload,
      createdAt: new Date()
    });
  } catch (error) {
    // 忽略日志集合不存在
  }
}

async function callCloudFunction(name, data) {
  const res = await app.callFunction({ name, data });
  const result = res.result || {};
  if (result.code && result.code !== 200 && result.code !== 0) {
    throw new Error(result.message || `云函数 ${name} 执行失败`);
  }
  return Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
}

async function queryAll(collectionName, options = {}) {
  const { where = {}, orderBy, pageSize = 100 } = options;
  const rows = [];
  let offset = 0;
  while (true) {
    let query = db.collection(collectionName);
    if (Object.keys(where).length > 0) query = query.where(where);
    if (Array.isArray(orderBy)) {
      orderBy.forEach((item) => {
        query = query.orderBy(item.field, item.direction);
      });
    } else if (orderBy) {
      query = query.orderBy(orderBy.field, orderBy.direction);
    }
    const res = await query.skip(offset).limit(pageSize).get();
    const data = res.data || [];
    rows.push(...data);
    if (data.length < pageSize) break;
    offset += data.length;
  }
  return rows;
}

async function findHouseMatch(houseAddress, houseCode) {
  const address = trimString(houseAddress);
  const code = normalizeHouseCode(houseCode);
  if (!address && !code) return { status: 'none', candidates: [] };
  const houses = await queryAll('houses', { orderBy: { field: 'createdAt', direction: 'desc' } });
  const candidates = houses.filter((item) => {
    const addressMatched = !address || item.address === address;
    const codeMatched = !code || item.code === code;
    return addressMatched && codeMatched;
  });
  if (candidates.length === 1) return { status: 'single', item: candidates[0], candidates };
  if (candidates.length > 1) return { status: 'ambiguous', candidates };

  if (code) {
    const codeOnly = houses.filter((item) => item.code === code);
    if (codeOnly.length === 1) return { status: 'single', item: codeOnly[0], candidates: codeOnly };
    if (codeOnly.length > 1) return { status: 'ambiguous', candidates: codeOnly };
  }
  return { status: 'none', candidates: [] };
}

async function findTenantMatch(tenantName) {
  const name = trimString(tenantName);
  if (!name) return { status: 'none', candidates: [] };
  const tenants = await queryAll('tenants', { orderBy: { field: 'createdAt', direction: 'desc' } });
  const exact = tenants.filter((item) => item.name === name);
  if (exact.length === 1) return { status: 'single', item: exact[0], candidates: exact };
  if (exact.length > 1) return { status: 'ambiguous', candidates: exact };
  return { status: 'none', candidates: [] };
}

async function findActiveLeaseByTarget(houseId, tenantId) {
  const leases = await queryAll('lease_agreements', {
    where: { status: 'active' },
    orderBy: { field: 'createdAt', direction: 'desc' }
  });
  if (houseId) {
    const matched = leases.filter((item) => item.houseId === houseId);
    if (matched.length > 0) return matched[0];
  }
  if (tenantId) {
    const matched = leases.filter((item) => item.tenantId === tenantId);
    if (matched.length > 0) return matched[0];
  }
  return null;
}

async function findOutstandingBill(leaseId) {
  const bills = await queryAll('bills', {
    where: { leaseId },
    orderBy: { field: 'createdAt', direction: 'desc' }
  });
  const candidates = bills
    .filter((item) => item.status === 'unpaid' || item.status === 'partial')
    .sort((left, right) => {
      const leftDate = new Date(left.dueDate || left.createdAt || 0).getTime();
      const rightDate = new Date(right.dueDate || right.createdAt || 0).getTime();
      return leftDate - rightDate;
    });
  return candidates[0] || null;
}

async function upsertHouseForLease(slots, meta) {
  const houseAddress = trimString(slots.houseAddress);
  const houseCode = normalizeHouseCode(slots.houseCode);
  const rent = normalizeNumber(slots.rent, 0);
  if (!houseAddress || !houseCode) throw new Error('合同办理需要完整的房屋位置和编号');

  const match = await findHouseMatch(houseAddress, houseCode);
  const now = new Date();

  if (match.status === 'ambiguous') {
    throw new Error('房屋匹配到多条记录，请补充更准确的地址和编号');
  }

  if (match.status === 'single') {
    const house = match.item;
    if (house.status === 'maintenance') throw new Error('房屋当前是维修状态，不能办理合同');
    await db.collection('houses').where({ _id: house._id }).update({
      address: houseAddress,
      code: houseCode,
      rent,
      updatedAt: now
    });
    return {
      houseId: house._id,
      detail: { title: '房屋信息', status: 'success', message: `已匹配并更新 ${houseAddress}${houseCode}` }
    };
  }

  const res = await db.collection('houses').add({
    ...meta,
    address: houseAddress,
    code: houseCode,
    rent,
    status: 'available',
    createdAt: now,
    updatedAt: now
  });
  return {
    houseId: res.id || res._id,
    detail: { title: '房屋信息', status: 'success', message: `已新建房屋 ${houseAddress}${houseCode}` }
  };
}

async function upsertTenantForLease(slots, meta) {
  const tenantName = trimString(slots.tenantName);
  if (!tenantName) throw new Error('合同办理需要租客姓名');
  const phone = trimString(slots.tenantPhone);
  const idCard = trimString(slots.tenantIdCard);
  const match = await findTenantMatch(tenantName);
  const now = new Date();

  if (match.status === 'ambiguous') {
    throw new Error('租客姓名匹配到多条记录，请补充更明确的信息');
  }

  if (match.status === 'single') {
    const tenant = match.item;
    await db.collection('tenants').where({ _id: tenant._id }).update({
      name: tenantName,
      phone: phone || tenant.phone || '',
      idCard: idCard || tenant.idCard || '',
      updatedAt: now
    });
    return {
      tenantId: tenant._id,
      detail: { title: '租客信息', status: 'success', message: `已匹配并更新租客 ${tenantName}` }
    };
  }

  const res = await db.collection('tenants').add({
    ...meta,
    orderNo: generateTenantOrderNo(),
    name: tenantName,
    phone,
    idCard,
    remark: '',
    status: 'inactive',
    createdAt: now,
    updatedAt: now
  });
  return {
    tenantId: res.id || res._id,
    detail: { title: '租客信息', status: 'success', message: `已新建租客 ${tenantName}` }
  };
}

async function executeHouseScene(slots, meta) {
  const houseAddress = trimString(slots.houseAddress);
  const houseCode = normalizeHouseCode(slots.houseCode);
  const rent = normalizeNumber(slots.rent, 0);
  if (!houseAddress || !houseCode) throw new Error('请补充完整的房屋位置和编号');
  if (rent <= 0) throw new Error('请填写有效的月租金额');

  const match = await findHouseMatch(houseAddress, houseCode);
  if (match.status === 'ambiguous') {
    throw new Error('这个房屋编号匹配到多套房，请补充更准确的地址');
  }

  const now = new Date();
  if (match.status === 'single') {
    const house = match.item;
    await db.collection('houses').where({ _id: house._id }).update({
      address: houseAddress,
      code: houseCode,
      rent,
      updatedAt: now
    });
    return [{
      title: '房屋办理',
      status: 'success',
      message: `已更新房屋 ${houseAddress}${houseCode}`,
      id: house._id
    }];
  }

  const res = await db.collection('houses').add({
    ...meta,
    address: houseAddress,
    code: houseCode,
    rent,
    status: 'available',
    createdAt: now,
    updatedAt: now
  });
  return [{
    title: '房屋办理',
    status: 'success',
    message: `已新建房屋 ${houseAddress}${houseCode}`,
    id: res.id || res._id
  }];
}

async function executeTenantScene(slots, meta) {
  const tenantName = trimString(slots.tenantName);
  if (!tenantName) throw new Error('请填写租客姓名');
  const phone = trimString(slots.tenantPhone);
  const idCard = trimString(slots.tenantIdCard);
  const match = await findTenantMatch(tenantName);
  if (match.status === 'ambiguous') {
    throw new Error('这个租客姓名匹配到多条记录，请补充更明确的信息');
  }

  const now = new Date();
  if (match.status === 'single') {
    const tenant = match.item;
    await db.collection('tenants').where({ _id: tenant._id }).update({
      name: tenantName,
      phone: phone || tenant.phone || '',
      idCard: idCard || tenant.idCard || '',
      updatedAt: now
    });
    return [{
      title: '租客办理',
      status: 'success',
      message: `已更新租客 ${tenantName}`,
      id: tenant._id
    }];
  }

  const res = await db.collection('tenants').add({
    ...meta,
    orderNo: generateTenantOrderNo(),
    name: tenantName,
    phone,
    idCard,
    remark: '',
    status: 'inactive',
    createdAt: now,
    updatedAt: now
  });
  return [{
    title: '租客办理',
    status: 'success',
    message: `已新建租客 ${tenantName}`,
    id: res.id || res._id
  }];
}

async function executeLeaseScene(slots, meta, variant) {
  const details = [];
  const leaseStartDate = normalizeDateValue(slots.startDate);
  const leaseRent = normalizeNumber(slots.rent, 0);
  const leaseDeposit = normalizeNumber(slots.deposit, leaseRent);
  const paymentCycle = normalizePaymentCycle(slots.paymentCycle);

  if (!leaseStartDate) throw new Error('请补充起租日期');
  if (leaseRent <= 0) throw new Error('请填写有效的月租金额');

  const existingHouseMatch = await findHouseMatch(slots.houseAddress, slots.houseCode);
  if (existingHouseMatch.status === 'ambiguous') {
    throw new Error('房屋匹配到多条记录，请补充更准确的地址和编号');
  }
  if (existingHouseMatch.status === 'single') {
    const existingHouseLease = await findActiveLeaseByTarget(existingHouseMatch.item._id, '');
    if (existingHouseLease) throw new Error('该房屋已有生效中的合同，不能重复办理');
  }

  const existingTenantMatch = await findTenantMatch(slots.tenantName);
  if (existingTenantMatch.status === 'ambiguous') {
    throw new Error('租客姓名匹配到多条记录，请补充更明确的信息');
  }
  if (existingTenantMatch.status === 'single') {
    const existingTenantLease = await findActiveLeaseByTarget('', existingTenantMatch.item._id);
    if (existingTenantLease) throw new Error('该租客已有生效中的合同，不能重复办理');
  }

  const houseResult = await upsertHouseForLease(slots, meta);
  details.push(houseResult.detail);
  const tenantResult = await upsertTenantForLease(slots, meta);
  details.push(tenantResult.detail);

  const existingHouseLease = await findActiveLeaseByTarget(houseResult.houseId, '');
  if (existingHouseLease) throw new Error('该房屋已有生效中的合同，不能重复办理');

  const existingTenantLease = await findActiveLeaseByTarget('', tenantResult.tenantId);
  if (existingTenantLease) throw new Error('该租客已有生效中的合同，不能重复办理');

  const payload = {
    ...meta,
    source: 'voice',
    houseId: houseResult.houseId,
    tenantId: tenantResult.tenantId,
    startDate: leaseStartDate,
    rent: leaseRent,
    deposit: leaseDeposit,
    paymentCycle,
    remark: trimString(slots.remark) || (variant === 'snapshot' ? '语音助手历史建档' : '语音助手新建合同')
  };

  if (variant === 'snapshot') {
    const snapshotData = await callCloudFunction('importLeaseSnapshot', {
      ...payload,
      rentCoveredUntil: normalizeDateValue(slots.rentCoveredUntil),
      nextRentDueDate: normalizeDateValue(slots.nextRentDueDate),
      lastPaymentDate: normalizeDateValue(slots.lastPaymentDate),
      lastRentAmount: normalizeNumber(slots.lastRentAmount, 0),
      electricityReading: normalizeNumber(slots.electricityReading, 0),
      waterReading: normalizeNumber(slots.waterReading, 0),
      lastUtilityDate: normalizeDateValue(slots.lastUtilityDate),
      utilityAmount: normalizeNumber(slots.utilityAmount, 0)
    });
    details.push({
      title: '历史建档',
      status: 'success',
      message: `已导入历史合同快照，合同号 ${snapshotData.leaseId}`,
      id: snapshotData.leaseId
    });
    return details;
  }

  const leaseData = await callCloudFunction('createLeaseAgreement', {
    ...payload,
    moveInElectricity: normalizeNumber(slots.moveInElectricity, 0),
    moveInWater: normalizeNumber(slots.moveInWater, 0),
    meterReplaced: false
  });
  details.push({
    title: '合同办理',
    status: 'success',
    message: `已创建合同 ${leaseData.leaseId}`,
    id: leaseData.leaseId
  });
  return details;
}

async function resolveExistingLease(slots) {
  const houseMatch = await findHouseMatch(slots.houseAddress, slots.houseCode);
  if (houseMatch.status === 'ambiguous') throw new Error('房屋匹配到多条记录，请补充更准确的地址');

  const tenantMatch = await findTenantMatch(slots.tenantName);
  if (tenantMatch.status === 'ambiguous') throw new Error('租客姓名匹配到多条记录，请补充更明确的信息');

  const lease = await findActiveLeaseByTarget(
    houseMatch.status === 'single' ? houseMatch.item._id : '',
    tenantMatch.status === 'single' ? tenantMatch.item._id : ''
  );
  if (!lease) throw new Error('未找到对应的生效合同');
  return { lease, houseMatch, tenantMatch };
}

async function executePaymentScene(slots) {
  const { lease } = await resolveExistingLease(slots);
  const bill = await findOutstandingBill(lease._id);
  if (!bill) throw new Error('当前没有待缴账单');

  const amount = normalizeNumber(slots.amount, Math.max(0, Number(bill.amount || 0) - Number(bill.paidAmount || 0)));
  if (amount <= 0) throw new Error('请填写有效的缴费金额');

  const paymentData = await callCloudFunction('payBill', {
    billId: bill._id,
    amount,
    paymentDate: normalizeDateValue(slots.paymentDate) || new Date().toISOString().slice(0, 10),
    paymentMethod: normalizePaymentMethod(slots.paymentMethod),
    remark: '语音助手缴费'
  });

  return [{
    title: '缴费办理',
    status: 'success',
    message: `已完成缴费，剩余 ${paymentData.remaining} 元`,
    id: bill._id
  }];
}

async function executeMeterScene(slots) {
  const { lease } = await resolveExistingLease(slots);
  const electricityReading = normalizeNumber(slots.electricityReading, -1);
  const waterReading = normalizeNumber(slots.waterReading, -1);
  if (electricityReading < 0 || waterReading < 0) throw new Error('请填写有效的水电表读数');

  const data = await callCloudFunction('addUtilityRecord', {
    leaseId: lease._id,
    electricityReading,
    waterReading,
    calculationDate: normalizeDateValue(slots.calculationDate),
    remark: '语音助手抄表'
  });
  return [{
    title: '抄表办理',
    status: 'success',
    message: `已记录抄表，生成费用 ¥${data.totalCost}`,
    id: data.recordId
  }];
}

async function executeBatchMeterScene(slots) {
  const entries = Array.isArray(slots.entries) ? slots.entries : [];
  if (entries.length === 0) throw new Error('请先添加至少一户抄表信息');

  const prepared = [];
  for (const entry of entries) {
    const { lease, houseMatch } = await resolveExistingLease({
      houseAddress: entry.houseAddress,
      houseCode: entry.houseCode,
      tenantName: entry.tenantName || ''
    });
    prepared.push({
      leaseId: lease._id,
      label: houseMatch.status === 'single' ? `${houseMatch.item.address}${houseMatch.item.code}` : `${trimString(entry.houseAddress)}${normalizeHouseCode(entry.houseCode)}`,
      electricityReading: normalizeNumber(entry.electricityReading, -1),
      waterReading: normalizeNumber(entry.waterReading, -1)
    });
  }

  const details = [];
  for (const item of prepared) {
    if (item.electricityReading < 0 || item.waterReading < 0) {
      throw new Error(`请补全 ${item.label} 的水电表读数`);
    }
    const data = await callCloudFunction('addUtilityRecord', {
      leaseId: item.leaseId,
      electricityReading: item.electricityReading,
      waterReading: item.waterReading,
      remark: '语音助手批量抄表'
    });
    details.push({
      title: '批量抄表',
      status: 'success',
      message: `${item.label} 已生成费用 ¥${data.totalCost}`,
      id: data.recordId
    });
  }
  return details;
}

async function executePrepayScene(slots) {
  const { lease } = await resolveExistingLease(slots);
  const coverageMonths = normalizeNumber(slots.coverageMonths, 0);
  const coverageDays = normalizeNumber(slots.coverageDays, 0);
  let amount = normalizeNumber(slots.amount, 0);
  if (amount <= 0 && coverageMonths > 0) {
    amount = Math.round(Number(lease.rent || 0) * coverageMonths * 100) / 100;
  }
  if (amount <= 0 && coverageDays > 0) {
    amount = Math.round(Number(lease.rent || 0) / 30 * coverageDays * 100) / 100;
  }
  if (amount <= 0) throw new Error('请补充预收金额或覆盖时长');

  const billData = await callCloudFunction('createNextRentBill', {
    leaseId: lease._id,
    amount,
    coverageMonths,
    coverageDays
  });
  const bill = billData.bill;
  if (!bill || !bill._id) throw new Error('预收账单生成失败');

  await callCloudFunction('payBill', {
    billId: bill._id,
    amount,
    paymentDate: normalizeDateValue(slots.payDate) || new Date().toISOString().slice(0, 10),
    paymentMethod: normalizePaymentMethod(slots.paymentMethod),
    remark: '语音助手提前收租'
  });

  return [{
    title: '提前收租',
    status: 'success',
    message: `已完成提前收租 ¥${amount}`,
    id: bill._id
  }];
}

async function executeMoveOutScene(slots) {
  const { lease } = await resolveExistingLease(slots);
  const moveOutDate = normalizeDateValue(slots.moveOutDate);
  const electricityReading = normalizeNumber(slots.moveOutElectricity, -1);
  const waterReading = normalizeNumber(slots.moveOutWater, -1);
  const damageAmount = normalizeNumber(slots.damageAmount, 0);
  if (!moveOutDate) throw new Error('请补充退租日期');
  if (electricityReading < 0 || waterReading < 0) throw new Error('请补充退租时的水电表读数');

  const data = await callCloudFunction('terminateLease', {
    leaseId: lease._id,
    endDate: moveOutDate,
    damageAmount,
    electricityReading,
    waterReading
  });

  return [{
    title: '退租办理',
    status: 'success',
    message: data.refundAmount > 0
      ? `退租完成，应退 ¥${data.refundAmount}`
      : `退租完成，还需补缴 ¥${data.extraDue || 0}`,
    id: lease._id
  }];
}

exports.main = async (event = {}) => {
  try {
    const scene = trimString(event.scene);
    const variant = trimString(event.variant) || 'daily';
    const slots = event.slots || {};
    const meta = buildMeta(event);

    let details = [];
    if (scene === 'house') {
      details = await executeHouseScene(slots, meta);
    } else if (scene === 'tenant') {
      details = await executeTenantScene(slots, meta);
    } else if (scene === 'lease') {
      details = await executeLeaseScene(slots, meta, variant);
    } else if (scene === 'payment') {
      details = await executePaymentScene(slots);
    } else if (scene === 'meter') {
      details = await executeMeterScene(slots);
    } else if (scene === 'batch_meter') {
      details = await executeBatchMeterScene(slots);
    } else if (scene === 'prepay_rent') {
      details = await executePrepayScene(slots);
    } else if (scene === 'move_out') {
      details = await executeMoveOutScene(slots);
    } else {
      return fail(`暂不支持的办理场景：${scene}`, 400);
    }

    const failed = details.filter((item) => item.status !== 'success').length;
    const success = details.length - failed;
    const summary = details.map((item) => item.message).join('；');

    await safeLog({
      scene,
      variant,
      slots,
      success,
      failed,
      details
    });

    return ok({
      success,
      failed,
      summary,
      details
    });
  } catch (error) {
    await safeLog({
      scene: event.scene || '',
      variant: event.variant || '',
      slots: event.slots || {},
      success: 0,
      failed: 1,
      error: error.message
    });
    return fail(error.message, 500);
  }
};
