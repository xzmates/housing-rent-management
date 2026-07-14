const apis = require('./index')

async function previewMoveOutSettlement(params = {}) {
  return apis.previewMoveOutSettlement(params)
}

module.exports = previewMoveOutSettlement

