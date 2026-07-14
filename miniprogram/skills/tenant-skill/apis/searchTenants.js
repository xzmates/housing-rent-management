const apis = require('./index')

async function searchTenants(params = {}) {
  return apis.searchTenants(params)
}

module.exports = searchTenants

