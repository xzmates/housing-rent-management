App({
  globalData: {
    envId: 'cloud1-2gxr9nlc327f3b44',
    agentHandoffs: {}
  },

  onLaunch() {
    this.registerAgentHandoff();
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: this.globalData.envId,
        traceUser: true
      });
    }
  },

  registerAgentHandoff() {
    if (!wx.onAgentHandoff) {
      console.warn('[App] 当前基础库不支持 wx.onAgentHandoff');
      return;
    }
    wx.onAgentHandoff(({ pageId, path, query, payload }) => {
      console.info('[App] onAgentHandoff', { pageId, path, query, payload });
      this.globalData.agentHandoffs = this.globalData.agentHandoffs || {};
      this.cleanupAgentHandoffs();
      this.globalData.agentHandoffs[pageId] = {
        path,
        query,
        payload,
        receivedAt: Date.now()
      };
    });
  },

  takeAgentHandoff(pageId) {
    this.cleanupAgentHandoffs();
    const map = this.globalData.agentHandoffs || {};
    const handoff = map[pageId];
    if (handoff) delete map[pageId];
    return handoff || null;
  },

  cleanupAgentHandoffs() {
    const map = this.globalData.agentHandoffs || {};
    const now = Date.now();
    const ttl = 10 * 60 * 1000;
    Object.keys(map).forEach((key) => {
      const item = map[key] || {};
      if (item.receivedAt && now - item.receivedAt > ttl) delete map[key];
    });
  }
});
