const api = require('../../miniprogram/services/api')

let pageDef = null
const previousPage = global.Page
global.Page = def => { pageDef = def }
require('../../miniprogram/pages/batch-meter/index.js')
global.Page = previousPage

function createPageContext(overrides = {}) {
  return {
    data: { ...pageDef.data, ...overrides },
    loadData() {},
    setData(patch, callback) {
      Object.entries(patch).forEach(([key, value]) => {
        const match = key.match(/^meters\[(\d+)\]\.(.+)$/)
        if (match) this.data.meters[Number(match[1])][match[2]] = value
        else this.data[key] = value
      })
      if (callback) callback()
    }
  }
}

describe('批量抄表日期', () => {
  const oldAddMeterReading = api.addMeterReading
  const oldShowModal = wx.showModal
  const oldShowToast = wx.showToast

  afterEach(() => {
    api.addMeterReading = oldAddMeterReading
    wx.showModal = oldShowModal
    wx.showToast = oldShowToast
  })

  it('每条记录默认今天，选择的日期会分别传给对应抄表记录', async () => {
    const ctx = createPageContext({
      totalCost: 68,
      meters: [
        { leaseId: 'lease_1', houseLabel: '202 - 东楼', currentElec: '100', currentWater: '100', lastReadDateKey: '2026-07-23', calculationDate: '2026-07-28', hasError: false },
        { leaseId: 'lease_2', houseLabel: '203 - 东楼', currentElec: '110', currentWater: '120', lastReadDateKey: '2026-07-23', calculationDate: '2026-07-28', hasError: false }
      ]
    })
    pageDef.onCalculationDateChange.call(ctx, { currentTarget: { dataset: { index: '1' } }, detail: { value: '2026-07-27' } })
    expect(ctx.data.meters[0].calculationDate).toBe('2026-07-28')
    expect(ctx.data.meters[1].calculationDate).toBe('2026-07-27')

    const submissions = []
    api.addMeterReading = async params => { submissions.push(params) }
    let confirm
    wx.showModal = ({ success }) => { confirm = success }
    wx.showToast = () => {}

    await pageDef.submitAll.call(ctx)
    await confirm({ confirm: true })

    expect(submissions).toEqual([
      { leaseId: 'lease_1', electricityReading: 100, waterReading: 100, calculationDate: '2026-07-28' },
      { leaseId: 'lease_2', electricityReading: 110, waterReading: 120, calculationDate: '2026-07-27' }
    ])
  })

  it('选择早于上次抄表的日期时阻止提交', async () => {
    const ctx = createPageContext({
      totalCost: 68,
      meters: [{ leaseId: 'lease_1', houseLabel: '202 - 东楼', currentElec: '100', currentWater: '100', lastReadDateKey: '2026-07-23', calculationDate: '2026-07-22', hasError: false }]
    })
    const toasts = []
    wx.showToast = payload => { toasts.push(payload) }
    api.addMeterReading = async () => { throw new Error('不应提交') }

    await pageDef.submitAll.call(ctx)

    expect(toasts[0].title).toContain('不能早于')
  })
})
