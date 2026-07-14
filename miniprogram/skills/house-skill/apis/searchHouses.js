const apis = require('./index')

async function searchHouses(params = {}) {
  return apis.searchHouses(params)
}

module.exports = searchHouses

