const { isPreviewMode, defaultRentBills, todayText } = require('../../utils/util')

function previewData() {
  const item = defaultRentBills()[0]
  return {
    billId: item.billId,
    houseLabel: item.houseLabel,
    tenantName: item.tenantName,
    period: item.period,
    amount: item.remaining,
    billAmount: item.amount,
    paidAmount: item.paidAmount,
    remaining: item.remaining,
    dueDate: item.dueDate,
    paymentDate: todayText(),
    paymentMethod: 'cash',
    paymentMethodText: '现金',
    statusText: item.statusText,
    confirmToken: ''
  }
}

Component({
  data: {
    billId: '',
    houseLabel: '',
    tenantName: '',
    period: '',
    amount: '0',
    billAmount: '0',
    paidAmount: '0',
    remaining: '0',
    dueDate: '',
    paymentDate: '',
    paymentMethod: 'cash',
    paymentMethodText: '现金',
    statusText: '',
    confirmToken: ''
  },
  lifetimes: {
    created() {
      console.info('[ai-mode] rent-pay-confirm-card created')
      const { NotificationType } = wx.modelContext
      const modelCtx = wx.modelContext.getContext(this)
      modelCtx.on(NotificationType.Result, (data) => {
        const sc = (data && data.result && data.result.structuredContent) || {}
        const nextData = {
          billId: sc.billId || '',
          houseLabel: sc.houseLabel || '',
          tenantName: sc.tenantName || '',
          period: sc.period || '',
          amount: String(sc.amount || '0'),
          billAmount: String(sc.billAmount || '0'),
          paidAmount: String(sc.paidAmount || '0'),
          remaining: String(sc.remaining || '0'),
          dueDate: sc.dueDate || '',
          paymentDate: sc.paymentDate || '',
          paymentMethod: sc.paymentMethod || 'cash',
          paymentMethodText: sc.paymentMethodText || '现金',
          statusText: sc.statusText || '',
          confirmToken: sc.confirmToken || ''
        }
        console.info('[ai-mode] rent-pay-confirm-card 收到 Result:', JSON.stringify(sc))
        this.setData(nextData)
        console.info('[ai-mode] rent-pay-confirm-card setData billId=', nextData.billId)
      })

      const viewCtx = wx.modelContext.getViewContext(this)
      try {
        const { width, minHeight, maxHeight } = viewCtx.getDimensions()
        console.info(`[ai-mode] rent-pay-confirm-card dimensions width=${width} minHeight=${minHeight} maxHeight=${maxHeight}`)
      } catch (err) {
        console.info('[ai-mode] rent-pay-confirm-card getDimensions skipped:', err.message)
      }
      viewCtx.on(NotificationType.Overflow, (data) => {
        const overflowed = !!(data && data.overflowHeight > 0)
        console.info(`[ai-mode] rent-pay-confirm-card overflow overflowed=${overflowed} data=${JSON.stringify(data)}`)
      })
      console.info('[ai-mode] rent-pay-confirm-card overflow monitor=on')
    },
    attached() {
      if (isPreviewMode() && !this.data.billId) {
        this.setData(previewData())
        console.info('[ai-mode] rent-pay-confirm-card attached preview data')
      }
    }
  },
  methods: {
    onTapConfirm() {
      const args = {
        billId: this.data.billId,
        amount: Number(this.data.amount || 0),
        paymentMethod: this.data.paymentMethod || 'cash',
        paymentDate: this.data.paymentDate,
        confirmToken: this.data.confirmToken
      }
      console.info(`[ai-mode] rent-pay-confirm-card send api/call name=payRentBill args=${JSON.stringify(args)}`)
      wx.modelContext.getContext(this).sendFollowUpMessage({
        content: [
          { type: 'text', text: '确认收款' },
          { type: 'api/call', data: { name: 'payRentBill', arguments: args } }
        ]
      })
    },
    onTapBack() {
      const args = {}
      console.info(`[ai-mode] rent-pay-confirm-card send api/call name=getRentBills args=${JSON.stringify(args)}`)
      wx.modelContext.getContext(this).sendFollowUpMessage({
        content: [
          { type: 'text', text: '返回待收' },
          { type: 'api/call', data: { name: 'getRentBills', arguments: args } }
        ]
      })
    }
  }
})
