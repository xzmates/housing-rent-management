const { createSkillMiddleware } = require('../_shared/middleware')
const apis = require('./apis/index')

const skill = wx.modelContext.createSkill('skills/lease-skill')
skill.use(createSkillMiddleware('lease-skill'))

skill.registerAPI('getActiveLeases', apis.getActiveLeases)
skill.registerAPI('previewCreateLease', apis.previewCreateLease)
skill.registerAPI('confirmCreateLease', apis.confirmCreateLease)
skill.registerAPI('previewPrepayRent', apis.previewPrepayRent)
skill.registerAPI('previewRentCollection', apis.previewRentCollection)
skill.registerAPI('previewRenewLease', apis.previewRenewLease)

console.info('[ai-mode] lease-skill APIs registered')
