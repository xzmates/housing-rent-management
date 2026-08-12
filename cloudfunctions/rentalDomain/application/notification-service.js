const crypto = require('crypto')
const { DomainError, invariant } = require('../infrastructure/errors')
const { createQueryService } = require('./query-service')
const { businessDateKey } = require('../domain/business-date')

const SUBSCRIPTION_COLLECTION = 'notification_subscriptions'
const DELIVERY_COLLECTION = 'notification_deliveries'
const DEFAULT_PAGE = 'pages/dashboard/index'
const DEFAULT_FIELD_MAP = {
  total: 'amount28',
  count: 'thing18',
  overdue: 'phrase17',
  top: 'thing9',
  date: 'time37'
}

function number(value) {
  const result = Number(value || 0)
  return Number.isFinite(result) ? Math.round(result * 100) / 100 : 0
}

function textLimit(value, maxLength = 20) {
  return Array.from(String(value || '')).slice(0, maxLength).join('')
}

function textLength(value) {
  return Array.from(String(value || '')).length
}

function amountText(value) {
  return String(number(value))
}

function roomText(value) {
  const compact = String(value || '未关联房屋').replace(/\s+/g, '')
  return compact.split(/[-－—·]/).filter(Boolean)[0] || compact || '房'
}

function tenantText(value) {
  return String(value || '未关联租客').replace(/\s+/g, '') || '租客'
}

function allocateTextLengths(values, budget, initialLengths = []) {
  const chars = values.map(value => Array.from(String(value || '')))
  const lengths = chars.map((value, index) => Math.min(value.length, Math.max(0, Number(initialLengths[index] || 0))))
  let remaining = Math.max(0, budget - lengths.reduce((sum, value) => sum + value, 0))
  while (remaining > 0) {
    let changed = false
    for (let index = 0; index < chars.length && remaining > 0; index += 1) {
      if (lengths[index] >= chars[index].length) continue
      lengths[index] += 1
      remaining -= 1
      changed = true
    }
    if (!changed) break
  }
  return lengths
}

function compactEntries(entries, tail = '', maxLength = 20) {
  const separatorLength = Math.max(0, entries.length - 1)
  const fixedLength = entries.reduce((sum, item) => sum + textLength(item.amount), 0) + separatorLength + textLength(tail)
  const roomValues = entries.map(item => item.room)
  const tenantValues = entries.map(item => item.tenant)
  const minimumRooms = roomValues.map(value => Math.min(1, textLength(value)))
  const minimumTenants = tenantValues.map(value => Math.min(1, textLength(value)))
  const minimumLength = minimumRooms.reduce((sum, value) => sum + value, 0) + minimumTenants.reduce((sum, value) => sum + value, 0)
  const contentBudget = Math.max(0, maxLength - fixedLength)
  const roomBudget = Math.max(0, contentBudget - minimumTenants.reduce((sum, value) => sum + value, 0))
  const roomLengths = allocateTextLengths(roomValues, roomBudget, minimumRooms)
  const usedRoomLength = roomLengths.reduce((sum, value) => sum + value, 0)
  const tenantBudget = Math.max(0, contentBudget - usedRoomLength)
  const tenantLengths = allocateTextLengths(tenantValues, tenantBudget, contentBudget >= minimumLength ? minimumTenants : [])

  const content = entries.map((item, index) => {
    const room = Array.from(item.room).slice(0, roomLengths[index]).join('')
    const tenant = Array.from(item.tenant).slice(0, tenantLengths[index]).join('')
    return `${room}${tenant}${item.amount}`
  }).join('；')
  return textLimit(`${content}${tail}`, maxLength)
}

function summaryGroupOrder(left, right) {
  const overduePriority = Number(number(right.overdueAmount) > 0) - Number(number(left.overdueAmount) > 0)
  if (overduePriority) return overduePriority
  const amountPriority = number(right.amount) - number(left.amount)
  if (amountPriority) return amountPriority
  return String(left.houseLabel || '').localeCompare(String(right.houseLabel || ''), 'zh-CN', { numeric: true })
}

function buildTopText(groups) {
  const rows = [...groups].sort(summaryGroupOrder)
  if (!rows.length) return ''
  const shown = rows.length === 2 ? rows.slice(0, 2) : rows.slice(0, 1)
  const entries = shown.map(item => ({
    room: roomText(item.houseLabel),
    tenant: tenantText(item.tenantName),
    amount: amountText(item.amount)
  }))
  if (rows.length <= 2) return compactEntries(entries)
  const remainingAmount = amountText(rows.slice(1).reduce((sum, item) => sum + number(item.amount), 0))
  return compactEntries(entries, `；另${rows.length - 1}项${remainingAmount}`)
}

function parseFieldMap(raw) {
  if (!raw) return { ...DEFAULT_FIELD_MAP }
  try {
    const parsed = JSON.parse(raw)
    return { ...DEFAULT_FIELD_MAP, ...(parsed && typeof parsed === 'object' ? parsed : {}) }
  } catch (error) {
    throw new DomainError('CONFIGURATION_ERROR', 'WECHAT_RECEIVABLE_TEMPLATE_FIELDS 必须是合法 JSON')
  }
}

function readConfig(env = process.env) {
  return {
    templateId: String(env.WECHAT_RECEIVABLE_TEMPLATE_ID || '').trim(),
    fieldMap: parseFieldMap(env.WECHAT_RECEIVABLE_TEMPLATE_FIELDS),
    miniprogramState: String(env.WECHAT_MINIPROGRAM_STATE || 'formal').trim(),
    page: String(env.WECHAT_RECEIVABLE_PAGE || DEFAULT_PAGE).trim() || DEFAULT_PAGE
  }
}

function subscriptionView(doc, config) {
  const acceptedCount = Math.max(0, Number(doc && doc.acceptedCount || 0))
  const sentCount = Math.max(0, Number(doc && doc.sentCount || 0))
  const remainingCredits = Math.max(0, Number(doc && doc.remainingCredits || 0))
  return {
    enabled: Boolean(doc && doc.enabled),
    acceptedCount,
    sentCount,
    remainingCredits,
    templateConfigured: Boolean(config.templateId),
    templateId: config.templateId,
    sendTime: '09:00',
    timeZone: 'Asia/Shanghai',
    lastSentAt: doc && doc.lastSentAt || null,
    lastErrorCode: doc && doc.lastErrorCode || ''
  }
}

function buildSummary(groups, dateKey) {
  const rows = Array.isArray(groups) ? groups : []
  const orderedRows = [...rows].sort(summaryGroupOrder)
  const totalAmount = number(rows.reduce((sum, item) => sum + number(item.amount), 0))
  const overdueAmount = number(rows.reduce((sum, item) => sum + number(item.overdueAmount), 0))
  const overdueCount = rows.reduce((sum, item) => sum + Number(item.overdueCount || 0), 0)
  const overdueGroupCount = rows.filter(item => number(item.overdueAmount) > 0).length
  const billCount = rows.reduce((sum, item) => sum + Math.max(1, Number(item.billCount || 0), Number(item.overdueCount || 0)), 0)
  const first = orderedRows[0] || null
  const firstText = buildTopText(orderedRows)
  const earliestDueDate = rows.map(item => String(item.earliestDueDate || '')).filter(Boolean).sort()[0] || dateKey
  const firstType = first && first.typeText || '待收账单'
  const typeCount = new Set(rows.map(item => String(item.type || item.typeText || '')).filter(Boolean)).size
  const statusText = overdueCount === 0 ? '暂无逾期' : overdueCount >= billCount ? '全部逾期' : '部分逾期'
  return {
    date: dateKey,
    earliestDueDate,
    totalAmount,
    groupCount: rows.length,
    billCount,
    overdueAmount,
    overdueCount,
    overdueGroupCount,
    typeText: textLimit(`${firstType}${typeCount > 1 ? '等' : ''}｜${rows.length}项${overdueCount}笔逾期`),
    statusText,
    firstText,
    groups: orderedRows
  }
}

function chineseDate(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})$/)
  return match ? `${match[1]}年${Number(match[2])}月${Number(match[3])}日` : String(value || '')
}

function buildTemplateData(summary, fieldMap) {
  const allowedStatuses = new Set(['全部逾期', '部分逾期', '暂无逾期'])
  const values = {
    total: amountText(summary.totalAmount),
    count: textLimit(summary.typeText || `待收｜${summary.groupCount}项${summary.overdueCount || 0}笔逾期`),
    overdue: allowedStatuses.has(summary.statusText) ? summary.statusText : (summary.overdueCount ? '部分逾期' : '暂无逾期'),
    top: textLimit(summary.firstText || '暂无待收'),
    date: chineseDate(summary.earliestDueDate || summary.date)
  }
  return Object.entries(values).reduce((result, [logicalName, value]) => {
    const fieldName = fieldMap[logicalName]
    if (fieldName) result[fieldName] = { value }
    return result
  }, {})
}

function deliveryId(dateKey, openId, templateId) {
  return crypto.createHash('sha256').update(`${dateKey}|${openId}|${templateId}`).digest('hex')
}

function errorDetails(error) {
  return {
    code: String(error && (error.errCode || error.errcode || error.code) || ''),
    message: String(error && (error.errMsg || error.errmsg || error.message) || '发送失败')
  }
}

function createNotificationService({ db, repo, sendMessage, env = process.env, now = () => new Date() }) {
  const config = readConfig(env)

  async function findSubscription(openId) {
    const rows = await repo.queryAll(SUBSCRIPTION_COLLECTION, { _openid: openId })
    return rows[0] || null
  }

  async function getDailyReminderSubscription(params = {}, caller) {
    invariant(caller && caller.openId, 'FORBIDDEN', '无法识别当前小程序用户')
    return subscriptionView(await findSubscription(caller.openId), config)
  }

  async function recordDailyReminderConsent(params = {}, caller) {
    invariant(caller && caller.openId, 'FORBIDDEN', '无法识别当前小程序用户')
    invariant(config.templateId, 'CONFIGURATION_ERROR', '云函数尚未配置待收提醒模板 ID')
    invariant(params.templateId === config.templateId, 'VALIDATION_ERROR', '订阅消息模板不匹配')
    invariant(params.status === 'accept', 'VALIDATION_ERROR', '仅接受成功授权记录')

    const current = await findSubscription(caller.openId)
    const changedAt = now()
    if (current) {
      await db.collection(SUBSCRIPTION_COLLECTION).doc(current._id).update({
        enabled: true,
        acceptedCount: db.command.inc(1),
        remainingCredits: db.command.inc(1),
        templateId: config.templateId,
        updatedAt: changedAt,
        lastConsentAt: changedAt,
        lastErrorCode: '',
        lastErrorMessage: ''
      })
      return subscriptionView({
        ...current,
        enabled: true,
        templateId: config.templateId,
        acceptedCount: Number(current.acceptedCount || 0) + 1,
        remainingCredits: Number(current.remainingCredits || 0) + 1,
        lastConsentAt: changedAt,
        lastErrorCode: ''
      }, config)
    }

    const created = {
      _openid: caller.openId,
      enabled: true,
      templateId: config.templateId,
      acceptedCount: 1,
      sentCount: 0,
      remainingCredits: 1,
      sendTime: '09:00',
      timeZone: 'Asia/Shanghai',
      createdAt: changedAt,
      updatedAt: changedAt,
      lastConsentAt: changedAt,
      lastSentAt: null,
      lastErrorCode: '',
      lastErrorMessage: ''
    }
    const result = await db.collection(SUBSCRIPTION_COLLECTION).add(created)
    return subscriptionView({ ...created, _id: result.id || result._id }, config)
  }

  async function disableDailyReminder(params = {}, caller) {
    invariant(caller && caller.openId, 'FORBIDDEN', '无法识别当前小程序用户')
    const current = await findSubscription(caller.openId)
    if (current) {
      await db.collection(SUBSCRIPTION_COLLECTION).doc(current._id).update({ enabled: false, updatedAt: now() })
    }
    return subscriptionView(current ? { ...current, enabled: false } : null, config)
  }

  async function claimDelivery(subscription, summary) {
    const id = deliveryId(summary.date, subscription._openid, config.templateId)
    const existing = await repo.queryAll(DELIVERY_COLLECTION, { _id: id })
    if (existing.length) {
      const previous = existing[0]
      if (previous.status !== 'failed') return null
      const retryAt = now()
      await db.collection(DELIVERY_COLLECTION).doc(id).update({
        status: 'sending',
        attemptCount: db.command.inc(1),
        errorCode: '',
        errorMessage: '',
        updatedAt: retryAt
      })
      return { ...previous, status: 'sending', attemptCount: Number(previous.attemptCount || 1) + 1, updatedAt: retryAt }
    }
    const delivery = {
      _id: id,
      _openid: subscription._openid,
      templateId: config.templateId,
      businessDate: summary.date,
      status: 'sending',
      attemptCount: 1,
      summary: {
        totalAmount: summary.totalAmount,
        groupCount: summary.groupCount,
        billCount: summary.billCount,
        overdueAmount: summary.overdueAmount,
        overdueCount: summary.overdueCount,
        overdueGroupCount: summary.overdueGroupCount,
        earliestDueDate: summary.earliestDueDate,
        typeText: summary.typeText,
        statusText: summary.statusText,
        firstText: summary.firstText
      },
      createdAt: now(),
      updatedAt: now()
    }
    try {
      await db.collection(DELIVERY_COLLECTION).add(delivery)
      return delivery
    } catch (error) {
      // 唯一 _id 的并发写入只允许一个任务获得发送权。
      const raced = await repo.queryAll(DELIVERY_COLLECTION, { _id: id })
      if (raced.length) return null
      throw error
    }
  }

  async function runDailyReceivableReminders() {
    if (!config.templateId) {
      return { skipped: true, reason: 'template_not_configured', sent: 0, empty: 0, duplicate: 0, failed: 0 }
    }
    const subscriptions = (await repo.queryAll(SUBSCRIPTION_COLLECTION, { enabled: true }))
      .filter(item => Number(item.remainingCredits || 0) > 0 && item._openid)
    const result = { skipped: false, candidates: subscriptions.length, sent: 0, empty: 0, duplicate: 0, failed: 0 }
    const dateKey = businessDateKey(now())

    for (const subscription of subscriptions) {
      const scopedRepo = repo.forOwner(subscription._openid)
      const query = createQueryService(scopedRepo, db.command)
      const groups = await query.getCurrentReceivableGroups({})
      const summary = buildSummary(groups, dateKey)
      if (!summary.groupCount) {
        result.empty += 1
        continue
      }
      const delivery = await claimDelivery(subscription, summary)
      if (!delivery) {
        result.duplicate += 1
        continue
      }

      try {
        await sendMessage({
          touser: subscription._openid,
          templateId: config.templateId,
          page: config.page,
          data: buildTemplateData(summary, config.fieldMap),
          miniprogramState: config.miniprogramState,
          lang: 'zh_CN'
        })
        const sentAt = now()
        await db.collection(DELIVERY_COLLECTION).doc(delivery._id).update({ status: 'sent', errorCode: '', errorMessage: '', sentAt, updatedAt: sentAt })
        await db.collection(SUBSCRIPTION_COLLECTION).doc(subscription._id).update({
          sentCount: db.command.inc(1),
          remainingCredits: db.command.inc(-1),
          lastSentAt: sentAt,
          updatedAt: sentAt,
          lastErrorCode: '',
          lastErrorMessage: ''
        })
        result.sent += 1
      } catch (error) {
        const details = errorDetails(error)
        const failedAt = now()
        await db.collection(DELIVERY_COLLECTION).doc(delivery._id).update({
          status: 'failed',
          errorCode: details.code,
          errorMessage: details.message,
          updatedAt: failedAt
        })
        const subscriptionPatch = {
          lastErrorCode: details.code,
          lastErrorMessage: details.message,
          updatedAt: failedAt
        }
        if (details.code === '43101') subscriptionPatch.remainingCredits = 0
        await db.collection(SUBSCRIPTION_COLLECTION).doc(subscription._id).update(subscriptionPatch)
        result.failed += 1
      }
    }
    return result
  }

  return {
    getDailyReminderSubscription,
    recordDailyReminderConsent,
    disableDailyReminder,
    runDailyReceivableReminders
  }
}

module.exports = {
  createNotificationService,
  readConfig,
  buildSummary,
  buildTemplateData,
  deliveryId,
  DEFAULT_FIELD_MAP
}
