const apis = require('./index')

async function getUnpaidBills(params = {}) {
  return apis.getUnpaidBills(params)
}

module.exports = getUnpaidBills

