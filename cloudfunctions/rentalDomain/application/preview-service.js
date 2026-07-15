const { invariant } = require('../infrastructure/errors')
const { createConfirmation, digest } = require('../infrastructure/confirmations')
const { billView, houseView, tenantView, leaseView, number } = require('../domain/presenters')
const { calculateMeterPreview, calculateSettlement } = require('../domain/settlement')

function dateValue(value) {
  if (!value) return ''
  if (value instanceof Date) return value.toISOString()
  return String(value)
}

function pick(doc = {}, fields = []) {
  return fields.reduce((out, field) => {
    if (doc[field] !== undefined) out[field] = field.endsWith('At') || field.endsWith('Date') ? dateValue(doc[field]) : doc[field]
    return out
  }, {})
}

function moveOutSourceDigest(ctx, bills, latestRecord, settings) {
  return digest({
    lease: pick(ctx.lease, [
      '_id', 'houseId', 'tenantId', 'status', 'rent', 'deposit', 'paymentCycle',
      'startDate', 'endDate', 'rentCoveredUntil', 'nextRentDueDate',
      'moveInElectricity', 'moveInWater', 'updatedAt'
    ]),
    house: pick(ctx.house, ['_id', 'status', 'rent', 'updatedAt']),
    tenant: pick(ctx.tenant, ['_id', 'status', 'updatedAt']),
    bills: bills.map(item => pick(item, ['_id', 'leaseId', 'type', 'amount', 'paidAmount', 'status', 'dueDate', 'period', 'updatedAt', 'createdAt']))
      .sort((a, b) => String(a._id || '').localeCompare(String(b._id || ''))),
    latestUtilityRecord: pick(latestRecord, ['_id', 'leaseId', 'electricityReading', 'waterReading', 'calculationDate', 'updatedAt', 'createdAt']),
    settings: pick(settings, ['_id', 'electricityPrice', 'waterPrice', 'updatedAt'])
  })
}

async function getLeaseContext(repo, leaseId) {
  const lease = await repo.byId('lease_agreements', leaseId)
  invariant(lease, 'NOT_FOUND', '未找到有效合同')
  const [house, tenant] = await Promise.all([repo.byId('houses', lease.houseId), repo.byId('tenants', lease.tenantId)])
  return { lease, house: house || {}, tenant: tenant || {} }
}

async function buildMoveOutSettlementSnapshot(repo, params) {
  invariant(params.leaseId, 'VALIDATION_ERROR', '缺少合同 ID')
  const ctx = await getLeaseContext(repo, params.leaseId)
  invariant(ctx.lease.status === 'active', 'CONFLICT', '合同不是生效状态')
  const [bills, records, settingsRows] = await Promise.all([
    repo.queryAll('bills', { leaseId: params.leaseId }),
    repo.queryAll('utility_records', { leaseId: params.leaseId }, { field: 'createdAt', direction: 'desc' }),
    repo.queryAll('system_settings', { _id: 'global' })
  ])
  const latest = records[0] || {}
  const settings = settingsRows[0] || {}
  const outstandingAmount = bills.filter(item => item.status !== 'paid').reduce((sum, item) => sum + Math.max(0, number(item.amount) - number(item.paidAmount)), 0)
  const settlementView = {
    lease: leaseView(ctx.lease, ctx.house, ctx.tenant),
    moveOutDate: params.moveOutDate,
    ...calculateSettlement({
      ...params,
      deposit: ctx.lease.deposit,
      outstandingAmount,
      lastElectricity: latest.electricityReading || ctx.lease.moveInElectricity || 0,
      lastWater: latest.waterReading || ctx.lease.moveInWater || 0,
      electricityPrice: settings.electricityPrice || 0.8,
      waterPrice: settings.waterPrice || 3.5
    })
  }
  return {
    targetId: params.leaseId,
    sourceDigest: moveOutSourceDigest(ctx, bills, latest, settings),
    settlementView
  }
}

function createPreviewService(db, repo) {
  async function context(leaseId) {
    return getLeaseContext(repo, leaseId)
  }

  async function previewCollectRent(params, caller) {
    invariant(params.billId, 'VALIDATION_ERROR', '缺少租金账单 ID')
    const bill = await repo.byId('bills', params.billId)
    invariant(bill && bill.type === 'rent', 'NOT_FOUND', '未找到租金账单')
    const ctx = await context(bill.leaseId)
    const view = billView(bill, ctx.lease, ctx.house, ctx.tenant)
    const amount = number(params.amount || view.remaining)
    invariant(amount > 0 && amount <= view.remaining, 'VALIDATION_ERROR', '收款金额不合法')
    const snapshot = { bill: view, amount, paymentMethod: params.paymentMethod || 'cash', paymentDate: params.paymentDate || new Date().toISOString().slice(0, 10), statusAfter: amount === view.remaining ? 'paid' : 'partial' }
    return { ...snapshot, ...(await createConfirmation(db, caller, 'confirmCollectRent', params, snapshot)) }
  }

  async function previewCreateHouse(params, caller) {
    invariant(params.code, 'VALIDATION_ERROR', '缺少房屋编号')
    invariant(params.address, 'VALIDATION_ERROR', '缺少房屋地址')
    invariant(number(params.rent) > 0, 'VALIDATION_ERROR', '月租金必须大于 0')
    const snapshot = {
      house: houseView({
        code: String(params.code).trim(),
        address: String(params.address).trim(),
        rent: number(params.rent),
        status: params.status || 'available'
      })
    }
    return { ...snapshot, ...(await createConfirmation(db, caller, 'confirmCreateHouse', params, snapshot)) }
  }

  async function previewCreateTenant(params, caller) {
    invariant(params.name, 'VALIDATION_ERROR', '缺少租客姓名')
    const snapshot = {
      tenant: tenantView({
        name: String(params.name).trim(),
        phone: params.phone || '',
        status: params.status || 'inactive'
      })
    }
    return { ...snapshot, ...(await createConfirmation(db, caller, 'confirmCreateTenant', params, snapshot)) }
  }

  async function previewCreateLease(params, caller) {
    invariant(params.houseId, 'VALIDATION_ERROR', '缺少房屋 ID')
    invariant(params.tenantId, 'VALIDATION_ERROR', '缺少租客 ID')
    invariant(params.startDate, 'VALIDATION_ERROR', '缺少起租日期')
    invariant(number(params.rent) > 0, 'VALIDATION_ERROR', '月租金必须大于 0')
    const [house, tenant] = await Promise.all([repo.byId('houses', params.houseId), repo.byId('tenants', params.tenantId)])
    invariant(house, 'NOT_FOUND', '房屋不存在')
    invariant(tenant, 'NOT_FOUND', '租客不存在')
    const [houseLeases, tenantLeases] = await Promise.all([
      repo.queryAll('lease_agreements', { houseId: params.houseId, status: 'active' }),
      repo.queryAll('lease_agreements', { tenantId: params.tenantId, status: 'active' })
    ])
    invariant(house.status !== 'maintenance', 'CONFLICT', '房屋维护中，无法创建合同')
    invariant(houseLeases.length === 0, 'CONFLICT', '该房屋已有生效合同')
    invariant(tenantLeases.length === 0, 'CONFLICT', '该租客已有生效合同')
    const snapshot = {
      lease: leaseView({
        houseId: params.houseId,
        tenantId: params.tenantId,
        rent: number(params.rent),
        deposit: params.deposit === undefined ? number(params.rent) : number(params.deposit),
        paymentCycle: params.paymentCycle || 'month',
        startDate: params.startDate,
        status: 'active'
      }, house, tenant)
    }
    return { ...snapshot, ...(await createConfirmation(db, caller, 'confirmCreateLease', params, snapshot)) }
  }

  async function previewRenewLease(params, caller) {
    invariant(params.leaseId, 'VALIDATION_ERROR', '缺少合同 ID')
    const ctx = await context(params.leaseId)
    invariant(ctx.lease.status === 'active', 'CONFLICT', '合同不是生效状态')
    const snapshot = {
      lease: leaseView(ctx.lease, ctx.house, ctx.tenant),
      nextRentDueDate: ctx.lease.nextRentDueDate || '',
      rentCoveredUntil: ctx.lease.rentCoveredUntil || '',
      rent: number(ctx.lease.rent),
      paymentCycle: ctx.lease.paymentCycle || 'month'
    }
    return { ...snapshot, ...(await createConfirmation(db, caller, 'confirmRenewLease', params, snapshot)) }
  }

  async function previewMeterReading(params, caller) {
    invariant(params.leaseId, 'VALIDATION_ERROR', '缺少合同 ID')
    const ctx = await context(params.leaseId)
    invariant(ctx.lease.status === 'active', 'CONFLICT', '合同不是生效状态')
    const records = await repo.queryAll('utility_records', { leaseId: params.leaseId }, { field: 'createdAt', direction: 'desc' })
    const latest = records[0] || {}
    const settings = (await repo.queryAll('system_settings', { _id: 'global' }))[0] || {}
    const meter = calculateMeterPreview({ ...params, lastElectricity: latest.electricityReading || ctx.lease.moveInElectricity || 0, lastWater: latest.waterReading || ctx.lease.moveInWater || 0, electricityPrice: settings.electricityPrice || 0.8, waterPrice: settings.waterPrice || 3.5 })
    const snapshot = { lease: leaseView(ctx.lease, ctx.house, ctx.tenant), ...meter }
    return { ...snapshot, ...(await createConfirmation(db, caller, 'confirmMeterReading', params, snapshot)) }
  }

  async function previewMoveOutSettlement(params, caller) {
    const snapshot = await buildMoveOutSettlementSnapshot(repo, params)
    return {
      settlementView: snapshot.settlementView,
      sourceDigest: snapshot.sourceDigest,
      targetId: snapshot.targetId,
      ...(await createConfirmation(db, caller, 'settleMoveOut', params, snapshot))
    }
  }

  return { previewCreateHouse, previewCreateTenant, previewCreateLease, previewRenewLease, previewCollectRent, previewMeterReading, previewMoveOutSettlement }
}

module.exports = { createPreviewService, buildMoveOutSettlementSnapshot }
