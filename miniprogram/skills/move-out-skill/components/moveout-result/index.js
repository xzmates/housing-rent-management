Component({
  data: { title: '', subtitle: '', fields: [], details: [], summary: '', mode: 'result', cancelText: '取消', confirmText: '确认办理' },
  lifetimes: {
    created() {
      const { NotificationType } = wx.modelContext
      const ctx = wx.modelContext.getContext(this)
      ctx.on(NotificationType.Result, (data) => {
        const sc = (data && data.result && data.result.structuredContent) || {}
        console.info('[ai-mode] moveout-result 收到 Result:', sc)
        const settlement = sc.settlementView || sc
        const leases = sc.leases || []
        const fields = leases.length
          ? leases.slice(0, 5).map(l => ({ label: l.tenant ? l.tenant.name : '—', value: l.house ? l.house.label : '—' }))
          : [
            { label: '水电费', value: `¥${settlement.utilityCost || 0}` },
            { label: '押金抵扣', value: `¥${settlement.depositOffset || 0}` },
            { label: settlement.finalLabel || '应退总额', value: `¥${settlement.finalAmount || settlement.totalRefund || 0}` }
          ]
        this.setData({
          title: sc.confirmationId ? '退租结算确认' : '退租对象',
          subtitle: sc.confirmationId || '',
          summary: sc.confirmationId ? '请核对押金、水电费和应退应补金额' : '',
          fields,
          details: [],
          mode: sc.confirmationId ? 'confirm' : 'result'
        })
        console.info('[ai-mode] moveout-result setData done')
      })
      const viewCtx = wx.modelContext.getViewContext(this)
      const dims = viewCtx.getDimensions()
      console.info(`[ai-mode] moveout-result dimensions width=${dims.width} minHeight=${dims.minHeight} maxHeight=${dims.maxHeight}`)
      viewCtx.on(NotificationType.Overflow, (data) => {
        const overflowed = !!(data && data.overflowHeight > 0)
        console.info(`[ai-mode] moveout-result overflow overflowed=${overflowed} data=${JSON.stringify(data)}`)
      })
      console.info('[ai-mode] moveout-result overflow monitor=on')
    }
  }
})

