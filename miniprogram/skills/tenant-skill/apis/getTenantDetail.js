const apis = require('./index')

async function getTenantDetail(params = {}) {
  return apis.getTenantDetail(params)
}

module.exports = getTenantDetail

