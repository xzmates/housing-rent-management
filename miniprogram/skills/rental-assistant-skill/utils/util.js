const CLOUD_ENV_ID = 'cloud1-2gxr9nlc327f3b44'
const PREVIEW_MODE_KEY = 'mp_skills_preview_mode'
const CONFIRM_STORE_KEY = 'rental_assistant_pending_confirms'
let cloudInited = false

function ensureCloudInit() {
  if (cloudInited) return
  if (!wx.cloud) throw new Error('当前环境不支持 wx.cloud')
  wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
  cloudInited = true
  console.info('[ai-mode] rental-assistant-skill cloud init env=', CLOUD_ENV_ID)
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

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100
}

function todayText() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function readConfirmStore() {
  try {
    return wx.getStorageSync(CONFIRM_STORE_KEY) || {}
  } catch (err) {
    return {}
  }
}

function writeConfirmStore(store) {
  try {
    wx.setStorageSync(CONFIRM_STORE_KEY, store || {})
  } catch (err) {
    console.warn('[ai-mode] rental-assistant-skill write confirm store skipped:', err.message)
  }
}

function createConfirmToken(actionName) {
  return `${actionName}_${Date.now()}_${Math.floor(Math.random() * 100000)}`
}

function callFunction(name, data) {
  ensureCloudInit()
  console.info('[ai-mode] rental-assistant-skill callFunction name=', name, 'data=', JSON.stringify(data || {}))
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

function normalizeText(value) {
  return value === undefined || value === null ? '' : String(value).trim()
}

function normalizeHouseCode(value) {
  return normalizeText(value).toUpperCase()
}

function activeTargetLabel(target) {
  const house = `${target.houseAddress || ''}${target.houseCode || ''}`
  return `${target.tenantName || '未知租客'}${house ? `（${house}）` : ''}`
}

async function queryLeaseData(action, filters = {}) {
  const data = await callFunction('queryLeaseData', { action, filters })
  if (data && Array.isArray(data.data)) return data.data
  return data
}

async function loadActiveLeaseTargets() {
  const leases = await queryLeaseData('listLeases', { status: 'active' })
  const tenants = await queryLeaseData('listTenants', { ids: leases.map((lease) => lease.tenantId) })
  const houses = await queryLeaseData('listHouses', { ids: leases.map((lease) => lease.houseId) })
  const tenantMap = {}
  const houseMap = {}
  tenants.forEach((tenant) => { tenantMap[tenant._id] = tenant })
  houses.forEach((house) => { houseMap[house._id] = house })
  return leases.map((lease) => {
    const tenant = tenantMap[lease.tenantId] || {}
    const house = houseMap[lease.houseId] || {}
    return {
      leaseId: String(lease._id || ''),
      tenantId: String(lease.tenantId || ''),
      tenantName: String(tenant.name || ''),
      houseId: String(lease.houseId || ''),
      houseAddress: String(house.address || ''),
      houseCode: String(house.code || ''),
      lease,
      tenant,
      house
    }
  })
}

function findActiveMoveOutTarget(targets, args) {
  const tenantName = normalizeText(args.tenantName)
  const houseAddress = normalizeText(args.houseAddress)
  const houseCode = normalizeHouseCode(args.houseCode)
  if (!tenantName && !houseCode) return { status: 'missing' }

  const matches = targets.filter((target) => {
    const tenantMatched = !tenantName || target.tenantName === tenantName
    const codeMatched = !houseCode || normalizeHouseCode(target.houseCode) === houseCode
    const addressMatched = !houseAddress || target.houseAddress === houseAddress
    return tenantMatched && codeMatched && addressMatched
  })
  if (matches.length === 1) return { status: 'single', target: matches[0] }
  if (matches.length > 1) return { status: 'ambiguous', targets: matches }
  return { status: 'none' }
}

function activeTargetsText(targets) {
  if (!targets || targets.length === 0) return '当前没有活动合同。'
  return `目前活动合同有：${targets.map(activeTargetLabel).join('、')}。今天是谁要办理退租呢？`
}

function parseDateInput(value) {
  if (value instanceof Date) return value
  if (typeof value === 'string') {
    const m = value.match(/^(\d{4})-(\d{2})-(\d{2})/)
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  }
  return value ? new Date(value) : new Date()
}

function addDays(date, days) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days)
}

function monthEnd(year, month) {
  return new Date(year, month, 0)
}

function parseRentPeriodEnd(period) {
  if (typeof period !== 'string') return null
  const matches = period.match(/\d{4}-\d{2}/g)
  if (!matches || matches.length === 0) return null
  const last = matches[matches.length - 1]
  const [year, month] = last.split('-').map(Number)
  return monthEnd(year, month)
}

function formatMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}

function formatDate(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

function formatRentPeriod(start, months) {
  const end = addDays(new Date(start.getFullYear(), start.getMonth() + months, start.getDate()), -1)
  if (months === 1) return formatMonth(start)
  return `${formatMonth(start)}~${formatMonth(end)}`
}

function ceilMonthsInclusive(start, end) {
  if (!start || !end || end < start) return 0
  const months = (end.getFullYear() - start.getFullYear()) * 12 + end.getMonth() - start.getMonth() + 1
  return Math.max(0, months)
}

function calcOccupiedMonths(startDate, endDate) {
  if (!startDate || !endDate || endDate < startDate) return 0
  const months = (endDate.getFullYear() - startDate.getFullYear()) * 12 + endDate.getMonth() - startDate.getMonth()
  return endDate.getDate() >= startDate.getDate() ? months + 1 : months
}

function dateMs(value) {
  if (!value) return 0
  if (value.$date) return Number(value.$date) || new Date(value.$date).getTime() || 0
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? 0 : d.getTime()
}

function latestUtilityRecord(rows) {
  return (rows || []).slice().sort((a, b) => {
    const calcDiff = dateMs(b.calculationDate) - dateMs(a.calculationDate)
    if (calcDiff !== 0) return calcDiff
    return dateMs(b.createdAt) - dateMs(a.createdAt)
  })[0] || null
}

function billRemaining(bill) {
  return Math.max(0, Number(bill.amount || 0) - Number(bill.paidAmount || 0))
}

async function getSystemSettings() {
  const settings = await queryLeaseData('getSystemSettings')
  return {
    electricityPrice: Number(settings.electricityPrice || 0.8),
    waterPrice: Number(settings.waterPrice || 3.5)
  }
}

async function buildMoveOutPreview(target, args) {
  const lease = target.lease || {}
  const moveOutDate = args.moveOutDate || todayText()
  const actualEndDate = parseDateInput(moveOutDate)
  const [bills, settings, currentLeaseRecords, houseRecords] = await Promise.all([
    queryLeaseData('listBills', { leaseId: target.leaseId }),
    getSystemSettings(),
    queryLeaseData('listUtilityRecords', { leaseId: target.leaseId }),
    queryLeaseData('listUtilityRecords', { houseId: target.houseId })
  ])
  const lastRecord = latestUtilityRecord(currentLeaseRecords) || latestUtilityRecord(houseRecords)
  const lastElectricity = Number(lastRecord ? lastRecord.electricityReading : (lease.moveInElectricity || 0))
  const lastWater = Number(lastRecord ? lastRecord.waterReading : (lease.moveInWater || 0))
  const moveOutElectricity = args.moveOutElectricity === undefined ? lastElectricity : Number(args.moveOutElectricity || 0)
  const moveOutWater = args.moveOutWater === undefined ? lastWater : Number(args.moveOutWater || 0)
  const electricityUsage = Math.max(0, moveOutElectricity - lastElectricity)
  const waterUsage = Math.max(0, moveOutWater - lastWater)
  const electricityCost = money(electricityUsage * settings.electricityPrice)
  const waterCost = money(waterUsage * settings.waterPrice)
  const utilityCost = money(electricityCost + waterCost)

  const rentPeriods = bills.filter((bill) => bill.type === 'rent').map((bill) => parseRentPeriodEnd(bill.period)).filter(Boolean)
  const latestRentBilledUntil = rentPeriods.length > 0
    ? new Date(Math.max(...rentPeriods.map((date) => date.getTime())))
    : parseDateInput(lease.rentCoveredUntil)
  const supplementalRentStart = addDays(latestRentBilledUntil, 1)
  const supplementalRentMonths = ceilMonthsInclusive(supplementalRentStart, actualEndDate)
  const supplementalRent = money(supplementalRentMonths * Number(lease.rent || 0))

  const outstandingBills = bills
    .filter((bill) => ['unpaid', 'partial'].includes(bill.status) && billRemaining(bill) > 0)
    .map((bill) => ({
      period: bill.period || bill.type,
      type: bill.type,
      remaining: money(billRemaining(bill))
    }))
  if (supplementalRent > 0) {
    outstandingBills.push({
      period: formatRentPeriod(supplementalRentStart, supplementalRentMonths),
      type: 'rent',
      remaining: supplementalRent
    })
  }
  if (utilityCost > 0) {
    outstandingBills.push({
      period: moveOutDate,
      type: 'utility',
      remaining: utilityCost
    })
  }

  const outstandingAmount = money(outstandingBills.reduce((sum, bill) => sum + Number(bill.remaining || 0), 0))
  const damageAmount = money(args.damageAmount || 0)
  const deposit = money(lease.deposit || 0)
  const refundableDeposit = money(deposit - damageAmount)
  const depositForOffset = Math.max(0, refundableDeposit)
  const depositOffset = money(Math.min(depositForOffset, outstandingAmount))
  const refundAmount = money(Math.max(0, depositForOffset - depositOffset))
  const damageExtraDue = damageAmount > deposit ? money(damageAmount - deposit) : 0
  const extraPayment = money(Math.max(0, outstandingAmount - depositOffset) + damageExtraDue)

  const paidRentBills = bills.filter((bill) => bill.type === 'rent' && ['paid', 'partial'].includes(bill.status))
  const totalPaidRent = money(paidRentBills.reduce((sum, bill) => sum + Number(bill.paidAmount || 0), 0))
  const leaseStartDate = parseDateInput(lease.startDate)
  const occupiedMonths = calcOccupiedMonths(leaseStartDate, actualEndDate)
  const actualRentDue = money(occupiedMonths * Number(lease.rent || 0))
  const overpaidRent = Math.max(0, money(totalPaidRent - actualRentDue))
  const rentRefund = {
    occupiedPeriod: `${formatDate(leaseStartDate)} 至 ${formatDate(actualEndDate)}`,
    occupiedMonths,
    actualRentDue,
    totalPaidRent,
    overpaidRent,
    paidRentDetails: paidRentBills.map((bill) => ({
      period: bill.period || '',
      amount: money(bill.paidAmount || 0)
    }))
  }
  const totalRefund = money(refundAmount + overpaidRent - extraPayment)

  return {
    tenantName: target.tenantName,
    houseAddress: target.houseAddress,
    houseCode: target.houseCode,
    houseText: `${target.houseCode || ''}${target.houseAddress ? ` - ${target.houseAddress}` : ''}` || activeTargetLabel(target),
    targetText: activeTargetLabel(target),
    moveOutDate,
    damageAmount,
    deposit,
    lastElectricity,
    lastWater,
    moveOutElectricity,
    moveOutWater,
    electricityUsage,
    waterUsage,
    electricityPrice: settings.electricityPrice,
    waterPrice: settings.waterPrice,
    electricityCost,
    waterCost,
    utilityCost,
    supplementalRent,
    supplementalRentMonths,
    outstandingBills,
    outstandingAmount,
    payableBeforeDeposit: outstandingAmount,
    depositOffset,
    refundAmount,
    damageExtraDue,
    damageOffset: money(Math.max(0, damageAmount - damageExtraDue)),
    extraPayment,
    rentRefund,
    totalRefund,
    finalLabel: totalRefund >= 0 ? '应退总额' : '仍需补缴',
    finalAmount: Math.abs(totalRefund),
    finalSignedText: totalRefund >= 0 ? `¥${money(totalRefund)}` : `-¥${money(Math.abs(totalRefund))}`,
    canMoveOutText: outstandingAmount > 0 ? `待抵扣款项 ¥${outstandingAmount}，确认退租后将优先用押金自动抵扣。` : '未结清款项已全部结清，可以办理退租。',
    utilityUsageText: `${electricityUsage} 度 / ${waterUsage} 吨`
  }
}

function actionList() {
  return [
    { key: 'house', index: 1, title: '新增房屋', subtitle: '房屋位置、编号、月租', sample: '新增房屋，东楼北102，月租1000' },
    { key: 'tenant', index: 2, title: '新增租客', subtitle: '姓名、电话、身份证', sample: '新增租客，小问，电话138...' },
    { key: 'lease', index: 3, title: '新建合同', subtitle: '房屋、租客、租金、押金、起租日', sample: '给102和小问新建合同，月租1000，押金1000' },
    { key: 'payment', index: 4, title: '缴费确认', subtitle: '房号或租客，再说金额', sample: '101麦粥缴费500，现金' },
    { key: 'meter', index: 5, title: '单次抄表', subtitle: '房号、电表、水表', sample: '102抄表，电表235，水表18' },
    { key: 'prepay', index: 6, title: '提前收租', subtitle: '房号、收几个月、方式', sample: '103提前收两个月租，微信' },
    { key: 'moveOut', index: 7, title: '退租结算', subtitle: '租客或房号、退租日、水电表', sample: '101退租，今天退，电表260水表22' }
  ]
}

function createConfirmPayload(actionName, actionTitle, slots, fields, summary) {
  const confirmToken = createConfirmToken(actionName)
  const payload = {
    mode: 'confirm',
    actionName,
    actionTitle,
    confirmToken,
    status: 'pending',
    statusText: '待确认',
    summary,
    success: 0,
    failed: 0,
    fields: fields || [],
    details: []
  }
  const store = readConfirmStore()
  store[confirmToken] = {
    actionName,
    actionTitle,
    slots: slots || {},
    createdAt: Date.now()
  }
  writeConfirmStore(store)
  return payload
}

function takeConfirmPayload(confirmToken, actionName) {
  const token = String(confirmToken || '')
  if (!token) throw new Error('缺少确认令牌，请先展示确认卡并由用户点击确认')
  const store = readConfirmStore()
  const pending = store[token]
  if (!pending) throw new Error('确认已失效，请重新发起办理')
  if (actionName && pending.actionName !== actionName) throw new Error('确认事项不匹配，请重新发起办理')
  delete store[token]
  writeConfirmStore(store)
  return pending
}

async function runScenario(scene, slots, title, variant) {
  const data = await callFunction('executeVoiceScenario', {
    scene,
    variant: variant || 'daily',
    slots,
    createdBy: 'ai_skill'
  })
  const details = Array.isArray(data.details) ? data.details : []
  const summary = data.summary || details.map((item) => item.message).filter(Boolean).join('；') || '办理完成'
  return {
    mode: 'result',
    actionTitle: title,
    status: data.failed > 0 ? 'partial' : 'success',
    statusText: data.failed > 0 ? '部分完成' : '办理成功',
    summary,
    success: Number(data.success || 0),
    failed: Number(data.failed || 0),
    details: details.map((item) => ({
      title: String(item.title || title),
      status: String(item.status || 'success'),
      message: String(item.message || ''),
      id: String(item.id || '')
    }))
  }
}

function previewResult(title) {
  return {
    mode: 'result',
    actionTitle: title,
    status: 'success',
    statusText: '办理成功',
    summary: `${title}已完成`,
    success: 1,
    failed: 0,
    details: [
      { title, status: 'success', message: `${title}示例结果`, id: 'preview' }
    ]
  }
}

function resultText(data) {
  return `${data.actionTitle}：${data.summary}`
}

module.exports = {
  ensureCloudInit,
  isPreviewMode,
  errorResult,
  successResult,
  getArgs,
  money,
  todayText,
  actionList,
  loadActiveLeaseTargets,
  findActiveMoveOutTarget,
  activeTargetsText,
  activeTargetLabel,
  buildMoveOutPreview,
  createConfirmPayload,
  takeConfirmPayload,
  runScenario,
  previewResult,
  resultText
}
