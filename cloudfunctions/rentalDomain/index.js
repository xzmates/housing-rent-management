const cloud = require('@cloudbase/node-sdk')
const { DomainError } = require('./infrastructure/errors')
const { getCaller } = require('./infrastructure/auth')
const { createRepository } = require('./repositories/rental-repository')
const { createQueryService } = require('./application/query-service')
const { createPreviewService } = require('./application/preview-service')
const { createCommandService } = require('./application/command-service')
const { safeAudit } = require('./infrastructure/audit')

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV })
const db = app.database()
const repo = createRepository(db)
const command = createCommandService(app, db)

function createActions(caller) {
  const scopedRepo = repo.forOwner(caller.openId)
  const query = createQueryService(scopedRepo, db.command)
  const preview = createPreviewService(db, scopedRepo)
  async function getOperationConfirmation(params = {}) {
    const confirmationId = params.confirmationId || ''
    if (!confirmationId) throw new DomainError('VALIDATION_ERROR', '缺少确认记录 ID')
    const res = await db.collection('operation_confirmations').doc(confirmationId).get()
    const confirmation = res && res.data && (Array.isArray(res.data) ? res.data[0] : res.data)
    if (!confirmation) throw new DomainError('NOT_FOUND', '确认记录不存在')
    if (confirmation._openid !== caller.openId) throw new DomainError('FORBIDDEN', '不能读取他人的确认记录')
    return {
      confirmation: {
        id: confirmation._id || confirmationId,
        action: confirmation.action,
        actionName: confirmation.actionName || confirmation.action,
        targetId: confirmation.targetId || '',
        sourceDigest: confirmation.sourceDigest || '',
        normalizedInput: confirmation.normalizedInput || {},
        snapshot: confirmation.snapshot || null,
        status: confirmation.status,
        expiresAt: confirmation.expiresAt,
        createdAt: confirmation.createdAt,
        executedAt: confirmation.executedAt
      }
    }
  }
  return {
    searchHouses: query.searchHouses,
    getHouseDetail: query.getHouseDetail,
    searchTenants: query.searchTenants,
    getTenantDetail: query.getTenantDetail,
    getActiveLeases: query.getActiveLeases,
    getUnpaidBills: query.getUnpaidBills,
    getPaymentHistory: query.getPaymentHistory,
    getMeterTargets: query.getMeterTargets,
    getMoveOutTargets: query.getMoveOutTargets,
    getOperationConfirmation,
    previewCreateHouse: preview.previewCreateHouse,
    previewCreateTenant: preview.previewCreateTenant,
    previewCreateLease: preview.previewCreateLease,
    previewRenewLease: preview.previewRenewLease,
    previewCollectRent: preview.previewCollectRent,
    previewMeterReading: preview.previewMeterReading,
    previewMoveOutSettlement: preview.previewMoveOutSettlement,
    confirmCreateHouse: command.confirmCreateHouse,
    confirmCreateTenant: command.confirmCreateTenant,
    confirmCreateLease: command.confirmCreateLease,
    confirmRenewLease: command.confirmRenewLease,
    confirmCollectRent: command.confirmCollectRent,
    confirmMeterReading: command.confirmMeterReading,
    settleMoveOut: command.settleMoveOut
  }
}
const auditableActions = new Set([
  'previewCreateHouse', 'previewCreateTenant', 'previewCreateLease', 'previewRenewLease',
  'previewCollectRent', 'previewMeterReading', 'previewMoveOutSettlement',
  'confirmCreateHouse', 'confirmCreateTenant', 'confirmCreateLease', 'confirmRenewLease',
  'confirmCollectRent', 'confirmMeterReading', 'settleMoveOut'
])

exports.main = async (event = {}, context = {}) => {
  const requestId = context.request_id || context.requestId || ''
  let action = ''
  let caller = null
  try {
    action = String(event.action || '')
    caller = getCaller(app)
    const actions = createActions(caller)
    if (!actions[action]) throw new DomainError('VALIDATION_ERROR', `未知业务动作：${action || '空'}`)
    const params = event.params && typeof event.params === 'object' ? event.params : event
    console.info('[rentalDomain] request', { action, requestId, caller: caller.openId.slice(-6) })
    const data = await actions[action](params, caller)
    if (auditableActions.has(action)) {
      const phase = action.startsWith('preview') ? 'preview' : 'confirm'
      await safeAudit(db, caller, { action, phase, status: 'success', requestId, targetId: data.confirmationId || '', idempotencyKey: data.idempotencyKey || '', summary: { confirmationId: data.confirmationId, result: data } })
    }
    return { code: 0, message: 'ok', data, requestId }
  } catch (error) {
    const errorCode = error instanceof DomainError ? error.code : 'INTERNAL_ERROR'
    console.error('[rentalDomain] failed', { errorCode, message: error.message, requestId })
    if (caller && action && auditableActions.has(action)) {
      const phase = action.startsWith('preview') ? 'preview' : 'confirm'
      await safeAudit(db, caller, { action, phase, status: 'failed', requestId, errorCode, errorMessage: error.message })
    }
    return { code: -1, errorCode, message: error.message || '服务异常', details: error.details || null, data: null, requestId }
  }
}
