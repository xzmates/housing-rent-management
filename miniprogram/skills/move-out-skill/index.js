const { createSkillMiddleware } = require('../_shared/middleware')
const apis = require('./apis/index')

const skill = wx.modelContext.createSkill('skills/move-out-skill')
skill.use(createSkillMiddleware('move-out-skill'))

skill.registerAPI('getMoveOutTargets', apis.getMoveOutTargets)
skill.registerAPI('previewMoveOutSettlement', apis.previewMoveOutSettlement)

console.info('[ai-mode] move-out-skill APIs registered')
