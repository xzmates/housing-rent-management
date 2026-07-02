const api = require('../../services/api');

Page({
  data: {
    loading: true,
    tenant: null,
    leases: [],
    bills: [],
    statistics: null
  },

  onLoad(options) {
    if (options.tenantId) {
      this.loadDetail(options.tenantId);
    }
  },

  async loadDetail(tenantId) {
    this.setData({ loading: true });
    try {
      const tenant = await api.getTenantById(tenantId);
      if (!tenant) {
        wx.showToast({ title: '租客不存在', icon: 'none' });
        this.setData({ loading: false });
        return;
      }

      // 通过 getTenantBills 获取合同和账单
      const data = await api.getTenantBills(tenantId);
      const leases = (data.leases || []).map(l => ({
        ...l,
        houseLabel: l.house ? `${l.house.code} - ${l.house.address}` : '未知房屋',
        statusLabel: l.status === 'active' ? '生效中' : '已结束',
        startDateStr: api.formatDate(l.startDate),
        endDateStr: api.formatDate(l.endDate),
        cycleLabel: { month: '月付', quarter: '季付', half_year: '半年付', year: '年付' }[l.paymentCycle] || '月付'
      }));

      const bills = (data.bills || []).map(b => ({
        ...b,
        typeText: { rent: '租金', utility: '水电费', deposit_return: '押金退还', extra_due: '补缴' }[b.type] || b.type,
        statusText: b.type === 'deposit_return' && b.status === 'paid' ? '已退' : b.status === 'paid' ? '已缴' : b.status === 'partial' ? '部分缴' : '待缴',
        dueDateStr: api.formatDate(b.dueDate)
      }));

      this.setData({
        tenant, leases, bills,
        statistics: data.statistics || { totalBills: 0, totalAmount: 0, totalPaid: 0, totalUnpaid: 0 },
        loading: false
      });
    } catch (e) {
      console.error('加载租客详情失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  goToCreateLease() {
    const tenant = this.data.tenant;
    if (!tenant) return;
    wx.navigateTo({ url: `/pages/create-lease/index?tenantId=${tenant._id}` });
  },

  stopPropagation() {}
});
