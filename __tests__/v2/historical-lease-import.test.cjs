const { getCollectionData, clearAllData } = require('../setup.cjs')
const api = require('../../miniprogram/services/api')
const rentCoverage = require('../../cloudfunctions/rentalDomain/domain/rent-coverage')
const { extractHistoricalLease } = require('../../cloudfunctions/recognizeHistoricalLeaseImages/parser')
const { recognizeImage } = require('../../cloudfunctions/recognizeHistoricalLeaseImages/ocr-client')

function seedExisting() {
  clearAllData()
  getCollectionData('houses').push({ _id: 'h220', code: '220', address: '东楼', rent: 1000, status: 'rented' })
  getCollectionData('tenants').push({ _id: 't1', name: '张三', phone: '13800000001', idCard: '11010519491231002X', status: 'inactive' })
}

function existingParams(updateRent = true) {
  return {
    house: { mode: 'existing', houseId: 'h220', updateRent, rent: 900 },
    tenant: { mode: 'existing', tenantId: 't1' },
    lease: {
      startDate: '2026-01-01',
      endDate: '2026-12-31',
      rent: 900,
      deposit: 900,
      paymentCycle: 'month',
      rentCoveredUntil: '2026-05-31',
      remark: '纸质合同核对完成'
    },
    utilityBaseline: { calculationDate: '2026-05-20', electricityReading: 321.5, waterReading: 45 }
  }
}

function key(value) {
  return rentCoverage.formatDateKey(value)
}

describe('历史合同建档', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-06-24T08:00:00+08:00'))
  })

  afterEach(() => vi.useRealTimers())

  it('绑定现有房屋后只写入当前待收和水电基准，不生成历史账单或付款流水', async () => {
    seedExisting()
    const preview = await api.previewHistoricalLeaseImport(existingParams(true))
    expect(preview.historicalImportView.historicalRentAmount).toBe(0)
    expect(preview.historicalImportView.unpaidBillCount).toBe(1)
    expect(preview.historicalImportView.paymentsCreated).toBe(0)

    const result = await api.confirmHistoricalLeaseImport(preview.confirmationId)
    const lease = getCollectionData('lease_agreements').find(item => item._id === result.leaseId)
    const bills = getCollectionData('bills').filter(item => item.leaseId === result.leaseId)
    const records = getCollectionData('utility_records').filter(item => item.leaseId === result.leaseId)

    expect(getCollectionData('houses').find(item => item._id === 'h220').rent).toBe(900)
    expect(lease.rent).toBe(900)
    expect(key(lease.endDate)).toBe('')
    expect(key(lease.documentEndDate)).toBe('2026-12-31')
    expect(lease.occupancyState).toBe('active_contract')
    expect(key(lease.rentCoveredUntil)).toBe('2026-05-31')
    expect(key(lease.nextRentDueDate)).toBe('2026-06-01')
    expect(getCollectionData('payments')).toHaveLength(0)
    expect(bills).toHaveLength(1)
    expect(bills.find(item => item.type === 'rent' && item.status === 'unpaid').period).toBe('2026-06-01~2026-06-30')
    expect(records).toHaveLength(1)
    expect(records[0].recordType).toBe('regular')
    expect(key(records[0].calculationDate)).toBe('2026-05-20')
    expect(records[0].electricityReading).toBe(321.5)

    const recalculated = rentCoverage.recalculateContinuousRentCoverage(lease, bills.filter(item => item.type === 'rent'))
    expect(key(recalculated.rentCoveredUntil)).toBe('2026-05-31')
    expect(key(recalculated.nextRentDueDate)).toBe('2026-06-01')

    const allowedLeaseFields = new Set([
      '_id', '_openid', 'houseId', 'tenantId', 'startDate', 'endDate', 'documentStartDate', 'documentEndDate', 'documentTerms', 'occupancyState', 'rent', 'deposit', 'paymentCycle',
      'moveInElectricity', 'moveInWater', 'meterReplaced', 'status', 'rentCoveredUntil', 'nextRentDueDate', 'coverageBaselineSource',
      'endedAt', 'remark', 'createdAt', 'updatedAt'
    ])
    expect(Object.keys(lease).every(field => allowedLeaseFields.has(field))).toBe(true)
    expect(lease).not.toHaveProperty('importMode')
    expect(lease).not.toHaveProperty('lastPaymentDate')
    expect(lease).not.toHaveProperty('lastRentAmount')
  })

  it('可保留现有房屋月租，重复确认不会重复建档', async () => {
    seedExisting()
    const preview = await api.previewHistoricalLeaseImport(existingParams(false))
    await api.confirmHistoricalLeaseImport(preview.confirmationId)
    const replay = await api.confirmHistoricalLeaseImport(preview.confirmationId)

    expect(getCollectionData('houses').find(item => item._id === 'h220').rent).toBe(1000)
    expect(getCollectionData('lease_agreements')).toHaveLength(1)
    expect(replay.replayed).toBe(true)
  })

  it('新房屋和新租客与合同在同一确认链路创建', async () => {
    clearAllData()
    const preview = await api.previewHistoricalLeaseImport({
      house: { mode: 'create', code: '202', address: '里召', rent: 900 },
      tenant: { mode: 'create', name: '李四', idCard: '', phone: '13900000002', remark: '' },
      lease: { startDate: '2026-03-01', endDate: '', rent: 900, deposit: 0, paymentCycle: 'quarter', rentCoveredUntil: '2026-05-31', remark: '' },
      utilityBaseline: null
    })
    const result = await api.confirmHistoricalLeaseImport(preview.confirmationId)

    expect(getCollectionData('houses').find(item => item._id === result.houseId).status).toBe('rented')
    expect(getCollectionData('tenants').find(item => item._id === result.tenantId).status).toBe('active')
    expect(getCollectionData('bills').filter(item => item.leaseId === result.leaseId)).toHaveLength(1)
    expect(getCollectionData('payments')).toHaveLength(0)
  })

  it('允许不与起租日账期对齐的已缴至日期，并以次日作为计费起点', async () => {
    seedExisting()
    const params = existingParams(true)
    params.lease.rentCoveredUntil = '2026-05-20'
    const preview = await api.previewHistoricalLeaseImport(params)
    expect(preview.historicalImportView.nextRentDueDate).toBe('2026-05-21')
  })

  it('季付合同允许任意已缴截止日', async () => {
    seedExisting()
    const params = existingParams(true)
    params.lease.paymentCycle = 'quarter'
    params.lease.rentCoveredUntil = '2026-05-20'
    const preview = await api.previewHistoricalLeaseImport(params)
    expect(preview.historicalImportView.nextRentDueDate).toBe('2026-05-21')
  })

  it('纸质合同到期后续住时保留纸面期限，按实际续住状态生成当前待收', async () => {
    seedExisting()
    vi.setSystemTime(new Date('2026-08-10T08:00:00+08:00'))
    const params = existingParams(true)
    params.lease = {
      startDate: '2024-03-30', documentStartDate: '2024-03-30', documentEndDate: '2025-06-30',
      occupancyState: 'continued_without_renewal', rent: 1800, deposit: 1800, paymentCycle: 'quarter',
      rentCoveredUntil: '2026-02-25', remark: ''
    }
    const preview = await api.previewHistoricalLeaseImport(params)
    expect(preview.historicalImportView.nextRentDueDate).toBe('2026-02-26')
    expect(preview.historicalImportView.unpaidBillCount).toBe(2)
    const result = await api.confirmHistoricalLeaseImport(preview.confirmationId)
    const lease = getCollectionData('lease_agreements').find(item => item._id === result.leaseId)
    const bills = getCollectionData('bills').filter(item => item.leaseId === result.leaseId)
    expect(key(lease.documentEndDate)).toBe('2025-06-30')
    expect(key(lease.endDate)).toBe('')
    expect(lease.occupancyState).toBe('continued_without_renewal')
    expect(bills.map(item => item.period)).toEqual(['2026-02-26~2026-05-25', '2026-05-26~2026-08-25'])
  })

  it('预览后房屋出现生效合同时拒绝确认', async () => {
    seedExisting()
    const preview = await api.previewHistoricalLeaseImport(existingParams(true))
    getCollectionData('lease_agreements').push({ _id: 'other', houseId: 'h220', tenantId: 'other-tenant', status: 'active', startDate: new Date('2026-06-01') })
    await expect(api.confirmHistoricalLeaseImport(preview.confirmationId)).rejects.toThrow(/已有生效合同|状态已变化/)
    expect(getCollectionData('lease_agreements')).toHaveLength(1)
  })
})

describe('纸质合同 OCR 结构化解析', () => {
  it('提取租客、日期、金额和房屋原文，并标记低置信字段', () => {
    const result = extractHistoricalLease([
      { text: '出租房屋：东楼220室', confidence: 0.96 },
      { text: '承租人：张三', confidence: 0.95 },
      { text: '身份证号：11010519491231002X', confidence: 0.94 },
      { text: '联系电话：13800000001', confidence: 0.93 },
      { text: '租赁期限自2026年1月1日至2026年12月31日', confidence: 0.92 },
      { text: '月租金：900元，月付', confidence: 0.91 },
      { text: '押金：900元', confidence: 0.9 }
    ])
    expect(result.houseOriginalText).toContain('东楼220')
    expect(result.tenantName).toBe('张三')
    expect(result.idCard).toBe('11010519491231002X')
    expect(result.phone).toBe('13800000001')
    expect(result.startDate).toBe('2026-01-01')
    expect(result.endDate).toBe('2026-12-31')
    expect(result.rent).toBe(900)
    expect(result.deposit).toBe(900)
    expect(result.paymentCycle).toBe('month')
    expect(result.uncertainFields).not.toContain('idCard')
  })

  it('解析腾讯高精度 OCR 的跨行标签和值，不从正文或身份证中误取字段', () => {
    const texts = [
      '房屋租赁合同', '承租人:', '张三', '身份证号:', '11010119900307681X',
      '联系电话:', '13800138000', '房屋地址:', '里召301', '第一条租赁期限',
      '租赁期限自', '2024', '年', '3', '月', '日至', '2025', '年', '6', '月', '30日。',
      '第二条租金及付款方式', '月租金:', '1800', '元', '押金:', '1800', '元',
      '付款周期:', '押一付三', '租金已交至', '2025', '年', '3月', '31日。',
      '第三条水电及表数', '水电已结清至', '2025', '年', '3', '月', '31', '日。',
      '电表读数:', '100', '水表读数:', '100', '第四条双方权利与义务',
      '1.乙方应按约定的时间和方式支付租金及其他费用。',
      '2.乙方应合理使用并爱护房屋及其附属设施，不得擅自改变房屋结构或用途。',
      '承租人(签字):'
    ]
    const result = extractHistoricalLease(texts.map((text, order) => ({ text, order, confidence: 1 })))

    expect(result.tenantName).toBe('张三')
    expect(result.idCard).toBe('11010119900307681X')
    expect(result.phone).toBe('13800138000')
    expect(result.houseOriginalText).toBe('里召301')
    expect(result.startDate).toBe('')
    expect(result.endDate).toBe('2025-06-30')
    expect(result.rent).toBe(1800)
    expect(result.deposit).toBe(1800)
    expect(result.paymentTermsText).toBe('押一付三')
    expect(result.paymentCycle).toBe('quarter')
    expect(result.rentCoveredUntil).toBe('2025-03-31')
    expect(result.utilityDate).toBe('2025-03-31')
    expect(result.utilityElectricity).toBe(100)
    expect(result.utilityWater).toBe(100)
    expect(result.uncertainFields).toContain('startDate')
    expect(result.uncertainFields).toContain('idCard')
    expect(result.ocrText).toContain('乙方应按约定')
  })

  it('同一字段出现不同候选值时留空并标记不确定', () => {
    const result = extractHistoricalLease([
      { text: '承租人：张三', confidence: 0.99 },
      { text: '承租人：李四', confidence: 0.99 }
    ])
    expect(result.tenantName).toBe('')
    expect(result.uncertainFields).toContain('tenantName')
  })

  it('每张图片只调用一次高精度 OCR 并保留坐标', async () => {
    let accurateCalls = 0
    const client = {
      async GeneralAccurateOCR() {
        accurateCalls += 1
        return {
          Angle: 1.5,
          TextDetections: [{
            DetectedText: '承租人：张三', Confidence: 99,
            Polygon: [{ X: 10, Y: 20 }, { X: 100, Y: 20 }, { X: 100, Y: 40 }, { X: 10, Y: 40 }],
            ItemPolygon: { X: 10, Y: 20, Width: 90, Height: 20 }
          }]
        }
      },
      async GeneralHandwritingOCR() {
        throw new Error('不应调用旧版手写 OCR')
      }
    }
    const page = await recognizeImage(client, Buffer.from('image'), 2)
    expect(accurateCalls).toBe(1)
    expect(page.angle).toBe(1.5)
    expect(page.items[0]).toMatchObject({ pageIndex: 2, text: '承租人：张三', confidence: 0.99 })
    expect(page.items[0].itemPolygon).toEqual({ X: 10, Y: 20, Width: 90, Height: 20 })
  })
})
