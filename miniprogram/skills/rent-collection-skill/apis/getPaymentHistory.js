const apis = require('./index')

async function getPaymentsByDateRange(params = {}) {
  return apis.getPaymentsByDateRange(params)
}

module.exports = getPaymentsByDateRange

