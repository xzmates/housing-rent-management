const apis = require('./index')

async function getPaymentHistory(params = {}) {
  return apis.getPaymentHistory(params)
}

module.exports = getPaymentHistory

