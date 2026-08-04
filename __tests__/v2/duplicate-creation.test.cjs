const { clearAllData, getCollectionData } = require('../setup.cjs')
const api = require('../../miniprogram/services/api')
const houseSkill = require('../../miniprogram/skills/house-skill/apis')
const tenantSkill = require('../../miniprogram/skills/tenant-skill/apis')

beforeEach(() => { clearAllData() })

describe('创建去重保护', () => {
  it('同一楼栋和房屋编号在预览、最终创建两层均被拒绝', async () => {
    await api.addHouse({ code: '223', address: '东楼', rent: 1000 })

    await expect(api.previewCreateHouse({ code: ' 223 ', address: '东 楼', rent: 1000 }))
      .rejects.toThrow(/房屋已存在/)
    await expect(api.addHouse({ code: '223', address: '东楼', rent: 1000 }))
      .rejects.toThrow(/房屋已存在/)

    expect((await api.getHouses()).data).toHaveLength(1)
  })

  it('相同手机号或身份证的租客在预览、最终创建两层均被拒绝', async () => {
    await api.addTenant({ name: '徐阿姨', phone: '13800138000', idCard: '110101199001011234' })

    await expect(api.previewCreateTenant({ name: '徐阿姨', phone: '138-0013-8000' }))
      .rejects.toThrow(/租客已存在/)
    await expect(api.addTenant({ name: '另一姓名', idCard: '110101199001011234' }))
      .rejects.toThrow(/租客已存在/)

    expect((await api.getTenants()).data).toHaveLength(1)
  })

  it('AI 创建入口命中已有房屋或租客时不再返回 Handoff 卡片', async () => {
    await api.addHouse({ code: '223', address: '东楼', rent: 1000 })
    await api.addTenant({ name: '徐阿姨', phone: '13800138000' })

    const houseResult = await houseSkill.previewCreateHouse({ code: '223', address: '东楼', rent: 1000 })
    const tenantResult = await tenantSkill.previewCreateTenant({ name: '徐阿姨', phone: '13800138000' })

    expect(houseResult.isError).toBe(true)
    expect(houseResult.handoff).toBeUndefined()
    expect(tenantResult.isError).toBe(true)
    expect(tenantResult.handoff).toBeUndefined()
  })

  it('相同房屋、租客和起租日的历史合同不能再次创建', async () => {
    const house = await api.addHouse({ code: '201', address: '东楼', rent: 1000 })
    const tenant = await api.addTenant({ name: '阿东', phone: '13800138001' })
    await api.createLease({ houseId: house._id, tenantId: tenant._id, startDate: '2026-07-01', rent: 1000 })

    const lease = getCollectionData('lease_agreements')[0]
    lease.status = 'terminated'
    getCollectionData('houses')[0].status = 'available'
    getCollectionData('tenants')[0].status = 'inactive'

    const duplicate = { houseId: house._id, tenantId: tenant._id, startDate: '2026-07-01', rent: 1000 }
    await expect(api.previewCreateLease(duplicate)).rejects.toThrow(/相同房屋、租客和起租日/)
    await expect(api.createLease(duplicate)).rejects.toThrow(/相同房屋、租客和起租日/)
    expect((await api.getLeases({ houseId: house._id })).data).toHaveLength(1)
  })
})
