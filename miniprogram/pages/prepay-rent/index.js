const api = require('../../services/api');

const MODE_OPTIONS = [
  { label: '半个月', coverageDays: 15 },
  { label: '1个月', coverageMonths: 1 },
  { label: '2个月', coverageMonths: 2 },
  { label: '3个月', coverageMonths: 3 },
  { label: '自定义金额', custom: true }
];

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

Page({
  data: {
    loading: true,
    saving: false,
    leases: [],
    leaseLabels: [],
    leaseIndex: -1,
    selectedLease: null,
    modeOptions: MODE_OPTIONS.map(item => item.label),
    modeIndex: 1,
    amount: 0,
    payDate: '',
    payMethodIndex: 0,
    payMethods: ['现金', '微信', '银行转账', '其他'],
    preview: {
      coverageText: '',
      amountText: '0',
      startText: '',
      endText: ''
    }
  },

  onLoad(options = {}) {
    this.pendingLeaseId = options.leaseId || '';
    this.setData({ payDate: new Date().toISOString().slice(0, 10) });
    this.loadData();
  },

  onPullDownRefresh() {
    this.loadData().finally(() => wx.stopPullDownRefresh());
  },

  async loadData() {
    this.setData({ loading: true });
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
        loading: false
      }, () => this.updatePreview());
    } catch (err) {
      console.error('加载提前收租数据失败', err);
      wx.showToast({ title: err.message || '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onLeaseChange(e) {
    const leaseIndex = Number(e.detail.value);
    const selectedLease = this.data.leases[leaseIndex] || null;
    this.setData({ leaseIndex, selectedLease }, () => this.updatePreview());
  },

  onModeChange(e) {
    this.setData({ modeIndex: Number(e.detail.value) }, () => this.updatePreview());
  },

  onAmountInput(e) {
    this.setData({ amount: Number(e.detail.value) || 0 }, () => this.updatePreview());
  },

  onPayDateChange(e) {
    this.setData({ payDate: e.detail.value });
  },

  onPayMethodChange(e) {
    this.setData({ payMethodIndex: Number(e.detail.value) });
  },

  updatePreview() {
    const lease = this.data.selectedLease;
    if (!lease) {
      this.setData({ preview: { coverageText: '', amountText: '0', startText: '', endText: '' } });
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
        endText: ''
      }
    });
  },

  async submit() {
    const lease = this.data.selectedLease;
    if (!lease) {
      wx.showToast({ title: '请选择合同', icon: 'none' });
      return;
    }
    const mode = MODE_OPTIONS[this.data.modeIndex];
    const amount = Number(this.data.amount || 0);
    if (amount <= 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }

    this.setData({ saving: true });
    try {
      const billRes = await api.createNextRentBill(lease._id, {
        amount,
        coverageMonths: mode.coverageMonths || 0,
        coverageDays: mode.coverageDays || 0
      });
      const bill = billRes.bill;
      if (!bill || !bill._id) throw new Error('租金账单生成失败');
      await api.payBill(bill._id, amount, this.data.payDate, ['cash', 'wechat', 'bank', 'other'][this.data.payMethodIndex]);
      wx.showToast({ title: '收租成功', icon: 'success' });
      setTimeout(() => wx.navigateBack(), 700);
    } catch (err) {
      console.error('提前收租失败', err);
      wx.showToast({ title: err.message || '收租失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
