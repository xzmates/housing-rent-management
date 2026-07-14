const apis = require('./index')

async function previewCreateTenant(params = {}) {
  return apis.previewCreateTenant(params)
}

module.exports = previewCreateTenant

