const apis = require('./index')

async function getActiveLeases(params = {}) {
  return apis.getActiveLeases(params)
}

module.exports = getActiveLeases

