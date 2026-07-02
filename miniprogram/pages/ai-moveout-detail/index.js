Page({
  data: {
    loaded: false,
    actionName: '',
    confirmToken: '',
    summary: '',
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
    canConfirm: true,
    confirmDisabled: false,
    processing: false,
    confirmText: '确认退租',
    resultText: '',
    resultStatus: '',
    closeTop: 24
  },

  onLoad(options = {}) {
    let previewKey = options.previewKey ? decodeURIComponent(options.previewKey) : ''
    if (!previewKey) {
      try {
        previewKey = wx.getStorageSync('moveout_preview_latest') || ''
      } catch (err) {
        previewKey = ''
      }
    }

    let payload = null
    try {
      payload = previewKey ? wx.getStorageSync(previewKey) : null
    } catch (err) {
      payload = null
    }

    try {
      const rect = wx.getDetailPageCloseButtonBoundingClientRect && wx.getDetailPageCloseButtonBoundingClientRect()
      if (rect && rect.bottom) this.setData({ closeTop: Math.ceil(rect.bottom + 12) })
    } catch (err) {
      // 仅在 AI 半屏里可用，普通页面打开时忽略。
    }

    if (!payload || !payload.moveOutPreview) {
      this.setData({ loaded: true })
      return
    }

    const preview = payload.moveOutPreview
    const moveOutDate = preview.moveOutDate || ''
    const damageAmountInput = String(preview.damageAmount !== undefined ? preview.damageAmount : 0)
    const moveOutElectricityInput = String(preview.moveOutElectricity !== undefined ? preview.moveOutElectricity : (preview.lastElectricity || 0))
    const moveOutWaterInput = String(preview.moveOutWater !== undefined ? preview.moveOutWater : (preview.lastWater || 0))

    this.setData({
      loaded: true,
      actionName: payload.actionName || 'settleMoveOut',
      confirmToken: payload.confirmToken || '',
      summary: payload.summary || '',
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
      }
    })
  },

  money(value) {
    return Math.round(Number(value || 0) * 100) / 100
  },

  recomputePreview(patch = {}) {
    const oldPreview = this.data.moveOutPreview
    if (!oldPreview) return
    const form = { ...this.data.form, ...patch }
    const damageAmount = this.money(form.damageAmount)
    const lastElectricity = Number(oldPreview.lastElectricity || 0)
    const lastWater = Number(oldPreview.lastWater || 0)
    const moveOutElectricity = form.moveOutElectricity === '' ? lastElectricity : Number(form.moveOutElectricity || 0)
    const moveOutWater = form.moveOutWater === '' ? lastWater : Number(form.moveOutWater || 0)

    let errorText = ''
    if (moveOutElectricity < lastElectricity) errorText = '退租电表读数不能小于上次读数'
    if (moveOutWater < lastWater) errorText = '退租水表读数不能小于上次读数'

    const electricityUsage = Math.max(0, moveOutElectricity - lastElectricity)
    const waterUsage = Math.max(0, moveOutWater - lastWater)
    const electricityCost = this.money(electricityUsage * Number(oldPreview.electricityPrice || 0.8))
    const waterCost = this.money(waterUsage * Number(oldPreview.waterPrice || 3.5))
    const utilityCost = this.money(electricityCost + waterCost)
    const nonUtilityAmount = this.money(Number(oldPreview.payableBeforeDeposit || 0) - Number(oldPreview.utilityCost || 0))
    const payableBeforeDeposit = this.money(nonUtilityAmount + utilityCost)
    const deposit = this.money(oldPreview.deposit || 0)
    const refundableDeposit = this.money(deposit - damageAmount)
    const depositForOffset = Math.max(0, refundableDeposit)
    const depositOffset = this.money(Math.min(depositForOffset, payableBeforeDeposit))
    const refundAmount = this.money(Math.max(0, depositForOffset - depositOffset))
    const damageExtraDue = damageAmount > deposit ? this.money(damageAmount - deposit) : 0
    const damageOffset = this.money(Math.max(0, damageAmount - damageExtraDue))
    const extraPayment = this.money(Math.max(0, payableBeforeDeposit - depositOffset) + damageExtraDue)
    const rentRefund = oldPreview.rentRefund || null
    const overpaidRent = rentRefund ? Number(rentRefund.overpaidRent || 0) : 0
    const totalRefund = this.money(refundAmount + overpaidRent - extraPayment)

    const moveOutPreview = {
      ...oldPreview,
      moveOutDate: form.moveOutDate,
      damageAmount,
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
      damageExtraDue,
      damageOffset,
      extraPayment,
      totalRefund,
      finalLabel: totalRefund >= 0 ? '应退总额' : '仍需补缴',
      finalAmount: Math.abs(totalRefund),
      finalSignedText: totalRefund >= 0 ? `¥${this.money(totalRefund)}` : `-¥${this.money(Math.abs(totalRefund))}`,
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
      moveOutWaterInput: form.moveOutWater
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

  syncConfirmSlots() {
    const preview = this.data.moveOutPreview
    const token = this.data.confirmToken
    if (!preview || !token) return false
    try {
      const store = wx.getStorageSync('rental_assistant_pending_confirms') || {}
      const pending = store[token]
      if (!pending) return false
      pending.slots = {
        ...(pending.slots || {}),
        tenantName: preview.tenantName,
        moveOutDate: preview.moveOutDate,
        moveOutElectricity: preview.moveOutElectricity,
        moveOutWater: preview.moveOutWater,
        damageAmount: preview.damageAmount
      }
      store[token] = pending
      wx.setStorageSync('rental_assistant_pending_confirms', store)
      return true
    } catch (err) {
      return false
    }
  },

  readPendingConfirm() {
    const token = this.data.confirmToken
    try {
      const store = wx.getStorageSync('rental_assistant_pending_confirms') || {}
      return store[token] || null
    } catch (err) {
      return null
    }
  },

  removePendingConfirm() {
    const token = this.data.confirmToken
    try {
      const store = wx.getStorageSync('rental_assistant_pending_confirms') || {}
      if (store[token]) {
        delete store[token]
        wx.setStorageSync('rental_assistant_pending_confirms', store)
      }
    } catch (err) {
      // 删除失败不影响云端办理结果。
    }
  },

  buildFallbackSlots() {
    const preview = this.data.moveOutPreview || {}
    return {
      houseAddress: preview.houseAddress || '',
      houseCode: preview.houseCode || '',
      tenantName: preview.tenantName || '',
      moveOutDate: preview.moveOutDate,
      moveOutElectricity: preview.moveOutElectricity,
      moveOutWater: preview.moveOutWater,
      damageAmount: preview.damageAmount
    }
  },

  async onConfirm() {
    console.info('[ai-mode] ai-moveout-detail onConfirm')
    if (this.data.processing) return
    if (!this.data.canConfirm) return
    if (!this.data.confirmToken) {
      this.setData({ errorText: '确认信息已失效，请重新发起退租' })
      return
    }
    if (this.data.errorText) return
    const synced = this.syncConfirmSlots()
    const pending = synced ? this.readPendingConfirm() : null
    const slots = pending && pending.slots ? pending.slots : this.buildFallbackSlots()
    if (!slots || (!slots.tenantName && !slots.houseCode)) {
      this.setData({ errorText: '确认信息已失效，请重新发起退租' })
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
      const res = await wx.cloud.callFunction({
        name: 'executeVoiceScenario',
        data: {
          scene: 'move_out',
          variant: 'daily',
          slots,
          createdBy: 'ai_detail_page'
        }
      })
      const raw = res.result || {}
      if (raw.code && raw.code !== 200 && raw.code !== 0) {
        throw new Error(raw.message || '退租办理失败')
      }
      const data = Object.prototype.hasOwnProperty.call(raw, 'data') ? raw.data : raw
      const details = Array.isArray(data.details) ? data.details : []
      const summary = data.summary || details.map((item) => item.message).filter(Boolean).join('；') || '退租结算成功'
      if (pending) this.removePendingConfirm()

      this.setData({
        processing: false,
        canConfirm: false,
        confirmDisabled: true,
        confirmText: '已完成',
        resultStatus: 'success',
        resultText: summary
      })

      try {
        wx.modelContext.getContext().sendFollowUpMessage({
          content: [
            { type: 'text', text: `退租结算已完成：${summary}` }
          ]
        })
      } catch (notifyErr) {
        console.info('[ai-mode] ai-moveout-detail notify skipped:', notifyErr.message)
      }
    } catch (err) {
      console.error('[ai-mode] ai-moveout-detail direct confirm failed:', err.message)
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
