Component({
  properties: {},
  data: { title: '', subtitle: '', fields: [], details: [], summary: '', mode: 'result', cancelText: '取消', confirmText: '确认办理' },
  lifetimes: {
    created() {
      const { NotificationType } = wx.modelContext
      const ctx = wx.modelContext.getContext(this)
      ctx.on(NotificationType.Result, (data) => {
        const sc = (data && data.result && data.result.structuredContent) || {}
        console.info('[ai-mode] tenant-result 收到 Result:', sc)
        this.setData({
          title: sc.title || '租客查询',
          subtitle: sc.subtitle || '',
          fields: sc.fields || [],
          details: sc.details || [],
          summary: sc.summary || '',
          mode: sc.mode || 'result'
        })
        console.info('[ai-mode] tenant-result setData done')
      })
      const viewCtx = wx.modelContext.getViewContext(this)
      const dims = viewCtx.getDimensions()
      console.info(`[ai-mode] tenant-result dimensions width=${dims.width} minHeight=${dims.minHeight} maxHeight=${dims.maxHeight}`)
      viewCtx.on(NotificationType.Overflow, (data) => {
        const overflowed = !!(data && data.overflowHeight > 0)
        console.info(`[ai-mode] tenant-result overflow overflowed=${overflowed} data=${JSON.stringify(data)}`)
      })
      console.info('[ai-mode] tenant-result overflow monitor=on')
    }
  }
})

