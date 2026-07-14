const { CLOUD_ENV_ID, RENTAL_DOMAIN } = require('./config')

let cloudInited = false

function ensureCloudInit() {
  if (cloudInited) return
  if (!wx.cloud) throw new Error('当前环境不支持 wx.cloud')
  wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true })
  cloudInited = true
}

async function callRentalDomain(action, params = {}) {
  ensureCloudInit()
  const res = await wx.cloud.callFunction({
    name: RENTAL_DOMAIN,
    data: { action, params }
  })
  const result = res.result || {}
  if (result.code !== 0 && result.code !== 200) {
    throw new Error(result.message || `rentalDomain.${action} 调用失败`)
  }
  return result.data
}

function successResult(text, structuredContent) {
  const result = { isError: false, content: [{ type: 'text', text }] }
  if (structuredContent !== undefined) result.structuredContent = structuredContent
  return result
}

function errorResult(msg) {
  return { isError: true, content: [{ type: 'text', text: msg }] }
}

module.exports = { ensureCloudInit, callRentalDomain, successResult, errorResult }
