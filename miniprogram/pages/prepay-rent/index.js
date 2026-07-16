const api = require('../../services/api');

const MODE_OPTIONS = [
  { label: '1个月', periodCount: 1 },
  { label: '2个月', periodCount: 2 },
  { label: '3个月', periodCount: 3 },
  { label: '6个月', periodCount: 6 },
  { label: '12个月', periodCount: 12 }
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

function dateKey(value) {
  if (!value) return '';
  const raw = value && value.$date ? value.$date : value;
  const date = raw instanceof Date ? raw : new Date(raw);
  if (Number.isNaN(date.getTime())) return String(value).replace(/\//g, '-');
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
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
  const months = Number(input.periodCount || input.coverageMonths || 0);
  const idx = MODE_OPTIONS.findIndex(item => item.periodCount === months);
  return idx >= 0 ? idx : 0;
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
    rentCoveredUntilText: view.currentRentCoveredUntil || view.rentCoveredUntil || ''
  };
}

function normalizeRentCollectionInput(input = {}) {
  const out = { ...input };
  if (!out.periodStart && out.startDate) out.periodStart = out.startDate;
  if (!out.periodStart && out.coverageStart) out.periodStart = out.coverageStart;
  if (!out.periodCount && out.coverageMonths) out.periodCount = out.coverageMonths;
  delete out.coverageMonths;
  delete out.coverageDays;
  delete out.startDate;
  return out;
}

function modeText(mode) {
  return ({ arrears: '补交欠租', current: '当期收租', advance: '提前收租', mixed: '混合收租' })[mode] || '租金收款';
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
    modeIndex: 0,
    periodStart: '',
    amount: 0,
    payDate: '',
    payMethodIndex: 0,
    payMethods: PAY_METHODS.map(item => item.label),
    preview: {
      coverageText: '',
      amountText: '0',
      startText: '',
      endText: '',
      paymentNote: '',
      modeText: '',
      allocations: [],
      currentRentCoveredUntil: '',
      projectedRentCoveredUntil: ''
    },
    note: '',
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
      const input = normalizeRentCollectionInput({
        ...(payload?.input || {}),
        ...(confirmation.normalizedInput || {}),
        leaseId: confirmation.targetId || handoffQuery.leaseId || payload?.input?.leaseId || ''
      });
      await this.refreshAuthoritativePreview(input);
    } catch (err) {
      console.error('加载租金收款接力失败', err);
      if (payload?.rentCollectionView || payload?.prepayView) {
        this.applyRentCollectionPreview({
          confirmationId,
          expiresAt: payload.expiresAt,
          normalizedInput: payload.input || {},
          rentCollectionView: payload.rentCollectionView || payload.prepayView,
          prepayView: payload.prepayView
        }, `最新预览刷新失败：${err.message}`);
        return;
      }
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      this.setData({
        loading: false,
        errorText: `租金收款接力已失效：${err.message}`
      });
    }
  },

  async readConfirmation(confirmationId) {
    const confirmation = await api.getOperationConfirmation(confirmationId);
    if (confirmation.action && !['confirmRentCollection', 'confirmPrepayRent'].includes(confirmation.action)) throw new Error('确认动作不匹配');
    if (confirmation.status && confirmation.status !== 'pending') throw new Error('确认记录已处理或失效');
    if (confirmation.expiresAt && new Date(confirmation.expiresAt).getTime() < Date.now()) throw new Error('确认记录已过期');
    return confirmation;
  },

  async refreshAuthoritativePreview(input) {
    const data = await api.previewRentCollection(normalizeRentCollectionInput(input));
    if (data.needPeriod) throw new Error(data.message || '请先选择收租账期');
    this.applyRentCollectionPreview(data, '');
    return data;
  },

  applyRentCollectionPreview(data = {}, errorText = '') {
    const view = data.rentCollectionView || data.prepayView || {};
    const input = data.normalizedInput || {};
    const selectedLease = leaseFromPreview(view);
    const leaseLabels = [`${selectedLease.houseLabel} · ${selectedLease.tenantName}`];
    const modeIndex = modeIndexFromInput(input);
    const amount = money(view.totalCollectionAmount || view.receivableAmount || view.amount || input.amount);
    const payMethodIndex = methodIndex(input.paymentMethod || view.paymentMethod);

    this.setData({
      loading: false,
      confirmationId: data.confirmationId || '',
      leases: [selectedLease],
      leaseLabels,
      leaseIndex: 0,
      selectedLease,
      modeIndex,
      periodStart: input.periodStart || view.periodStart || view.coverageStart || '',
      amount,
      payDate: input.paymentDate || view.paymentDate || todayText(),
      payMethodIndex,
      note: input.note || view.note || '',
      preview: {
        coverageText: view.periodCount ? `${view.periodCount}个月` : (view.coverageText || ''),
        amountText: money(amount),
        startText: view.periodStart || view.coverageStart || '',
        endText: view.periodEnd || view.coverageEnd || '',
        paymentNote: view.paymentNote || '',
        modeText: modeText(view.mode),
        allocations: view.allocations || [],
        currentRentCoveredUntil: view.currentRentCoveredUntil || view.rentCoveredUntil || '',
        projectedRentCoveredUntil: view.projectedRentCoveredUntil || ''
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
          nextRentDueDateKey: dateKey(lease.nextRentDueDate),
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
        periodStart: selectedLease ? selectedLease.nextRentDueDateKey : '',
        loading: false,
        needsAuthoritativeRefresh: true
      }, () => this.updatePreview());
    } catch (err) {
      console.error('加载租金收款数据失败', err);
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      this.setData({ loading: false, errorText: err.message || '加载失败' });
    }
  },

  onLeaseChange(e) {
    const leaseIndex = Number(e.detail.value);
    const selectedLease = this.data.leases[leaseIndex] || null;
    this.setData({ leaseIndex, selectedLease, periodStart: selectedLease ? selectedLease.nextRentDueDateKey : '', confirmationId: '', needsAuthoritativeRefresh: true }, () => this.updatePreview());
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

  onPeriodStartChange(e) {
    this.setData({ periodStart: e.detail.value, confirmationId: '', needsAuthoritativeRefresh: true }, () => this.updatePreview());
  },

  onNoteInput(e) {
    this.setData({ note: e.detail.value || '', confirmationId: '', needsAuthoritativeRefresh: true });
  },

  updatePreview() {
    const lease = this.data.selectedLease;
    if (!lease) {
      this.setData({ preview: { coverageText: '', amountText: '0', startText: '', endText: '', paymentNote: '' } });
      return;
    }
    const mode = MODE_OPTIONS[this.data.modeIndex];
    const monthlyRent = Number(lease.rent || 0);
    let amount = monthlyRent * Number(mode.periodCount || 1);
    let coverageText = mode.label;

    this.setData({
      amount: money(amount),
      preview: {
        ...this.data.preview,
        coverageText,
        amountText: money(amount),
        startText: this.data.periodStart || lease.nextRentDueDateKey || '',
        endText: '',
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
      periodStart: this.data.periodStart || (lease && lease.nextRentDueDateKey),
      periodCount: mode.periodCount || 1,
      paymentDate: this.data.payDate,
      paymentMethod: this.currentPaymentMethod(),
      note: this.data.note || ''
    };
    return params;
  },

  async ensureLatestConfirmation() {
    if (this.data.confirmationId && !this.data.needsAuthoritativeRefresh) return this.data.confirmationId;
    const data = await api.previewRentCollection(this.buildPreviewParams());
    if (data.needPeriod) throw new Error(data.message || '请先选择收租账期');
    this.applyRentCollectionPreview(data, '');
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
      const result = await api.confirmRentCollection({ confirmationId });
      console.info('租金收款入账成功', result);
      wx.showToast({ title: '已入账', icon: 'success' });
      this.setData({
        saving: false,
        confirmationId,
        needsAuthoritativeRefresh: false,
        resultStatus: 'success',
        resultText: '租金收款已入账，账单和收款记录已更新。'
      });
    } catch (err) {
      console.error('租金收款失败', err);
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
