Component({
  data: {
    mode: 'result',
    actionName: '',
    confirmToken: '',
    actionTitle: '办理结果',
    statusText: '办理成功',
    summary: '',
    success: 0,
    failed: 0,
    fields: [],
    details: [],
    hasMoveOutPreview: false,
    moveOutPreview: null,
    previewKey: ''
  },
  lifetimes: {
    created() {
      console.info('[ai-mode] rental-action-result-card created')
      const { NotificationType } = wx.modelContext
      const modelCtx = wx.modelContext.getContext(this)
      modelCtx.on(NotificationType.Result, (data) => {
        const sc = (data && data.result && data.result.structuredContent) || {}
        let previewKey = ''
        if (sc.moveOutPreview) {
          previewKey = `moveout_preview_${sc.confirmToken || Date.now()}`
          try {
            wx.setStorageSync(previewKey, {
              actionName: sc.actionName || '',
              confirmToken: sc.confirmToken || '',
              actionTitle: sc.actionTitle || '退租结算',
              statusText: sc.statusText || '待确认',
              summary: sc.summary || '',
              moveOutPreview: sc.moveOutPreview
            })
            wx.setStorageSync('moveout_preview_latest', previewKey)
            wx.modelContext.getViewContext(this).setRelatedPage({
              path: '/pages/ai-moveout-detail/index',
              query: `previewKey=${encodeURIComponent(previewKey)}`
            })
            console.info(`[ai-mode] rental-action-result-card setRelatedPage previewKey=${previewKey}`)
          } catch (err) {
            console.info('[ai-mode] rental-action-result-card setRelatedPage skipped:', err.message)
          }
        } else {
          try {
            wx.modelContext.getViewContext(this).setRelatedPage({ path: '/pages/dashboard/index' })
          } catch (err) {
            console.info('[ai-mode] rental-action-result-card setRelatedPage dashboard skipped:', err.message)
          }
        }
        const nextData = {
          mode: sc.mode || 'result',
          actionName: sc.actionName || '',
          confirmToken: sc.confirmToken || '',
          actionTitle: sc.actionTitle || '办理结果',
          statusText: sc.statusText || '办理成功',
          summary: sc.summary || '',
          success: sc.success || 0,
          failed: sc.failed || 0,
          fields: sc.fields || [],
          details: sc.details || [],
          hasMoveOutPreview: !!sc.moveOutPreview,
          moveOutPreview: sc.moveOutPreview || null,
          previewKey
        }
        console.info('[ai-mode] rental-action-result-card 收到 Result:', JSON.stringify(sc))
        this.setData(nextData)
      })

      const viewCtx = wx.modelContext.getViewContext(this)
      try {
        const { width, minHeight, maxHeight } = viewCtx.getDimensions()
        console.info(`[ai-mode] rental-action-result-card dimensions width=${width} minHeight=${minHeight} maxHeight=${maxHeight}`)
      } catch (err) {
        console.info('[ai-mode] rental-action-result-card getDimensions skipped:', err.message)
      }
      viewCtx.on(NotificationType.Overflow, (data) => {
        const overflowed = !!(data && data.overflowHeight > 0)
        console.info(`[ai-mode] rental-action-result-card overflow overflowed=${overflowed} data=${JSON.stringify(data)}`)
      })
      console.info('[ai-mode] rental-action-result-card overflow monitor=on')
    }
  },
  methods: {
    onTapDetail() {
      if (!this.data.previewKey) return
      const url = `/pages/ai-moveout-detail/index?previewKey=${encodeURIComponent(this.data.previewKey)}`
      console.info(`[ai-mode] rental-action-result-card openDetailPage url=${url}`)
      wx.modelContext.getViewContext(this).openDetailPage({ url })
    },
    onTapConfirm() {
      const args = {
        actionName: this.data.actionName,
        confirmToken: this.data.confirmToken
      }
      console.info(`[ai-mode] rental-action-result-card send api/call name=executeRentalAction args=${JSON.stringify(args)}`)
      wx.modelContext.getContext(this).sendFollowUpMessage({
        content: [
          { type: 'text', text: '确认办理' },
          { type: 'api/call', data: { name: 'executeRentalAction', arguments: args } }
        ]
      })
    },
    onTapMenu() {
      const args = {}
      console.info(`[ai-mode] rental-action-result-card send api/call name=getRentalActions args=${JSON.stringify(args)}`)
      wx.modelContext.getContext(this).sendFollowUpMessage({
        content: [
          { type: 'text', text: '继续办理' },
          { type: 'api/call', data: { name: 'getRentalActions', arguments: args } }
        ]
      })
    }
  }
})
