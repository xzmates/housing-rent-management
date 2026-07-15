const { invariant } = require('../infrastructure/errors')
const { idempotencyKey, loadPendingConfirmation, findExecutedOperation } = require('../infrastructure/idempotency')
const { createRepository } = require('../repositories/rental-repository')
const { buildMoveOutSettlementSnapshot } = require('./preview-service')

async function legacyCall(app, name, data) {
  const res = await app.callFunction({ name, data })
  const result = res.result || {}
  if (result.code && result.code !== 200 && result.code !== 0) {
    const error = new Error(result.message || `${name} 调用失败`)
    error.code = result.code
    throw error
  }
  return Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result
}

function cleanParams(params) {
  const out = { ...(params || {}) }
  delete out.confirmationId
  return out
}

function sameValue(left, right) {
  if (left === right) return true
  if (left === undefined || right === undefined) return false
  return String(left) === String(right)
}

function assertConfirmationParamsNotOverridden(action, params, confirmation) {
  if (action !== 'settleMoveOut') return
  const supplied = cleanParams(params)
  const normalized = confirmation.normalizedInput || {}
  const changedKeys = Object.keys(supplied).filter(key => !sameValue(supplied[key], normalized[key]))
  invariant(changedKeys.length === 0, 'VALIDATION_ERROR', '确认参数与预览记录不一致，请重新生成退租预览')
}

function normalizeMoveOutParams(params) {
  const out = cleanParams(params)
  if (!out.endDate && out.moveOutDate) out.endDate = out.moveOutDate
  if (out.moveOutElectricity !== undefined && out.electricityReading === undefined) out.electricityReading = out.moveOutElectricity
  if (out.moveOutWater !== undefined && out.waterReading === undefined) out.waterReading = out.moveOutWater
  return out
}

function createCommandService(app, db) {
  const repo = createRepository(db)

  async function resolveParams(params, caller, action) {
    if (!params || !params.confirmationId) return { input: cleanParams(params), confirmation: null, key: '' }

    const key = idempotencyKey(action, params.confirmationId)
    const executed = await findExecutedOperation(db, caller, key)
    if (executed) return { replay: true, key, result: executed.summary && executed.summary.result }

    const confirmation = await loadPendingConfirmation(db, caller, action, params.confirmationId)
    assertConfirmationParamsNotOverridden(action, params, confirmation)
    return { input: { ...(confirmation.normalizedInput || {}) }, confirmation, key }
  }

  async function markConfirmation(confirmationId, patch) {
    if (!confirmationId) return
    await db.collection('operation_confirmations').doc(confirmationId).update(patch)
  }

  async function markExecuting(confirmationId) {
    await markConfirmation(confirmationId, { status: 'executing', executingAt: new Date() })
  }

  async function markPendingAfterFailure(confirmationId) {
    await markConfirmation(confirmationId, { status: 'pending', executingAt: null })
  }

  async function markExecuted(confirmationId, result) {
    await markConfirmation(confirmationId, {
      status: 'executed',
      executedAt: new Date(),
      result
    })
  }

  async function assertMoveOutConfirmationFresh(input, caller, confirmation) {
    if (!confirmation) return
    invariant(confirmation.targetId === input.leaseId, 'VALIDATION_ERROR', '确认记录与合同不匹配')
    invariant(confirmation.sourceDigest, 'STALE_CONFIRMATION', '退租预览已过期，请重新生成预览')
    const snapshot = await buildMoveOutSettlementSnapshot(repo.forOwner(caller.openId), input)
    invariant(snapshot.sourceDigest === confirmation.sourceDigest, 'STALE_CONFIRMATION', '退租数据已变化，请重新生成预览')
  }

  async function runLegacy(params, caller, action, legacyName, mapParams = cleanParams) {
    invariant(caller && caller.openId, 'FORBIDDEN', '缺少调用者身份')
    const resolved = await resolveParams(params, caller, action)
    if (resolved.replay) return { replayed: true, idempotencyKey: resolved.key, result: resolved.result }

    if (action === 'settleMoveOut' && resolved.confirmation) {
      await assertMoveOutConfirmationFresh(resolved.input, caller, resolved.confirmation)
      await markExecuting(params.confirmationId)
    }
    const input = mapParams(resolved.input)
    try {
      await assertLegacyTargetOwner(action, input, caller)
      const result = await legacyCall(app, legacyName, input)
      if (resolved.confirmation) await markExecuted(params.confirmationId, result)
      return { ...result, confirmationId: params && params.confirmationId, idempotencyKey: resolved.key }
    } catch (err) {
      if (action === 'settleMoveOut' && resolved.confirmation) await markPendingAfterFailure(params.confirmationId)
      throw err
    }
  }

  async function assertOwned(collection, id, caller, label) {
    invariant(id, 'VALIDATION_ERROR', `缺少${label} ID`)
    const res = await db.collection(collection).where({ _id: id, _openid: caller.openId }).limit(1).get()
    invariant(res && res.data && res.data[0], 'FORBIDDEN', `不能操作其他用户的${label}`)
  }

  async function assertLegacyTargetOwner(action, input, caller) {
    if (action === 'confirmCreateLease') {
      await Promise.all([
        assertOwned('houses', input.houseId, caller, '房屋'),
        assertOwned('tenants', input.tenantId, caller, '租客')
      ])
      return
    }
    if (action === 'confirmCollectRent') {
      await assertOwned('bills', input.billId, caller, '账单')
      return
    }
    if (['confirmRenewLease', 'confirmMeterReading', 'settleMoveOut'].includes(action)) {
      await assertOwned('lease_agreements', input.leaseId, caller, '合同')
    }
  }

  async function runDirect(params, caller, action, executor) {
    invariant(caller && caller.openId, 'FORBIDDEN', '缺少调用者身份')
    const resolved = await resolveParams(params, caller, action)
    if (resolved.replay) return { replayed: true, idempotencyKey: resolved.key, result: resolved.result }

    const result = await executor(cleanParams(resolved.input), caller)
    if (resolved.confirmation) await markExecuted(params.confirmationId, result)
    return { ...result, confirmationId: params && params.confirmationId, idempotencyKey: resolved.key }
  }

  async function createHouse(params, caller) {
    invariant(params.code, 'VALIDATION_ERROR', '缺少房屋编号')
    invariant(params.address, 'VALIDATION_ERROR', '缺少房屋地址')
    invariant(Number(params.rent) > 0, 'VALIDATION_ERROR', '月租金必须大于 0')
    const now = new Date()
    const data = {
      _openid: caller.openId,
      code: String(params.code).trim(),
      address: String(params.address).trim(),
      rent: Number(params.rent),
      status: params.status || 'available',
      createdAt: now,
      updatedAt: now
    }
    const res = await db.collection('houses').add(data)
    return { houseId: res.id || res._id, house: data }
  }

  async function createTenant(params, caller) {
    invariant(params.name, 'VALIDATION_ERROR', '缺少租客姓名')
    const now = new Date()
    const data = {
      _openid: caller.openId,
      name: String(params.name).trim(),
      idCard: params.idCard || '',
      phone: params.phone || '',
      remark: params.remark || '',
      status: params.status || 'inactive',
      createdAt: now,
      updatedAt: now
    }
    const res = await db.collection('tenants').add(data)
    return { tenantId: res.id || res._id, tenant: data }
  }

  return {
    confirmCreateHouse(params, caller) {
      return runDirect(params, caller, 'confirmCreateHouse', createHouse)
    },
    confirmCreateTenant(params, caller) {
      return runDirect(params, caller, 'confirmCreateTenant', createTenant)
    },
    confirmCreateLease(params, caller) {
      return runLegacy(params, caller, 'confirmCreateLease', 'createLeaseAgreement')
    },
    confirmRenewLease(params, caller) {
      return runLegacy(params, caller, 'confirmRenewLease', 'createNextRentBill')
    },
    confirmCollectRent(params, caller) {
      return runLegacy(params, caller, 'confirmCollectRent', 'payBill')
    },
    confirmMeterReading(params, caller) {
      return runLegacy(params, caller, 'confirmMeterReading', 'addUtilityRecord')
    },
    settleMoveOut(params, caller) {
      return runLegacy(params, caller, 'settleMoveOut', 'terminateLease', normalizeMoveOutParams)
    }
  }
}

module.exports = { createCommandService }
