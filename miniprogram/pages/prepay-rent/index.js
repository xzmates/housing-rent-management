const api = require('../../services/api');

const MODE_OPTIONS = [
  { label: '半个月', coverageDays: 15 },
  { label: '1个月', coverageMonths: 1 },
  { label: '2个月', coverageMonths: 2 },
  { label: '3个月', coverageMonths: 3 },
  { label: '自定义金额', custom: true }
];

const PAY_METHODS = [
  { label: '现金', value: 'cash' },
  { label: '微信转账', value: 'wechat' },
  { label: '支付宝转账', value: 'alipay' },
  { label: '银行卡转账', value: 'bank' },
  { label: '其他', value: 'other' }
];

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function parseQuery(query) {
  if (!query) return {};
  if (typeof query === 'object') return query;
  return String(query).split('&').reduce((out, part) => {
    const [rawKey, rawValue = ''] = part.split('=');
    if (!rawKey) return out;
    out[decodeURIComponent(rawKey)] = decodeURIComponent(rawValue);
    return out;
  }, {});
}

function methodIndex(value) {
  const idx = PAY_METHODS.findIndex(item => item.value === value);
  return idx >= 0 ? idx : 0;
}

function modeIndexFromInput(input = {}) {
  const months = Number(input.coverageMonths || 0);
  const days = Number(input.coverageDays || 0);
  if (days === 15) return 0;
  if (months >= 1 && months <= 3) return months;
  return 4;
}

function leaseFromPreview(view = {}) {
  const lease = view.lease || {};
  const house = lease.house || {};
  const tenant = lease.tenant || {};
  return {
    _id: lease.id || '',
    rent: view.monthlyRent || lease.rent || 0,
    houseLabel: house.label || [house.code, house.address].filter(Boolean).join(' - ') || '该房屋',
    tenantName: tenant.name || '该租客',
    nextRentDueDateText: view.nextRentDueDate || view.coverageStart || '',
    rentCoveredUntilText: view.rentCoveredUntil || ''
  };
}

Page({
  data: {
    loading: true,
    saving: false,
    pageId: '',
    handoffPayload: null,
    confirmationId: '',
    leases: [],
    leaseLabels: [],
    leaseIndex: -1,
    selectedLease: null,
    modeOptions: MODE_OPTIONS.map(item => item.label),
    modeIndex: 1,
    amount: 0,
    payDate: '',
    payMethodIndex: 0,
    payMethods: PAY_METHODS.map(item => item.label),
    preview: {
      coverageText: '',
      amountText: '0',
      startText: '',
      endText: '',
      paymentNote: ''
    },
    errorText: '',
    resultText: '',
    resultStatus: '',
    needsAuthoritativeRefresh: true
  },

  onLoad(options = {}) {
    this.pendingLeaseId = options.leaseId || '';
    this.setData({ payDate: todayText() });
    this.loadFromHandoff(options);
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  async loadFromHandoff(options = {}) {
    const app = getApp();
    const pageId = typeof this.getPageId === 'function' ? this.getPageId() : '';
    const handoff = app && app.takeAgentHandoff && pageId ? app.takeAgentHandoff(pageId) : null;
    const handoffQuery = parseQuery(handoff && handoff.query);
    const payload = (handoff && handoff.payload) || null;
    const optionQuery = parseQuery(options);
    const confirmationId = payload?.confirmationId || handoffQuery.confirmationId || optionQuery.confirmationId || '';
    this.pendingLeaseId = optionQuery.leaseId || this.pendingLeaseId || '';

    this.setData({ pageId, handoffPayload: payload });

    if (!confirmationId) {
      await this.loadData();
      return;
    }

    try {
      const confirmation = await this.readConfirmation(confirmationId);
      const input = {
        ...(payload?.input || {}),
        ...(confirmation.normalizedInput || {}),
        leaseId: confirmation.targetId || handoffQuery.leaseId || payload?.input?.leaseId || ''
      };
      await this.refreshAuthoritativePreview(input);
    } catch (err) {
      console.error('加载提前收租接力失败', err);
      if (payload?.prepayView) {
        this.applyPrepayPreview({
          confirmationId,
          expiresAt: payload.expiresAt,
          normalizedInput: payload.input || {},
          prepayView: payload.prepayView
        }, `最新预览刷新失败：${err.message}`);
        return;
      }
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      this.setData({
        loading: false,
        errorText: `提前收租接力已失效：${err.message}`
      });
    }
  },

  async readConfirmation(confirmationId) {
    const confirmation = await api.getOperationConfirmation(confirmationId);
    if (confirmation.action && confirmation.action !== 'confirmPrepayRent') throw new Error('确认动作不匹配');
    if (confirmation.status && confirmation.status !== 'pending') throw new Error('确认记录已处理或失效');
    if (confirmation.expiresAt && new Date(confirmation.expiresAt).getTime() < Date.now()) throw new Error('确认记录已过期');
    return confirmation;
  },

  async refreshAuthoritativePreview(input) {
    const data = await api.previewPrepayRent(input);
    this.applyPrepayPreview(data, '');
    return data;
  },

  applyPrepayPreview(data = {}, errorText = '') {
    const view = data.prepayView || {};
    const input = data.normalizedInput || {};
    const selectedLease = leaseFromPreview(view);
    const leaseLabels = [`${selectedLease.houseLabel} · ${selectedLease.tenantName}`];
    const modeIndex = modeIndexFromInput(input);
    const amount = money(view.receivableAmount || view.amount || input.amount);
    const payMethodIndex = methodIndex(input.paymentMethod || view.paymentMethod);

    this.setData({
      loading: false,
      confirmationId: data.confirmationId || '',
      leases: [selectedLease],
      leaseLabels,
      leaseIndex: 0,
      selectedLease,
      modeIndex,
      amount,
      payDate: input.paymentDate || view.paymentDate || todayText(),
      payMethodIndex,
      preview: {
        coverageText: view.coverageText || '',
        amountText: money(amount),
        startText: view.coverageStart || '',
        endText: view.coverageEnd || '',
        paymentNote: view.paymentNote || ''
      },
      errorText,
      resultText: '',
      resultStatus: '',
      needsAuthoritativeRefresh: false
    });
  },

  async loadData() {
    this.setData({ loading: true, errorText: '', resultText: '', resultStatus: '' });
    try {
      const leaseRes = await api.getLeases({ status: 'active' });
      const leases = leaseRes.data || [];
      const houseIds = [...new Set(leases.map(l => l.houseId))];
      const tenantIds = [...new Set(leases.map(l => l.tenantId))];
      const [houses, tenants] = await Promise.all([
        Promise.all(houseIds.map(id => api.getHouseById(id).catch(() => null))),
        Promise.all(tenantIds.map(id => api.getTenantById(id).catch(() => null)))
      ]);
      const houseMap = {};
      houses.forEach(h => { if (h) houseMap[h._id] = h; });
      const tenantMap = {};
      tenants.forEach(t => { if (t) tenantMap[t._id] = t; });

      const enriched = leases.map(lease => {
        const house = houseMap[lease.houseId] || {};
        const tenant = tenantMap[lease.tenantId] || {};
        return {
          ...lease,
          houseLabel: `${house.code || '未命名房屋'} - ${house.address || ''}`,
          tenantName: tenant.name || '未知租客',
          nextRentDueDateText: api.formatDate(lease.nextRentDueDate),
          rentCoveredUntilText: api.formatDate(lease.rentCoveredUntil)
        };
      });

      const leaseIndex = this.pendingLeaseId
        ? enriched.findIndex(item => item._id === this.pendingLeaseId)
        : -1;
      const selectedLease = leaseIndex >= 0 ? enriched[leaseIndex] : null;

      this.setData({
        leases: enriched,
        leaseLabels: enriched.map(item => `${item.houseLabel} · ${item.tenantName}`),
        leaseIndex,
        selectedLease,
        loading: false,
        needsAuthoritativeRefresh: true
      }, () => this.updatePreview());
    } catch (err) {
      console.error('加载提前收租数据失败', err);
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      this.setData({ loading: false, errorText: err.message || '加载失败' });
    }
  },

  onLeaseChange(e) {
    const leaseIndex = Number(e.detail.value);
    const selectedLease = this.data.leases[leaseIndex] || null;
    this.setData({ leaseIndex, selectedLease, confirmationId: '', needsAuthoritativeRefresh: true }, () => this.updatePreview());
  },

  onModeChange(e) {
    this.setData({ modeIndex: Number(e.detail.value), confirmationId: '', needsAuthoritativeRefresh: true }, () => this.updatePreview());
  },

  onAmountInput(e) {
    this.setData({ amount: Number(e.detail.value) || 0, confirmationId: '', needsAuthoritativeRefresh: true }, () => this.updatePreview());
  },

  onPayDateChange(e) {
    this.setData({ payDate: e.detail.value, confirmationId: '', needsAuthoritativeRefresh: true });
  },

  onPayMethodChange(e) {
    this.setData({ payMethodIndex: Number(e.detail.value), confirmationId: '', needsAuthoritativeRefresh: true });
  },

  updatePreview() {
    const lease = this.data.selectedLease;
    if (!lease) {
      this.setData({ preview: { coverageText: '', amountText: '0', startText: '', endText: '', paymentNote: '' } });
      return;
    }
    const mode = MODE_OPTIONS[this.data.modeIndex];
    const monthlyRent = Number(lease.rent || 0);
    let amount = Number(this.data.amount || 0);
    let coverageText = mode.label;
    if (!mode.custom) {
      if (mode.coverageMonths) amount = monthlyRent * mode.coverageMonths;
      if (mode.coverageDays) amount = monthlyRent / 30 * mode.coverageDays;
    } else if (amount > 0) {
      coverageText = `约 ${Math.max(1, Math.round(amount / monthlyRent * 30))} 天`;
    }

    this.setData({
      amount: mode.custom ? this.data.amount : money(amount),
      preview: {
        coverageText,
        amountText: money(amount),
        startText: lease.nextRentDueDateText || '',
        endText: this.data.preview.endText || '',
        paymentNote: this.currentPaymentMethod() === 'wechat' ? '按微信转账已收款入账。' : ''
      }
    });
  },

  currentPaymentMethod() {
    return (PAY_METHODS[this.data.payMethodIndex] || PAY_METHODS[0]).value;
  },

  buildPreviewParams() {
    const lease = this.data.selectedLease;
    const mode = MODE_OPTIONS[this.data.modeIndex];
    const params = {
      leaseId: lease && lease._id,
      paymentDate: this.data.payDate,
      paymentMethod: this.currentPaymentMethod()
    };
    if (mode.coverageMonths) params.coverageMonths = mode.coverageMonths;
    if (mode.coverageDays) params.coverageDays = mode.coverageDays;
    if (mode.custom) params.amount = Number(this.data.amount || 0);
    return params;
  },

  async ensureLatestConfirmation() {
    if (this.data.confirmationId && !this.data.needsAuthoritativeRefresh) return this.data.confirmationId;
    const data = await api.previewPrepayRent(this.buildPreviewParams());
    this.applyPrepayPreview(data, '');
    return data.confirmationId;
  },

  async submit() {
    if (this.data.saving) return;
    if (this.data.errorText) return;
    const lease = this.data.selectedLease;
    if (!lease) {
      wx.showToast({ title: '请选择合同', icon: 'none' });
      return;
    }
    const amount = Number(this.data.amount || 0);
    if (amount <= 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }

    this.setData({ saving: true, errorText: '', resultText: '', resultStatus: '' });
    try {
      const confirmationId = await this.ensureLatestConfirmation();
      if (!confirmationId) throw new Error('云端未返回确认编号');
      const result = await api.confirmPrepayRent({ confirmationId });
      console.info('提前收租入账成功', result);
      wx.showToast({ title: '已入账', icon: 'success' });
      this.setData({
        saving: false,
        confirmationId,
        needsAuthoritativeRefresh: false,
        resultStatus: 'success',
        resultText: '提前收租已入账，未来租金账单和收款记录已更新。'
      });
    } catch (err) {
      console.error('提前收租失败', err);
      wx.showToast({ title: err.message || '收租失败', icon: 'none' });
      this.setData({
        saving: false,
        errorText: err.message || '收租失败',
        resultStatus: 'failed',
        resultText: ''
      });
    }
  }
});
