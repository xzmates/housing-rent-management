const api = require('../../services/api');
const dataRefresh = require('../../utils/data-refresh');
const app = getApp();

Page({
  data: {
    saving: false, generating: false,
    notificationLoading: false,
    notificationSubscription: {
      enabled: false,
      remainingCredits: 0,
      templateConfigured: false,
      templateId: '',
      statusText: '正在读取提醒状态',
      actionText: '开启每日提醒'
    },
    settings: { electricityPrice: 0.8, waterPrice: 3.5 },
    form: { electricityPrice: 0.8, waterPrice: 3.5 },
    envId: app.globalData.envId,
    stats: { houses: 0, tenants: 0 }
  },

  onShow() {
    if (dataRefresh.needsRefresh(this)) this.loadAll();
  },
  onPullDownRefresh() {
    this.loadAll(true).then(() => wx.stopPullDownRefresh());
  },

  async loadAll() {
    await Promise.all([this.loadSettings(), this.loadStats(), this.loadNotificationSubscription()]);
    dataRefresh.markLoaded(this);
  },

  notificationView(subscription = {}) {
    const remainingCredits = Math.max(0, Number(subscription.remainingCredits || 0));
    const templateConfigured = Boolean(subscription.templateConfigured && subscription.templateId);
    let statusText = '授权后每日 09:00 自动检查当前待收';
    if (!templateConfigured) statusText = '订阅消息模板尚未配置';
    else if (subscription.enabled && remainingCredits > 0) statusText = `每日 09:00 自动检查，预计还可提醒 ${remainingCredits} 天`;
    else if (subscription.enabled) statusText = '提醒次数已用完，请补充授权';
    if (subscription.statusText) statusText = subscription.statusText;
    return {
      ...subscription,
      enabled: Boolean(subscription.enabled),
      remainingCredits,
      templateConfigured,
      statusText,
      actionText: subscription.enabled ? '补充提醒次数' : '开启每日提醒'
    };
  },

  async loadNotificationSubscription() {
    try {
      const subscription = await api.callRentalDomain('getDailyReminderSubscription');
      this.setData({ notificationSubscription: this.notificationView(subscription) });
    } catch (e) {
      console.error('加载微信提醒状态失败', e);
      this.setData({ notificationSubscription: this.notificationView({ statusText: '提醒状态读取失败，请稍后重试' }) });
    }
  },

  requestDailyReminder() {
    if (this.data.notificationLoading) return;
    const subscription = this.data.notificationSubscription || {};
    if (!subscription.templateConfigured || !subscription.templateId) {
      wx.showModal({
        title: '提醒模板待配置',
        content: '请先在微信公众平台添加待收账单提醒模板，并在 rentalDomain 云函数配置模板 ID。',
        showCancel: false
      });
      return;
    }
    if (!wx.requestSubscribeMessage) {
      wx.showToast({ title: '当前微信版本不支持订阅消息', icon: 'none' });
      return;
    }
    this.setData({ notificationLoading: true });
    wx.requestSubscribeMessage({
      tmplIds: [subscription.templateId],
      success: async (result) => {
        if (result[subscription.templateId] !== 'accept') {
          wx.showToast({ title: '未获得提醒授权', icon: 'none' });
          this.setData({ notificationLoading: false });
          return;
        }
        try {
          const updated = await api.callRentalDomain('recordDailyReminderConsent', { templateId: subscription.templateId, status: 'accept' });
          this.setData({ notificationLoading: false, notificationSubscription: this.notificationView(updated) });
          wx.showToast({ title: '已增加1次提醒', icon: 'success' });
        } catch (e) {
          console.error('保存微信提醒授权失败', e);
          this.setData({ notificationLoading: false });
          wx.showToast({ title: '授权记录保存失败', icon: 'none' });
        }
      },
      fail: (error) => {
        console.error('订阅消息授权失败', error);
        this.setData({ notificationLoading: false });
        wx.showToast({ title: '订阅授权失败', icon: 'none' });
      }
    });
  },

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

  async loadStats() {
    try {
      const [houseRes, tenantRes] = await Promise.all([api.getHouses(), api.getTenants()]);
      this.setData({
        stats: {
          houses: (houseRes.data || []).length,
          tenants: (tenantRes.data || []).length
        }
      });
    } catch (e) {
      console.error('加载我的页统计失败', e);
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
