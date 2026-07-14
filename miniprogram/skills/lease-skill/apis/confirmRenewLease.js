const apis = require('./index')

async function confirmRenewLease(params = {}) {
  return apis.confirmRenewLease(params)
}

module.exports = confirmRenewLease

