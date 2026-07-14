Component({
  data: { title: '', subtitle: '', fields: [], details: [], summary: '', mode: 'result', cancelText: '取消', confirmText: '确认办理' },
  lifetimes: {
    created() {
      const { NotificationType } = wx.modelContext
      const ctx = wx.modelContext.getContext(this)
      ctx.on(NotificationType.Result, (data) => {
        const sc = (data && data.result && data.result.structuredContent) || {}
        console.info('[ai-mode] meter-result 收到 Result:', sc)
        const leases = sc.leases || []
        const fields = leases.length
          ? leases.slice(0, 5).map(l => ({ label: l.tenant ? l.tenant.name : '—', value: l.house ? l.house.label : '—' }))
          : [
            { label: '电量', value: `${sc.electricityUsage || 0} 度` },
            { label: '水量', value: `${sc.waterUsage || 0} 吨` },
            { label: '费用', value: `¥${sc.utilityCost || sc.totalCost || 0}` }
          ]
        this.setData({
          title: sc.confirmationId ? '抄表确认' : '抄表对象',
          subtitle: sc.confirmationId || '',
          summary: sc.confirmationId ? '请核对水电读数与费用' : '',
          fields,
          details: [],
          mode: sc.confirmationId ? 'confirm' : 'result'
        })
        console.info('[ai-mode] meter-result setData done')
      })
      const viewCtx = wx.modelContext.getViewContext(this)
      const dims = viewCtx.getDimensions()
      console.info(`[ai-mode] meter-result dimensions width=${dims.width} minHeight=${dims.minHeight} maxHeight=${dims.maxHeight}`)
      viewCtx.on(NotificationType.Overflow, (data) => {
        const overflowed = !!(data && data.overflowHeight > 0)
        console.info(`[ai-mode] meter-result overflow overflowed=${overflowed} data=${JSON.stringify(data)}`)
      })
      console.info('[ai-mode] meter-result overflow monitor=on')
    }
  }
})

