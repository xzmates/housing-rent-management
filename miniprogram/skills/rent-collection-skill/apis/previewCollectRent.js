const apis = require('./index')

async function previewCollectRent(params = {}) {
  return apis.previewCollectRent(params)
}

module.exports = previewCollectRent

