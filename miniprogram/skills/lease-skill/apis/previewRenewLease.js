const apis = require('./index')

async function previewRenewLease(params = {}) {
  return apis.previewRenewLease(params)
}

module.exports = previewRenewLease

