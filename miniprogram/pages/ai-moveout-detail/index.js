const api = require('../../services/api')

function money(value) {
  const result = Number(value || 0)
  return Number.isFinite(result) ? Math.round(result * 100) / 100 : 0
}

function todayText() {
  return new Date().toISOString().slice(0, 10)
}

function parseQuery(query) {
  if (!query) return {}
  if (typeof query === 'object') return query
  return String(query).split('&').reduce((out, part) => {
    const [rawKey, rawValue = ''] = part.split('=')
    if (!rawKey) return out
    out[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue)
    return out
  }, {})
}

function fieldValue(value, fallback = '') {
  return value === undefined || value === null || value === '' ? fallback : value
}

function numberValue(value, fallback = 0) {
  const raw = fieldValue(value, fallback)
  return money(raw)
}

function normalizeInput(input = {}) {
  return {
    leaseId: input.leaseId || '',
    moveOutDate: input.moveOutDate || input.endDate || todayText(),
    electricityReading: numberValue(input.electricityReading, input.moveOutElectricity),
    waterReading: numberValue(input.waterReading, input.moveOutWater),
    damageAmount: numberValue(input.damageAmount, 0),
    remark: input.remark || ''
  }
}

function buildPreview(settlementView = {}, input = {}) {
  const lease = settlementView.lease || {}
  const house = lease.house || {}
  const tenant = lease.tenant || {}
  const finalAmount = money(settlementView.finalAmount || Math.abs(Number(settlementView.totalRefund || 0)))
  const totalRefund = money(settlementView.totalRefund)
  const damageAmount = money(settlementView.damageAmount)
  const deposit = money(settlementView.deposit)
  const damageExtraDue = money(settlementView.damageExtraDue)
  const damageOffset = money(Math.max(0, damageAmount - damageExtraDue))
  const payableBeforeDeposit = money(settlementView.payableBeforeDeposit || settlementView.outstandingAmount)
  const electricityReading = numberValue(settlementView.electricityReading, input.electricityReading)
  const waterReading = numberValue(settlementView.waterReading, input.waterReading)
  const electricityUsage = money(settlementView.electricityUsage)
  const waterUsage = money(settlementView.waterUsage)

  return {
    leaseId: lease.id || input.leaseId || '',
    houseAddress: house.address || '',
    houseCode: house.code || '',
    houseText: house.label || [house.code, house.address].filter(Boolean).join(' - ') || '该房屋',
    tenantName: tenant.name || '该租客',
    moveOutDate: settlementView.moveOutDate || input.moveOutDate || todayText(),
    deposit,
    damageAmount,
    damageOffset,
    damageExtraDue,
    lastElectricity: money(settlementView.lastElectricity),
    lastWater: money(settlementView.lastWater),
    moveOutElectricity: electricityReading,
    moveOutWater: waterReading,
    electricityUsage,
    waterUsage,
    electricityCost: money(settlementView.electricityCost),
    waterCost: money(settlementView.waterCost),
    utilityCost: money(settlementView.utilityCost),
    outstandingAmount: money(settlementView.outstandingAmount),
    payableBeforeDeposit,
    depositOffset: money(settlementView.depositOffset),
    refundAmount: money(settlementView.refundAmount),
    extraPayment: money(settlementView.extraPayment),
    overpaidRent: money(settlementView.overpaidRent),
    totalRefund,
    finalLabel: settlementView.finalLabel || (totalRefund >= 0 ? '应退总额' : '仍需补缴'),
    finalAmount,
    finalSignedText: totalRefund >= 0 ? `¥${finalAmount}` : `-¥${finalAmount}`,
    canMoveOutText: payableBeforeDeposit > 0
      ? `待抵扣款项 ¥${payableBeforeDeposit}，确认退租后将优先用押金自动抵扣。`
      : '未结清款项已全部结清，可以办理退租。',
    utilityUsageText: `${electricityUsage} 度 / ${waterUsage} 吨`,
    rentRefund: settlementView.rentRefund || null,
    supplementalRent: money(settlementView.supplementalRent)
  }
}

Page({
  data: {
    loaded: false,
    pageId: '',
    handoffPayload: null,
    actionName: 'settleMoveOut',
    confirmToken: '',
    summary: '',
    leaseId: '',
    moveOutPreview: null,
    form: {
      moveOutDate: '',
      damageAmount: '',
      moveOutElectricity: '',
      moveOutWater: ''
    },
    moveOutDate: '',
    damageAmountInput: '',
    moveOutElectricityInput: '',
    moveOutWaterInput: '',
    errorText: '',
    emptyText: '退租结算信息已失效，请重新发起退租。',
    canConfirm: true,
    confirmDisabled: false,
    processing: false,
    confirmText: '确认退租',
    resultText: '',
    resultStatus: '',
    closeTop: 24,
    needsAuthoritativeRefresh: false
  },

  onLoad(options = {}) {
    this.initCloseTop()
    this.loadFromHandoff(options)
  },

  initCloseTop() {
    try {
      const rect = wx.getDetailPageCloseButtonBoundingClientRect && wx.getDetailPageCloseButtonBoundingClientRect()
      if (rect && rect.bottom) this.setData({ closeTop: Math.ceil(rect.bottom + 12) })
    } catch (err) {
      // 仅在 AI 半屏里可用，普通页面打开时忽略。
    }
  },

  async loadFromHandoff(options = {}) {
    const app = getApp()
    const pageId = typeof this.getPageId === 'function' ? this.getPageId() : ''
    const handoff = app && app.takeAgentHandoff && pageId ? app.takeAgentHandoff(pageId) : null
    const handoffQuery = parseQuery(handoff && handoff.query)
    const payload = (handoff && handoff.payload) || null
    const optionQuery = parseQuery(options)
    const confirmationId = payload?.confirmationId || handoffQuery.confirmationId || optionQuery.confirmationId || ''
    const input = normalizeInput({
      ...optionQuery,
      ...(payload?.input || {}),
      leaseId: payload?.input?.leaseId || handoffQuery.leaseId || optionQuery.leaseId || ''
    })

    this.setData({ pageId, handoffPayload: payload })

    if (!confirmationId && !input.leaseId) {
      this.setData({
        loaded: true,
        emptyText: '没有收到退租接力信息，请重新从对话中发起退租。'
      })
      return
    }

    try {
      const confirmation = confirmationId ? await this.readConfirmation(confirmationId) : null
      const authoritativeInput = normalizeInput({
        ...input,
        ...(confirmation?.normalizedInput || {})
      })
      await this.refreshAuthoritativePreview(authoritativeInput)
    } catch (err) {
      console.error('[ai-mode] ai-moveout-detail load failed:', err)
      const fallback = payload?.settlementView || null
      if (fallback) {
        this.applyPreview({
          confirmationId,
          settlementView: fallback,
          expiresAt: payload?.expiresAt || ''
        }, input, `最新结算刷新失败：${err.message}`)
        this.setData({ canConfirm: false, confirmDisabled: true })
        return
      }
      this.setData({
        loaded: true,
        emptyText: `退租结算加载失败：${err.message}`,
        canConfirm: false,
        confirmDisabled: true
      })
    }
  },

  async readConfirmation(confirmationId) {
    const confirmation = await api.getOperationConfirmation(confirmationId)
    if (confirmation.action && confirmation.action !== 'settleMoveOut') throw new Error('确认动作不匹配')
    if (confirmation.status && confirmation.status !== 'pending') throw new Error('确认记录已处理或失效')
    if (confirmation.expiresAt && new Date(confirmation.expiresAt).getTime() < Date.now()) throw new Error('确认记录已过期')
    return confirmation
  },

  async refreshAuthoritativePreview(input) {
    const normalized = normalizeInput(input)
    if (!normalized.leaseId) throw new Error('缺少合同 ID')
    const data = await api.previewMoveOutSettlement(normalized)
    this.applyPreview(data, normalized, '')
    return data
  },

  applyPreview(data = {}, input = {}, errorText = '') {
    const preview = buildPreview(data.settlementView || {}, input)
    const moveOutDate = preview.moveOutDate || todayText()
    const damageAmountInput = String(preview.damageAmount)
    const moveOutElectricityInput = String(preview.moveOutElectricity)
    const moveOutWaterInput = String(preview.moveOutWater)

    this.setData({
      loaded: true,
      actionName: 'settleMoveOut',
      confirmToken: data.confirmationId || '',
      summary: data.expiresAt ? `确认有效期至 ${data.expiresAt}` : '',
      leaseId: preview.leaseId,
      moveOutPreview: preview,
      moveOutDate,
      damageAmountInput,
      moveOutElectricityInput,
      moveOutWaterInput,
      form: {
        moveOutDate,
        damageAmount: damageAmountInput,
        moveOutElectricity: moveOutElectricityInput,
        moveOutWater: moveOutWaterInput
      },
      errorText,
      canConfirm: !errorText,
      confirmDisabled: !!errorText,
      needsAuthoritativeRefresh: false
    })
  },

  recomputePreview(patch = {}) {
    const oldPreview = this.data.moveOutPreview
    if (!oldPreview) return
    const form = { ...this.data.form, ...patch }
    const damageAmount = money(form.damageAmount)
    const lastElectricity = Number(oldPreview.lastElectricity || 0)
    const lastWater = Number(oldPreview.lastWater || 0)
    const moveOutElectricity = form.moveOutElectricity === '' ? lastElectricity : Number(form.moveOutElectricity || 0)
    const moveOutWater = form.moveOutWater === '' ? lastWater : Number(form.moveOutWater || 0)

    let errorText = ''
    if (moveOutElectricity < lastElectricity) errorText = '退租电表读数不能小于上次读数'
    if (moveOutWater < lastWater) errorText = '退租水表读数不能小于上次读数'

    const electricityUsage = Math.max(0, moveOutElectricity - lastElectricity)
    const waterUsage = Math.max(0, moveOutWater - lastWater)
    const electricityPrice = oldPreview.electricityUsage ? Number(oldPreview.electricityCost || 0) / Number(oldPreview.electricityUsage || 1) : 0.8
    const waterPrice = oldPreview.waterUsage ? Number(oldPreview.waterCost || 0) / Number(oldPreview.waterUsage || 1) : 3.5
    const electricityCost = money(electricityUsage * electricityPrice)
    const waterCost = money(waterUsage * waterPrice)
    const utilityCost = money(electricityCost + waterCost)
    const nonUtilityAmount = money(Number(oldPreview.payableBeforeDeposit || 0) - Number(oldPreview.utilityCost || 0))
    const payableBeforeDeposit = money(nonUtilityAmount + utilityCost)
    const deposit = money(oldPreview.deposit || 0)
    const refundableDeposit = money(deposit - damageAmount)
    const depositForOffset = Math.max(0, refundableDeposit)
    const depositOffset = money(Math.min(depositForOffset, payableBeforeDeposit))
    const refundAmount = money(Math.max(0, depositForOffset - depositOffset))
    const damageExtraDue = damageAmount > deposit ? money(damageAmount - deposit) : 0
    const damageOffset = money(Math.max(0, damageAmount - damageExtraDue))
    const extraPayment = money(Math.max(0, payableBeforeDeposit - depositOffset) + damageExtraDue)
    const totalRefund = money(refundAmount + Number(oldPreview.overpaidRent || 0) - extraPayment)

    const moveOutPreview = {
      ...oldPreview,
      moveOutDate: form.moveOutDate,
      damageAmount,
      damageOffset,
      damageExtraDue,
      moveOutElectricity,
      moveOutWater,
      electricityUsage,
      waterUsage,
      electricityCost,
      waterCost,
      utilityCost,
      payableBeforeDeposit,
      outstandingAmount: payableBeforeDeposit,
      depositOffset,
      refundAmount,
      extraPayment,
      totalRefund,
      finalLabel: totalRefund >= 0 ? '应退总额' : '仍需补缴',
      finalAmount: Math.abs(totalRefund),
      finalSignedText: totalRefund >= 0 ? `¥${money(totalRefund)}` : `-¥${money(Math.abs(totalRefund))}`,
      canMoveOutText: payableBeforeDeposit > 0 ? `待抵扣款项 ¥${payableBeforeDeposit}，确认退租后将优先用押金自动抵扣。` : '未结清款项已全部结清，可以办理退租。',
      utilityUsageText: `${electricityUsage} 度 / ${waterUsage} 吨`
    }

    this.setData({
      form,
      moveOutPreview,
      errorText,
      canConfirm: !errorText,
      confirmDisabled: !!errorText,
      moveOutDate: form.moveOutDate,
      damageAmountInput: form.damageAmount,
      moveOutElectricityInput: form.moveOutElectricity,
      moveOutWaterInput: form.moveOutWater,
      needsAuthoritativeRefresh: true
    })
  },

  onDateChange(e) {
    this.recomputePreview({ moveOutDate: e.detail.value })
  },

  onFieldInput(e) {
    const field = e.currentTarget.dataset.field
    if (!field) return
    this.recomputePreview({ [field]: e.detail.value })
  },

  buildCurrentInput() {
    const form = this.data.form || {}
    return normalizeInput({
      leaseId: this.data.leaseId,
      moveOutDate: form.moveOutDate,
      electricityReading: form.moveOutElectricity,
      waterReading: form.moveOutWater,
      damageAmount: form.damageAmount
    })
  },

  async onConfirm() {
    console.info('[ai-mode] ai-moveout-detail onConfirm')
    if (this.data.processing) return
    if (!this.data.canConfirm || this.data.errorText) return
    if (!this.data.leaseId) {
      this.setData({ errorText: '缺少合同信息，请重新发起退租' })
      return
    }

    this.setData({
      processing: true,
      confirmDisabled: true,
      confirmText: '办理中...',
      errorText: '',
      resultText: '',
      resultStatus: ''
    })

    try {
      const latest = await api.previewMoveOutSettlement(this.buildCurrentInput())
      this.applyPreview(latest, this.buildCurrentInput(), '')
      const confirmationId = latest.confirmationId
      if (!confirmationId) throw new Error('云端未返回确认编号')
      const result = await api.terminateLease({ confirmationId })
      console.info('[ai-mode] ai-moveout-detail settle result:', result)
      this.setData({
        processing: false,
        canConfirm: false,
        confirmDisabled: true,
        confirmText: '已完成',
        resultStatus: 'success',
        resultText: '退租办理成功，合同、账单、付款记录和房屋状态已更新。'
      })
    } catch (err) {
      console.error('[ai-mode] ai-moveout-detail confirm failed:', err.message)
      this.setData({
        processing: false,
        canConfirm: true,
        confirmDisabled: false,
        confirmText: '确认退租',
        resultStatus: 'failed',
        resultText: '',
        errorText: `确认失败：${err.message}`
      })
    }
  }
})
