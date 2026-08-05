describe('创建租赁合同的押金默认值', () => {
  function loadPage() {
    let pageDef = null
    const oldPage = global.Page
    global.Page = (def) => { pageDef = def }
    delete require.cache[require.resolve('../../miniprogram/pages/create-lease/index.js')]
    require('../../miniprogram/pages/create-lease/index.js')
    global.Page = oldPage
    return pageDef
  }

  function setByPath(target, path, value) {
    const keys = path.split('.')
    let cursor = target
    for (let i = 0; i < keys.length - 1; i++) cursor = cursor[keys[i]]
    cursor[keys[keys.length - 1]] = value
  }

  function createContext() {
    const pageDef = loadPage()
    return {
      ...pageDef,
      data: JSON.parse(JSON.stringify(pageDef.data)),
      setData(patch, callback) {
        Object.keys(patch).forEach((key) => setByPath(this.data, key, patch[key]))
        if (callback) callback()
      }
    }
  }

  it('选择房屋时，押金默认与该房屋月租一致', () => {
    const ctx = createContext()
    ctx.data.houses = [{ _id: 'house-201', rent: 1200 }]
    ctx.loadHouseMeterBaseline = () => Promise.resolve()

    ctx.onHouseChange.call(ctx, { detail: { value: '0' } })

    expect(ctx.data.form).toMatchObject({
      houseId: 'house-201',
      rent: 1200,
      deposit: 1200
    })
  })

  it('预填房屋而未明确传押金时，押金默认使用房屋月租', async () => {
    const ctx = createContext()
    ctx.data.presetHouseId = 'house-202'
    ctx.data.presetDeposit = null
    ctx.loadHouseMeterBaseline = () => Promise.resolve()

    const api = require('../../miniprogram/services/api')
    const oldHouses = api.getHousesWithOccupancy
    const oldTenants = api.getTenantsWithOccupancy
    api.getHousesWithOccupancy = async () => ({ data: [{
      _id: 'house-202', code: '202', address: '东楼', rent: 1500, status: 'available', hasActiveLease: false
    }] })
    api.getTenantsWithOccupancy = async () => ({ data: [] })
    try {
      await ctx.loadData()
      expect(ctx.data.form).toMatchObject({ houseId: 'house-202', rent: 1500, deposit: 1500 })
    } finally {
      api.getHousesWithOccupancy = oldHouses
      api.getTenantsWithOccupancy = oldTenants
    }
  })
})
