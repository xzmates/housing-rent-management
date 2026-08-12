const api = require('../../services/api');
const dataRefresh = require('../../utils/data-refresh');
const { billTypeText, paymentMethodText } = require('../../utils/billing-labels');

function toTime(value) {
  if (!value) return 0;
  const date = new Date(value.$date || value);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function dateKey(value) {
  const time = toTime(value);
  if (!time) return '';
  const date = new Date(time);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function money(value) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0;
}

function billRemaining(bill = {}) {
  return money(Math.max(0, Number(bill.amount || 0) - Number(bill.paidAmount || 0)));
}

function calculateManagedDeposit(leases = [], bills = [], payments = [], houseId = '') {
  const activeLeaseIds = new Set(leases.filter(item => item.status === 'active' && (!houseId || item.houseId === houseId)).map(item => item._id));
  const billMap = Object.fromEntries(bills.map(item => [item._id, item]));
  const depositBillIds = new Set(bills.filter(item => activeLeaseIds.has(item.leaseId) && item.type === 'deposit').map(item => item._id));
  const received = payments.filter(item => activeLeaseIds.has(item.leaseId) && depositBillIds.has(item.billId) && item.direction === 'in' && item.cashImpact !== false && item.paymentMethod !== 'deposit_offset').reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const reduced = payments.filter(item => activeLeaseIds.has(item.leaseId) && (item.paymentMethod === 'deposit_offset' || (item.direction === 'out' && billMap[item.billId] && billMap[item.billId].type === 'deposit_return'))).reduce((sum, item) => sum + Number(item.amount || 0), 0);
  return money(Math.max(0, received - reduced));
}

function inPaymentRange(item, dateStart, dateEnd) {
  const key = dateKey(item.paymentDate || item.createdAt);
  return key && (!dateStart || key >= dateStart) && (!dateEnd || key <= dateEnd);
}

function calculateFinancialAdditions(bills = [], payments = [], leases = [], houseId = '', dateStart = '', dateEnd = '') {
  const billMap = Object.fromEntries(bills.map(item => [item._id, item]));
  const offsets = payments.filter(item => item.paymentMethod === 'deposit_offset' && inPaymentRange(item, dateStart, dateEnd)).reduce((result, item) => {
    const bill = billMap[item.billId];
    if (!bill || (houseId && bill.houseId !== houseId)) return result;
    const key = bill.type === 'rent' ? 'rent' : (bill.type === 'utility' ? 'utility' : 'other');
    result[key] = money(result[key] + Number(item.amount || 0));
    return result;
  }, { rent: 0, utility: 0, other: 0 });
  const settled = payments.filter(item => {
    const bill = billMap[item.billId];
    return bill && (!houseId || bill.houseId === houseId) && item.direction === 'in' && inPaymentRange(item, dateStart, dateEnd);
  }).reduce((result, item) => {
    const type = billMap[item.billId].type;
    if (type === 'rent' || type === 'utility') result[type] = money(result[type] + Number(item.amount || 0));
    return result;
  }, { rent: 0, utility: 0 });
  const rentRefund = money(payments.filter(item => {
    const bill = billMap[item.billId];
    return bill && (!houseId || bill.houseId === houseId) && bill.type === 'rent_refund' && item.direction === 'out' && inPaymentRange(item, dateStart, dateEnd);
  }).reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const terminated = leases.filter(item => item.status === 'terminated' && (!houseId || item.houseId === houseId)).filter(item => {
    const key = dateKey(item.endedAt || item.endDate || item.updatedAt);
    return key && (!dateStart || key >= dateStart) && (!dateEnd || key <= dateEnd);
  });
  const damageSettled = money(terminated.reduce((sum, item) => sum + Number(item.damageAmount || 0), 0));
  const damageDepositDeducted = money(terminated.reduce((sum, item) => sum + Math.min(Number(item.deposit || 0), Math.max(0, Number(item.damageAmount || 0))), 0));
  const rentSettled = money(settled.rent - rentRefund);
  return {
    rentSettled,
    utilitySettled: settled.utility,
    damageSettled,
    operatingSettlementTotal: money(rentSettled + settled.utility + damageSettled),
    damageDepositDeducted,
    depositOffsetRent: offsets.rent,
    depositOffsetUtility: offsets.utility,
    depositOffsetOther: offsets.other
  };
}

Page({
  data: {
    loading: false,
    showFinancialDetail: false,
    showDetailModal: false,
    detailBill: null,
    bills: [], visibleBills: [], allBills: [], allPayments: [], allLeases: [], allHouses: [],
    filters: { type: '', dateStart: '', dateEnd: '' },
    houseFilterId: '', houseFilterLabel: '全部房屋', houseOptions: ['全部房屋'],
    houseCodeSearch: '',
    displayLimitOptions: [10, 20], displayLimit: 10, displayLimitIndex: 0,
    currentPage: 1, totalPages: 1,
    stats: {
      operatingSettlementTotal: 0, managedDeposit: 0,
      rentSettled: 0, utilitySettled: 0, damageSettled: 0,
      cashReceived: 0, rentReceived: 0, utilityReceived: 0, depositReceived: 0,
      damageDepositDeducted: 0, depositOffsetRent: 0, depositOffsetUtility: 0, depositOffsetOther: 0,
      depositRefund: 0, rentRefund: 0, otherRefund: 0, cashRefunded: 0
    }
  },

  onPullDownRefresh() { this.loadAll(true).then(() => wx.stopPullDownRefresh()); },
  onShow() { if (dataRefresh.needsRefresh(this)) this.loadAll(); },

  async loadAll() {
    const housesPromise = this.loadHouses();
    await this.loadBills(housesPromise);
  },

  async loadHouses() {
    try {
      const houses = (await api.getHouses()).data || [];
      this.setData({ allHouses: houses, houseOptions: ['全部房屋'].concat(houses.map(item => `${item.code} - ${item.address}`)) });
      return houses;
    } catch (error) { console.error('加载房屋失败', error); }
  },

  async loadBills(housesPromise) {
    this.setData({ loading: true });
    try {
      const leases = (await api.getLeases()).data || [];
      const leaseMap = Object.fromEntries(leases.map(item => [item._id, item]));
      const houseIds = [...new Set(leases.map(item => item.houseId).filter(Boolean))];
      const tenantIds = [...new Set(leases.map(item => item.tenantId).filter(Boolean))];
      const [houseRes, tenantRes, billRes, paymentRes] = await Promise.all([
        housesPromise ? housesPromise.then(data => ({ data: data || [] })) : api.getHouses(),
        api.getTenants(),
        api.getBills({ leaseIds: leases.map(item => item._id) }),
        api.getPayments({ leaseIds: leases.map(item => item._id) }).catch(() => ({ data: [] }))
      ]);
      const houseData = (houseRes.data || []).filter(item => houseIds.includes(item._id));
      const tenantData = (tenantRes.data || []).filter(item => tenantIds.includes(item._id));
      const houseMap = Object.fromEntries(houseData.filter(Boolean).map(item => [item._id, item]));
      const tenantMap = Object.fromEntries(tenantData.filter(Boolean).map(item => [item._id, item]));
      const payments = paymentRes.data || [];
      const paymentsByBill = payments.reduce((map, item) => {
        if (!map[item.billId]) map[item.billId] = [];
        map[item.billId].push(item);
        return map;
      }, {});
      const allBills = (billRes.data || []).map(bill => {
        const lease = leaseMap[bill.leaseId] || {};
        const house = houseMap[lease.houseId] || {};
        const tenant = tenantMap[lease.tenantId] || {};
        const related = (paymentsByBill[bill._id] || []).slice().sort((a, b) => toTime(b.paymentDate || b.createdAt) - toTime(a.paymentDate || a.createdAt));
        const latest = related[0] || {};
        return {
          ...bill,
          houseId: lease.houseId,
          houseLabel: house.code ? `${house.code} - ${house.address}` : '未关联房屋',
          tenantName: tenant.name || '未关联租客',
          typeText: billTypeText(bill.type),
          statusText: ['deposit_return', 'rent_refund'].includes(bill.type) ? '已退' : '已缴清',
          dueDateStr: api.formatDate(bill.dueDate),
          paymentDateStr: api.formatDate(latest.paymentDate || latest.createdAt),
          paymentMethodText: paymentMethodText(latest.paymentMethod),
          transactionDateLabel: latest.direction === 'out' ? '退款' : (latest.paymentMethod === 'deposit_offset' ? '抵扣' : '收款'),
          utilityDetail: bill.type === 'utility' ? (bill.remark || '') : '',
          relatedPayments: related
        };
      });
      this.setData({ allBills, allPayments: payments, allLeases: leases });
      this.applyFilters();
      await this.loadFinancialSummary();
      dataRefresh.markLoaded(this);
    } catch (error) {
      console.error('加载账单失败', error);
      wx.showToast({ title: '账单加载失败', icon: 'none' });
    } finally { this.setData({ loading: false }); }
  },

  applyFilters() {
    const { type, dateStart, dateEnd } = this.data.filters;
    let bills = this.data.allBills.filter(item => billRemaining(item) <= 0 && Number(item.paidAmount || 0) >= Number(item.amount || 0));
    if (type) bills = bills.filter(item => item.type === type);
    if (this.data.houseFilterId) bills = bills.filter(item => item.houseId === this.data.houseFilterId);
    const keyword = String(this.data.houseCodeSearch || '').trim().toLowerCase();
    if (keyword) {
      bills = bills.filter(item => {
        const house = this.data.allHouses.find(h => h._id === item.houseId);
        return String((house && house.code) || '').toLowerCase().includes(keyword);
      });
    }
    if (dateStart || dateEnd) {
      bills = bills.filter(item => (item.relatedPayments || []).some(payment => {
        const key = dateKey(payment.paymentDate || payment.createdAt);
        return key && (!dateStart || key >= dateStart) && (!dateEnd || key <= dateEnd);
      }));
    }
    bills.sort((a, b) => toTime(b.paymentDateStr || b.dueDate) - toTime(a.paymentDateStr || a.dueDate));
    this.updateVisibleBills(bills, 1);
  },

  async loadFinancialSummary() {
    const { dateStart, dateEnd } = this.data.filters;
    const params = {};
    if (dateStart) params.startDate = dateStart;
    if (dateEnd) params.endDate = dateEnd;
    if (this.data.houseFilterId) params.houseId = this.data.houseFilterId;
    try {
      const report = await api.callRentalDomain('getFinancialReport', params);
      const additions = calculateFinancialAdditions(this.data.allBills, this.data.allPayments, this.data.allLeases, this.data.houseFilterId, dateStart, dateEnd);
      this.setData({ stats: { ...this.data.stats, ...report, ...additions, managedDeposit: calculateManagedDeposit(this.data.allLeases, this.data.allBills, this.data.allPayments, this.data.houseFilterId) } });
    } catch (error) {
      console.error('加载财务汇总失败', error);
      wx.showToast({ title: '财务汇总加载失败', icon: 'none' });
    }
  },

  setFilter(e) {
    const { key, val } = e.currentTarget.dataset;
    this.setData({ filters: { ...this.data.filters, [key]: this.data.filters[key] === val ? '' : val } }, () => { this.applyFilters(); this.loadFinancialSummary(); });
  },

  onHouseFilterChange(e) {
    const index = Number(e.detail.value);
    const house = index > 0 ? this.data.allHouses[index - 1] : null;
    this.setData({ houseFilterId: house ? house._id : '', houseFilterLabel: house ? house.code : '全部房屋' }, () => { this.applyFilters(); this.loadFinancialSummary(); });
  },

  onHouseCodeSearch(e) {
    this.setData({ houseCodeSearch: e.detail.value, currentPage: 1 }, () => this.applyFilters());
  },

  setDate(field, value) {
    const filters = { ...this.data.filters, [field]: value };
    if (filters.dateStart && filters.dateEnd && filters.dateStart > filters.dateEnd) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' }); return;
    }
    this.setData({ filters }, () => { this.applyFilters(); this.loadFinancialSummary(); });
  },
  onDateStartChange(e) { this.setDate('dateStart', e.detail.value); },
  onDateEndChange(e) { this.setDate('dateEnd', e.detail.value); },
  clearDateRange() { this.setData({ filters: { ...this.data.filters, dateStart: '', dateEnd: '' } }, () => { this.applyFilters(); this.loadFinancialSummary(); }); },
  toggleFinancialDetail() { this.setData({ showFinancialDetail: !this.data.showFinancialDetail }); },
  showDetail(e) { this.setData({ detailBill: e.currentTarget.dataset.bill, showDetailModal: true }); },
  closeDetail() { this.setData({ detailBill: null, showDetailModal: false }); },
  stopPropagation() {},

  onDisplayLimitChange(e) {
    const displayLimitIndex = Number(e.detail.value);
    this.setData({ displayLimitIndex, displayLimit: this.data.displayLimitOptions[displayLimitIndex] || 10 }, () => this.applyFilters());
  },
  updateVisibleBills(bills, page) {
    const totalPages = Math.max(1, Math.ceil(bills.length / this.data.displayLimit));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const start = (currentPage - 1) * this.data.displayLimit;
    this.setData({ bills, currentPage, totalPages, visibleBills: bills.slice(start, start + this.data.displayLimit) });
  },
  changePage(e) { this.updateVisibleBills(this.data.bills, this.data.currentPage + Number(e.currentTarget.dataset.direction || 0)); },

  exportCSV() {
    if (!this.data.bills.length) { wx.showToast({ title: '暂无数据可导出', icon: 'none' }); return; }
    const header = '类型,期间,房屋,租客,应收,实收,收款日期,付款方式';
    const rows = this.data.bills.map(item => `${item.typeText},${item.period || ''},${item.houseLabel},${item.tenantName},${item.amount},${item.paidAmount},${item.paymentDateStr},${item.paymentMethodText}`);
    wx.setClipboardData({ data: `${header}\n${rows.join('\n')}`, success() { wx.showToast({ title: '已复制到剪贴板', icon: 'success' }); } });
  }
});
