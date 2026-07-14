const { DomainError } = require('./errors')

function getCaller(app) {
  try {
    const info = app.auth().getUserInfo() || {}
    const openId = info.openId || info.OPENID || info.uid || ''
    if (!openId) throw new Error('missing openid')
    return { openId }
  } catch (error) {
    throw new DomainError('FORBIDDEN', '无法识别当前小程序用户')
  }
}

module.exports = { getCaller }
