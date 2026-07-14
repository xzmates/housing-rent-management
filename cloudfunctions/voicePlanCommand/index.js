const cloud = require('@cloudbase/node-sdk');
const https = require('https');

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

const SCENE_LABELS = {
  house: '新增房屋',
  tenant: '新增租客',
  lease: '新建合同',
  payment: '缴费确认',
  meter: '单次抄表',
  batch_meter: '批量抄表',
  prepay_rent: '提前收租',
  move_out: '退租结算',
  unsupported: '暂不支持'
};

const REQUIRED_FIELDS = {
  house: ['houseAddress', 'houseCode', 'rent'],
  tenant: ['tenantName'],
  lease: ['houseAddress', 'houseCode', 'tenantName', 'startDate', 'rent', 'deposit', 'paymentCycle'],
  payment: ['targetLabel'],
  meter: ['targetLabel', 'electricityReading', 'waterReading'],
  batch_meter: ['entries'],
  prepay_rent: ['targetLabel', 'prepayBasis'],
  move_out: ['targetLabel', 'moveOutDate', 'moveOutElectricity', 'moveOutWater']
};

const FIELD_LABELS = {
  houseAddress: '房屋位置',
  houseCode: '房屋编号',
  rent: '月租金',
  tenantName: '租客姓名',
  tenantPhone: '手机号',
  tenantIdCard: '身份证号',
  startDate: '起租日期',
  deposit: '押金',
  paymentCycle: '付款周期',
  targetLabel: '办理对象',
  amount: '金额',
  paymentDate: '缴费日期',
  paymentMethod: '收款方式',
  electricityReading: '电表读数',
  waterReading: '水表读数',
  coverageMonths: '预收月数',
  coverageDays: '预收天数',
  payDate: '收款日期',
  moveOutDate: '退租日期',
  moveOutElectricity: '退租电表',
  moveOutWater: '退租水表',
  damageAmount: '损耗扣款',
  entries: '批量抄表明细',
  prepayBasis: '预收租金依据'
};

function ok(data) {
  return { code: 200, message: '规划成功', data };
}

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    }, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch (error) {
          // 保留原始响应，便于定位非 JSON 错误
        }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`DeepSeek HTTP ${res.statusCode}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function trimString(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

function toHalfWidth(text) {
  return String(text || '').replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248)).replace(/\u3000/g, ' ');
}

function normalizeText(text) {
  return toHalfWidth(text)
    .replace(/[;；]/g, '，')
    .replace(/\s+/g, ' ')
    .replace(/东楼被|东楼倍/g, '东楼北')
    .replace(/里招|里照/g, '里召')
    .replace(/转帐/g, '转账')
    .trim();
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
    return right ? Number(`${left}.${right}`) : left;
  }

  const digitMap = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
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
      total += (section + number) * unit;
      section = 0;
      number = 0;
      continue;
    }
    section += (number || 1) * unit;
    number = 0;
  }
  return total + section + number;
}

function normalizeNumber(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'number') return value;
  const text = trimString(value).replace(/[¥￥,\s]/g, '').replace(/(元|块|月|天|度|吨|个月|月份)/g, '');
  if (!text) return fallback;
  if (/^-?\d+(?:\.\d+)?$/.test(text)) return Number(text);
  const chinese = parseChineseNumber(text);
  return chinese === null ? fallback : chinese;
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

function todayBase(event = {}) {
  const source = event.nowDate ? new Date(event.nowDate) : new Date();
  if (Number.isNaN(source.getTime())) return new Date();
  return new Date(source.getFullYear(), source.getMonth(), source.getDate());
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDateText(text, event = {}) {
  const raw = trimString(text);
  if (!raw) return '';
  const base = todayBase(event);

  const iso = raw.match(/(\d{4})-(\d{1,2})(?:-(\d{1,2}))?/);
  if (iso) {
    const day = iso[3] ? Number(iso[3]) : 1;
    return formatDate(new Date(Number(iso[1]), Number(iso[2]) - 1, day));
  }

  const full = raw.match(/(\d{4})\s*年\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*月\s*(?:(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[日号]?)?/);
  if (full) {
    const month = normalizeNumber(full[2], 1);
    const day = full[3] ? normalizeNumber(full[3], 1) : 1;
    return formatDate(new Date(Number(full[1]), month - 1, day));
  }

  const relativeYear = raw.match(/(去年|今年|明年)\s*(\d{1,2}|[一二三四五六七八九十]{1,3})\s*月\s*(?:(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[日号]?)?/);
  if (relativeYear) {
    const offset = relativeYear[1] === '去年' ? -1 : relativeYear[1] === '明年' ? 1 : 0;
    const month = normalizeNumber(relativeYear[2], 1);
    const day = relativeYear[3] ? normalizeNumber(relativeYear[3], 1) : 1;
    return formatDate(new Date(base.getFullYear() + offset, month - 1, day));
  }

  const relativeMonth = raw.match(/(上个月|这个月|下个月)\s*(?:(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[日号])?/);
  if (relativeMonth) {
    const offset = relativeMonth[1] === '上个月' ? -1 : relativeMonth[1] === '下个月' ? 1 : 0;
    const day = relativeMonth[2] ? normalizeNumber(relativeMonth[2], 1) : 1;
    return formatDate(new Date(base.getFullYear(), base.getMonth() + offset, day));
  }

  if (/今天|今日/.test(raw)) return formatDate(base);
  if (/昨天/.test(raw)) return formatDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() - 1));
  if (/明天/.test(raw)) return formatDate(new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1));

  const monthOnly = raw.match(/(\d{1,2}|[一二三四五六七八九十]{1,3})\s*月\s*(?:(\d{1,2}|[一二三四五六七八九十]{1,3})\s*[日号])?/);
  if (monthOnly) {
    const month = normalizeNumber(monthOnly[1], base.getMonth() + 1);
    const day = monthOnly[2] ? normalizeNumber(monthOnly[2], 1) : 1;
    return formatDate(new Date(base.getFullYear(), month - 1, day));
  }

  return '';
}

function normalizePaymentCycle(value) {
  const text = trimString(value);
  if (!text) return '';
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
    return 'month';
  }
  return '';
}

function cycleLabel(cycle) {
  return ({ month: '月付', quarter: '季付', half_year: '半年付', year: '年付' })[cycle] || '';
}

function normalizePaymentMethod(text) {
  if (/微信/.test(text)) return 'wechat';
  if (/银行|转账/.test(text)) return 'bank';
  if (/现金|现钱/.test(text)) return 'cash';
  if (/其他/.test(text)) return 'other';
  return '';
}

function detectScene(text, explicitScene) {
  if (explicitScene && explicitScene !== 'auto') return explicitScene;
  if (/删除|删掉|导出|设置|单价|生成月租账单/.test(text)) return 'unsupported';
  if (/批量抄表|统一提交|一户点下一户/.test(text)) return 'batch_meter';
  if (/退租|搬走|走了|退房/.test(text)) return 'move_out';
  if (/提前收租|预收|收\d+个?月|收[一二两三四五六七八九十]+个?月/.test(text)) return 'prepay_rent';
  if (/电表|水表|抄表/.test(text)) return 'meter';
  if (/缴费|交钱|交租|付款|付了|已收|收了/.test(text)) return 'payment';
  if (/合同|入住|住的|租的|押一付|押二付|起租/.test(text)) return 'lease';
  if (/租客|电话|身份证/.test(text)) return 'tenant';
  return 'house';
}

function extractAddress(text) {
  return ADDRESS_OPTIONS.find((item) => text.includes(item)) || '';
}

function extractHouseCode(text, address) {
  if (address) {
    const after = text.slice(text.indexOf(address) + address.length);
    const direct = after.match(/^\s*([A-Za-z]?\d{1,4}(?:-\d{1,4})?|[零〇一二两三四五六七八九]{2,4})/);
    if (direct) return normalizeHouseCode(direct[1]);
    const before = text.slice(0, text.indexOf(address));
    const beforeDirect = before.match(/([A-Za-z]?\d{1,4}(?:-\d{1,4})?|[零〇一二两三四五六七八九]{2,4})\s*$/);
    if (beforeDirect) return normalizeHouseCode(beforeDirect[1]);
  }
  const codeMatch = text.match(/(?:^|[,\s，、])([A-Za-z]?\d{1,4}(?:-\d{1,4})?|[零〇一二两三四五六七八九]{2,4})(?:[,\s，、]|$)/);
  if (!codeMatch) return '';
  const code = normalizeHouseCode(codeMatch[1]);
  if (/^\d{4}$/.test(code) && Number(code) > 1900 && Number(code) < 2100) return '';
  return code;
}

function extractName(text) {
  const exclude = new Set(['东楼北', '东楼南', '里召', '电表', '水表', '今天', '去年', '今年', '明年', '租客']);
  const patterns = [
    /([一-龥]{2,4})\s*(?:今天|要)?\s*退租/,
    /(?:租客|换成|改成)\s*([一-龥]{2,4})/,
    /([一-龥]{2,4})\s*(?:阿姨|叔叔|先生|女士)?\s*(?:住|租|入住|退租|搬走|走了)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const name = match[1].replace(/(今天|昨天|明天|要)$/, '');
    if (!name || exclude.has(name) || ADDRESS_OPTIONS.some((addr) => name.includes(addr))) continue;
    if (/(收|交|付|电|水|表|押|扣|钱|金额|个月|月租|房租)/.test(name)) continue;
    return name;
  }
  return '';
}

function extractMoneyAfter(text, pattern) {
  const match = text.match(pattern);
  return match ? normalizeNumber(match[1], null) : null;
}

function extractSlots(text, scene, event = {}) {
  const slots = {};
  const address = extractAddress(text);
  const code = extractHouseCode(text, address);
  if (address) slots.houseAddress = address;
  if (code) slots.houseCode = code;
  if (address || code) slots.targetLabel = `${address || ''}${code || ''}` || code;

  const rent = extractMoneyAfter(text, /(?:月租|租金|房租|每月)\s*[¥￥]?\s*([零〇一二两三四五六七八九十百千万\d.]+)/);
  if (rent !== null) slots.rent = rent;

  const deposit = extractMoneyAfter(text, /押金\s*[¥￥]?\s*([零〇一二两三四五六七八九十百千万\d.]+)/);
  if (deposit !== null) slots.deposit = deposit;

  const pledgePay = text.match(/押([一二两三四五六七八九十\d]+)付([一二两三四五六七八九十\d]+)/);
  if (pledgePay) {
    const pledgeMonths = normalizeNumber(pledgePay[1], 1);
    const payMonths = normalizeNumber(pledgePay[2], 1);
    if (slots.rent && slots.deposit === undefined) slots.deposit = slots.rent * pledgeMonths;
    slots.paymentCycle = payMonths >= 12 ? 'year' : payMonths >= 6 ? 'half_year' : payMonths >= 3 ? 'quarter' : 'month';
  }

  const cycle = normalizePaymentCycle(text);
  if (cycle) slots.paymentCycle = cycle;

  const name = extractName(text);
  if (name) {
    slots.tenantName = name;
    if (!slots.targetLabel && ['payment', 'prepay_rent', 'move_out'].includes(scene)) slots.targetLabel = name;
  }

  const phone = text.match(/1\d{10}/);
  if (phone) slots.tenantPhone = phone[0];

  const idCard = text.match(/\d{17}[\dXx]|\d{15}/);
  if (idCard) slots.tenantIdCard = idCard[0];

  const startDateText = text.match(/(?:入住|起租|从)\s*([^，。；;]+)|([^，。；;]+)\s*(?:入住|起租)/);
  if (startDateText) {
    const parsed = parseDateText(startDateText[1] || startDateText[2], event);
    if (parsed) slots.startDate = parsed;
  } else {
    const parsed = parseDateText(text, event);
    if (parsed && /(去年|今年|明年|\d{4}年|\d{4}-|今天|昨天|上个月|这个月|下个月)/.test(text)) {
      if (scene === 'move_out') slots.moveOutDate = parsed;
      else if (scene === 'payment') slots.paymentDate = parsed;
      else if (scene === 'prepay_rent') slots.payDate = parsed;
      else slots.startDate = parsed;
    }
  }

  const paidUntil = text.match(/(?:交到|交至|已交到|已交至)\s*([^，。；;]+)/);
  if (paidUntil) {
    const parsed = parseDateText(paidUntil[1], event);
    if (parsed) slots.rentCoveredUntil = parsed;
  }

  const amount = extractMoneyAfter(text, /(?:金额|缴费|交了|收了|付了|付款|水电费|扣)\s*[¥￥]?\s*([零〇一二两三四五六七八九十百千万\d.]+)/);
  if (amount !== null) slots.amount = amount;

  const method = normalizePaymentMethod(text);
  if (method) {
    slots.paymentMethod = method;
    slots.payMethod = method;
  }

  const elec = extractMoneyAfter(text, /(?:电表|电)\s*([零〇一二两三四五六七八九十百千万\d.]+)/);
  if (elec !== null) {
    if (scene === 'move_out') slots.moveOutElectricity = elec;
    else slots.electricityReading = elec;
  }

  const water = extractMoneyAfter(text, /(?:水表|水)\s*([零〇一二两三四五六七八九十百千万\d.]+)/);
  if (water !== null) {
    if (scene === 'move_out') slots.moveOutWater = water;
    else slots.waterReading = water;
  }

  if (scene === 'move_out') {
    const moveDate = parseDateText(text, event);
    if (moveDate) slots.moveOutDate = moveDate;
    const damage = extractMoneyAfter(text, /(?:墙皮|损坏|损耗|扣|赔)\D*([零〇一二两三四五六七八九十百千万\d.]+)/);
    if (damage !== null) slots.damageAmount = damage;
  }

  const monthsMatch = text.match(/(?:收|预收|提前收)\s*([零〇一二两三四五六七八九十\d]+)\s*个?月/);
  if (monthsMatch) slots.coverageMonths = normalizeNumber(monthsMatch[1], null);

  if (scene === 'batch_meter') {
    const entries = [];
    const codeRegex = /([A-Za-z]?\d{1,4}|[零〇一二两三四五六七八九]{2,4})/g;
    let match;
    while ((match = codeRegex.exec(text)) !== null) {
      const itemCode = normalizeHouseCode(match[1]);
      if (/^\d{4}$/.test(itemCode) && Number(itemCode) > 1900 && Number(itemCode) < 2100) continue;
      if (!entries.find((item) => item.houseCode === itemCode)) {
        entries.push({ houseAddress: address, houseCode: itemCode, electricityReading: '', waterReading: '' });
      }
    }
    if (entries.length > 0) slots.entries = entries;
  }

  return slots;
}

function applyFieldHint(slots, field, text, event = {}) {
  if (!field || !text) return slots;
  if (field === 'houseAddress') slots.houseAddress = extractAddress(text) || text;
  else if (field === 'houseCode') slots.houseCode = normalizeHouseCode(text);
  else if (['rent', 'deposit', 'amount', 'electricityReading', 'waterReading', 'coverageMonths', 'coverageDays', 'moveOutElectricity', 'moveOutWater', 'damageAmount'].includes(field)) {
    slots[field] = normalizeNumber(text, slots[field] || 0);
  } else if (['startDate', 'paymentDate', 'payDate', 'moveOutDate', 'rentCoveredUntil', 'lastPaymentDate', 'lastUtilityDate'].includes(field)) {
    slots[field] = parseDateText(text, event) || text;
  } else if (field === 'paymentCycle') {
    slots.paymentCycle = normalizePaymentCycle(text) || text;
  } else if (field === 'paymentMethod') {
    slots.paymentMethod = normalizePaymentMethod(text) || text;
  } else if (field === 'prepayBasis') {
    const month = normalizeNumber(text, null);
    if (month !== null && /月/.test(text)) slots.coverageMonths = month;
    else slots.amount = normalizeNumber(text, slots.amount || 0);
  } else {
    slots[field] = text;
  }
  if ((slots.houseAddress || slots.houseCode) && !slots.targetLabel) {
    slots.targetLabel = `${slots.houseAddress || ''}${slots.houseCode || ''}`;
  }
  if (slots.tenantName && !slots.targetLabel && ['payment', 'prepay_rent', 'move_out'].includes(slots.scene || '')) {
    slots.targetLabel = slots.tenantName;
  }
  return slots;
}

function applyShortAnswer(slots, scene, text) {
  const compact = trimString(text);
  if (!compact || /[，。；;、\s]/.test(compact)) return slots;

  if (scene === 'house' && slots.houseAddress && slots.houseCode && !slots.rent) {
    const rent = normalizeNumber(compact, null);
    if (rent !== null) slots.rent = rent;
  }

  if (scene === 'tenant' && !slots.tenantName && /^[一-龥]{2,4}$/.test(compact)) {
    slots.tenantName = compact;
  }

  if (['payment', 'prepay_rent'].includes(scene) && !slots.amount && /(?:\d|[零〇一二两三四五六七八九十百千万])/.test(compact)) {
    const amount = normalizeNumber(compact, null);
    if (amount !== null) slots.amount = amount;
  }

  return slots;
}

function mergeSlots(base, extracted) {
  return Object.assign({}, base || {}, extracted || {});
}

function isShortNumberReplyToHouseDraft(baseSlots, scene, text) {
  const compact = trimString(text);
  return scene === 'house'
    && baseSlots
    && baseSlots.houseAddress
    && baseSlots.houseCode
    && !baseSlots.rent
    && compact
    && !/[，。；;、\s]/.test(compact)
    && normalizeNumber(compact, null) !== null;
}

function missingFields(scene, slots) {
  const required = REQUIRED_FIELDS[scene] || [];
  const missing = [];
  required.forEach((field) => {
    if (field === 'targetLabel') {
      if (!slots.targetLabel && !slots.houseCode && !slots.tenantName) missing.push({ field, label: FIELD_LABELS[field] });
      return;
    }
    if (field === 'prepayBasis') {
      if (!slots.coverageMonths && !slots.coverageDays && !slots.amount) missing.push({ field, label: FIELD_LABELS[field] });
      return;
    }
    if (field === 'entries') {
      const entries = Array.isArray(slots.entries) ? slots.entries : [];
      const hasMissingReading = entries.some((item) => {
        return item.electricityReading === undefined || item.electricityReading === null || item.electricityReading === ''
          || item.waterReading === undefined || item.waterReading === null || item.waterReading === '';
      });
      if (entries.length === 0 || hasMissingReading) missing.push({ field, label: FIELD_LABELS[field] });
      return;
    }
    if (slots[field] === undefined || slots[field] === null || slots[field] === '') missing.push({ field, label: FIELD_LABELS[field] });
  });
  return missing;
}

async function queryAll(collectionName, options = {}) {
  const { where = {}, pageSize = 100 } = options;
  const rows = [];
  let offset = 0;
  while (true) {
    let query = db.collection(collectionName);
    if (Object.keys(where).length > 0) query = query.where(where);
    const res = await query.skip(offset).limit(pageSize).get();
    const data = res.data || [];
    rows.push(...data);
    if (data.length < pageSize) break;
    offset += data.length;
  }
  return rows;
}

async function buildMatchHints(scene, slots) {
  const warnings = [];
  const candidates = [];
  if (!slots.houseCode) return { warnings, candidates };
  try {
    const houses = await queryAll('houses');
    const matched = houses.filter((house) => {
      if (house.code !== slots.houseCode) return false;
      return !slots.houseAddress || house.address === slots.houseAddress;
    });
    if (matched.length > 1) {
      warnings.push(`房屋编号 ${slots.houseCode} 命中 ${matched.length} 套房，请补充房屋位置`);
      matched.slice(0, 5).forEach((house) => {
        candidates.push({ type: 'house', id: house._id, label: `${house.address}${house.code}` });
      });
    }
    if (matched.length === 1 && ['payment', 'meter', 'prepay_rent', 'move_out'].includes(scene)) {
      slots.houseAddress = matched[0].address;
      slots.targetLabel = `${matched[0].address}${matched[0].code}`;
    }
  } catch (error) {
    warnings.push('已有记录匹配失败，可先确认文本后再执行');
  }
  return { warnings, candidates };
}

function buildReviewCards(scene, slots, missing) {
  if (scene === 'unsupported') {
    return [{
      title: '暂不支持语音办理',
      subtitle: '删除、导出、系统设置修改请回到对应页面手动操作',
      tone: 'warning',
      fields: []
    }];
  }

  const fieldsByScene = {
    house: ['houseAddress', 'houseCode', 'rent'],
    tenant: ['tenantName', 'tenantPhone', 'tenantIdCard'],
    lease: ['houseAddress', 'houseCode', 'tenantName', 'startDate', 'rent', 'deposit', 'paymentCycle'],
    payment: ['targetLabel', 'amount', 'paymentDate', 'paymentMethod'],
    meter: ['targetLabel', 'electricityReading', 'waterReading'],
    batch_meter: ['entries'],
    prepay_rent: ['targetLabel', 'coverageMonths', 'coverageDays', 'amount', 'payDate', 'paymentMethod'],
    move_out: ['targetLabel', 'moveOutDate', 'moveOutElectricity', 'moveOutWater', 'damageAmount']
  }[scene] || [];

  const fields = fieldsByScene.map((field) => {
    let value = slots[field];
    if (field === 'paymentCycle') value = cycleLabel(slots[field]) || value || '';
    if (field === 'paymentMethod') value = ({ cash: '现金', wechat: '微信', bank: '银行转账', other: '其他' })[slots[field]] || value || '';
    if (field === 'entries') value = Array.isArray(slots.entries) ? `${slots.entries.length} 户待补读数` : '';
    return {
      field,
      label: FIELD_LABELS[field] || field,
      value: value === undefined || value === null ? '' : String(value),
      editable: field !== 'entries'
    };
  });

  return [{
    title: SCENE_LABELS[scene] || '语音办理',
    subtitle: missing.length > 0 ? `还差 ${missing.length} 项信息` : '信息已整理，请确认后执行',
    tone: missing.length > 0 ? 'warning' : 'success',
    fields
  }];
}

async function safeLog(payload) {
  try {
    await db.collection('voice_command_logs').add({
      type: 'plan',
      ...payload,
      createdAt: new Date()
    });
  } catch (error) {
    // 日志集合缺失时不影响主流程
  }
}

function hasDeepSeekConfig() {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

function buildDeepSeekPrompt({ text, scene, mode, currentDraft, ruleIntent, history }) {
  return [
    {
      role: 'system',
      content: [
        '你是房租管理小程序的语音业务助手，服务对象是60岁左右的房东。',
        '你的任务是把用户口述整理成 VoiceIntent，并生成一句自然、简短、适合语音播报的 replyText。',
        '安全规则：你只负责理解和补槽，绝对不能执行落库、不能编造历史账单、不能编造历史付款流水。',
        '如果信息齐全，只能让前端展示确认卡，不能说已经办理完成。',
        '如果信息缺失，一次只追问一个最重要字段。',
        '如果用户提到删除、导出、系统设置、水电单价、批量生成月租账单，必须标记 unsupported。',
        '必须只输出 JSON，不要 Markdown，不要解释。',
        'JSON 字段：replyText, intent。intent 必须兼容已有 VoiceIntent：scene, sceneLabel, mode, operation, variant, target, slots, missingSlots, warnings, candidates, reviewCards, executionPlan, canExecute, riskLevel, transcript, normalizedText, supportMessage。'
      ].join('\n')
    },
    {
      role: 'user',
      content: JSON.stringify({
        userText: text,
        explicitScene: scene,
        mode,
        currentDraft,
        recentHistory: Array.isArray(history) ? history.slice(-4) : [],
        ruleIntent,
        today: new Date().toISOString().slice(0, 10)
      })
    }
  ];
}

function tryParseModelJson(content) {
  if (!content || typeof content !== 'string') return null;
  try {
    return JSON.parse(content);
  } catch (error) {
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      return null;
    }
  }
}

async function callDeepSeekPlanner({ text, scene, mode, currentDraft, ruleIntent, history }) {
  const apiUrl = process.env.DEEPSEEK_API_URL || 'https://api.deepseek.com/chat/completions';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  const response = await postJson(apiUrl, {
    model,
    messages: buildDeepSeekPrompt({ text, scene, mode, currentDraft, ruleIntent, history }),
    temperature: 0.1,
    response_format: { type: 'json_object' }
  }, {
    Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`
  });

  const content = response && response.choices && response.choices[0] && response.choices[0].message
    ? response.choices[0].message.content
    : '';
  const parsed = tryParseModelJson(content);
  if (!parsed || !parsed.intent) throw new Error('DeepSeek 未返回有效 VoiceIntent JSON');
  return parsed;
}

function normalizeModelIntent(modelPayload, ruleIntent) {
  const modelIntent = modelPayload.intent || {};
  const merged = {
    ...ruleIntent,
    ...modelIntent,
    target: {
      ...(ruleIntent.target || {}),
      ...(modelIntent.target || {})
    },
    slots: {
      ...(ruleIntent.slots || {}),
      ...(modelIntent.slots || {})
    }
  };
  merged.scene = merged.scene || ruleIntent.scene;
  merged.sceneLabel = merged.sceneLabel || ruleIntent.sceneLabel;
  merged.mode = merged.mode || ruleIntent.mode;
  merged.operation = merged.operation || ruleIntent.operation;
  merged.variant = merged.variant || ruleIntent.variant;
  merged.missingSlots = Array.isArray(merged.missingSlots) ? merged.missingSlots : ruleIntent.missingSlots;
  merged.warnings = Array.isArray(merged.warnings) ? merged.warnings : ruleIntent.warnings;
  merged.candidates = Array.isArray(merged.candidates) ? merged.candidates : ruleIntent.candidates;
  merged.reviewCards = Array.isArray(merged.reviewCards) && merged.reviewCards.length > 0 ? merged.reviewCards : ruleIntent.reviewCards;
  merged.executionPlan = merged.canExecute ? [{
    action: 'routeToSkill',
    scene: merged.scene,
    operation: merged.operation,
    variant: merged.variant,
    slots: merged.slots
  }] : [];
  merged.riskLevel = merged.riskLevel || ruleIntent.riskLevel;
  merged.transcript = merged.transcript || ruleIntent.transcript;
  merged.normalizedText = merged.normalizedText || ruleIntent.normalizedText;
  merged.supportMessage = merged.scene === 'unsupported'
    ? '暂不支持语音办理，请手动操作。'
    : (merged.supportMessage || '');
  merged.replyText = modelPayload.replyText || buildDefaultReplyText(merged);
  return merged;
}

async function enforceIntentSafety(intent) {
  const scene = intent.scene || 'house';
  const slots = intent.slots || {};
  const matchHints = await buildMatchHints(scene, slots);
  const missing = scene === 'unsupported' ? [] : missingFields(scene, slots);
  const operation = {
    house: 'create',
    tenant: 'create',
    lease: 'create',
    payment: 'pay',
    meter: 'record',
    batch_meter: 'record',
    prepay_rent: 'prepay',
    move_out: 'terminate',
    unsupported: 'unsupported'
  }[scene] || intent.operation || 'create';
  const variant = slots.rentCoveredUntil || slots.lastPaymentDate ? 'snapshot' : (intent.variant || 'daily');
  const canExecute = scene !== 'unsupported' && missing.length === 0 && matchHints.candidates.length === 0;

  return {
    ...intent,
    scene,
    operation,
    variant,
    slots,
    missingSlots: missing,
    warnings: Array.from(new Set([...(intent.warnings || []), ...matchHints.warnings])),
    candidates: matchHints.candidates,
    reviewCards: buildReviewCards(scene, slots, missing),
    canExecute,
    executionPlan: canExecute ? [{
      action: 'routeToSkill',
      scene,
      operation,
      variant,
      slots
    }] : [],
    supportMessage: scene === 'unsupported' ? '暂不支持语音办理，请手动操作。' : ''
  };
}

function buildDefaultReplyText(intent) {
  if (!intent) return '我没有听清楚，请再说一遍。';
  if (intent.scene === 'unsupported') return '这个操作暂不支持语音办理，请您手动操作。';
  if (!intent.canExecute) {
    const missing = Array.isArray(intent.missingSlots) ? intent.missingSlots : [];
    if (missing.length > 0) return `还需要补充${missing[0].label}，请您再说一句。`;
    if (intent.candidates && intent.candidates.length > 0) return '我找到多个可能记录，请补充更准确的信息。';
    return '我还需要补充一点信息，请您再说一句。';
  }
  return `我整理好了，是${intent.sceneLabel}。请您确认卡片内容，无误后再办理。`;
}

exports.main = async (event = {}) => {
  const rawText = trimString(event.text || event.transcriptText || '');
  const text = normalizeText(rawText);
  const mode = event.mode || 'free_dictation';
  const currentDraft = event.currentDraft || {};
  const explicitScene = event.scene || currentDraft.scene || 'auto';
  const detectedScene = detectScene(text, explicitScene);
  const scene = detectedScene || 'house';

  const baseSlots = currentDraft.slots || currentDraft || {};
  const extractedSlots = isShortNumberReplyToHouseDraft(baseSlots, scene, text)
    ? {}
    : extractSlots(text, scene, event);
  let slots = mergeSlots(baseSlots, extractedSlots);
  slots.scene = scene;
  slots = applyFieldHint(slots, event.fieldHint, text, event);
  slots = applyShortAnswer(slots, scene, text);

  if ((slots.houseAddress || slots.houseCode) && !slots.targetLabel) {
    slots.targetLabel = `${slots.houseAddress || ''}${slots.houseCode || ''}`;
  }
  if (slots.tenantName && !slots.targetLabel && ['payment', 'prepay_rent', 'move_out'].includes(scene)) {
    slots.targetLabel = slots.tenantName;
  }
  if (slots.paymentCycle && !slots.paymentCycleLabel) slots.paymentCycleLabel = cycleLabel(slots.paymentCycle);

  const matchHints = await buildMatchHints(scene, slots);
  const missing = scene === 'unsupported' ? [] : missingFields(scene, slots);
  const reviewCards = buildReviewCards(scene, slots, missing);
  const canExecute = scene !== 'unsupported' && missing.length === 0 && matchHints.candidates.length === 0;
  const operation = {
    house: 'create',
    tenant: 'create',
    lease: 'create',
    payment: 'pay',
    meter: 'record',
    batch_meter: 'record',
    prepay_rent: 'prepay',
    move_out: 'terminate',
    unsupported: 'unsupported'
  }[scene] || 'create';
  const variant = slots.rentCoveredUntil || slots.lastPaymentDate ? 'snapshot' : 'daily';

  const intent = {
    scene,
    sceneLabel: SCENE_LABELS[scene] || scene,
    mode,
    operation,
    variant,
    target: {
      label: slots.targetLabel || slots.tenantName || '',
      houseAddress: slots.houseAddress || '',
      houseCode: slots.houseCode || '',
      tenantName: slots.tenantName || ''
    },
    slots,
    missingSlots: missing,
    warnings: matchHints.warnings,
    candidates: matchHints.candidates,
    reviewCards,
    executionPlan: canExecute ? [{
      action: 'routeToSkill',
      scene,
      operation,
      variant,
      slots
    }] : [],
    canExecute,
    riskLevel: ['payment', 'prepay_rent', 'move_out', 'lease'].includes(scene) ? 'high' : 'normal',
    transcript: rawText,
    normalizedText: text,
    supportMessage: scene === 'unsupported' ? '暂不支持语音办理，请手动操作。' : ''
  };

  let finalIntent = intent;
  if (event.useLLM !== false && hasDeepSeekConfig() && text) {
    try {
      const modelPayload = await callDeepSeekPlanner({
        text,
        scene,
        mode,
        currentDraft,
        ruleIntent: intent,
        history: event.history || []
      });
      finalIntent = normalizeModelIntent(modelPayload, intent);
    } catch (error) {
      intent.warnings = (intent.warnings || []).concat(`DeepSeek 规划失败，已使用规则解析：${error.message}`);
      intent.replyText = buildDefaultReplyText(intent);
      finalIntent = intent;
    }
  } else {
    intent.replyText = buildDefaultReplyText(intent);
  }

  finalIntent = await enforceIntentSafety(finalIntent);
  if (!finalIntent.canExecute && finalIntent.replyText && /确认卡|确认|办理/.test(finalIntent.replyText)) {
    finalIntent.replyText = buildDefaultReplyText(finalIntent);
  }
  if (!finalIntent.replyText) finalIntent.replyText = buildDefaultReplyText(finalIntent);

  await safeLog({
    scene,
    mode,
    operation,
    canExecute: finalIntent.canExecute,
    text,
    slots: finalIntent.slots,
    missingSlots: finalIntent.missingSlots,
    warnings: finalIntent.warnings,
    planner: finalIntent === intent ? 'rules' : 'deepseek'
  });

  return ok(finalIntent);
};
