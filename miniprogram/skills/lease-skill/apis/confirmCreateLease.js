const apis = require('./index')

async function confirmCreateLease(params = {}) {
  return apis.confirmCreateLease(params)
}

module.exports = confirmCreateLease

