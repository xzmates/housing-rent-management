const { isPreviewMode, defaultHistory } = require('../../utils/util')

function fitItems(items) {
  const list = items || []
  return {
    visibleItems: list.slice(0, 3),
    omittedCount: Math.max(0, list.length - 3)
  }
}

Component({
  data: {
    visibleItems: [],
    total: 0,
    totalAmount: '0',
    filterText: '全部房屋',
    omittedCount: 0
  },
  lifetimes: {
    created() {
      console.info('[ai-mode] rent-history-card created')
      const { NotificationType } = wx.modelContext
      const modelCtx = wx.modelContext.getContext(this)
      modelCtx.on(NotificationType.Result, (data) => {
        const sc = (data && data.result && data.result.structuredContent) || {}
        const fit = fitItems(sc.items || [])
        const nextData = {
          visibleItems: fit.visibleItems,
          total: sc.total || 0,
          totalAmount: String(sc.totalAmount || '0'),
          filterText: sc.filterText || '全部房屋',
          omittedCount: fit.omittedCount
        }
        console.info('[ai-mode] rent-history-card 收到 Result:', JSON.stringify(sc))
        this.setData(nextData)
        console.info('[ai-mode] rent-history-card setData total=', nextData.total, 'visible=', nextData.visibleItems.length)
      })

      const viewCtx = wx.modelContext.getViewContext(this)
      try {
        const { width, minHeight, maxHeight } = viewCtx.getDimensions()
        console.info(`[ai-mode] rent-history-card dimensions width=${width} minHeight=${minHeight} maxHeight=${maxHeight}`)
      } catch (err) {
        console.info('[ai-mode] rent-history-card getDimensions skipped:', err.message)
      }
      viewCtx.on(NotificationType.Overflow, (data) => {
        const overflowed = !!(data && data.overflowHeight > 0)
        console.info(`[ai-mode] rent-history-card overflow overflowed=${overflowed} data=${JSON.stringify(data)}`)
      })
      console.info('[ai-mode] rent-history-card overflow monitor=on')
    },
    attached() {
      if (isPreviewMode() && this.data.visibleItems.length === 0) {
        const items = defaultHistory()
        const fit = fitItems(items)
        this.setData({
          visibleItems: fit.visibleItems,
          total: items.length,
          totalAmount: '2100',
          filterText: '全部房屋',
          omittedCount: fit.omittedCount
        })
        console.info('[ai-mode] rent-history-card attached preview data')
      }
    }
  },
  methods: {
    onTapBills() {
      const args = {}
      console.info(`[ai-mode] rent-history-card send api/call name=getRentBills args=${JSON.stringify(args)}`)
      wx.modelContext.getContext(this).sendFollowUpMessage({
        content: [
          { type: 'text', text: '继续收租' },
          { type: 'api/call', data: { name: 'getRentBills', arguments: args } }
        ]
      })
    }
  }
})
