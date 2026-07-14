const apis = require('./index')

async function previewMeterReading(params = {}) {
  return apis.previewMeterReading(params)
}

module.exports = previewMeterReading

