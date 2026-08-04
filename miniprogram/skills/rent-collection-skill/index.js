const { createSkillMiddleware } = require('../_shared/middleware')
const apis = require('./apis/index')

const skill = wx.modelContext.createSkill('skills/rent-collection-skill')
skill.use(createSkillMiddleware('rent-collection-skill'))

skill.registerAPI('previewCollectRent', apis.previewCollectRent)
skill.registerAPI('getPaymentsByDateRange', apis.getPaymentsByDateRange)

console.info('[ai-mode] rent-collection-skill APIs registered')
