const { invariant } = require('./errors')

function idempotencyKey(action, confirmationId) {
  invariant(action && confirmationId, 'VALIDATION_ERROR', '缺少幂等参数')
  return `${action}:${confirmationId}`
}

async function loadPendingConfirmation(db, caller, action, confirmationId) {
  invariant(caller && caller.openId, 'FORBIDDEN', '缺少调用者身份')
  invariant(confirmationId, 'VALIDATION_ERROR', '缺少确认 ID')
  const res = await db.collection('operation_confirmations').doc(confirmationId).get()
  const confirmation = res && res.data && (Array.isArray(res.data) ? res.data[0] : res.data)
  invariant(confirmation, 'NOT_FOUND', '确认记录不存在')
  invariant(confirmation._openid === caller.openId, 'FORBIDDEN', '不能操作他人的确认记录')
  invariant(confirmation.action === action, 'VALIDATION_ERROR', '确认动作不匹配')
  invariant(confirmation.status === 'pending', 'CONFLICT', '确认记录已处理或失效')
  invariant(!confirmation.expiresAt || new Date(confirmation.expiresAt).getTime() >= Date.now(), 'CONFLICT', '确认记录已过期')
  return confirmation
}

async function findExecutedOperation(db, caller, key) {
  invariant(caller && caller.openId, 'FORBIDDEN', '缺少调用者身份')
  const res = await db.collection('operation_logs').where({ _openid: caller.openId, idempotencyKey: key, status: 'success' }).limit(1).get()
  return res && res.data && res.data[0]
}

module.exports = { idempotencyKey, loadPendingConfirmation, findExecutedOperation }
