async function writeAudit(db, caller, entry) {
  const now = new Date()
  const payload = {
    _openid: caller && caller.openId,
    action: entry.action,
    phase: entry.phase || 'request',
    status: entry.status || 'success',
    requestId: entry.requestId || '',
    targetId: entry.targetId || '',
    idempotencyKey: entry.idempotencyKey || '',
    summary: entry.summary || {},
    errorCode: entry.errorCode || '',
    errorMessage: entry.errorMessage || '',
    createdAt: now
  }
  await db.collection('operation_logs').add(payload)
  return payload
}

async function safeAudit(db, caller, entry) {
  try {
    return await writeAudit(db, caller, entry)
  } catch (error) {
    console.warn('[rentalDomain] audit skipped', { message: error.message, action: entry && entry.action })
    return null
  }
}

module.exports = { safeAudit, writeAudit }
