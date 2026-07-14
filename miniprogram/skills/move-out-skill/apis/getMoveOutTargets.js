const apis = require('./index')

async function getMoveOutTargets(params = {}) {
  return apis.getMoveOutTargets(params)
}

module.exports = getMoveOutTargets

