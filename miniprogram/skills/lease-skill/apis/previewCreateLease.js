const apis = require('./index')

async function previewCreateLease(params = {}) {
  return apis.previewCreateLease(params)
}

module.exports = previewCreateLease

