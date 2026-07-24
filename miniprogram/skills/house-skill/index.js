const { createSkillMiddleware } = require('../_shared/middleware')
const apis = require('./apis/index')

const skill = wx.modelContext.createSkill('skills/house-skill')
skill.use(createSkillMiddleware('house-skill'))

skill.registerAPI('searchHouses', apis.searchHouses)
skill.registerAPI('getHouseAvailability', apis.getHouseAvailability)
skill.registerAPI('getHouseDetail', apis.getHouseDetail)
skill.registerAPI('previewCreateHouse', apis.previewCreateHouse)
skill.registerAPI('confirmCreateHouse', apis.confirmCreateHouse)

console.info('[ai-mode] house-skill APIs registered')
