const { DomainError } = require('./errors')

const TOKEN_URL = 'https://api.weixin.qq.com/cgi-bin/stable_token'
const SEND_URL = 'https://api.weixin.qq.com/cgi-bin/message/subscribe/send'
const TOKEN_ERROR_CODES = new Set([40014, 42001])

function apiError(payload, fallback) {
  const error = new Error(String(payload && payload.errmsg || fallback))
  error.errCode = Number(payload && payload.errcode || -1)
  return error
}

function createWechatSubscribeSender({ env = process.env, fetchImpl = global.fetch, now = () => Date.now() } = {}) {
  let tokenCache = { value: '', expiresAt: 0 }

  async function requestJson(url, options) {
    if (typeof fetchImpl !== 'function') throw new DomainError('CONFIGURATION_ERROR', '当前云函数运行时不支持 fetch')
    const response = await fetchImpl(url, options)
    const payload = await response.json()
    if (!response.ok) throw apiError(payload, `微信服务端接口请求失败：HTTP ${response.status}`)
    return payload
  }

  async function getAccessToken(forceRefresh = false) {
    const appId = String(env.WECHAT_MINIPROGRAM_APP_ID || '').trim()
    const appSecret = String(env.WECHAT_MINIPROGRAM_APP_SECRET || '').trim()
    if (!appId || !appSecret) throw new DomainError('CONFIGURATION_ERROR', '云函数尚未配置小程序 AppID/AppSecret')
    if (!forceRefresh && tokenCache.value && tokenCache.expiresAt > now() + 60000) return tokenCache.value

    const payload = await requestJson(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ grant_type: 'client_credential', appid: appId, secret: appSecret, force_refresh: forceRefresh })
    })
    if (!payload.access_token) throw apiError(payload, '获取微信 access_token 失败')
    tokenCache = {
      value: payload.access_token,
      expiresAt: now() + Math.max(300, Number(payload.expires_in || 7200)) * 1000
    }
    return tokenCache.value
  }

  async function sendWithToken(params, forceRefresh = false) {
    const token = await getAccessToken(forceRefresh)
    const payload = await requestJson(`${SEND_URL}?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        touser: params.touser,
        template_id: params.templateId,
        page: params.page,
        data: params.data,
        miniprogram_state: params.miniprogramState,
        lang: params.lang
      })
    })
    if (Number(payload.errcode || 0) !== 0) {
      if (!forceRefresh && TOKEN_ERROR_CODES.has(Number(payload.errcode))) {
        tokenCache = { value: '', expiresAt: 0 }
        return sendWithToken(params, true)
      }
      throw apiError(payload, '发送微信订阅消息失败')
    }
    return payload
  }

  return params => sendWithToken(params)
}

module.exports = { createWechatSubscribeSender }
