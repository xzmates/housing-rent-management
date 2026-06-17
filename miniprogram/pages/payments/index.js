const api = require('../../services/api');

Page({
  data: {
    loading: false, paying: false,
    showPayModal: false, showDetailModal: false,
    detailBill: null,
    bills: [],
    allHouses: [], allLeases: [],
    filters: { status: '', type: '' },
    houseFilterId: '',
    houseFilterLabel: '全部房屋',
    houseOptions: ['全部房屋'],
    stats: { totalUnpaid: 0, totalPaid: 0, rentUnpaid: 0, utilityUnpay: 0 },
    // 缴费弹窗
    payBillId: '',
    payAmount: 0,
    payMethod: 'cash',
    payDate: ''
  },

  onLoad() {
    const today = new Date().toISOString().slice(0, 10);
    this.setData({ payDate: today });
  },

  onPullDownRefresh() { this.loadAll().then(() => wx.stopPullDownRefresh()); },
  onShow() { this.loadAll(); },

  async loadAll() {
    await Promise.all([this.loadHouses(), this.loadBills()]);
  },

  async loadHouses() {
    try {
      const result = await api.getHouses();
      const houses = result.data || [];
      const addrOrder = { '东楼北': 1, '东楼南': 2, '里召': 3 };
      houses.sort((a, b) => {
        const aa = addrOrder[a.address] ?? 99, bb = addrOrder[b.address] ?? 99;
        if (aa !== bb) return aa - bb;
        return (parseInt(a.code, 10) || 0) - (parseInt(b.code, 10) || 0);
      });
      const options = ['全部房屋'].concat(houses.map(h => `${h.code} - ${h.address}`));
      this.setData({ allHouses: houses, houseOptions: options });
    } catch (e) { console.error(e); }
  },

  async loadBills() {
    this.setData({ loading: true });
    try {
      // 获取所有活跃合同
      const leaseRes = await api.getLeases({ status: 'active' });
      const leases = leaseRes.data || [];
      this.setData({ allLeases: leases });

      const leaseIds = leases.map(l => l._id);
      if (leaseIds.length === 0) {
        this.setData({ bills: [], loading: false });
        this._calcStats([]);
        return;
      }

      // 构建 lease -> house/tenant 映射
      const leaseMap = {};
      const houseIds = new Set();
      const tenantIds = new Set();
      leases.forEach(l => {
        leaseMap[l._id] = l;
        houseIds.add(l.houseId);
        tenantIds.add(l.tenantId);
      });

      // 批量加载房屋和租客
      const [houseData, tenantData] = await Promise.all([
        Promise.all([...houseIds].map(id => api.getHouseById(id).catch(() => null))),
        Promise.all([...tenantIds].map(id => api.getTenantById(id).catch(() => null)))
      ]);
      const houseMap = {};
      houseData.forEach(h => { if (h) houseMap[h._id] = h; });
      const tenantMap = {};
      tenantData.forEach(t => { if (t) tenantMap[t._id] = t; });

      // 查询所有账单
      const billRes = await api.getBills({ leaseIds });
      let bills = (billRes.data || []).map(bill => {
        const lease = leaseMap[bill.leaseId] || {};
        const house = houseMap[lease.houseId] || {};
        const tenant = tenantMap[lease.tenantId] || {};
        return {
          ...bill,
          houseLabel: house.code ? `${house.code} - ${house.address}` : '',
          tenantName: tenant.name || '',
          houseId: lease.houseId,
          remaining: bill.amount - bill.paidAmount,
          typeText: { rent: '租金', utility: '水电费', deposit_return: '押金退还', extra_due: '补缴' }[bill.type] || bill.type,
          statusText: bill.status === 'paid' ? '已缴' : bill.status === 'partial' ? '部分缴' : '待缴',
          dueDateStr: api.formatDate(bill.dueDate)
        };
      });

      // 筛选
      const { status, type } = this.data.filters;
      if (status) bills = bills.filter(b => b.status === status);
      if (type) bills = bills.filter(b => b.type === type);
      if (this.data.houseFilterId) {
        const filterLeaseIds = leases.filter(l => l.houseId === this.data.houseFilterId).map(l => l._id);
        bills = bills.filter(b => filterLeaseIds.indexOf(b.leaseId) >= 0);
      }

      // 排序：待缴优先，然后按到期日
      bills.sort((a, b) => {
        if (a.status !== b.status) {
          const order = { unpaid: 0, partial: 1, paid: 2 };
          return (order[a.status] ?? 9) - (order[b.status] ?? 9);
        }
        return (a.dueDate || '').localeCompare(b.dueDate || '');
      });

      this.setData({ bills });
      this._calcStats(bills);
    } catch (e) {
      console.error('加载账单失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  _calcStats(bills) {
    const unpaid = bills.filter(b => b.status !== 'paid');
    const paid = bills.filter(b => b.status === 'paid');
    this.setData({
      stats: {
        totalUnpaid: unpaid.reduce((s, b) => s + (b.amount - b.paidAmount), 0),
        totalPaid: paid.reduce((s, b) => s + b.paidAmount, 0),
        rentUnpaid: unpaid.filter(b => b.type === 'rent').reduce((s, b) => s + (b.amount - b.paidAmount), 0),
        utilityUnpay: unpaid.filter(b => b.type === 'utility').reduce((s, b) => s + (b.amount - b.paidAmount), 0)
      }
    });
  },

  setFilter(e) {
    const { key, val } = e.currentTarget.dataset;
    const filters = this.data.filters;
    filters[key] = val;
    this.setData({ filters }, () => this.loadBills());
  },

  onHouseFilterChange(e) {
    const idx = e.detail.value;
    if (idx === 0) {
      this.setData({ houseFilterId: '', houseFilterLabel: '全部房屋' }, () => this.loadBills());
    } else {
      const house = this.data.allHouses[idx - 1];
      this.setData({ houseFilterId: house._id, houseFilterLabel: house.code }, () => this.loadBills());
    }
  },

  // 缴费弹窗
  showPayModal(e) {
    const bill = e.currentTarget.dataset.bill;
    this.setData({
      showPayModal: true,
      payBillId: bill._id,
      payAmount: bill.amount - bill.paidAmount,
      payMethod: 'cash',
      payDate: new Date().toISOString().slice(0, 10),
      payBillInfo: bill
    });
  },

  closePay() { this.setData({ showPayModal: false }); },
  onPayAmountInput(e) { this.setData({ payAmount: Number(e.detail.value) || 0 }); },
  onPayDateChange(e) { this.setData({ payDate: e.detail.value }); },
  onPayMethodChange(e) {
    const methods = ['cash', 'wechat', 'bank', 'other'];
    this.setData({ payMethod: methods[e.detail.value] });
  },

  async confirmPay() {
    const { payBillId, payAmount, payDate, payMethod } = this.data;
    if (!payBillId || payAmount <= 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }
    this.setData({ paying: true });
    try {
      await api.payBill(payBillId, payAmount, payDate, payMethod);
      wx.showToast({ title: '缴费成功', icon: 'success' });
      this.closePay();
      this.loadBills();
    } catch (e) {
      console.error('缴费失败', e);
      wx.showToast({ title: e.message || '缴费失败', icon: 'none' });
    } finally {
      this.setData({ paying: false });
    }
  },

  // 详情弹窗
  showDetail(e) {
    const bill = e.currentTarget.dataset.bill;
    this.setData({ detailBill: bill, showDetailModal: true });
  },

  closeDetail() { this.setData({ showDetailModal: false, detailBill: null }); },

  stopPropagation() {},

  exportCSV() {
    const bills = this.data.bills;
    if (bills.length === 0) {
      wx.showToast({ title: '暂无数据可导出', icon: 'none' });
      return;
    }
    const header = '类型,期间,房屋,租客,应收,已收,状态,到期日';
    const rows = bills.map(b => {
      return `${b.typeText},${b.period || ''},${b.houseLabel},${b.tenantName},${b.amount},${b.paidAmount},${b.statusText},${b.dueDateStr}`;
    });
    wx.setClipboardData({
      data: header + '\n' + rows.join('\n'),
      success() { wx.showToast({ title: '已复制到剪贴板', icon: 'success' }); }
    });
  }
});
