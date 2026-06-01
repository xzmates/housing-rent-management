App({
  globalData: {
    envId: 'cloud1-2gxr9nlc327f3b44'
  },

  onLaunch() {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力');
    } else {
      wx.cloud.init({
        env: this.globalData.envId,
        traceUser: true
      });
    }
  }
});
