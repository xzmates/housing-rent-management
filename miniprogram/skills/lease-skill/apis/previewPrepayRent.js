const apis = require('./index')

async function previewPrepayRent(params = {}) {
  return apis.previewPrepayRent(params)
}

module.exports = previewPrepayRent

