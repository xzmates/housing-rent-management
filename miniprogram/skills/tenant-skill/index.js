const { createSkillMiddleware } = require('../_shared/middleware')
const apis = require('./apis/index')

const skill = wx.modelContext.createSkill('skills/tenant-skill')
skill.use(createSkillMiddleware('tenant-skill'))

skill.registerAPI('searchTenants', apis.searchTenants)
skill.registerAPI('getTenantDetail', apis.getTenantDetail)
skill.registerAPI('previewCreateTenant', apis.previewCreateTenant)
skill.registerAPI('confirmCreateTenant', apis.confirmCreateTenant)

console.info('[ai-mode] tenant-skill APIs registered')
