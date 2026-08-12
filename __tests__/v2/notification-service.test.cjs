const { clearAllData, getCollectionData, mockDb } = require('../setup.cjs')
const { createRepository } = require('../../cloudfunctions/rentalDomain/repositories/rental-repository')
const {
  createNotificationService,
  buildSummary,
  buildTemplateData
} = require('../../cloudfunctions/rentalDomain/application/notification-service')

const OPENID = 'landlord-openid'
const ENV = {
  WECHAT_RECEIVABLE_TEMPLATE_ID: 'tmpl-receivable',
  WECHAT_RECEIVABLE_TEMPLATE_FIELDS: JSON.stringify({
    total: 'amount28',
    count: 'thing18',
    overdue: 'phrase17',
    top: 'thing9',
    date: 'time37'
  }),
  WECHAT_MINIPROGRAM_STATE: 'developer'
}
const NOW = new Date('2026-06-24T09:00:00+08:00')

function seedCurrentReceivable() {
  getCollectionData('houses').push({ _id: 'h1', _openid: OPENID, code: '101', address: '东楼' })
  getCollectionData('tenants').push({ _id: 't1', _openid: OPENID, name: '张阿姨' })
  getCollectionData('lease_agreements').push({
    _id: 'l1', _openid: OPENID, houseId: 'h1', tenantId: 't1', status: 'active'
  })
  getCollectionData('bills').push({
    _id: 'b1',
    _openid: OPENID,
    leaseId: 'l1',
    houseId: 'h1',
    tenantId: 't1',
    type: 'rent',
    amount: 1200,
    paidAmount: 200,
    status: 'partial',
    dueDate: '2026-06-20',
    period: '2026-06-01~2026-06-30'
  })
}

function createService(sendMessage = async () => ({})) {
  return createNotificationService({
    db: mockDb,
    repo: createRepository(mockDb),
    sendMessage,
    env: ENV,
    now: () => new Date(NOW)
  })
}

describe('每日当前待收微信提醒', () => {
  beforeEach(() => clearAllData())

  it('消息摘要与首页待收分组使用相同金额，并映射模板字段', () => {
    const summary = buildSummary([
      { type: 'rent', amount: 1000, billCount: 1, overdueAmount: 1000, overdueCount: 1, earliestDueDate: '2026-06-20', houseLabel: '101 - 东楼', tenantName: '张阿姨', typeText: '租金' },
      { type: 'utility', amount: 88.5, billCount: 1, overdueAmount: 0, overdueCount: 0, earliestDueDate: '2026-06-30', houseLabel: '102 - 东楼', tenantName: '李阿姨', typeText: '水电费' }
    ], '2026-06-24')
    expect(summary).toMatchObject({ totalAmount: 1088.5, groupCount: 2, billCount: 2, overdueAmount: 1000, overdueCount: 1, statusText: '部分逾期' })
    expect(buildTemplateData(summary, JSON.parse(ENV.WECHAT_RECEIVABLE_TEMPLATE_FIELDS))).toMatchObject({
      amount28: { value: '1088.5' },
      thing18: { value: '租金等｜2项1笔逾期' },
      phrase17: { value: '部分逾期' },
      thing9: { value: '101张阿姨1000；102李阿88.5' },
      time37: { value: '2026年6月20日' }
    })
  })

  it('按截图数据生成全部逾期摘要并完整容纳金额最大的两项', () => {
    const summary = buildSummary([
      { type: 'rent', typeText: '租金', amount: 6400, billCount: 4, overdueAmount: 6400, overdueCount: 4, earliestDueDate: '2026-05-07', houseLabel: '101 - 里召', tenantName: '小笛子' },
      { type: 'rent', typeText: '租金', amount: 2700, billCount: 1, overdueAmount: 2700, overdueCount: 1, earliestDueDate: '2026-06-01', houseLabel: '204 - 东楼', tenantName: '小晶' }
    ], '2026-08-11')

    expect(summary).toMatchObject({
      totalAmount: 9100,
      groupCount: 2,
      billCount: 5,
      overdueCount: 5,
      typeText: '租金｜2项5笔逾期',
      statusText: '全部逾期',
      earliestDueDate: '2026-05-07',
      firstText: '101小笛子6400；204小晶2700'
    })
    expect(Array.from(summary.firstText)).toHaveLength(20)
  })

  it('无逾期时显示暂无逾期和零笔逾期', () => {
    const summary = buildSummary([
      { type: 'rent', typeText: '租金', amount: 1600, billCount: 1, overdueAmount: 0, overdueCount: 0, earliestDueDate: '2026-08-30', houseLabel: '207 - 东楼', tenantName: '李四' }
    ], '2026-08-11')
    expect(summary).toMatchObject({ typeText: '租金｜1项0笔逾期', statusText: '暂无逾期', firstText: '207李四1600' })
  })

  it('超过两项时按逾期优先和金额降序展示首项并合并其余金额', () => {
    const summary = buildSummary([
      { type: 'rent', typeText: '租金', amount: 9000, billCount: 1, overdueAmount: 0, overdueCount: 0, earliestDueDate: '2026-09-01', houseLabel: '301 - 西楼', tenantName: '待缴大额' },
      { type: 'rent', typeText: '租金', amount: 6400, billCount: 1, overdueAmount: 6400, overdueCount: 1, earliestDueDate: '2026-05-07', houseLabel: '101 - 里召', tenantName: '小笛子' },
      { type: 'rent', typeText: '租金', amount: 2700, billCount: 1, overdueAmount: 2700, overdueCount: 1, earliestDueDate: '2026-06-01', houseLabel: '204 - 东楼', tenantName: '姓名特别特别长的租客' },
      { type: 'rent', typeText: '租金', amount: 1600, billCount: 1, overdueAmount: 0, overdueCount: 0, earliestDueDate: '2026-08-30', houseLabel: '207 - 东楼', tenantName: '李四' }
    ], '2026-08-11')

    expect(summary.firstText).toBe('101小笛子6400；另3项13300')
    expect(Array.from(summary.firstText).length).toBeLessThanOrEqual(20)
    expect(summary.groups.map(item => item.houseLabel)).toEqual(['101 - 里召', '204 - 东楼', '301 - 西楼', '207 - 东楼'])
  })

  it('姓名过长时自动缩写且模板文本字段不超过20字符', () => {
    const summary = buildSummary([
      { type: 'rent', typeText: '租金', amount: 12345.67, billCount: 1, overdueAmount: 12345.67, overdueCount: 1, earliestDueDate: '2026-05-07', houseLabel: '超长房间编号101 - 里召', tenantName: '这是一位姓名非常非常长的租客' },
      { type: 'rent', typeText: '租金', amount: 9876.54, billCount: 1, overdueAmount: 9876.54, overdueCount: 1, earliestDueDate: '2026-06-01', houseLabel: '超长房间编号204 - 东楼', tenantName: '另一位姓名同样非常长的租客' }
    ], '2026-08-11')
    const data = buildTemplateData(summary, JSON.parse(ENV.WECHAT_RECEIVABLE_TEMPLATE_FIELDS))
    expect(Array.from(data.thing9.value).length).toBeLessThanOrEqual(20)
    expect(Array.from(data.thing18.value).length).toBeLessThanOrEqual(20)
    expect(data.phrase17.value).toBe('全部逾期')
  })

  it('每次接受订阅只增加一次预计提醒额度', async () => {
    const service = createService()
    const first = await service.recordDailyReminderConsent({ templateId: 'tmpl-receivable', status: 'accept' }, { openId: OPENID })
    const second = await service.recordDailyReminderConsent({ templateId: 'tmpl-receivable', status: 'accept' }, { openId: OPENID })
    expect(first.remainingCredits).toBe(1)
    expect(second.remainingCredits).toBe(2)
    expect(getCollectionData('notification_subscriptions')[0]).toMatchObject({
      _openid: OPENID,
      enabled: true,
      acceptedCount: 2,
      sentCount: 0,
      remainingCredits: 2
    })
  })

  it('有当前待收时每天只发送一次，成功后扣减一次额度', async () => {
    seedCurrentReceivable()
    getCollectionData('notification_subscriptions').push({
      _id: 'sub1', _openid: OPENID, enabled: true, acceptedCount: 2, sentCount: 0, remainingCredits: 2
    })
    const sent = []
    const service = createService(async message => { sent.push(message); return { errCode: 0 } })

    const first = await service.runDailyReceivableReminders()
    const duplicate = await service.runDailyReceivableReminders()

    expect(first).toMatchObject({ sent: 1, failed: 0 })
    expect(duplicate).toMatchObject({ sent: 0, duplicate: 1 })
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({
      touser: OPENID,
      templateId: 'tmpl-receivable',
      page: 'pages/dashboard/index',
      miniprogramState: 'developer'
    })
    expect(sent[0].data).toMatchObject({
      amount28: { value: '1000' },
      thing18: { value: '租金｜1项1笔逾期' },
      phrase17: { value: '全部逾期' },
      time37: { value: '2026年6月20日' }
    })
    expect(getCollectionData('notification_subscriptions')[0]).toMatchObject({ sentCount: 1, remainingCredits: 1 })
    expect(getCollectionData('notification_deliveries')).toHaveLength(1)
    expect(getCollectionData('notification_deliveries')[0].status).toBe('sent')
  })

  it('没有当前待收时保持静默且不扣减额度', async () => {
    getCollectionData('notification_subscriptions').push({
      _id: 'sub1', _openid: OPENID, enabled: true, acceptedCount: 1, sentCount: 0, remainingCredits: 1
    })
    let sendCount = 0
    const service = createService(async () => { sendCount += 1 })
    const result = await service.runDailyReceivableReminders()
    expect(result).toMatchObject({ sent: 0, empty: 1 })
    expect(sendCount).toBe(0)
    expect(getCollectionData('notification_subscriptions')[0].remainingCredits).toBe(1)
  })

  it('微信返回未订阅错误时将预计剩余额度归零', async () => {
    seedCurrentReceivable()
    getCollectionData('notification_subscriptions').push({
      _id: 'sub1', _openid: OPENID, enabled: true, acceptedCount: 2, sentCount: 0, remainingCredits: 2
    })
    const service = createService(async () => {
      const error = new Error('user refuse to accept the msg')
      error.errCode = 43101
      throw error
    })
    const result = await service.runDailyReceivableReminders()
    expect(result).toMatchObject({ sent: 0, failed: 1 })
    expect(getCollectionData('notification_subscriptions')[0]).toMatchObject({ remainingCredits: 0, lastErrorCode: '43101' })
  })

  it('发送失败后允许当天重试，成功后仍只扣减一次额度', async () => {
    seedCurrentReceivable()
    getCollectionData('notification_subscriptions').push({
      _id: 'sub1', _openid: OPENID, enabled: true, acceptedCount: 1, sentCount: 0, remainingCredits: 1
    })
    let attempts = 0
    const service = createService(async () => {
      attempts += 1
      if (attempts === 1) throw new Error('temporary failure')
      return { errCode: 0 }
    })

    expect(await service.runDailyReceivableReminders()).toMatchObject({ failed: 1, sent: 0 })
    expect(await service.runDailyReceivableReminders()).toMatchObject({ failed: 0, sent: 1 })
    expect(attempts).toBe(2)
    expect(getCollectionData('notification_subscriptions')[0]).toMatchObject({ sentCount: 1, remainingCredits: 0 })
    expect(getCollectionData('notification_deliveries')[0]).toMatchObject({ status: 'sent', attemptCount: 2 })
  })
})
