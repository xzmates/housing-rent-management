const { callRentalDomain, successResult, errorResult } = require('../../_shared/domain-client')

function encodeQuery(params = {}) {
  return Object.keys(params)
    .filter((key) => params[key] !== undefined && params[key] !== null && params[key] !== '')
    .map((key) => `${encodeURIComponent(key)}=${encodeURIComponent(String(params[key]))}`)
    .join('&')
}

async function getActiveLeases(params = {}) {
  console.info('[ai-mode] lease-skill getActiveLeases params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('getActiveLeases', {
      keyword: params.keyword || ''
    })
    const leases = (data && data.leases) || []
    const text = leases.length > 0
      ? `找到 ${leases.length} 份生效合同：${leases.map(l => `${l.tenant ? l.tenant.name : ''}（${l.house ? l.house.label : ''}，合同ID：${l.id || ''}）`).join('、')}。后续办理提前收租时请使用对应的合同ID。`
      : '当前没有生效的租赁合同。'
    return successResult(text, {
      title: '生效合同',
      subtitle: '办理提前收租时必须使用 leaseId/合同ID，不要使用租客ID或房屋展示名称。',
      leases: leases.map(l => ({
        id: l.id || '',
        leaseId: l.id || '',
        tenantId: l.tenant ? l.tenant.id || '' : '',
        tenantName: l.tenant ? l.tenant.name || '' : '',
        houseId: l.house ? l.house.id || '' : '',
        houseLabel: l.house ? l.house.label || '' : '',
        rent: l.rent,
        paymentCycle: l.paymentCycle,
        status: l.status,
        startDate: l.startDate,
        endDate: l.endDate
      })),
      fields: leases.map(l => ({
        label: l.tenant ? l.tenant.name : '—',
        value: l.house ? l.house.label : '—',
        leaseId: l.id || ''
      }))
    })
  } catch (err) {
    console.error('[ai-mode] lease-skill getActiveLeases error:', err.message)
    return errorResult('查询生效合同失败：' + err.message)
  }
}

function prepayHandoff(data = {}, params = {}) {
  const view = data.prepayView || {}
  const input = data.normalizedInput || {}
  const lease = view.lease || {}
  return {
    query: encodeQuery({
      action: 'prepayRent',
      confirmationId: data.confirmationId || '',
      leaseId: input.leaseId || params.leaseId || lease.id || ''
    }),
    payload: {
      type: 'prepayRent',
      action: 'confirmPrepayRent',
      confirmationId: data.confirmationId || '',
      expiresAt: data.expiresAt || '',
      input,
      prepayView: view
    }
  }
}

async function previewPrepayRent(params = {}) {
  console.info('[ai-mode] lease-skill previewPrepayRent params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewPrepayRent', params)
    const result = successResult('提前收租预览已生成，请点击小程序卡片进入页面核对，并在确认已线下收款后入账。', data)
    result.handoff = prepayHandoff(data, params)
    return result
  } catch (err) {
    console.error('[ai-mode] lease-skill previewPrepayRent error:', err.message)
    return errorResult('预览提前收租失败：' + err.message)
  }
}

async function previewCreateLease(params = {}) {
  console.info('[ai-mode] lease-skill previewCreateLease params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewCreateLease', params)
    return successResult('已生成创建合同确认卡，请核对后确认。', data)
  } catch (err) {
    console.error('[ai-mode] lease-skill previewCreateLease error:', err.message)
    return errorResult('预览创建合同失败：' + err.message)
  }
}

async function confirmCreateLease(params = {}) {
  console.info('[ai-mode] lease-skill confirmCreateLease params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('confirmCreateLease', params)
    return successResult('合同创建成功。', data)
  } catch (err) {
    console.error('[ai-mode] lease-skill confirmCreateLease error:', err.message)
    return errorResult('创建合同失败：' + err.message)
  }
}

async function previewRenewLease(params = {}) {
  console.info('[ai-mode] lease-skill previewRenewLease params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewRenewLease', params)
    return successResult('已生成续租确认卡，请核对后确认。', data)
  } catch (err) {
    console.error('[ai-mode] lease-skill previewRenewLease error:', err.message)
    return errorResult('预览续租失败：' + err.message)
  }
}

async function confirmRenewLease(params = {}) {
  console.info('[ai-mode] lease-skill confirmRenewLease params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('confirmRenewLease', params)
    return successResult('下一期租金账单已生成。', data)
  } catch (err) {
    console.error('[ai-mode] lease-skill confirmRenewLease error:', err.message)
    return errorResult('确认续租失败：' + err.message)
  }
}

module.exports = { getActiveLeases, previewCreateLease, confirmCreateLease, previewPrepayRent, previewRenewLease, confirmRenewLease }
