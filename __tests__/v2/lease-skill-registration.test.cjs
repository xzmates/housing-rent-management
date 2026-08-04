const leaseSkillPath = require.resolve('../../miniprogram/skills/lease-skill/index.js')
const houseSkillPath = require.resolve('../../miniprogram/skills/house-skill/index.js')
const rentCollectionSkillPath = require.resolve('../../miniprogram/skills/rent-collection-skill/index.js')

describe('合同查询 Skill 注册', () => {
  it('注册相对时间入住退租查询接口', () => {
    const previousModelContext = wx.modelContext
    const registered = []
    wx.modelContext = {
      createSkill() {
        return {
          use() {},
          registerAPI(name, handler) { registered.push({ name, handler }) }
        }
      }
    }
    try {
      delete require.cache[leaseSkillPath]
      require(leaseSkillPath)
      expect(registered.find(item => item.name === 'listGlobalMoveInOutForRelativePeriod')?.handler).toBeTypeOf('function')
      expect(registered.find(item => item.name === 'listGlobalMoveInOutByDateRange')?.handler).toBeTypeOf('function')
      expect(registered.find(item => item.name === 'getContractOverview')?.handler).toBeTypeOf('function')
      expect(registered.find(item => item.name === 'getRelativeLeaseExpiry')?.handler).toBeTypeOf('function')
      expect(registered.find(item => item.name === 'getAllLeaseActivityByDateRange')).toBeUndefined()
      expect(registered.find(item => item.name === 'getTenantLeaseHistoryByKeyword')).toBeUndefined()
      expect(registered.find(item => item.name === 'getLeaseActivity')).toBeUndefined()
      expect(registered.find(item => item.name === 'getRelativeFutureReceivables')?.handler).toBeTypeOf('function')
      expect(registered.find(item => item.name === 'getTenantPaymentHistoryByKeyword')?.handler).toBeTypeOf('function')
      expect(registered.find(item => item.name === 'getHousePaymentHistoryByKeyword')?.handler).toBeTypeOf('function')
      expect(registered.find(item => item.name === 'getTenantArrearsByKeyword')?.handler).toBeTypeOf('function')
      expect(registered.find(item => item.name === 'getFutureReceivablesByExplicitDateRange')).toBeUndefined()
      expect(registered.find(item => item.name === 'getFutureReceivables')).toBeUndefined()
      expect(registered.find(item => item.name === 'getSubjectProfile')).toBeUndefined()
    } finally {
      if (previousModelContext === undefined) delete wx.modelContext
      else wx.modelContext = previousModelContext
      delete require.cache[leaseSkillPath]
    }
  })

  it('房屋查询只注册安全关键词入口，不注册可猜测 ID 的详情接口', () => {
    const previousModelContext = wx.modelContext
    const registered = []
    wx.modelContext = {
      createSkill() {
        return {
          use() {},
          registerAPI(name, handler) { registered.push({ name, handler }) }
        }
      }
    }
    try {
      delete require.cache[houseSkillPath]
      require(houseSkillPath)
      expect(registered.find(item => item.name === 'getHouseDetailByKeyword')?.handler).toBeTypeOf('function')
      expect(registered.find(item => item.name === 'getHouseProfileByKeyword')?.handler).toBeTypeOf('function')
      expect(registered.find(item => item.name === 'getHouseDetail')).toBeUndefined()
      expect(registered.find(item => item.name === 'getHouseProfile')).toBeUndefined()
    } finally {
      if (previousModelContext === undefined) delete wx.modelContext
      else wx.modelContext = previousModelContext
      delete require.cache[houseSkillPath]
    }
  })

  it('收租 Skill 仅注册强制日期范围的付款查询接口', () => {
    const previousModelContext = wx.modelContext
    const registered = []
    wx.modelContext = {
      createSkill() {
        return {
          use() {},
          registerAPI(name, handler) { registered.push({ name, handler }) }
        }
      }
    }
    try {
      delete require.cache[rentCollectionSkillPath]
      require(rentCollectionSkillPath)
      expect(registered.find(item => item.name === 'getPaymentsByDateRange')?.handler).toBeTypeOf('function')
      expect(registered.find(item => item.name === 'getPaymentHistory')).toBeUndefined()
      expect(registered.find(item => item.name === 'getUnpaidBills')).toBeUndefined()
    } finally {
      if (previousModelContext === undefined) delete wx.modelContext
      else wx.modelContext = previousModelContext
      delete require.cache[rentCollectionSkillPath]
    }
  })

  it('租客 Skill 只暴露安全的关键词详情查询，不暴露可猜测 ID 的详情接口', () => {
    const tenantSkillPath = require.resolve('../../miniprogram/skills/tenant-skill/index.js')
    const previousModelContext = wx.modelContext
    const registered = []
    wx.modelContext = {
      createSkill() {
        return {
          use() {},
          registerAPI(name, handler) { registered.push({ name, handler }) }
        }
      }
    }
    try {
      delete require.cache[tenantSkillPath]
      require(tenantSkillPath)
      expect(registered.find(item => item.name === 'getTenantDetailByKeyword')?.handler).toBeTypeOf('function')
      expect(registered.find(item => item.name === 'getTenantDetail')).toBeUndefined()
    } finally {
      if (previousModelContext === undefined) delete wx.modelContext
      else wx.modelContext = previousModelContext
      delete require.cache[tenantSkillPath]
    }
  })
})
