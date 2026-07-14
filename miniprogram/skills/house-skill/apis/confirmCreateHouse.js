const apis = require('./index')

async function confirmCreateHouse(params = {}) {
  return apis.confirmCreateHouse(params)
}

module.exports = confirmCreateHouse

