Component({
  data: {
    houseLabel: '',
    tenantName: '',
    period: '',
    paymentAmount: '0',
    totalPaid: '0',
    totalAmount: '0',
    remaining: '0',
    paymentDate: '',
    paymentMethodText: '现金',
    statusText: '已结清'
  },
  lifetimes: {
    created() {
      console.info('[ai-mode] rent-pay-result-card created')
      const { NotificationType } = wx.modelContext
      const modelCtx = wx.modelContext.getContext(this)
      modelCtx.on(NotificationType.Result, (data) => {
        const sc = (data && data.result && data.result.structuredContent) || {}
        const nextData = {
          houseLabel: sc.houseLabel || '',
          tenantName: sc.tenantName || '',
          period: sc.period || '',
          paymentAmount: String(sc.paymentAmount || '0'),
          totalPaid: String(sc.totalPaid || '0'),
          totalAmount: String(sc.totalAmount || '0'),
          remaining: String(sc.remaining || '0'),
          paymentDate: sc.paymentDate || '',
          paymentMethodText: sc.paymentMethodText || '现金',
          statusText: sc.statusText || '已结清'
        }
        console.info('[ai-mode] rent-pay-result-card 收到 Result:', JSON.stringify(sc))
        this.setData(nextData)
        console.info('[ai-mode] rent-pay-result-card setData house=', nextData.houseLabel)
      })

      const viewCtx = wx.modelContext.getViewContext(this)
      try {
        const { width, minHeight, maxHeight } = viewCtx.getDimensions()
        console.info(`[ai-mode] rent-pay-result-card dimensions width=${width} minHeight=${minHeight} maxHeight=${maxHeight}`)
      } catch (err) {
        console.info('[ai-mode] rent-pay-result-card getDimensions skipped:', err.message)
      }
      viewCtx.on(NotificationType.Overflow, (data) => {
        const overflowed = !!(data && data.overflowHeight > 0)
        console.info(`[ai-mode] rent-pay-result-card overflow overflowed=${overflowed} data=${JSON.stringify(data)}`)
      })
      console.info('[ai-mode] rent-pay-result-card overflow monitor=on')
    }
  },
  methods: {
    onTapBills() {
      const args = {}
      console.info(`[ai-mode] rent-pay-result-card send api/call name=getRentBills args=${JSON.stringify(args)}`)
      wx.modelContext.getContext(this).sendFollowUpMessage({
        content: [
          { type: 'text', text: '继续收租' },
          { type: 'api/call', data: { name: 'getRentBills', arguments: args } }
        ]
      })
    },
    onTapHistory() {
      const args = {}
      console.info(`[ai-mode] rent-pay-result-card send api/call name=getRentPaymentHistory args=${JSON.stringify(args)}`)
      wx.modelContext.getContext(this).sendFollowUpMessage({
        content: [
          { type: 'text', text: '查看记录' },
          { type: 'api/call', data: { name: 'getRentPaymentHistory', arguments: args } }
        ]
      })
    }
  }
})
