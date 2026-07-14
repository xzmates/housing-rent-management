Component({
  properties: {
    title: { type: String, value: '' },
    subtitle: { type: String, value: '' },
    statusText: { type: String, value: '' },
    summary: { type: String, value: '' },
    fields: { type: Array, value: [] },
    details: { type: Array, value: [] },
    mode: { type: String, value: 'result' },
    confirmText: { type: String, value: '确认办理' },
    cancelText: { type: String, value: '取消' },
    hasConfirm: { type: Boolean, value: true }
  },
  methods: {
    sendText(text) {
      console.info(`[ai-mode] result-card send text=${text}`)
      wx.modelContext.getContext(this).sendFollowUpMessage({
        content: [{ type: 'text', text }]
      })
    },
    onTapConfirm() {
      this.sendText('确认办理')
      this.triggerEvent('confirm', {}, { bubbles: true })
    },
    onTapCancel() {
      this.sendText('取消办理')
      this.triggerEvent('cancel', {}, { bubbles: true })
    },
    onTapContinue() {
      this.sendText('继续办理')
      this.triggerEvent('continue', {}, { bubbles: true })
    }
  }
})
