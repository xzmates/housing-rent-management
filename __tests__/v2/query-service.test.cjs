const { clearAllData } = require('../setup.cjs')
const { createRepository } = require('../../cloudfunctions/rentalDomain/repositories/rental-repository')
const { createQueryService } = require('../../cloudfunctions/rentalDomain/application/query-service')
const houseSkill = require('../../miniprogram/skills/house-skill/apis/index')
const tenantSkill = require('../../miniprogram/skills/tenant-skill/apis/index')
const leaseSkill = require('../../miniprogram/skills/lease-skill/apis/index')
const rentCollectionSkill = require('../../miniprogram/skills/rent-collection-skill/apis/index')

beforeEach(() => clearAllData())

async function createQuery() {
  const db = wx.cloud.database()
  const house = await db.collection('houses').add({ data: { code: '101', address: '东楼', rent: 1000 } })
  const tenant = await db.collection('tenants').add({ data: { name: '张阿姨', phone: '13800138000' } })
  const lease = await db.collection('lease_agreements').add({ data: { houseId: house._id, tenantId: tenant._id, status: 'active', startDate: '2026-01-01', endDate: '2026-12-31', rent: 1000 } })
  const rentBill = await db.collection('bills').add({ data: { leaseId: lease._id, type: 'rent', amount: 1000, paidAmount: 0, status: 'unpaid', dueDate: '2026-01-05' } })
  await db.collection('payments').add({ data: { leaseId: lease._id, billId: rentBill._id, amount: 1000, direction: 'in', paymentDate: '2026-05-01' } })
  const repo = createRepository({ collection: name => db.collection(name) }).forOwner('test-openid')
  return { query: createQueryService(repo, wx.cloud.database().command), house, tenant, lease, rentBill }
}

describe('只读查询服务', () => {
  it('出租状态以活跃合同而非房屋 status 判断', async () => {
    const { query } = await createQuery()
    const result = await query.getHouseAvailability({ mode: 'rented' })
    expect(result.houses).toHaveLength(1)
    expect(result.houses[0].occupancy).toBe('rented')
  })

  it('房屋和租客状态查询均以活跃合同判断，而非历史状态字段', async () => {
    const { query } = await createQuery()
    const houses = await query.searchHouses({ status: 'rented' })
    const tenants = await query.searchTenants({ status: 'active' })
    expect(houses.houses).toHaveLength(1)
    expect(houses.houses[0].occupancy).toBe('rented')
    expect(tenants.tenants).toHaveLength(1)
    expect(tenants.tenants[0].occupancy).toBe('current')
  })

  it('付款来源优先由关联账单类型确定并校验日期范围', async () => {
    const { query } = await createQuery()
    const result = await query.getFinancialReport({ startDate: '2026-05-01', endDate: '2026-05-01' })
    expect(result.totalIncome).toBe(1000)
    expect(result.sourceTotals.rent).toBe(1000)
    await expect(query.getFinancialReport({ startDate: '2026-06-01', endDate: '2026-05-01' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('AI 财务查询只展示实际收款和实际退款，不展示资金净进账', async () => {
    await createQuery()
    const result = await leaseSkill.getFinancialReport({ startDate: '2026-05-01', endDate: '2026-05-01' })
    expect(result.isError, result.content[0].text).toBe(false)
    expect(result.structuredContent.title).toBe('收款与退款汇总')
    expect(result.structuredContent.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '实际收款', value: '¥1000' }),
      expect.objectContaining({ label: '实际退款', value: '¥0' })
    ]))
    expect(result.content[0].text).toContain('不能等同利润')
    expect(result.structuredContent.fields).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '退款后净进账' })
    ]))
    expect(result.content[0].text).not.toContain('经营性净收入')
  })

  it('财务报表按房屋或租客严格限定付款，所有已生成未结清账单进入当前待收', async () => {
    const { query, house, tenant, lease, rentBill } = await createQuery()
    const db = wx.cloud.database()
    const otherHouse = await db.collection('houses').add({ data: { code: '202', address: '西楼' } })
    const otherTenant = await db.collection('tenants').add({ data: { name: '李阿姨' } })
    const otherLease = await db.collection('lease_agreements').add({ data: { houseId: otherHouse._id, tenantId: otherTenant._id, status: 'active' } })
    const otherBill = await db.collection('bills').add({ data: { leaseId: otherLease._id, type: 'rent', amount: 800, paidAmount: 800, status: 'paid' } })
    await db.collection('payments').add({ data: { leaseId: otherLease._id, billId: otherBill._id, amount: 800, direction: 'in', paymentDate: '2026-05-01' } })
    await db.collection('bills').doc(rentBill._id).update({ data: { paidAmount: 1000, status: 'paid' } })
    await db.collection('bills').add({ data: { leaseId: lease._id, type: 'utility', amount: 120, paidAmount: 0, status: 'unpaid', dueDate: '2020-01-01' } })
    await db.collection('bills').add({ data: { leaseId: lease._id, type: 'rent', amount: 900, paidAmount: 0, status: 'unpaid', dueDate: '2099-01-01' } })
    await db.collection('bills').add({ data: { leaseId: lease._id, type: 'rent', amount: 70, paidAmount: 0, status: 'unpaid' } })

    const report = await query.getFinancialReport({ houseId: house._id, tenantId: tenant._id, startDate: '2026-05-01', endDate: '2026-05-01' })
    expect(report.cashReceived).toBe(1000)
    expect(report.overdueAmount).toBe(120)
    expect(report.upcomingAmount).toBe(900)
    expect(report.currentReceivableAmount).toBe(1090)
    expect(report.unpaidAmount).toBe(1090)
    expect(report.undatedOutstandingAmount).toBe(70)
  })

  it('未来收租提醒只来自有效合同，并以账单覆盖期而非账单到期日去重', async () => {
    const { query, house, tenant, lease } = await createQuery()
    const db = wx.cloud.database()
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const format = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
    const plusDays = (days) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + days)
    const due = format(plusDays(10))
    await db.collection('lease_agreements').doc(lease._id).update({ data: { nextRentDueDate: due, paymentCycle: 'quarter', rent: 1000 } })
    // 该账单的 dueDate 不同，但 coverageStart 与下一收费日相同，仍必须阻止重复合同提醒。
    await db.collection('bills').add({ data: {
      leaseId: lease._id, type: 'rent', amount: 3000, paidAmount: 0, status: 'unpaid',
      dueDate: format(plusDays(14)), rentCoverageStart: due, rentCoverageEnd: format(plusDays(99))
    } })
    const secondHouse = await db.collection('houses').add({ data: { code: '102', address: '东楼' } })
    const secondTenant = await db.collection('tenants').add({ data: { name: '李阿姨' } })
    const secondLease = await db.collection('lease_agreements').add({ data: {
      houseId: secondHouse._id, tenantId: secondTenant._id, status: 'active', rent: 800,
      paymentCycle: 'quarter', nextRentDueDate: format(plusDays(7))
    } })
    await db.collection('lease_agreements').add({ data: {
      houseId: house._id, tenantId: tenant._id, status: 'terminated', rent: 900,
      nextRentDueDate: format(plusDays(5))
    } })

    const result = await query.getFutureRentReminders({ days: 15 })
    expect(result.items).toEqual([expect.objectContaining({ leaseId: secondLease._id, expectedAmount: 2400, daysUntilDue: 7 })])
    expect(result.totalExpectedAmount).toBe(2400)
  })

  it('首页待收按房屋、租客和费用类别合并，租金保留覆盖账期', async () => {
    const { query, lease } = await createQuery()
    const db = wx.cloud.database()
    await db.collection('bills').add({ data: {
      leaseId: lease._id, type: 'rent', amount: 2000, paidAmount: 0, status: 'unpaid',
      rentCoverageStart: '2026-04-04', rentCoverageEnd: '2026-07-03'
    } })
    await db.collection('bills').add({ data: {
      leaseId: lease._id, type: 'utility', amount: 180, paidAmount: 0, status: 'unpaid', dueDate: '2026-05-06'
    } })
    const result = await query.getCurrentReceivableGroups({})
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'rent', amount: 3000, periodText: expect.stringContaining('2026/04/04-2026/07/03') }),
      expect.objectContaining({ type: 'utility', amount: 180, periodText: '2026/05/06' })
    ]))
  })

  it('经营性收入排除押金，且房损仅在存在实际收款流水时计入', async () => {
    const { query, house, tenant } = await createQuery()
    const db = wx.cloud.database()
    const depositBill = await db.collection('bills').add({ data: { type: 'deposit', amount: 500, paidAmount: 500, status: 'paid' } })
    await db.collection('payments').add({ data: { billId: depositBill._id, amount: 500, direction: 'in', paymentDate: '2026-05-01' } })
    const lease = await db.collection('lease_agreements').add({ data: { houseId: house._id, tenantId: tenant._id, status: 'terminated', endedAt: '2026-05-01', damageAmount: 200 } })
    const damageBill = await db.collection('bills').add({ data: { leaseId: lease._id, type: 'extra_due', amount: 200, paidAmount: 200, status: 'paid' } })
    await db.collection('payments').add({ data: { leaseId: lease._id, billId: damageBill._id, amount: 200, direction: 'in', paymentDate: '2026-05-01' } })
    const result = await query.getFinancialReport({ startDate: '2026-05-01', endDate: '2026-05-01' })
    expect(result.cashReceived).toBe(1700)
    expect(result.depositReceived).toBe(500)
    expect(result.rentIncome).toBe(1000)
    expect(result.damageIncome).toBe(200)
    expect(result.totalIncome).toBe(1200)
  })

  it('无付款证据的房损结算与非现金押金抵扣不得计入实际收入', async () => {
    const { query } = await createQuery()
    const db = wx.cloud.database()
    const house = await db.collection('houses').add({ data: { code: '102', address: '东楼' } })
    const tenant = await db.collection('tenants').add({ data: { name: '李姨' } })
    const lease = await db.collection('lease_agreements').add({ data: { houseId: house._id, tenantId: tenant._id, status: 'terminated', endedAt: '2026-05-02', damageAmount: 450 } })
    const offsetBill = await db.collection('bills').add({ data: { leaseId: lease._id, type: 'extra_due', amount: 300, paidAmount: 300, status: 'paid' } })
    await db.collection('payments').add({ data: { leaseId: lease._id, billId: offsetBill._id, amount: 300, direction: 'in', cashImpact: false, paymentDate: '2026-05-02' } })
    const result = await query.getFinancialReport({ startDate: '2026-05-02', endDate: '2026-05-02' })
    expect(result.damageIncome).toBe(0)
    expect(result.cashReceived).toBe(0)
    expect(result.totalIncome).toBe(0)
  })

  it('兼容历史 deposit_offset 流水：即使缺少 cashImpact 也不得计入实际收款', async () => {
    const { query, lease } = await createQuery()
    const db = wx.cloud.database()
    const utilityBill = await db.collection('bills').add({ data: { leaseId: lease._id, type: 'utility', amount: 300, paidAmount: 300, status: 'paid' } })
    await db.collection('payments').add({ data: { leaseId: lease._id, billId: utilityBill._id, amount: 300, direction: 'in', paymentMethod: 'deposit_offset', paymentDate: '2026-05-01' } })

    const report = await query.getFinancialReport({ startDate: '2026-05-01', endDate: '2026-05-01' })
    expect(report.cashReceived).toBe(1000)
    expect(report.utilityIncome).toBe(0)

    const history = await leaseSkill.getLeasePaymentHistory({ leaseId: lease._id })
    expect(history.structuredContent.incomingTotal).toBe(1000)
    expect(history.structuredContent.internalOffsetTotal).toBe(300)
  })

  it('退租结算也不能把 cashImpact=false 的押金抵扣称为实际到账', async () => {
    const { query, house, tenant } = await createQuery()
    const db = wx.cloud.database()
    const lease = await db.collection('lease_agreements').add({ data: { houseId: house._id, tenantId: tenant._id, status: 'terminated', endedAt: '2026-05-02', damageAmount: 300 } })
    const bill = await db.collection('bills').add({ data: { leaseId: lease._id, type: 'extra_due', amount: 300, paidAmount: 300, status: 'paid' } })
    await db.collection('payments').add({ data: { leaseId: lease._id, billId: bill._id, amount: 300, direction: 'in', cashImpact: false, paymentDate: '2026-05-02' } })
    const result = await query.getSettlementReport({})
    const settlement = result.settlements.find(item => item.leaseId === lease._id)
    expect(settlement).toMatchObject({ damageAmount: 300, damageReceived: 0, damageEvidence: 'insufficient' })
  })

  it('历史房损可由押金实收、抵扣和退款完整对平时，标记为可复核的押金扣除', async () => {
    const { query, house, tenant } = await createQuery()
    const db = wx.cloud.database()
    const lease = await db.collection('lease_agreements').add({
      data: { houseId: house._id, tenantId: tenant._id, status: 'terminated', deposit: 1000, damageAmount: 100, depositOffsetAmount: 680, totalRefund: 220 }
    })
    const depositBill = await db.collection('bills').add({ data: { leaseId: lease._id, type: 'deposit', amount: 1000, paidAmount: 1000, status: 'paid' } })
    const refundBill = await db.collection('bills').add({ data: { leaseId: lease._id, type: 'deposit_return', amount: 220, paidAmount: 220, status: 'paid' } })
    const rentRefundBill = await db.collection('bills').add({ data: { leaseId: lease._id, type: 'rent_refund', amount: 2700, paidAmount: 2700, status: 'paid' } })
    await db.collection('payments').add({ data: { leaseId: lease._id, billId: depositBill._id, amount: 1000, direction: 'in' } })
    await db.collection('payments').add({ data: { leaseId: lease._id, billId: refundBill._id, amount: 220, direction: 'out' } })
    await db.collection('payments').add({ data: { leaseId: lease._id, billId: rentRefundBill._id, amount: 2700, direction: 'out' } })

    const result = await query.getSettlementReport({})
    const settlement = result.settlements.find(item => item.leaseId === lease._id)
    expect(settlement).toMatchObject({
      damageAmount: 100,
      damageReceived: 0,
      damageDepositDeducted: 100,
      damageEvidence: 'derived',
      damageUnconfirmedAmount: 0
    })
  })

  it('对象档案与缴费历史将内部抵扣同实际收款分开', async () => {
    const { query, lease, tenant } = await createQuery()
    const db = wx.cloud.database()
    const bill = await db.collection('bills').add({ data: { leaseId: lease._id, type: 'extra_due', amount: 300, paidAmount: 300, status: 'paid' } })
    await db.collection('payments').add({ data: { leaseId: lease._id, billId: bill._id, amount: 300, direction: 'in', cashImpact: false, paymentDate: '2026-05-02' } })
    const profile = await query.getSubjectProfile({ tenantId: tenant._id })
    expect(profile.actualReceivedAmount).toBe(1000)
    const history = await leaseSkill.getLeasePaymentHistory({ leaseId: lease._id })
    expect(history.structuredContent.incomingTotal).toBe(1000)
    expect(history.structuredContent.internalOffsetTotal).toBe(300)
    expect(history.content[0].text).toContain('内部抵扣')
  })

  it('合同到期查询只按有效合同结束日过滤，不混入未来应收账单', async () => {
    const { lease } = await createQuery()
    await wx.cloud.database().collection('lease_agreements').doc(lease._id).update({ data: { endDate: '2026-07-31' } })
    const result = await leaseSkill.getRelativeLeaseExpiry({ mode: 'earliest' })
    expect(result.isError, result.content[0].text).toBe(false)
    expect(result.content[0].text).toContain('合同')
    expect(result.structuredContent.contracts).toEqual(expect.arrayContaining([expect.objectContaining({ id: lease._id, endDate: '2026-07-31' })]))
  })

  it('付款历史从关联账单读取类型，不能把金额孤立展示', async () => {
    const { query, lease } = await createQuery()
    const result = await query.getPaymentHistory({ leaseId: lease._id })
    expect(result.payments).toEqual(expect.arrayContaining([expect.objectContaining({ billType: 'rent', amount: 1000 })]))
  })

  it('按房屋查询付款时通过关联合同限定范围，不能依赖 payments 上可缺失的 houseId', async () => {
    const { query, house } = await createQuery()
    const db = wx.cloud.database()
    const otherHouse = await db.collection('houses').add({ data: { code: '202', address: '西楼' } })
    const otherTenant = await db.collection('tenants').add({ data: { name: '李阿姨' } })
    const otherLease = await db.collection('lease_agreements').add({ data: { houseId: otherHouse._id, tenantId: otherTenant._id, status: 'active' } })
    const otherBill = await db.collection('bills').add({ data: { leaseId: otherLease._id, type: 'rent', amount: 800, paidAmount: 800, status: 'paid' } })
    await db.collection('payments').add({ data: { leaseId: otherLease._id, billId: otherBill._id, amount: 800, direction: 'in', paymentDate: '2026-05-01' } })

    const result = await query.getPaymentHistory({ houseId: house._id, startDate: '2026-05-01', endDate: '2026-05-01' })
    expect(result.payments).toHaveLength(1)
    expect(result.payments[0]).toMatchObject({ amount: 1000, billType: 'rent' })
  })

  it('付款日期范围保留用户边界并拒绝倒置范围，不选择无关合同', async () => {
    const { query, lease } = await createQuery()
    const inRange = await query.getPaymentHistory({ startDate: '2026-05-01', endDate: '2026-05-01' })
    expect(inRange.payments).toEqual(expect.arrayContaining([
      expect.objectContaining({ leaseId: lease._id, amount: 1000, billType: 'rent' })
    ]))
    await expect(query.getPaymentHistory({ startDate: '2026-08-01', endDate: '2026-07-01' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('付款日期范围 Skill 强制双日期并把倒置范围返回为校验错误', async () => {
    await createQuery()
    const valid = await rentCollectionSkill.getPaymentsByDateRange({ startDate: '2026-05-01', endDate: '2026-05-01' })
    expect(valid.isError).toBe(false)
    expect(valid.content[0].text).toContain('实际收款 ¥1000')
    const invalid = await rentCollectionSkill.getPaymentsByDateRange({ startDate: '2026-08-01', endDate: '2026-07-01' })
    expect(invalid.isError).toBe(false)
    expect(invalid.content[0].text).toContain('开始日期不能晚于结束日期')
    expect(invalid.structuredContent).toMatchObject({ invalidDateRange: true, queryExecuted: false })
  })

  it('缴费历史按关联账单类型汇总实际收款，并保留逐笔流水', async () => {
    const { lease } = await createQuery()
    const db = wx.cloud.database()
    const utilityBill = await db.collection('bills').add({ data: { leaseId: lease._id, type: 'utility', amount: 166, paidAmount: 166, status: 'paid' } })
    await db.collection('payments').add({ data: { leaseId: lease._id, billId: utilityBill._id, amount: 166, direction: 'in', paymentDate: '2026-05-02' } })
    const result = await leaseSkill.getLeasePaymentHistory({ leaseId: lease._id })
    expect(result.isError, result.content[0].text).toBe(false)
    expect(result.content[0].text).toContain('租金 ¥1000')
    expect(result.content[0].text).toContain('水电费 ¥166')
    expect(result.structuredContent.sourceTotals).toMatchObject({ rent: 1000, utility: 166 })
    expect(result.structuredContent.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '水电费实收', value: '¥166' })
    ]))
  })

  it('按租客关键词查询付款先唯一解析租客，再以 tenantId 严格过滤全部关联合同', async () => {
    const { tenant, lease } = await createQuery()
    const db = wx.cloud.database()
    const otherHouse = await db.collection('houses').add({ data: { code: '202', address: '西楼' } })
    const otherTenant = await db.collection('tenants').add({ data: { name: '李阿姨', phone: '13900139000' } })
    const otherLease = await db.collection('lease_agreements').add({ data: { houseId: otherHouse._id, tenantId: otherTenant._id, status: 'active' } })
    const otherBill = await db.collection('bills').add({ data: { leaseId: otherLease._id, type: 'rent', amount: 800, paidAmount: 800, status: 'paid' } })
    await db.collection('payments').add({ data: { leaseId: otherLease._id, billId: otherBill._id, amount: 800, direction: 'in', paymentDate: '2026-05-02' } })

    const result = await leaseSkill.getTenantPaymentHistoryByKeyword({ keyword: '张阿姨' })
    expect(result.isError).toBe(false)
    expect(result.content[0].text).toContain('张阿姨：找到 1 条资金流水')
    expect(result.structuredContent.payments).toEqual([expect.objectContaining({ leaseId: lease._id, amount: 1000 })])
    expect(result.structuredContent.payments).not.toEqual(expect.arrayContaining([expect.objectContaining({ leaseId: otherLease._id })]))
  })

  it('欠费查询排除剩余金额为零的 partial 历史账单', async () => {
    const { query, lease } = await createQuery()
    await wx.cloud.database().collection('bills').add({ data: { leaseId: lease._id, type: 'rent', amount: 1000, paidAmount: 1000, status: 'partial', dueDate: '2026-01-01' } })
    const result = await query.getArrearsReport({})
    expect(result.bills).toHaveLength(1)
    expect(result.totalRemaining).toBe(1000)
  })

  it('当前欠费排除未来应收，并返回部分付款的应缴已缴待缴明细', async () => {
    const { query, lease } = await createQuery()
    await wx.cloud.database().collection('bills').add({
      data: { leaseId: lease._id, type: 'rent', amount: 1000, paidAmount: 400, status: 'partial', dueDate: '2026-01-15' }
    })
    await wx.cloud.database().collection('bills').add({
      data: { leaseId: lease._id, type: 'rent', amount: 800, paidAmount: 0, status: 'unpaid', dueDate: '2099-08-05' }
    })
    const result = await query.getArrearsReport({})
    expect(result.totalRemaining).toBe(1600)
    expect(result.futureOutstandingCount).toBe(1)
    expect(result.futureOutstandingAmount).toBe(800)
    expect(result.bills).toEqual(expect.arrayContaining([
      expect.objectContaining({ amount: 1000, paidAmount: 400, remaining: 600 })
    ]))
  })

  it('未来应收严格按日期范围过滤，不混入已到期、已缴或范围外账单', async () => {
    const { query, lease } = await createQuery()
    const db = wx.cloud.database()
    await db.collection('bills').add({
      data: { leaseId: lease._id, type: 'rent', amount: 800, paidAmount: 0, status: 'unpaid', dueDate: '2099-08-01' }
    })
    await db.collection('bills').add({
      data: { leaseId: lease._id, type: 'utility', amount: 1000, paidAmount: 400, status: 'partial', dueDate: '2099-08-05' }
    })
    await db.collection('bills').add({
      data: { leaseId: lease._id, type: 'rent', amount: 600, paidAmount: 0, status: 'unpaid', dueDate: '2099-08-11' }
    })
    await db.collection('bills').add({
      data: { leaseId: lease._id, type: 'rent', amount: 300, paidAmount: 300, status: 'paid', dueDate: '2099-08-04' }
    })

    const result = await query.getFutureReceivables({ startDate: '2099-08-01', endDate: '2099-08-10' })
    expect(result.totalRemaining).toBe(1400)
    expect(result.bills).toHaveLength(2)
    expect(result.bills).toEqual(expect.arrayContaining([
      expect.objectContaining({ dueDate: '2099-08-01', remaining: 800 }),
      expect.objectContaining({ dueDate: '2099-08-05', paidAmount: 400, remaining: 600 })
    ]))
    await expect(query.getFutureReceivables({ startDate: '2099-08-10', endDate: '2099-08-01' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('对象档案只汇总关联合同、账单和付款，不产生写入', async () => {
    const { query, house } = await createQuery()
    const result = await query.getSubjectProfile({ houseId: house._id })
    expect(result.subjectType).toBe('house')
    expect(result.paymentCount).toBe(1)
    expect(result.actualReceivedAmount).toBe(1000)
    expect(result.receiptCount).toBe(1)
    expect(result.receiptTotalsByBillType).toMatchObject({ rent: 1000 })
    expect(result.receiptScope).toBe('all_linked_leases')
    expect(result.unpaidAmount).toBe(1000)
    expect(result.currentArrearsAmount).toBe(1000)
  })

  it('对象档案的当前欠费明细排除未来应收', async () => {
    const { query, lease, tenant } = await createQuery()
    await wx.cloud.database().collection('bills').add({
      data: { leaseId: lease._id, type: 'rent', amount: 800, paidAmount: 0, status: 'unpaid', dueDate: '2099-08-05' }
    })
    const result = await query.getSubjectProfile({ tenantId: tenant._id })
    expect(result.currentArrearsAmount).toBe(1000)
    expect(result.futureOutstandingAmount).toBe(800)
    expect(result.currentArrearsBills).toHaveLength(1)
  })

  it('经营概览单列当前欠费与未来应收，待收仍保留全部未结清账单', async () => {
    const { query, lease } = await createQuery()
    await wx.cloud.database().collection('bills').add({
      data: { leaseId: lease._id, type: 'rent', amount: 800, paidAmount: 0, status: 'unpaid', dueDate: '2099-08-05' }
    })
    const result = await query.getOperatingOverview()
    expect(result.unpaidAmount).toBe(1800)
    expect(result.currentArrearsAmount).toBe(1000)
    expect(result.futureOutstandingAmount).toBe(800)
  })

  it('对象档案区分合同约定押金与付款流水证实的实际收押金', async () => {
    const { query, lease, tenant } = await createQuery()
    const db = wx.cloud.database()
    await db.collection('lease_agreements').doc(lease._id).update({ data: { deposit: 800 } })
    const depositBill = await db.collection('bills').add({
      data: { leaseId: lease._id, type: 'deposit', amount: 800, paidAmount: 800, status: 'paid' }
    })
    await db.collection('payments').add({
      data: { leaseId: lease._id, billId: depositBill._id, amount: 800, direction: 'in', paymentDate: '2026-05-02' }
    })
    const result = await query.getSubjectProfile({ tenantId: tenant._id })
    expect(result.depositAgreedAmount).toBe(800)
    expect(result.depositReceivedAmount).toBe(800)
    expect(result.depositEvidence).toBe('direct')
    expect(result.depositReceiptCount).toBe(1)
  })

  it('租客综合档案兜底展示基础资料和当前房屋', async () => {
    const { tenant } = await createQuery()
    const result = await leaseSkill.getSubjectProfile({ tenantId: tenant._id })
    expect(result.isError).toBe(false)
    expect(result.structuredContent.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '姓名', value: '张阿姨' }),
      expect.objectContaining({ label: '电话', value: '13800138000' }),
      expect.objectContaining({ label: '当前房屋', value: '101 - 东楼' })
    ]))
  })

  it('租客综合档案逐份展示历史合同，而非只返回合同数量', async () => {
    const { tenant } = await createQuery()
    const formerHouse = await wx.cloud.database().collection('houses').add({ data: { code: '102', address: '东楼' } })
    await wx.cloud.database().collection('lease_agreements').add({
      data: { houseId: formerHouse._id, tenantId: tenant._id, status: 'terminated', startDate: '2025-01-01', endDate: '2025-12-31' }
    })
    const result = await leaseSkill.getSubjectProfile({ tenantId: tenant._id })
    expect(result.structuredContent.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '合同数', value: '2' }),
      expect.objectContaining({ label: '合同 1 · 101 - 东楼' }),
      expect.objectContaining({ label: '合同 2 · 102 - 东楼' })
    ]))
  })

  it('对象档案没有关联押金付款流水时不得把合同押金当作实收', async () => {
    const { query, lease, tenant } = await createQuery()
    await wx.cloud.database().collection('lease_agreements').doc(lease._id).update({ data: { deposit: 800 } })
    const result = await query.getSubjectProfile({ tenantId: tenant._id })
    expect(result.depositAgreedAmount).toBe(800)
    expect(result.depositReceivedAmount).toBe(0)
    expect(result.depositEvidence).toBe('insufficient')
    expect(result.limitations).toContain('当前数据库记录不足以确认实际收到押金')
  })

  it('到期日前的合同查询默认只返回活跃合同，不把已退租合同误报为待到期', async () => {
    const { query, house, tenant } = await createQuery()
    await wx.cloud.database().collection('lease_agreements').add({
      data: { houseId: house._id, tenantId: tenant._id, status: 'terminated', startDate: '2026-01-01', endDate: '2026-07-23' }
    })
    const result = await query.getLeaseReport({ dueBefore: '2026-12-31' })
    expect(result.leases).toHaveLength(1)
    expect(result.leases[0].status).toBe('active')
  })

  it('按上海业务日统计带时区字符串和 Date 对象的入住日期边界', async () => {
    const { query, house, tenant } = await createQuery()
    const db = wx.cloud.database()
    await db.collection('lease_agreements').add({
      data: {
        houseId: house._id,
        tenantId: tenant._id,
        status: 'active',
        startDate: '2026-07-01T00:00:00.000+08:00',
        endDate: '2026-12-31T00:00:00.000+08:00'
      }
    })
    await db.collection('lease_agreements').add({
      data: {
        houseId: house._id,
        tenantId: tenant._id,
        status: 'active',
        startDate: new Date('2026-06-30T16:00:00.000Z'),
        endDate: new Date('2026-12-30T16:00:00.000Z')
      }
    })

    const result = await query.getLeaseActivity({ startDate: '2026-07-01', endDate: '2026-07-01' })
    expect(result.moveIns).toHaveLength(2)
  })

  it('退租活动把终止记录日与实际搬离日证据区分', async () => {
    const { query, house, tenant } = await createQuery()
    await wx.cloud.database().collection('lease_agreements').add({
      data: { houseId: house._id, tenantId: tenant._id, status: 'terminated', endedAt: '2026-07-01', updatedAt: '2026-07-01' }
    })
    const result = await query.getLeaseActivity({ startDate: '2026-07-01', endDate: '2026-07-01' })
    const movedOut = result.moveOuts[0]
    expect(movedOut).toMatchObject({ moveOutRecordDate: '2026-07-01', moveOutEvidence: 'partial', actualMoveOutEvidence: 'insufficient' })
  })

  it('租客详情将合同结束日与实际搬离日分开，并在缺失时明确限制', async () => {
    const { tenant, house } = await createQuery()
    await wx.cloud.database().collection('lease_agreements').add({
      data: {
        houseId: house._id,
        tenantId: tenant._id,
        status: 'terminated',
        endDate: '2026-07-01T00:00:00.000+08:00'
      }
    })

    const result = await tenantSkill.getTenantDetail({ tenantId: tenant._id })
    const terminated = result.structuredContent.leases.find(item => item.status === 'terminated')
    expect(terminated.endDate).toBe('2026-07-01')
    expect(terminated.actualMoveOutDate).toBe('')
    expect(terminated.actualMoveOutEvidence).toBe('insufficient')
    expect(result.content[0].text).toContain('当前数据库记录不足以确认准确实际搬离日期')
    expect(result.structuredContent.limitations).toContain('合同结束日不能替代实际搬离日')
  })

  it('退租结算查询返回合同中的房损和押金抵扣字段', async () => {
    const { query, house, tenant } = await createQuery()
    await wx.cloud.database().collection('lease_agreements').add({
      data: { houseId: house._id, tenantId: tenant._id, status: 'terminated', endedAt: '2026-07-23', damageAmount: 500, depositOffsetAmount: 300, cashSettlementAmount: 200 }
    })
    const result = await query.getSettlementReport({})
    expect(result.settlements).toEqual(expect.arrayContaining([
      expect.objectContaining({ damageAmount: 500, depositOffsetAmount: 300, cashSettlementAmount: 200 })
    ]))
  })

  it('退款结算金额必须由退款付款流水证明，不能直接称为实际退款', async () => {
    const { query, house, tenant } = await createQuery()
    const db = wx.cloud.database()
    const withEvidence = await db.collection('lease_agreements').add({
      data: { houseId: house._id, tenantId: tenant._id, status: 'terminated', endedAt: '2026-07-23', totalRefund: 580 }
    })
    const refundBill = await db.collection('bills').add({
      data: { leaseId: withEvidence._id, type: 'deposit_return', amount: 580, paidAmount: 580, status: 'paid' }
    })
    await db.collection('payments').add({
      data: { leaseId: withEvidence._id, billId: refundBill._id, amount: 580, direction: 'out', paymentDate: '2026-07-23' }
    })
    const withoutEvidence = await db.collection('lease_agreements').add({
      data: { houseId: house._id, tenantId: tenant._id, status: 'terminated', endedAt: '2026-07-24', totalRefund: 300 }
    })
    const result = await query.getSettlementReport({})
    expect(result.settlements).toEqual(expect.arrayContaining([
      expect.objectContaining({ leaseId: withEvidence._id, totalRefund: 580, refundPaidAmount: 580, refundEvidence: 'direct' }),
      expect.objectContaining({ leaseId: withoutEvidence._id, totalRefund: 300, refundPaidAmount: 0, refundEvidence: 'insufficient' })
    ]))
    expect(result.limitations).toContain('结算退款不等同实际退款')
  })

  it('房损结算金额不等于实际到账，且关键词只返回匹配租客', async () => {
    const { query } = await createQuery()
    const db = wx.cloud.database()
    const targetHouse = await db.collection('houses').add({ data: { code: '201', address: '目标楼' } })
    const targetTenant = await db.collection('tenants').add({ data: { name: '未到账房损租客' } })
    const otherHouse = await db.collection('houses').add({ data: { code: '202', address: '目标楼' } })
    const otherTenant = await db.collection('tenants').add({ data: { name: '无关租客' } })
    await db.collection('lease_agreements').add({ data: { houseId: targetHouse._id, tenantId: targetTenant._id, status: 'terminated', damageAmount: 450, endedAt: '2026-07-01' } })
    await db.collection('lease_agreements').add({ data: { houseId: otherHouse._id, tenantId: otherTenant._id, status: 'terminated', damageAmount: 300, endedAt: '2026-07-01' } })
    const result = await query.getSettlementReport({ keyword: '未到账房损租客' })
    expect(result.settlements).toHaveLength(1)
    expect(result.settlements[0]).toMatchObject({ tenantName: '未到账房损租客', damageAmount: 450, damageReceived: 0, damageEvidence: 'insufficient' })
    expect(result.limitations).toContain('房损结算金额不等同实际到账')
  })

  it('房屋详情 Skill 展示当前和历史租客，不能只显示房屋基本字段', async () => {
    const { house, tenant } = await createQuery()
    const formerTenant = await wx.cloud.database().collection('tenants').add({ data: { name: '李阿姨' } })
    await wx.cloud.database().collection('lease_agreements').add({
      data: { houseId: house._id, tenantId: formerTenant._id, status: 'terminated', endDate: '2025-12-31' }
    })
    const result = await houseSkill.getHouseDetail({ houseId: house._id })
    expect(result.content[0].text).toContain('张阿姨')
    expect(result.structuredContent.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '当前租客', value: '张阿姨' }),
      expect.objectContaining({ label: '合同结束日', value: '2026-12-31' }),
      expect.objectContaining({ label: '历史租客', value: '李阿姨' })
    ]))
  })

  it('房屋详情 Skill 先按原始房号唯一匹配，近似或同号房屋不自动选择', async () => {
    const { house } = await createQuery()
    const unique = await houseSkill.getHouseDetailByKeyword({ keyword: '东楼101' })
    expect(unique.isError).toBe(false)
    expect(unique.structuredContent.subtitle).toBe('101 - 东楼')

    await wx.cloud.database().collection('houses').add({ data: { code: '101', address: '西楼', rent: 900 } })
    const ambiguous = await houseSkill.getHouseDetailByKeyword({ keyword: '101' })
    expect(ambiguous.isError).toBe(false)
    expect(ambiguous.content[0].text).toContain('不会自动选择')
    expect(ambiguous.structuredContent.candidates).toHaveLength(2)

    const missing = await houseSkill.getHouseDetailByKeyword({ keyword: '999' })
    expect(missing.isError).toBe(true)
    expect(missing.content[0].text).toContain('没有找到')
    expect(house._id).toBeTruthy()
  })

  it('房屋综合档案 Skill 的实际收款只来自房屋关联合同付款', async () => {
    const { house } = await createQuery()
    const result = await houseSkill.getHouseProfileByKeyword({ keyword: '东楼101' })
    expect(result.isError).toBe(false)
    expect(result.structuredContent.houseId).toBe(house._id)
    expect(result.structuredContent.summary).toContain('实际收款 ¥1000')
    expect(result.structuredContent.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '实际收款（关联付款流水）', value: '¥1000（1 笔）' })
    ]))
  })

  it('租客详情 Skill 展示当前和历史房屋，不能只显示合同数量', async () => {
    const { house, tenant } = await createQuery()
    const formerHouse = await wx.cloud.database().collection('houses').add({ data: { code: '102', address: '东楼' } })
    await wx.cloud.database().collection('lease_agreements').add({
      data: { houseId: formerHouse._id, tenantId: tenant._id, status: 'terminated', endDate: '2025-12-31' }
    })
    const result = await tenantSkill.getTenantDetail({ tenantId: tenant._id })
    expect(result.content[0].text).toContain('101 - 东楼')
    expect(result.content[0].text).toContain('当前合同：')
    expect(result.content[0].text).toContain('电话：')
    expect(result.structuredContent.summary).toContain('101 - 东楼')
    expect(result.structuredContent.summary).toContain('102 - 东楼')
    expect(result.structuredContent.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '当前房屋', value: '101 - 东楼' }),
      expect.objectContaining({ label: '历史房屋', value: '102 - 东楼' }),
      expect.objectContaining({ label: '合同 1 · 101 - 东楼' }),
      expect.objectContaining({ label: '合同 2 · 102 - 东楼' })
    ]))
  })

  it('租客历史房屋按起租时间排序并保留重复居住记录', async () => {
    const { tenant } = await createQuery()
    const db = wx.cloud.database()
    const firstHouse = await db.collection('houses').add({ data: { code: '201', address: '东楼' } })
    const secondHouse = await db.collection('houses').add({ data: { code: '202', address: '东楼' } })
    await db.collection('lease_agreements').add({ data: { houseId: secondHouse._id, tenantId: tenant._id, status: 'terminated', startDate: '2025-02-01', endDate: '2025-02-28' } })
    await db.collection('lease_agreements').add({ data: { houseId: firstHouse._id, tenantId: tenant._id, status: 'terminated', startDate: '2025-01-01', endDate: '2025-01-31' } })
    await db.collection('lease_agreements').add({ data: { houseId: firstHouse._id, tenantId: tenant._id, status: 'terminated', startDate: '2025-03-01', endDate: '2025-03-31' } })
    const result = await tenantSkill.getTenantDetail({ tenantId: tenant._id })
    expect(result.structuredContent.summary).toContain('201 - 东楼、202 - 东楼、201 - 东楼')
  })

  it('按租客姓名查询详情先做唯一匹配，不能静默选中同名对象', async () => {
    const { tenant } = await createQuery()
    const unique = await tenantSkill.getTenantDetailByKeyword({ keyword: '张阿姨' })
    expect(unique.isError).toBe(false)
    expect(unique.structuredContent.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '姓名', value: '张阿姨' })
    ]))
    await wx.cloud.database().collection('tenants').add({ data: { name: '张阿姨', phone: '13900139000' } })
    const ambiguous = await tenantSkill.getTenantDetailByKeyword({ keyword: '张阿姨' })
    expect(ambiguous.isError).toBe(false)
    expect(ambiguous.content[0].text).toContain('不会自动选择')
    expect(ambiguous.structuredContent.candidates).toHaveLength(2)
  })

  it('租客 Skill 按关键词安全查询租客历史合同，不回退为全库活动记录', async () => {
    const { tenant } = await createQuery()
    const formerHouse = await wx.cloud.database().collection('houses').add({ data: { code: '102', address: '东楼' } })
    await wx.cloud.database().collection('lease_agreements').add({
      data: { houseId: formerHouse._id, tenantId: tenant._id, status: 'terminated', startDate: '2025-01-01', endDate: '2025-12-31' }
    })
    const result = await tenantSkill.getTenantDetailByKeyword({ keyword: '张阿姨' })
    expect(result.isError).toBe(false)
    expect(result.structuredContent.leases).toHaveLength(2)
    expect(result.structuredContent.fields).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: '合同 1 · 101 - 东楼' }),
      expect.objectContaining({ label: '合同 2 · 102 - 东楼' })
    ]))
  })

  it('全量入住退租查询缺少无对象范围确认时终止且不访问云端', async () => {
    const originalCallFunction = wx.cloud.callFunction
    let callCount = 0
    wx.cloud.callFunction = async () => {
      callCount += 1
      throw new Error('不应访问云端')
    }
    try {
      const result = await leaseSkill.listGlobalMoveInOutByDateRange({ startDate: '2026-01-01', endDate: '2026-12-31' })
      expect(result.isError).toBe(false)
      expect(result.structuredContent.queryExecuted).toBe(false)
      expect(result.structuredContent.routeRejected).toBe('global_activity_requires_unfiltered_scope')
      expect(callCount).toBe(0)
    } finally {
      wx.cloud.callFunction = originalCallFunction
    }
  })

  it('相对未来应收云端动作未部署时终止，不回退到欠费或经营概览', async () => {
    const originalCallFunction = wx.cloud.callFunction
    wx.cloud.callFunction = async () => ({ result: { code: -1, message: '未知动作 getFutureReceivables' } })
    try {
      const result = await leaseSkill.getRelativeFutureReceivables({ period: 'next_7_days' })
      expect(result.isError).toBe(false)
      expect(result.structuredContent.queryExecuted).toBe(false)
      expect(result.structuredContent.deploymentRequired).toBe(true)
      expect(result.content[0].text).toContain('不得引用经营概览、待收、当前欠费')
    } finally {
      wx.cloud.callFunction = originalCallFunction
    }
  })
})
