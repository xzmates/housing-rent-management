const apis = require('./index')

async function previewCreateHouse(params = {}) {
  return apis.previewCreateHouse(params)
}

module.exports = previewCreateHouse

