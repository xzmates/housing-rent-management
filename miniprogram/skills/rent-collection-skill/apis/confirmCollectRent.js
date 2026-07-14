const apis = require('./index')

async function confirmCollectRent(params = {}) {
  return apis.confirmCollectRent(params)
}

module.exports = confirmCollectRent

