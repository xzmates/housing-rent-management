const apis = require('./index')

async function confirmMeterReading(params = {}) {
  return apis.confirmMeterReading(params)
}

module.exports = confirmMeterReading

