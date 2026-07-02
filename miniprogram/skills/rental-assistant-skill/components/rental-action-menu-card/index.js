const { actionList } = require('../../utils/util')

Component({
  data: {
    title: '语音助手',
    subtitle: '说完先确认，再安全办理',
    actions: []
  },
  lifetimes: {
    created() {
      console.info('[ai-mode] rental-action-menu-card created')
      const { NotificationType } = wx.modelContext
      const modelCtx = wx.modelContext.getContext(this)
      modelCtx.on(NotificationType.Result, (data) => {
        const sc = (data && data.result && data.result.structuredContent) || {}
        const nextData = {
          title: sc.title || '语音助手',
          subtitle: sc.subtitle || '说完先确认，再安全办理',
          actions: sc.actions || actionList()
        }
        console.info('[ai-mode] rental-action-menu-card 收到 Result:', JSON.stringify(sc))
        this.setData(nextData)
      })

      const viewCtx = wx.modelContext.getViewContext(this)
      try {
        const { width, minHeight, maxHeight } = viewCtx.getDimensions()
        console.info(`[ai-mode] rental-action-menu-card dimensions width=${width} minHeight=${minHeight} maxHeight=${maxHeight}`)
      } catch (err) {
        console.info('[ai-mode] rental-action-menu-card getDimensions skipped:', err.message)
      }
      viewCtx.on(NotificationType.Overflow, (data) => {
        const overflowed = !!(data && data.overflowHeight > 0)
        console.info(`[ai-mode] rental-action-menu-card overflow overflowed=${overflowed} data=${JSON.stringify(data)}`)
      })
    },
    attached() {
      if (this.data.actions.length === 0) {
        this.setData({ actions: actionList() })
      }
    }
  },
  methods: {
    onTapAction(e) {
      const sample = e.currentTarget.dataset.sample || '我要办理'
      console.info(`[ai-mode] rental-action-menu-card send text sample=${sample}`)
      wx.modelContext.getContext(this).sendFollowUpMessage({
        content: [{ type: 'text', text: sample }]
      })
    }
  }
})
