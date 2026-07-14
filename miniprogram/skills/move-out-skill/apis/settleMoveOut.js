const apis = require('./index')

async function settleMoveOut(params = {}) {
  return apis.settleMoveOut(params)
}

module.exports = settleMoveOut

