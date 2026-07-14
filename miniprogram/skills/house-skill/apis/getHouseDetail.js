const apis = require('./index')

async function getHouseDetail(params = {}) {
  return apis.getHouseDetail(params)
}

module.exports = getHouseDetail

