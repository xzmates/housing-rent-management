Component({
  data: { title: '', subtitle: '', fields: [], details: [], summary: '', mode: 'result', cancelText: '取消', confirmText: '确认办理' },
  lifetimes: {
    created() {
      const { NotificationType } = wx.modelContext
      const ctx = wx.modelContext.getContext(this)
      ctx.on(NotificationType.Result, (data) => {
        const sc = (data && data.result && data.result.structuredContent) || {}
        console.info('[ai-mode] rent-result 收到 Result:', sc)
        const bills = sc.bills || []
        this.setData({
          title: sc.confirmationId ? '收租确认' : '待收租金',
          subtitle: sc.confirmationId || '',
          summary: sc.totalRemaining !== undefined ? `待收合计 ¥${sc.totalRemaining}` : '',
          fields: bills.slice(0, 5).map(b => ({ label: `${b.houseLabel || ''} ${b.tenantName || ''}`, value: `¥${b.remaining || b.amount || 0}` })),
          details: sc.bill ? [{ label: sc.bill.typeText || '账单', value: `¥${sc.amount || sc.bill.remaining || 0}` }] : [],
          mode: sc.confirmationId ? 'confirm' : 'result'
        })
        console.info('[ai-mode] rent-result setData done')
      })
      const viewCtx = wx.modelContext.getViewContext(this)
      const dims = viewCtx.getDimensions()
      console.info(`[ai-mode] rent-result dimensions width=${dims.width} minHeight=${dims.minHeight} maxHeight=${dims.maxHeight}`)
      viewCtx.on(NotificationType.Overflow, (data) => {
        const overflowed = !!(data && data.overflowHeight > 0)
        console.info(`[ai-mode] rent-result overflow overflowed=${overflowed} data=${JSON.stringify(data)}`)
      })
      console.info('[ai-mode] rent-result overflow monitor=on')
    }
  }
})

