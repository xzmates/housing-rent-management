const crypto = require('crypto')
const { invariant } = require('./errors')

function stable(value) {
  if (Array.isArray(value)) return value.map(stable)
  if (value && typeof value === 'object') {
    return Object.keys(value).sort().reduce((out, key) => {
      out[key] = stable(value[key])
      return out
    }, {})
  }
  return value
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex')
}

async function createConfirmation(db, caller, action, input, snapshot, ttlMinutes = 15) {
  invariant(caller && caller.openId, 'FORBIDDEN', '缺少调用者身份')
  const now = new Date()
  const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000)
  const payload = { action, input, snapshot }
  const targetId = (snapshot && snapshot.targetId) || input.leaseId || input.billId || input.houseId || input.tenantId || ''
  const sourceDigest = (snapshot && snapshot.sourceDigest) || ''
  const res = await db.collection('operation_confirmations').add({
    _openid: caller.openId,
    action,
    actionName: action,
    targetId,
    sourceDigest,
    normalizedInput: input,
    snapshot,
    digest: digest(payload),
    status: 'pending',
    expiresAt,
    createdAt: now,
    executedAt: null
  })
  return { confirmationId: res.id || res._id, expiresAt: expiresAt.toISOString() }
}

module.exports = { createConfirmation, digest }
