const { createSkillMiddleware } = require('../_shared/middleware')
const apis = require('./apis/index')

const skill = wx.modelContext.createSkill('skills/rent-collection-skill')
skill.use(createSkillMiddleware('rent-collection-skill'))

skill.registerAPI('getUnpaidBills', apis.getUnpaidBills)
skill.registerAPI('previewCollectRent', apis.previewCollectRent)
skill.registerAPI('confirmCollectRent', apis.confirmCollectRent)
skill.registerAPI('getPaymentHistory', apis.getPaymentHistory)

console.info('[ai-mode] rent-collection-skill APIs registered')
