const { createSkillMiddleware } = require('../_shared/middleware')
const apis = require('./apis/index')

const skill = wx.modelContext.createSkill('skills/house-skill')
skill.use(createSkillMiddleware('house-skill'))

skill.registerAPI('searchHouses', apis.searchHouses)
skill.registerAPI('getHouseAvailability', apis.getHouseAvailability)
// 自然语言入口不得接受可猜测/可复用的 houseId，必须先按用户原话唯一匹配。
skill.registerAPI('getHouseDetailByKeyword', apis.getHouseDetailByKeyword)
skill.registerAPI('getHouseProfileByKeyword', apis.getHouseProfileByKeyword)
skill.registerAPI('previewCreateHouse', apis.previewCreateHouse)
skill.registerAPI('confirmCreateHouse', apis.confirmCreateHouse)

console.info('[ai-mode] house-skill APIs registered')
