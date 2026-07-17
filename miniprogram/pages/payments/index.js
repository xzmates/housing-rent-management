const api = require('../../services/api');

function toTime(value) {
  if (!value) return 0;
  const raw = value.$date || value;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function rentCoverageStartTime(bill = {}) {
  return toTime(bill.rentCoverageStart || bill.dueDate);
}

function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function billRemaining(bill = {}) {
  return money(Math.max(0, Number(bill.amount || 0) - Number(bill.paidAmount || 0)));
}

function effectiveBillStatus(bill = {}) {
  const amount = money(bill.amount);
  const paidAmount = money(bill.paidAmount);
  const remaining = billRemaining(bill);
  if (remaining <= 0 && paidAmount >= amount) return 'paid';
  if (paidAmount > 0) return 'partial';
  return bill.status || 'unpaid';
}

function billStatusText(bill = {}) {
  const status = effectiveBillStatus(bill);
  if (['deposit_return', 'rent_refund'].indexOf(bill.type) >= 0 && status === 'paid') return '已退';
  return status === 'paid' ? '已缴' : status === 'partial' ? '部分缴' : '待缴';
}

Page({
  data: {
    loading: false, paying: false,
    showPayModal: false, showDetailModal: false,
    detailBill: null,
    bills: [], allBills: [],
    allHouses: [], allLeases: [],
    filters: { status: '', type: '' },
    houseFilterId: '',
    houseFilterLabel: '全部房屋',
    houseOptions: ['全部房屋'],
    stats: { totalUnpaid: 0, totalPaid: 0, rentPaid: 0, utilityPaid: 0, lossPaid: 0, rentUnpaid: 0, utilityUnpay: 0, managedDeposit: 0 },
    // 缴费弹窗
    payBillId: '',
    payTargetBillId: '',
    payAmount: 0,
    payMethod: 'cash',
    payDate: '',
    rentGapWarning: null,
    rentGapConfirmed: false
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
      // 获取所有合同，包含已退租合同，确保历史缴费记录仍可查看
      const leaseRes = await api.getLeases();
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
      const [billRes, paymentsRes] = await Promise.all([
        api.getBills({ leaseIds }),
        api.getPayments({ leaseIds }).catch(() => ({ data: [] }))
      ]);

      // 构建押金抵扣映射（billId -> 抵扣金额）
      const depositOffsetMap = {};
      (paymentsRes.data || []).forEach(p => {
        if (p.paymentMethod === 'deposit_offset') {
          depositOffsetMap[p.billId] = (depositOffsetMap[p.billId] || 0) + Number(p.amount || 0);
        }
      });

      const allBills = (billRes.data || []).map(bill => {
        const lease = leaseMap[bill.leaseId] || {};
        const house = houseMap[lease.houseId] || {};
        const tenant = tenantMap[lease.tenantId] || {};
        const normalized = { ...bill, remaining: billRemaining(bill), status: effectiveBillStatus(bill) };
        return {
          ...normalized,
          _depositOffset: depositOffsetMap[bill._id] || 0,
          houseLabel: house.code ? `${house.code} - ${house.address}` : '',
          tenantName: tenant.name || '',
          houseId: lease.houseId,
          typeText: { rent: '租金', deposit: '押金', utility: '水电费', deposit_return: '押金退还', rent_refund: '租金退还', extra_due: '补缴', other: '补缴' }[bill.type] || bill.type,
          statusText: billStatusText(normalized),
          dueDateStr: api.formatDate(bill.dueDate),
          utilityDetail: bill.type === 'utility' ? (bill.remark || '') : ''
        };
      });
      let bills = allBills.slice();

      // 筛选
      const { status, type } = this.data.filters;
      if (status === 'unpaid') {
        bills = bills.filter(b => b.status === 'unpaid' || b.status === 'partial');
      } else if (status) {
        bills = bills.filter(b => b.status === status);
      }
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

      this.setData({ bills, allBills });
      this._calcStats(allBills);
    } catch (e) {
      console.error('加载账单失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  _calcStats(allBills) {
    const { status, type } = this.data.filters || {};
    const scopedBills = (allBills || []).filter(b => !this.data.houseFilterId || b.houseId === this.data.houseFilterId);
    const typeMatchedBills = scopedBills.filter(b => {
      if (!type) return true;
      if (type === 'rent') return b.type === 'rent' || b.type === 'rent_refund';
      return b.type === type;
    });
    const visibleForStats = typeMatchedBills.filter(b => {
      const billStatus = effectiveBillStatus(b);
      if (status === 'unpaid') return billStatus === 'unpaid' || billStatus === 'partial';
      if (status) return billStatus === status;
      return true;
    });
    const unpaid = visibleForStats.filter(b => effectiveBillStatus(b) !== 'paid');
    const paid = status === 'unpaid' ? [] : visibleForStats.filter(b => effectiveBillStatus(b) === 'paid');
    const rentPaid = type && type !== 'rent' ? 0 : (
      paid.filter(b => b.type === 'rent').reduce((s, b) => s + Number(b.paidAmount || 0), 0) -
      paid.filter(b => b.type === 'rent_refund').reduce((s, b) => s + Number(b.paidAmount || 0), 0)
    );
    const utilityPaid = type && type !== 'utility'
      ? 0
      : paid.filter(b => b.type === 'utility').reduce((s, b) => s + Number(b.paidAmount || 0), 0);
    const lossPaid = (!type && status !== 'unpaid')
      ? (this.data.allLeases || [])
        .filter(l => l.status === 'terminated')
        .filter(l => !this.data.houseFilterId || l.houseId === this.data.houseFilterId)
        .reduce((s, l) => s + Number(l.damageAmount || 0), 0)
      : 0;
    const activeLeases = (this.data.allLeases || [])
      .filter(l => l.status === 'active')
      .filter(l => !this.data.houseFilterId || l.houseId === this.data.houseFilterId);
    this.setData({
      stats: {
        totalUnpaid: unpaid.reduce((s, b) => s + billRemaining(b), 0),
        totalPaid: rentPaid + utilityPaid + lossPaid,
        rentPaid,
        utilityPaid,
        lossPaid,
        rentUnpaid: type && type !== 'rent' ? 0 : unpaid.filter(b => b.type === 'rent').reduce((s, b) => s + billRemaining(b), 0),
        utilityUnpay: type && type !== 'utility' ? 0 : unpaid.filter(b => b.type === 'utility').reduce((s, b) => s + billRemaining(b), 0),
        managedDeposit: activeLeases.reduce((s, l) => s + Number(l.deposit || 0), 0)
      }
    });
  },

  setFilter(e) {
    const { key, val } = e.currentTarget.dataset;
    const filters = { ...this.data.filters };
    filters[key] = filters[key] === val ? '' : val;
    this.setData({ filters }, () => this.loadBills());
  },

  onHouseFilterChange(e) {
    const idx = Number(e.detail.value);
    if (idx === 0) {
      this.setData({ houseFilterId: '', houseFilterLabel: '全部房屋' }, () => this.loadBills());
    } else {
      const house = this.data.allHouses[idx - 1];
      if (!house) {
        this.setData({ houseFilterId: '', houseFilterLabel: '全部房屋' }, () => this.loadBills());
        return;
      }
      this.setData({ houseFilterId: house._id, houseFilterLabel: house.code }, () => this.loadBills());
    }
  },

  // 缴费弹窗
  showPayModal(e) {
    const bill = e.currentTarget.dataset.bill;
    const warning = this.buildRentGapWarning(bill);
    this.setData({
      showPayModal: true,
      payBillId: bill._id,
      payTargetBillId: bill._id,
      payAmount: billRemaining(bill),
      payMethod: 'cash',
      payDate: new Date().toISOString().slice(0, 10),
      payBillInfo: bill,
      rentGapWarning: warning,
      rentGapConfirmed: !warning
    });
  },

  closePay() { this.setData({ showPayModal: false, rentGapWarning: null, rentGapConfirmed: false }); },
  onPayAmountInput(e) { this.setData({ payAmount: Number(e.detail.value) || 0 }); },
  onPayDateChange(e) { this.setData({ payDate: e.detail.value }); },
  onPayMethodChange(e) {
    const methods = ['cash', 'wechat', 'bank', 'other'];
    this.setData({ payMethod: methods[e.detail.value] });
  },

  buildRentGapWarning(bill) {
    if (!bill || bill.type !== 'rent') return null;
    const selectedStart = rentCoverageStartTime(bill);
    if (!selectedStart) return null;
    const earlier = (this.data.allBills || [])
      .filter(item => item.leaseId === bill.leaseId && item.type === 'rent' && item._id !== bill._id)
      .filter(item => effectiveBillStatus(item) !== 'paid')
      .filter(item => rentCoverageStartTime(item) > 0 && rentCoverageStartTime(item) < selectedStart)
      .sort((a, b) => rentCoverageStartTime(a) - rentCoverageStartTime(b));
    if (!earlier.length) return null;
    return {
      count: earlier.length,
      targetPeriod: bill.period || bill.dueDateStr || '当前账期',
      earliestBillId: earlier[0]._id,
      earlierBills: earlier.map(item => ({
        id: item._id,
        period: item.period || item.dueDateStr || '未标注账期',
        remaining: billRemaining(item)
      }))
    };
  },

  useEarliestRentBill() {
    const warning = this.data.rentGapWarning;
    if (!warning || !warning.earliestBillId) return;
    const bill = (this.data.allBills || []).find(item => item._id === warning.earliestBillId);
    if (!bill) return;
    this.setData({
      payBillId: bill._id,
      payTargetBillId: bill._id,
      payAmount: billRemaining(bill),
      payBillInfo: bill,
      rentGapWarning: null,
      rentGapConfirmed: true
    });
  },

  keepSelectedRentBill() {
    this.setData({ rentGapConfirmed: true });
  },

  async confirmPay() {
    const { payBillId, payAmount, payDate, payMethod, rentGapWarning, rentGapConfirmed } = this.data;
    if (!payBillId || payAmount <= 0) {
      wx.showToast({ title: '请输入有效金额', icon: 'none' });
      return;
    }
    if (rentGapWarning && !rentGapConfirmed) {
      wx.showToast({ title: '请先确认欠租提醒', icon: 'none' });
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
