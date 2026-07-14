const apis = require('./index')

async function getMeterTargets(params = {}) {
  return apis.getMeterTargets(params)
}

module.exports = getMeterTargets

