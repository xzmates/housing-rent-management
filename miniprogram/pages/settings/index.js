const dbService = require('../../services/database');
const app = getApp();

Page({
  data: {
    saving: false,
    settings: { electricityPrice: 0.8, waterPrice: 3.5 },
    form: { electricityPrice: 0.8, waterPrice: 3.5 },
    envId: app.globalData.envId
  },

  onLoad() {
    this.loadSettings();
  },

  async loadSettings() {
    try {
      const result = await dbService.getSystemSettings();
      if (result.data.length > 0) {
        const s = result.data[0];
        this.setData({
          settings: {
            electricityPrice: s.electricityPrice || 0.8,
            waterPrice: s.waterPrice || 3.5,
            updatedAt: s.updatedAt
          },
          form: {
            electricityPrice: s.electricityPrice || 0.8,
            waterPrice: s.waterPrice || 3.5
          }
        });
      }
    } catch (e) {
      console.error('加载设置失败', e);
    }
  },

  async saveSettings() {
    this.setData({ saving: true });
    try {
      await dbService.updateSystemSettings({
        electricityPrice: Number(this.data.form.electricityPrice),
        waterPrice: Number(this.data.form.waterPrice)
      });
      await this.loadSettings();
      wx.showToast({ title: '保存成功', icon: 'success' });
    } catch (e) {
      console.error('保存设置失败', e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  _formatDate(date) {
    if (!date) return '未设置';
    return new Date(date).toLocaleString('zh-CN');
  }
});
