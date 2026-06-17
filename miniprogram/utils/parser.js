/**
 * 自然语言解析引擎（V2 - 适配新数据模型）
 * 将用户输入的文字/语音转文字解析为房屋、租客、合同、缴费操作
 *
 * 新模型：tenants 纯人员信息，lease_agreements 连接 houses 和 tenants，
 *         bills 管理应收，写操作通过云函数（事务保障）
 *
 * 操作类型：
 *   create_house  → 直接写 houses 集合
 *   update_house  → 直接写 houses 集合
 *   create_tenant → 直接写 tenants 集合（仅人员信息）
 *   update_tenant → 直接写 tenants 集合
 *   create_lease  → 调用 createLeaseAgreement 云函数
 *   create_payment → 调用 payBill 云函数（需 billId）
 *   checkout_tenant → 调用 terminateLease 云函数（需 leaseId）
 */

// ========== 正则模式 ==========

const ADDRESS_KEYWORDS = ['东楼北', '东楼南', '里召'];
const ADDRESS_PATTERN = new RegExp('(' + ADDRESS_KEYWORDS.join('|') + ')');
const CODE_PATTERN = /(?:^|[,\s，])([A-Za-z]?\d{1,4}(?:-\d{1,4})?)(?:[,\s，]|$)/;
const RENT_PATTERN = /(?:月租|租金|月付|每月)\s*[¥￥]?\s*(\d+(?:\.\d+)?)/;
const DEPOSIT_PATTERN = /押金\s*[¥￥]?\s*(\d+(?:\.\d+)?)/;
const DATE_FULL_PATTERN = /(\d{4})\s*[年\-\/]\s*(\d{1,2})\s*(?:[月\-\/]\s*(\d{1,2})\s*日?)?/;
const MOVE_IN_PATTERN = /(?:入住|住进|搬进|从)\s*(?:\d{4}\s*[年\-\/]\s*\d{1,2}\s*(?:[月\-\/]\s*\d{1,2}\s*日?)?)/;
const LAST_PAYMENT_PATTERN = /(?:最近\s*(?:一次)?\s*(?:交租|交钱|付款|缴费)|上次\s*(?:交租|交钱|付款|缴费)|已交\s*(?:到|至))\s*(\d{4})\s*[年\-\/]\s*(\d{1,2})/;
const PAYMENT_CYCLE_PATTERN = /(年付|半年付|季付|月付)/;
const CYCLE_MAP = { '月付': 'month', '季付': 'quarter', '半年付': 'half_year', '年付': 'year' };
const EXCLUDE_WORDS = ['月租', '租金', '押金', '入住', '退租', '交租', '水电', '东楼北', '东楼南', '里召'];
const NAME_PATTERN = /(?:^|[,\s，])([一-龥]{2,4})(?:住|租|的|，|,|\s|$)/;

// ========== 提取函数 ==========

function extractAddress(text) {
  const match = text.match(ADDRESS_PATTERN);
  return match ? match[1] : null;
}

function extractCode(text) {
  const addr = extractAddress(text);
  if (addr) {
    const afterAddr = text.slice(text.indexOf(addr) + addr.length);
    const codeMatch = afterAddr.match(/^([A-Za-z]?\d{1,4}(?:-\d{1,4})?)/);
    if (codeMatch) return codeMatch[1];
  }
  const match = text.match(CODE_PATTERN);
  if (match) {
    const code = match[1];
    if (/^\d{4}$/.test(code) && Number(code) > 1900 && Number(code) < 2100) return null;
    return code;
  }
  return null;
}

function extractRent(text) {
  const match = text.match(RENT_PATTERN);
  return match ? Number(match[1]) : null;
}

function extractDeposit(text) {
  const match = text.match(DEPOSIT_PATTERN);
  return match ? Number(match[1]) : null;
}

function extractDate(text) {
  const match = text.match(DATE_FULL_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = match[3] ? Number(match[3]) : 1;
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return {
    year, month, day,
    str: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  };
}

function extractMoveInDate(text) {
  const moveInMatch = text.match(MOVE_IN_PATTERN);
  if (moveInMatch) return extractDate(moveInMatch[0]);
  const dates = [];
  const dateRegex = /\d{4}\s*[年\-\/]\s*\d{1,2}\s*(?:[月\-\/]\s*\d{1,2}\s*日?)?/g;
  let m;
  while ((m = dateRegex.exec(text)) !== null) {
    const d = extractDate(m[0]);
    if (d) dates.push(d);
  }
  return dates.length === 1 ? dates[0] : null;
}

function extractLastPaymentDate(text) {
  const match = text.match(LAST_PAYMENT_PATTERN);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  const lastDay = new Date(year, month, 0).getDate();
  return { year, month, day: lastDay, str: `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}` };
}

function extractPaymentCycle(text) {
  const match = text.match(PAYMENT_CYCLE_PATTERN);
  return match ? { label: match[1], value: CYCLE_MAP[match[1]] } : null;
}

function extractName(text) {
  const nameWithVerb = text.match(/([一-龥]{2,4})\s*(?:住|租)/);
  if (nameWithVerb) {
    const name = nameWithVerb[1];
    if (!EXCLUDE_WORDS.includes(name) && !ADDRESS_KEYWORDS.includes(name)
        && !ADDRESS_KEYWORDS.some(k => name.startsWith(k))) return name;
  }
  const match = text.match(NAME_PATTERN);
  if (match) {
    const name = match[1];
    if (!EXCLUDE_WORDS.includes(name) && !ADDRESS_KEYWORDS.includes(name)
        && !ADDRESS_KEYWORDS.some(k => name.startsWith(k))) return name;
  }
  return null;
}

// ========== 主解析逻辑 ==========

function splitSegments(text) {
  return text.split(/[。；;\n]+/).map(s => s.trim()).filter(s => s.length > 0);
}

function mergeFragments(segments) {
  const merged = [];
  let current = null;
  for (const seg of segments) {
    const hasAddress = ADDRESS_PATTERN.test(seg) || CODE_PATTERN.test(seg);
    const hasName = /[一-龥]{2,4}\s*(?:住|租)/.test(seg);
    if (!current) { current = seg; continue; }
    const currentHasAddress = ADDRESS_PATTERN.test(current) || CODE_PATTERN.test(current);
    const currentHasName = /[一-龥]{2,4}\s*(?:住|租)/.test(current);
    if (currentHasAddress && !currentHasName && hasName) {
      current = current + '，' + seg;
    } else if (!currentHasAddress && hasAddress && !hasName) {
      current = current + '，' + seg;
    } else {
      merged.push(current);
      current = seg;
    }
  }
  if (current) merged.push(current);
  return merged;
}

function parseRecord(text, tmpId) {
  const house = {};
  const tenant = {};
  const payment = {};
  let totalScore = 0;
  let maxScore = 0;

  const address = extractAddress(text);
  if (address) { house.address = address; totalScore += 2; }
  maxScore += 2;

  const code = extractCode(text);
  if (code) { house.code = code; totalScore += 2; }
  maxScore += 2;

  const rent = extractRent(text);
  if (rent) { house.rent = rent; tenant.rent = rent; totalScore += 2; }
  maxScore += 2;

  const name = extractName(text);
  if (name) { tenant.name = name; totalScore += 2; }
  maxScore += 2;

  const moveInDate = extractMoveInDate(text);
  if (moveInDate) { tenant.moveInDate = moveInDate.str; totalScore += 1.5; }
  maxScore += 1.5;

  const paymentCycle = extractPaymentCycle(text);
  if (paymentCycle) { tenant.paymentCycle = paymentCycle.value; tenant.paymentCycleLabel = paymentCycle.label; totalScore += 1.5; }
  maxScore += 1.5;

  const deposit = extractDeposit(text);
  if (deposit) { tenant.deposit = deposit; totalScore += 1; }
  maxScore += 1;

  const lastPaymentDate = extractLastPaymentDate(text);
  if (lastPaymentDate) { payment.lastPaymentDate = lastPaymentDate.str; totalScore += 1; }
  maxScore += 1;

  if (!house.code && !house.address) return null;

  return {
    tmpId,
    house: Object.keys(house).length > 0 ? house : null,
    tenant: Object.keys(tenant).length > 0 ? tenant : null,
    payment: Object.keys(payment).length > 0 ? payment : null,
    confidence: maxScore > 0 ? totalScore / maxScore : 0,
    rawText: text,
    warnings: _generateWarnings(house, tenant)
  };
}

function _generateWarnings(house, tenant) {
  const warnings = [];
  if (!house.code) warnings.push('未识别到房屋编号');
  if (!house.address) warnings.push('未识别到房屋地址');
  if (!tenant || !tenant.name) warnings.push('未识别到租客姓名');
  if (house.rent && house.rent > 10000) warnings.push('租金异常高，请确认');
  if (tenant && tenant.deposit && tenant.deposit > 50000) warnings.push('押金异常高，请确认');
  return warnings;
}

function parseInput(input) {
  if (!input || typeof input !== 'string') return [];
  const segments = splitSegments(input);
  const merged = mergeFragments(segments);
  return merged.map((seg, i) => parseRecord(seg, `tmp_${i + 1}`)).filter(Boolean);
}

// ========== AI 智能解析 ==========

async function aiParseInput(input) {
  if (!input || typeof input !== 'string') return [];
  try {
    const { result } = await wx.cloud.callFunction({ name: 'aiParse', data: { input } });
    if (result.code !== 0) {
      console.warn('AI解析失败，回退到正则解析:', result.message);
      return _fallbackParse(input);
    }
    return result.data;
  } catch (e) {
    console.error('AI解析失败，回退到正则解析:', e);
    return _fallbackParse(input);
  }
}

// ========== 操作解析（查库匹配已有记录） ==========

/**
 * 对AI返回的原始操作进行二次解析
 * @param {Array} rawOps 原始操作数组
 * @param {object} api 服务层实例（需要 getHouses, getTenants, getLeases 等方法）
 */
async function resolveOperations(rawOps, api) {
  // 预加载现有数据
  const [housesRes, tenantsRes, leasesRes] = await Promise.all([
    api.getHouses(),
    api.getTenants(),
    api.getLeases()
  ]);
  const houses = housesRes.data || [];
  const tenants = tenantsRes.data || [];
  const leases = (leasesRes.data || []).filter(l => l.status === 'active');

  // 索引：address|code → house
  const houseMap = {};
  for (const h of houses) {
    houseMap[(h.address || '') + '|' + (h.code || '')] = h;
  }

  // 索引：name → tenant
  const tenantByName = {};
  for (const t of tenants) {
    tenantByName[t.name] = t;
  }

  // 索引：houseId → active lease
  const leaseByHouse = {};
  for (const l of leases) {
    leaseByHouse[l.houseId] = l;
  }

  const resolved = [];

  for (const op of rawOps) {
    const newOp = Object.assign({}, op);
    newOp.warnings = (op.warnings || []).slice();

    const addr = op.match.houseAddress || op.data.address || '';
    const code = op.match.houseCode || op.data.code || '';
    const key = addr + '|' + code;
    const existingHouse = (addr || code) ? houseMap[key] : null;
    const existingTenant = op.match.tenantName ? tenantByName[op.match.tenantName] : null;
    const existingLease = existingHouse ? leaseByHouse[existingHouse._id] : null;

    switch (op.action) {
      case 'create_house':
        if (existingHouse) {
          newOp.action = 'update_house';
          newOp.match = { houseAddress: existingHouse.address, houseCode: existingHouse.code };
          newOp.warnings.push('房屋已存在，将更新信息');
          if (existingHouse.status === 'rented') {
            delete newOp.data.address;
            delete newOp.data.code;
            newOp.warnings.push('房屋正在出租，地址和编号不可修改');
          }
        }
        break;

      case 'update_house':
        if (existingHouse) {
          newOp.match = { houseAddress: existingHouse.address, houseCode: existingHouse.code };
          if (existingHouse.status === 'rented') {
            delete newOp.data.address;
            delete newOp.data.code;
            newOp.warnings.push('房屋正在出租，地址和编号不可修改');
          }
        } else {
          newOp.action = 'create_house';
          newOp.warnings.push('未找到已有房屋，将新建');
        }
        break;

      case 'create_tenant': {
        // V2: tenants 只存人员信息，检查同名租客
        const name = op.data.name;
        if (name && tenantByName[name]) {
          newOp.action = 'update_tenant';
          newOp.match.tenantName = name;
          newOp.warnings.push('租客 ' + name + ' 已存在，将更新信息');
        }
        // 如果同时有房屋和租客信息，标记后续需要创建合同
        if (existingHouse && op.data.name && (op.data.rent || op.data.moveInDate)) {
          newOp._needsLease = true;
          newOp.match.houseAddress = existingHouse.address;
          newOp.match.houseCode = existingHouse.code;
        }
        break;
      }

      case 'update_tenant':
        if (existingTenant) {
          newOp.match.tenantName = existingTenant.name;
        } else if (op.match.tenantName) {
          const found = tenantByName[op.match.tenantName];
          if (found) {
            newOp.match.tenantName = found.name;
          } else {
            newOp.warnings.push('未找到租客' + op.match.tenantName);
          }
        }
        break;

      case 'create_lease': {
        // 新操作类型：创建合同
        if (!existingHouse) {
          if (addr || code) {
            newOp.warnings.push('未找到房屋' + addr + code + '，请先创建房屋');
          }
        } else if (existingLease) {
          newOp.warnings.push('该房屋已有活跃合同，跳过');
          newOp._skip = true;
        }
        // 匹配租客
        if (op.data.tenantName && tenantByName[op.data.tenantName]) {
          newOp.data.tenantId = tenantByName[op.data.tenantName]._id;
        }
        break;
      }

      case 'create_payment': {
        // V2: 需要找到 lease → 找到 unpaid bill → payBill
        if (existingHouse) {
          newOp.match = { houseAddress: existingHouse.address, houseCode: existingHouse.code };
          const lease = existingLease;
          if (lease) {
            newOp.data.leaseId = lease._id;
            // 查找该合同的未缴账单
            try {
              const billsRes = await api.getBills({ leaseId: lease._id, status: 'unpaid' });
              const unpaidBills = billsRes.data || [];
              if (unpaidBills.length > 0) {
                newOp.data.billId = unpaidBills[0]._id;
                if (op.data.amount === undefined) {
                  newOp.data.amount = unpaidBills[0].amount - (unpaidBills[0].paidAmount || 0);
                }
              } else {
                // 也查 partial
                const partialRes = await api.getBills({ leaseId: lease._id, status: 'partial' });
                const partialBills = partialRes.data || [];
                if (partialBills.length > 0) {
                  newOp.data.billId = partialBills[0]._id;
                  if (op.data.amount === undefined) {
                    newOp.data.amount = partialBills[0].amount - (partialBills[0].paidAmount || 0);
                  }
                } else {
                  newOp.warnings.push('该房屋没有未缴账单');
                }
              }
            } catch (e) {
              newOp.warnings.push('查询账单失败：' + (e.message || '未知错误'));
            }
          } else {
            newOp.warnings.push('该房屋没有活跃合同，无法缴费');
          }
        }
        break;
      }

      case 'checkout_tenant': {
        // V2: 需要 leaseId → terminateLease
        if (existingHouse) {
          const lease = existingLease;
          if (lease) {
            newOp.data.leaseId = lease._id;
            newOp.match.tenantName = lease._tenantName || '';
            // 尝试获取租客名
            try {
              const tenant = await api.getTenantById(lease.tenantId);
              if (tenant) {
                newOp.match.tenantName = tenant.name;
                newOp.data.tenantName = tenant.name;
              }
            } catch (e) { /* ignore */ }
          } else {
            newOp.warnings.push('该房屋没有活跃合同');
          }
        } else if (op.match.tenantName) {
          // 按租客名查找其活跃合同
          const tenant = tenantByName[op.match.tenantName];
          if (tenant) {
            const lease = leases.find(l => l.tenantId === tenant._id);
            if (lease) {
              newOp.data.leaseId = lease._id;
              newOp.match.tenantName = tenant.name;
            } else {
              newOp.warnings.push('租客' + op.match.tenantName + '没有活跃合同');
            }
          } else {
            newOp.warnings.push('未找到租客' + op.match.tenantName);
          }
        }
        break;
      }
    }

    // 租客操作后处理
    if (newOp.action === 'create_tenant' || newOp.action === 'update_tenant') {
      _postProcessTenant(newOp);
    }

    resolved.push(newOp);
  }

  return resolved;
}

function _normalizeDate(val) {
  if (!val || typeof val !== 'string') return val;
  val = val.trim();
  if (/^\d{4}-\d{2}-$/.test(val)) return val + '01';
  if (/^\d{4}-\d{2}$/.test(val)) return val + '-01';
  return val;
}

function _postProcessTenant(op) {
  const d = op.data;
  d.moveInDate = _normalizeDate(d.moveInDate);
  d.lastPaymentDate = _normalizeDate(d.lastPaymentDate);

  if (d.moveInDate && /^\d{4}-\d{2}$/.test(d.moveInDate)) {
    op.warnings.push('入住日期缺少具体日，请补充（如 ' + d.moveInDate + '-01）');
    d.moveInDate = d.moveInDate + '-01';
  }
  if (d.lastPaymentDate && /^\d{4}-\d{2}$/.test(d.lastPaymentDate)) {
    op.warnings.push('最近交租日期缺少具体日，请补充精确到日的日期');
    d.lastPaymentDate = d.lastPaymentDate + '-01';
  }

  const cycle = d.paymentCycle || 'month';
  const lastPay = d.lastPaymentDate || d.moveInDate;

  if (lastPay && !d.rentCoveredUntil) {
    d.rentCoveredUntil = _calcRentCoveredUntil(lastPay, cycle);
  }
  if (d.rentCoveredUntil && !d.nextRentDueDate) {
    const next = new Date(d.rentCoveredUntil);
    if (!isNaN(next.getTime())) {
      next.setDate(next.getDate() + 1);
      d.nextRentDueDate = _formatDate(next);
    }
  } else if (lastPay && !d.nextRentDueDate) {
    d.nextRentDueDate = _calcNextDueDate(lastPay, cycle);
  }

  if (d.lastRentAmount === undefined || d.lastRentAmount === '') {
    const rent = d.rent || 0;
    const months = { month: 1, quarter: 3, half_year: 6, year: 12 };
    d.lastRentAmount = rent * (months[cycle] || 1);
  }
}

function _calcRentCoveredUntil(lastPaymentDate, cycle) {
  const d = new Date(lastPaymentDate);
  if (isNaN(d.getTime())) return null;
  const months = { month: 1, quarter: 3, half_year: 6, year: 12 };
  const m = months[cycle] || 1;
  const origDay = d.getDate();
  const isMonthEnd = origDay === new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setMonth(d.getMonth() + m);
  if (d.getDate() !== origDay) d.setDate(0);
  else if (!isMonthEnd) d.setDate(d.getDate() - 1);
  return _formatDate(d);
}

function _formatDate(d) {
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${mo}-${day}`;
}

function _calcNextDueDate(lastPaymentDate, cycle) {
  const d = new Date(lastPaymentDate);
  if (isNaN(d.getTime())) return null;
  const months = { month: 1, quarter: 3, half_year: 6, year: 12 };
  const m = months[cycle] || 1;
  const origDay = d.getDate();
  d.setMonth(d.getMonth() + m);
  if (d.getDate() !== origDay) d.setDate(0);
  return _formatDate(d);
}

// ========== 正则兜底解析 ==========

function _fallbackParse(input) {
  const records = parseInput(input);
  const ops = [];
  for (const r of records) {
    if (r.house) {
      ops.push({
        tmpId: r.tmpId + '_h', action: 'create_house',
        data: { address: r.house.address, code: r.house.code, rent: r.house.rent },
        match: {}, confidence: r.confidence, warnings: r.warnings, rawText: r.rawText
      });
    }
    if (r.tenant && r.house) {
      const data = { name: r.tenant.name };
      if (r.tenant.moveInDate) data.moveInDate = r.tenant.moveInDate;
      if (r.tenant.paymentCycle) data.paymentCycle = r.tenant.paymentCycle;
      if (r.tenant.paymentCycleLabel) data.paymentCycleLabel = r.tenant.paymentCycleLabel;
      if (r.tenant.deposit) data.deposit = r.tenant.deposit;
      if (r.tenant.rent) data.rent = r.tenant.rent;
      ops.push({
        tmpId: r.tmpId + '_t', action: 'create_tenant', data,
        match: { houseAddress: r.house.address, houseCode: r.house.code },
        confidence: r.confidence, warnings: [], rawText: r.rawText
      });
    }
    if (r.payment && r.house) {
      ops.push({
        tmpId: r.tmpId + '_p', action: 'create_payment',
        data: { paymentType: 'rent', paymentDate: r.payment.lastPaymentDate },
        match: { houseAddress: r.house.address, houseCode: r.house.code },
        confidence: r.confidence, warnings: [], rawText: r.rawText
      });
    }
  }
  return ops;
}

// ========== 操作执行器 ==========

/**
 * 执行操作指令列表
 * @param {Array} operations 操作指令数组
 * @param {object} api 服务层实例（需要云函数调用 + 直接查询方法）
 */
async function executeOperations(operations, api) {
  const details = [];
  let successCount = 0;
  let failedCount = 0;

  for (const op of operations) {
    if (op._skip) {
      details.push({ tmpId: op.tmpId, action: op.action, rawText: op.rawText, status: 'skipped', steps: [] });
      continue;
    }

    const detail = { tmpId: op.tmpId, action: op.action, rawText: op.rawText, steps: [] };

    try {
      switch (op.action) {
        case 'create_house': {
          const result = await api.addHouse({
            code: op.data.code || '',
            address: op.data.address || '',
            rent: op.data.rent || 0
          });
          detail.id = result._id || result.id;
          detail.status = 'success';
          break;
        }

        case 'update_house': {
          const house = await _findHouse(api, op.match);
          if (!house) throw new Error('未找到匹配的房屋：' + _matchLabel(op.match));
          if (house.status === 'rented') {
            throw new Error(house.address + house.code + ' 正在出租中，不能修改房屋信息');
          }
          await api.updateHouse(house._id, op.data);
          detail.id = house._id;
          detail.matched = house.address + house.code;
          detail.status = 'success';
          break;
        }

        case 'create_tenant': {
          // V2: 只创建人员信息
          const result = await api.addTenant({
            name: op.data.name || '未知租客',
            phone: op.data.phone || '',
            idCard: op.data.idCard || ''
          });
          detail.id = result._id;
          detail.status = 'success';

          // 如果标记需要创建合同，自动创建 lease 操作
          if (op._needsLease) {
            const house = await _findHouse(api, op.match);
            if (house) {
              try {
                const leaseResult = await api.createLease({
                  houseId: house._id,
                  tenantId: result._id,
                  startDate: op.data.moveInDate || new Date().toISOString().slice(0, 10),
                  rent: op.data.rent || house.rent || 0,
                  deposit: op.data.deposit || 0,
                  paymentCycle: op.data.paymentCycle || 'month',
                  moveInElectricity: op.data.moveInElectricity || 0,
                  moveInWater: op.data.moveInWater || 0
                });
                detail.steps.push({ action: 'create_lease', id: leaseResult.leaseId, status: 'success' });
              } catch (leaseErr) {
                detail.steps.push({ action: 'create_lease', status: 'failed', error: leaseErr.message });
              }
            }
          }
          break;
        }

        case 'update_tenant': {
          const tenant = await _findTenant(api, op.match);
          if (!tenant) throw new Error('未找到匹配的租客：' + _matchLabel(op.match));
          // 只更新人员信息
          const updateData = {};
          if (op.data.name) updateData.name = op.data.name;
          if (op.data.phone) updateData.phone = op.data.phone;
          if (op.data.idCard) updateData.idCard = op.data.idCard;
          await api.updateTenant(tenant._id, updateData);
          detail.id = tenant._id;
          detail.matched = tenant.name;
          detail.status = 'success';
          break;
        }

        case 'create_lease': {
          const house = await _findHouse(api, op.match);
          if (!house) throw new Error('未找到匹配的房屋：' + _matchLabel(op.match));
          const tenantId = op.data.tenantId;
          if (!tenantId) throw new Error('未指定租客，请先创建租客');
          const result = await api.createLease({
            houseId: house._id,
            tenantId,
            startDate: op.data.startDate || op.data.moveInDate || new Date().toISOString().slice(0, 10),
            rent: op.data.rent || house.rent || 0,
            deposit: op.data.deposit || 0,
            paymentCycle: op.data.paymentCycle || 'month',
            moveInElectricity: op.data.moveInElectricity || 0,
            moveInWater: op.data.moveInWater || 0
          });
          detail.id = result.leaseId;
          detail.matched = house.address + house.code;
          detail.status = 'success';
          break;
        }

        case 'create_payment': {
          // V2: 需要 billId → payBill 云函数
          const billId = op.data.billId;
          if (!billId) throw new Error('未找到对应的未缴账单，无法缴费');
          const amount = op.data.amount || 0;
          if (amount <= 0) throw new Error('缴费金额必须大于0');
          const result = await api.payBill(
            billId,
            amount,
            op.data.paymentDate || new Date().toISOString().slice(0, 10),
            op.data.paymentMethod || 'cash'
          );
          detail.id = billId;
          detail.matched = '¥' + amount;
          detail.status = 'success';
          break;
        }

        case 'checkout_tenant': {
          // V2: 需要 leaseId → terminateLease 云函数
          const leaseId = op.data.leaseId;
          if (!leaseId) throw new Error('未找到活跃合同，无法退租');
          const result = await api.terminateLease(
            leaseId,
            op.data.moveOutDate || new Date().toISOString().slice(0, 10),
            op.data.damageDeduction || 0
          );
          detail.id = leaseId;
          detail.matched = op.data.tenantName || '';
          detail.status = 'success';
          detail.settlement = result;
          break;
        }

        default:
          throw new Error('未知操作类型：' + op.action);
      }

      successCount++;
    } catch (e) {
      failedCount++;
      detail.status = 'failed';
      detail.error = e.message || '操作失败';
    }

    details.push(detail);
  }

  return { success: successCount, failed: failedCount, details };
}

// ========== 查找辅助 ==========

async function _findHouse(api, match) {
  if (!match.houseAddress && !match.houseCode) return null;
  const houses = await api.getHouses();
  return (houses.data || []).find(h => {
    const addrMatch = !match.houseAddress || h.address === match.houseAddress;
    const codeMatch = !match.houseCode || h.code === match.houseCode;
    return addrMatch && codeMatch;
  }) || null;
}

async function _findTenant(api, match) {
  // 按姓名查找
  if (match.tenantName) {
    const tenants = await api.getTenants();
    return (tenants.data || []).find(t => t.name === match.tenantName) || null;
  }
  // 通过房屋 → 合同 → 租客
  if (match.houseAddress || match.houseCode) {
    const house = await _findHouse(api, match);
    if (house) {
      const leases = await api.getLeases({ houseId: house._id, status: 'active' });
      if (leases.data && leases.data.length > 0) {
        const tenant = await api.getTenantById(leases.data[0].tenantId);
        return tenant;
      }
    }
  }
  return null;
}

function _matchLabel(match) {
  const parts = [];
  if (match.houseAddress) parts.push(match.houseAddress);
  if (match.houseCode) parts.push(match.houseCode);
  if (match.tenantName) parts.push(match.tenantName);
  return parts.join('') || '未知';
}

module.exports = {
  parseInput,
  aiParseInput,
  resolveOperations,
  executeOperations,
  _test: {
    extractAddress, extractCode, extractRent, extractDeposit, extractDate,
    extractMoveInDate, extractLastPaymentDate, extractPaymentCycle, extractName,
    splitSegments, mergeFragments, parseRecord, _calcNextDueDate,
    _calcRentCoveredUntil, _formatDate
  }
};
