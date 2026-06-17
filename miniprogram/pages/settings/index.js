const api = require('../../services/api');
const app = getApp();

Page({
  data: {
    saving: false, generating: false,
    settings: { electricityPrice: 0.8, waterPrice: 3.5 },
    form: { electricityPrice: 0.8, waterPrice: 3.5 },
    envId: app.globalData.envId
  },

  onLoad() { this.loadSettings(); },

  async loadSettings() {
    try {
      const prices = await api.getUtilityPrices();
      this.setData({
        settings: { ...prices },
        form: { ...prices }
      });
    } catch (e) {
      console.error('加载设置失败', e);
    }
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  async saveSettings() {
    this.setData({ saving: true });
    try {
      await api.updateSystemSettings({
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

  async generateBills() {
    wx.showModal({
      title: '生成月租账单',
      content: '将为所有活跃合同生成下月租金账单，已存在的不会重复生成。',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ generating: true });
        try {
          const result = await api.generateMonthlyBills();
          wx.showToast({ title: `生成${result.generated}条，跳过${result.skipped}条`, icon: 'success' });
        } catch (e) {
          console.error('生成账单失败', e);
          wx.showToast({ title: e.message || '生成失败', icon: 'none' });
        } finally {
          this.setData({ generating: false });
        }
      }
    });
  },

  _formatDate(date) {
    if (!date) return '未设置';
    return new Date(date).toLocaleString('zh-CN');
  }
});
