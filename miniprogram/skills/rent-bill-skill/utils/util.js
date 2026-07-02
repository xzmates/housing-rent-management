const CLOUD_ENV_ID = 'cloud1-2gxr9nlc327f3b44'
const PREVIEW_MODE_KEY = 'mp_skills_preview_mode'
const RENT_CONFIRM_STORE_KEY = 'rent_bill_pending_confirms'
let cloudInited = false

function ensureCloudInit() {
  if (cloudInited) return
  if (!wx.cloud) throw new Error('当前环境不支持 wx.cloud')
  wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
  cloudInited = true
  console.info('[ai-mode] rent-bill-skill cloud init env=', CLOUD_ENV_ID)
}

function isPreviewMode() {
  try {
    return wx.getStorageSync(PREVIEW_MODE_KEY) === true
  } catch (err) {
    return false
  }
}

function errorResult(msg, structuredContent) {
  const result = { isError: true, content: [{ type: 'text', text: msg }] }
  if (structuredContent !== undefined) result.structuredContent = structuredContent
  return result
}

function successResult(msg, structuredContent) {
  const result = { isError: false, content: [{ type: 'text', text: msg }] }
  if (structuredContent !== undefined) result.structuredContent = structuredContent
  return result
}

function getArgs(params) {
  return (params && params.arguments) || params || {}
}

function todayText() {
  return formatDate(new Date())
}

function normalizeDate(value) {
  if (!value) return null
  if (value instanceof Date) return value
  if (value.$date) return new Date(value.$date)
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDate(value) {
  const d = normalizeDate(value)
  if (!d) return ''
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function methodText(value) {
  return ({ cash: '现金', wechat: '微信', bank: '银行转账', other: '其他' })[value] || '现金'
}

function normalizePaymentMethod(value) {
  if (['cash', 'wechat', 'bank', 'other'].indexOf(value) >= 0) return value
  return 'cash'
}

function readConfirmStore() {
  try {
    const store = wx.getStorageSync(RENT_CONFIRM_STORE_KEY)
    return store && typeof store === 'object' ? store : {}
  } catch (err) {
    return {}
  }
}

function writeConfirmStore(store) {
  try {
    wx.setStorageSync(RENT_CONFIRM_STORE_KEY, store || {})
  } catch (err) {
    console.warn('[ai-mode] rent-bill-skill writeConfirmStore skipped:', err.message)
  }
}

function createRentConfirmPayload(data) {
  const confirmToken = `rent_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const store = readConfirmStore()
  store[confirmToken] = {
    createdAt: Date.now(),
    billId: data.billId,
    amount: data.amount,
    paymentMethod: data.paymentMethod,
    paymentDate: data.paymentDate
  }
  writeConfirmStore(store)
  return Object.assign({}, data, { confirmToken })
}

function takeRentConfirmPayload(confirmToken) {
  if (!confirmToken) throw new Error('缺少收款确认令牌，请先展示确认卡并由用户点击确认收款')
  const store = readConfirmStore()
  const payload = store[confirmToken]
  if (!payload) throw new Error('收款确认已失效，请重新生成确认卡')
  delete store[confirmToken]
  writeConfirmStore(store)
  return payload
}

function statusText(status, remaining) {
  if (status === 'paid' || remaining <= 0) return '已结清'
  if (status === 'partial') return '部分收款'
  return '待收'
}

function callFunction(name, data) {
  ensureCloudInit()
  console.info('[ai-mode] rent-bill-skill callFunction name=', name, 'data=', JSON.stringify(data || {}))
  return wx.cloud.callFunction({ name, data: data || {} }).then((res) => {
    const result = res.result || {}
    if (result.code && result.code !== 200 && result.code !== 0) {
      throw new Error(result.message || `${name} 调用失败`)
    }
    return Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result
  })
}

function db() {
  ensureCloudInit()
  return wx.cloud.database()
}

async function queryAll(collectionName, options = {}) {
  const { where = {}, orderBy, pageSize = 100 } = options
  const rows = []
  let offset = 0
  while (true) {
    let q = db().collection(collectionName)
    if (Object.keys(where).length > 0) q = q.where(where)
    if (Array.isArray(orderBy)) {
      orderBy.forEach((item) => {
        q = q.orderBy(item.field, item.direction)
      })
    } else if (orderBy) {
      q = q.orderBy(orderBy.field, orderBy.direction)
    }
    const res = await q.skip(offset).limit(pageSize).get()
    const data = res.data || []
    rows.push(...data)
    if (data.length < pageSize) break
    offset += data.length
  }
  return rows
}

async function getByIds(collectionName, ids) {
  const cleanIds = Array.from(new Set((ids || []).filter(Boolean)))
  if (cleanIds.length === 0) return {}
  const _ = db().command
  const rows = await queryAll(collectionName, { where: { _id: _.in(cleanIds) } })
  const map = {}
  rows.forEach((item) => {
    map[item._id] = item
  })
  return map
}

function buildFilterText(args) {
  const parts = []
  if (args.houseCode) parts.push(`房号 ${args.houseCode}`)
  if (args.tenantName) parts.push(`租客 ${args.tenantName}`)
  return parts.length > 0 ? parts.join('，') : '全部房屋'
}

function normalizeHouseCode(value) {
  return value === undefined || value === null ? '' : String(value).trim().toUpperCase()
}

function normalizeName(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function isOverdue(dueDate) {
  const d = normalizeDate(dueDate)
  if (!d) return false
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  d.setHours(0, 0, 0, 0)
  return d.getTime() < today.getTime()
}

function toRentBillItem(bill, maps) {
  const lease = maps.leaseMap[bill.leaseId] || {}
  const house = maps.houseMap[lease.houseId || bill.houseId] || {}
  const tenant = maps.tenantMap[lease.tenantId || bill.tenantId] || {}
  const remaining = money(Number(bill.amount || 0) - Number(bill.paidAmount || 0))
  return {
    billId: String(bill._id || ''),
    leaseId: String(bill.leaseId || ''),
    houseId: String(lease.houseId || bill.houseId || ''),
    tenantId: String(lease.tenantId || bill.tenantId || ''),
    houseCode: String(house.code || ''),
    houseAddress: String(house.address || ''),
    houseLabel: house.code ? `${house.code} - ${house.address || ''}` : '未关联房屋',
    tenantName: String(tenant.name || '未知租客'),
    period: String(bill.period || ''),
    amount: money(bill.amount),
    paidAmount: money(bill.paidAmount),
    remaining,
    dueDate: formatDate(bill.dueDate),
    overdue: isOverdue(bill.dueDate),
    status: String(bill.status || 'unpaid'),
    statusText: statusText(bill.status, remaining)
  }
}

async function loadRentContext() {
  const [billPayload, leasePayload] = await Promise.all([
    callFunction('queryLeaseData', { action: 'listBills', filters: { type: 'rent' } }),
    callFunction('queryLeaseData', { action: 'listLeases', filters: {} })
  ])
  const bills = (billPayload && billPayload.data) || []
  const leases = (leasePayload && leasePayload.data) || []
  const leaseMap = {}
  const houseIds = []
  const tenantIds = []
  leases.forEach((lease) => {
    leaseMap[lease._id] = lease
    if (lease.houseId) houseIds.push(lease.houseId)
    if (lease.tenantId) tenantIds.push(lease.tenantId)
  })
  bills.forEach((bill) => {
    if (bill.houseId) houseIds.push(bill.houseId)
    if (bill.tenantId) tenantIds.push(bill.tenantId)
  })
  const [houseMap, tenantMap] = await Promise.all([
    getByIds('houses', houseIds),
    getByIds('tenants', tenantIds)
  ])
  return { bills, maps: { leaseMap, houseMap, tenantMap } }
}

function filterRentItems(items, args) {
  const houseCode = normalizeHouseCode(args.houseCode)
  const tenantName = normalizeName(args.tenantName)
  return items.filter((item) => {
    if (houseCode && item.houseCode.toUpperCase().indexOf(houseCode) < 0) return false
    if (tenantName && item.tenantName.indexOf(tenantName) < 0) return false
    return true
  })
}

function defaultRentBills() {
  return [
    {
      billId: 'mock_rent_001',
      leaseId: 'mock_lease_001',
      houseId: 'mock_house_001',
      tenantId: 'mock_tenant_001',
      houseCode: '101',
      houseAddress: '东楼北',
      houseLabel: '101 - 东楼北',
      tenantName: '王阿姨',
      period: '2026-07',
      amount: 1200,
      paidAmount: 0,
      remaining: 1200,
      dueDate: '2026-07-05',
      overdue: false,
      status: 'unpaid',
      statusText: '待收'
    },
    {
      billId: 'mock_rent_002',
      leaseId: 'mock_lease_002',
      houseId: 'mock_house_002',
      tenantId: 'mock_tenant_002',
      houseCode: '203',
      houseAddress: '东楼南',
      houseLabel: '203 - 东楼南',
      tenantName: '李叔',
      period: '2026-06',
      amount: 1000,
      paidAmount: 300,
      remaining: 700,
      dueDate: '2026-06-20',
      overdue: true,
      status: 'partial',
      statusText: '部分收款'
    }
  ]
}

function defaultHistory() {
  return [
    {
      paymentId: 'mock_pay_001',
      billId: 'mock_paid_001',
      houseLabel: '102 - 东楼北',
      tenantName: '张三',
      period: '2026-06',
      amount: 1200,
      paymentDate: '2026-06-05',
      paymentMethod: 'wechat',
      paymentMethodText: '微信'
    },
    {
      paymentId: 'mock_pay_002',
      billId: 'mock_paid_002',
      houseLabel: '301 - 里召',
      tenantName: '赵姐',
      period: '2026-06',
      amount: 900,
      paymentDate: '2026-06-03',
      paymentMethod: 'cash',
      paymentMethodText: '现金'
    }
  ]
}

module.exports = {
  ensureCloudInit,
  isPreviewMode,
  errorResult,
  successResult,
  getArgs,
  todayText,
  formatDate,
  money,
  methodText,
  normalizePaymentMethod,
  createRentConfirmPayload,
  takeRentConfirmPayload,
  statusText,
  callFunction,
  queryAll,
  loadRentContext,
  toRentBillItem,
  filterRentItems,
  buildFilterText,
  defaultRentBills,
  defaultHistory
}
