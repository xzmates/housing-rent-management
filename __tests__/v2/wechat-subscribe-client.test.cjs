const { createWechatSubscribeSender } = require('../../cloudfunctions/rentalDomain/infrastructure/wechat-subscribe-client')

function response(payload) {
  return { ok: true, status: 200, json: async () => payload }
}

describe('微信订阅消息服务端客户端', () => {
  it('使用 stable_token 并按微信字段格式发送消息', async () => {
    const calls = []
    const send = createWechatSubscribeSender({
      env: { WECHAT_MINIPROGRAM_APP_ID: 'appid', WECHAT_MINIPROGRAM_APP_SECRET: 'secret' },
      fetchImpl: async (url, options) => {
        calls.push({ url, options })
        return calls.length === 1 ? response({ access_token: 'token-1', expires_in: 7200 }) : response({ errcode: 0, errmsg: 'ok' })
      },
      now: () => 1000
    })

    await send({
      touser: 'openid', templateId: 'template', page: 'pages/dashboard/index',
      data: { amount28: { value: '100' } }, miniprogramState: 'formal', lang: 'zh_CN'
    })

    expect(calls).toHaveLength(2)
    expect(JSON.parse(calls[1].options.body)).toMatchObject({
      touser: 'openid', template_id: 'template', miniprogram_state: 'formal'
    })
  })

  it('access_token 失效时强制刷新并重试一次', async () => {
    const replies = [
      { access_token: 'old-token', expires_in: 7200 },
      { errcode: 40014, errmsg: 'invalid access_token' },
      { access_token: 'new-token', expires_in: 7200 },
      { errcode: 0, errmsg: 'ok' }
    ]
    const send = createWechatSubscribeSender({
      env: { WECHAT_MINIPROGRAM_APP_ID: 'appid', WECHAT_MINIPROGRAM_APP_SECRET: 'secret' },
      fetchImpl: async () => response(replies.shift()),
      now: () => 1000
    })

    await expect(send({ touser: 'openid', templateId: 'template', data: {} })).resolves.toMatchObject({ errcode: 0 })
    expect(replies).toHaveLength(0)
  })
})
