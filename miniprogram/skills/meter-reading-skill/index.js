const { createSkillMiddleware } = require('../_shared/middleware')
const apis = require('./apis/index')

const skill = wx.modelContext.createSkill('skills/meter-reading-skill')
skill.use(createSkillMiddleware('meter-reading-skill'))

skill.registerAPI('getMeterTargets', apis.getMeterTargets)
skill.registerAPI('previewMeterReading', apis.previewMeterReading)
skill.registerAPI('confirmMeterReading', apis.confirmMeterReading)

console.info('[ai-mode] meter-reading-skill APIs registered')
