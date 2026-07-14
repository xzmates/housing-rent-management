const apis = require('./index')

async function confirmCreateTenant(params = {}) {
  return apis.confirmCreateTenant(params)
}

module.exports = confirmCreateTenant

