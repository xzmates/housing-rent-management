const api = require('../../services/api');
const dataRefresh = require('../../utils/data-refresh');
const { billTypeText } = require('../../utils/billing-labels');

function toTime(value) {
  if (!value) return 0;
  const raw = value.$date || value;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? 0 : date.getTime();
}

function dateKey(value) {
  const time = toTime(value);
  if (!time) return '';
  const date = new Date(time);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
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
  if (status === 'paid') return '已缴清';
  const due = toTime(bill.dueDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (due) {
    const dueDay = new Date(due);
    dueDay.setHours(0, 0, 0, 0);
    const days = Math.floor((today.getTime() - dueDay.getTime()) / 86400000);
    if (days > 0) return `已逾期${days}天`;
    if (days === 0) return '今天应收';
  }
  return `还待收¥${billRemaining(bill)}`;
}

function calculateManagedDeposit(leases = [], bills = [], payments = [], houseId = '') {
  const activeLeases = leases.filter(item => item.status === 'active' && (!houseId || item.houseId === houseId));
  const activeLeaseIds = new Set(activeLeases.map(item => item._id));
  const billMap = Object.fromEntries(bills.map(item => [item._id, item]));
  const depositBillIds = new Set(bills.filter(item => activeLeaseIds.has(item.leaseId) && item.type === 'deposit').map(item => item._id));
  const incoming = payments.filter(item => activeLeaseIds.has(item.leaseId) && depositBillIds.has(item.billId) && item.direction === 'in' && item.cashImpact !== false && item.paymentMethod !== 'deposit_offset');
  const reductions = payments.filter(item => activeLeaseIds.has(item.leaseId) && (
    item.paymentMethod === 'deposit_offset' ||
    (item.direction === 'out' && billMap[item.billId] && billMap[item.billId].type === 'deposit_return')
  ));
  const received = money(incoming.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const reduced = money(reductions.reduce((sum, item) => sum + Number(item.amount || 0), 0));
  return {
    managedDeposit: money(Math.max(0, received - reduced)),
    managedDepositEvidence: received > 0 ? 'direct' : 'not_applicable'
  };
}

function calculateDamageDepositDeduction(leases = [], houseId = '', dateStart = '', dateEnd = '') {
  return money(leases
    .filter(item => item.status === 'terminated' && (!houseId || item.houseId === houseId))
    .filter(item => {
      const key = dateKey(item.endedAt || item.endDate || item.updatedAt);
      return key && (!dateStart || key >= dateStart) && (!dateEnd || key <= dateEnd);
    })
    .reduce((sum, item) => sum + Math.min(Number(item.deposit || 0), Math.max(0, Number(item.damageAmount || 0))), 0));
}

function calculateDepositOffsetBreakdown(bills = [], payments = [], houseId = '', dateStart = '', dateEnd = '') {
  const billMap = Object.fromEntries(bills.map(item => [item._id, item]));
  const inRange = item => {
    const key = dateKey(item.paymentDate || item.createdAt);
    return key && (!dateStart || key >= dateStart) && (!dateEnd || key <= dateEnd);
  };
  return payments
    .filter(item => item.paymentMethod === 'deposit_offset' && inRange(item))
    .reduce((totals, item) => {
      const bill = billMap[item.billId];
      if (!bill || (houseId && bill.houseId !== houseId)) return totals;
      const type = bill.type === 'rent' ? 'rent' : (bill.type === 'utility' ? 'utility' : 'other');
      totals[type] = money(Number(totals[type] || 0) + Number(item.amount || 0));
      return totals;
    }, { rent: 0, utility: 0, other: 0 });
}

function calculateOperatingSettlement(bills = [], payments = [], leases = [], houseId = '', dateStart = '', dateEnd = '') {
  const billMap = Object.fromEntries(bills.map(item => [item._id, item]));
  const inRange = item => {
    const key = dateKey(item.paymentDate || item.createdAt);
    return key && (!dateStart || key >= dateStart) && (!dateEnd || key <= dateEnd);
  };
  const settledByType = payments
    .filter(item => {
      const bill = billMap[item.billId];
      return bill && (!houseId || bill.houseId === houseId) && item.direction === 'in' && inRange(item);
    })
    .reduce((totals, item) => {
      const type = billMap[item.billId] && billMap[item.billId].type;
      if (type === 'rent' || type === 'utility') totals[type] = money(Number(totals[type] || 0) + Number(item.amount || 0));
      return totals;
    }, { rent: 0, utility: 0 });
  const rentRefunded = money(payments
    .filter(item => {
      const bill = billMap[item.billId];
      return bill && (!houseId || bill.houseId === houseId) && bill.type === 'rent_refund' && item.direction === 'out' && inRange(item);
    })
    .reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const netRentSettled = money(settledByType.rent - rentRefunded);
  const damage = money(leases
    .filter(item => item.status === 'terminated' && (!houseId || item.houseId === houseId))
    .filter(item => {
      const key = dateKey(item.endedAt || item.endDate || item.updatedAt);
      return key && (!dateStart || key >= dateStart) && (!dateEnd || key <= dateEnd);
    })
    .reduce((sum, item) => sum + Number(item.damageAmount || 0), 0));
  return {
    rentSettled: netRentSettled,
    utilitySettled: settledByType.utility,
    damageSettled: damage,
    operatingSettlementTotal: money(netRentSettled + settledByType.utility + damage)
  };
}

Page({
  data: {
    loading: false, paying: false,
    showPayModal: false, showDetailModal: false,
    showFinancialDetail: false,
    detailBill: null,
    bills: [], visibleBills: [], allBills: [], allPayments: [],
    allHouses: [], allLeases: [],
    filters: { status: '', type: '', dateStart: '', dateEnd: '' },
    collectionTab: 'overdue',
    overdueCount: 0,
    pendingCount: 0,
    overdueAmount: 0,
    pendingAmount: 0,
    houseFilterId: '',
    houseFilterLabel: '全部房屋',
    houseCodeSearch: '',
    houseOptions: ['全部房屋'],
    displayLimitOptions: [10, 20],
    displayLimit: 10,
    displayLimitIndex: 0,
    currentPage: 1,
    totalPages: 1,
    stats: {
      cashReceived: 0, rentReceived: 0, utilityReceived: 0, depositReceived: 0, settlementReceived: 0, otherReceived: 0,
      cashRefunded: 0, depositRefund: 0, rentRefund: 0, otherRefund: 0,
      currentReceivableAmount: 0, currentReceivableCount: 0, overdueAmount: 0, overdueCount: 0, upcomingAmount: 0, undatedOutstandingAmount: 0,
      operatingReceived: 0, rentSettled: 0, utilitySettled: 0, damageSettled: 0, operatingSettlementTotal: 0,
      damageDepositDeducted: 0, depositOffsetRent: 0, depositOffsetUtility: 0, depositOffsetOther: 0,
      managedDeposit: 0, managedDepositEvidence: 'not_applicable'
    },
    // 缴费弹窗
    payBillId: '',
    payTargetBillId: '',
    payBillIds: [],
    payGroupInfo: null,
    payBillDetails: [],
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

  onPullDownRefresh() { this.loadAll(true).then(() => wx.stopPullDownRefresh()); },
  onShow() { if (dataRefresh.needsRefresh(this)) this.loadAll(); },

  async loadAll() {
    const housesPromise = this.loadHouses();
    await this.loadBills(housesPromise);
    this.openDashboardSelectedBills();
  },

  openDashboardSelectedBills() {
    const billIds = wx.getStorageSync('dashboardPayBillIds') || [];
    if (!Array.isArray(billIds) || !billIds.length) return;
    wx.removeStorageSync('dashboardPayBillIds');
    const bills = (this.data.allBills || []).filter(item => billIds.includes(item._id) && billRemaining(item) > 0 && item.status !== 'paid');
    if (!bills.length) {
      wx.showToast({ title: '该待收账单已结清，请刷新首页', icon: 'none' });
      return;
    }
    const firstBill = bills[0];
    const due = toTime(firstBill && firstBill.dueDate);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const dueDay = due ? new Date(due) : null;
    if (dueDay) dueDay.setHours(0, 0, 0, 0);
    this.setData({ collectionTab: dueDay && dueDay < today ? 'overdue' : 'pending' });
    this.openPayBills(bills);
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
      return houses;
    } catch (e) { console.error(e); }
  },

  async loadBills(housesPromise) {
    this.setData({ loading: true });
    try {
      // 获取所有合同，包含已退租合同，确保历史缴费记录仍可查看
      const leaseRes = await api.getLeases();
      const leases = leaseRes.data || [];
      this.setData({ allLeases: leases });

      const leaseIds = leases.map(l => l._id);
      if (leaseIds.length === 0) {
        this.updateVisibleBills([], 1, { allBills: [] });
        await this.loadFinancialSummary();
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

      // 一次读取房屋和租客，避免按合同逐条查询。
      const [houseRes, tenantRes] = await Promise.all([
        housesPromise ? housesPromise.then(data => ({ data: data || [] })) : api.getHouses(),
        api.getTenants()
      ]);
      const houseData = (houseRes.data || []).filter(item => houseIds.has(item._id));
      const tenantData = (tenantRes.data || []).filter(item => tenantIds.has(item._id));
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
          typeText: billTypeText(bill.type),
          statusText: billStatusText(normalized),
          dueDateStr: api.formatDate(bill.dueDate),
          billDateText: bill.type === 'utility'
            ? (api.formatDate(bill.period || bill.meterReadingDate || bill.readingDate || bill.createdAt) || '日期未记录')
            : (bill.period || ''),
          utilityDetail: bill.type === 'utility' ? (bill.remark || '') : ''
        };
      });
      this.setData({ allBills, allPayments: paymentsRes.data || [] }, () => this.applyCollectionFilters());
      dataRefresh.markLoaded(this);
    } catch (e) {
      console.error('加载账单失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadFinancialSummary() {
    const { dateStart, dateEnd } = this.data.filters || {};
    const params = {};
    if (dateStart) params.startDate = dateStart;
    if (dateEnd) params.endDate = dateEnd;
    if (this.data.houseFilterId) params.houseId = this.data.houseFilterId;
    try {
      const report = await api.callRentalDomain('getFinancialReport', params);
      const depositStats = calculateManagedDeposit(this.data.allLeases, this.data.allBills, this.data.allPayments, this.data.houseFilterId);
      const operatingReceived = money(Number(report.rentReceived || 0) + Number(report.utilityReceived || 0) + Number(report.settlementReceived || 0) + Number(report.otherReceived || 0));
      const damageDepositDeducted = calculateDamageDepositDeduction(this.data.allLeases, this.data.houseFilterId, dateStart, dateEnd);
      const depositOffsetBreakdown = calculateDepositOffsetBreakdown(this.data.allBills, this.data.allPayments, this.data.houseFilterId, dateStart, dateEnd);
      const settlementStats = calculateOperatingSettlement(this.data.allBills, this.data.allPayments, this.data.allLeases, this.data.houseFilterId, dateStart, dateEnd);
      this.setData({
        stats: {
          ...report,
          ...depositStats,
          ...settlementStats,
          operatingReceived,
          damageDepositDeducted,
          depositOffsetRent: depositOffsetBreakdown.rent,
          depositOffsetUtility: depositOffsetBreakdown.utility,
          depositOffsetOther: depositOffsetBreakdown.other
        }
      });
    } catch (e) {
      console.error('加载收付款汇总失败', e);
      wx.showToast({ title: '收付款汇总加载失败', icon: 'none' });
    }
  },

  _calcStats(allBills) {
    // 资金汇总必须来自 rentalDomain；这里仅保留在测试或旧调用方直接触发时的
    // 在管押金必须有押金收款流水佐证；缺少流水时只可作为合同约定额显示。
    const activeLeases = (this.data.allLeases || [])
      .filter(l => l.status === 'active')
      .filter(l => !this.data.houseFilterId || l.houseId === this.data.houseFilterId);
    this.setData({
      stats: {
        ...this.data.stats,
        ...calculateManagedDeposit(activeLeases, this.data.allBills, this.data.allPayments, this.data.houseFilterId)
      }
    });
  },

  applyCollectionFilters() {
    let bills = (this.data.allBills || []).filter(b => billRemaining(b) > 0 && b.status !== 'paid');
    const { type } = this.data.filters;
    if (type) bills = bills.filter(b => b.type === type);
    if (this.data.houseFilterId) bills = bills.filter(b => b.houseId === this.data.houseFilterId);
    const keyword = String(this.data.houseCodeSearch || '').trim().toLowerCase();
    if (keyword) {
      bills = bills.filter(b => {
        const house = (this.data.allHouses || []).find(item => item._id === b.houseId);
        return String((house && house.code) || '').toLowerCase().includes(keyword);
      });
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdueBills = bills.filter(item => {
      const due = toTime(item.dueDate);
      if (!due) return false;
      const dueDay = new Date(due); dueDay.setHours(0, 0, 0, 0);
      return dueDay < today;
    });
    const pendingBills = bills.filter(item => !overdueBills.includes(item));
    const overdueAmount = money(overdueBills.reduce((sum, item) => sum + billRemaining(item), 0));
    const pendingAmount = money(pendingBills.reduce((sum, item) => sum + billRemaining(item), 0));
    let collectionTab = this.data.collectionTab;
    if (!overdueBills.length && collectionTab === 'overdue') collectionTab = 'pending';
    bills = collectionTab === 'overdue' ? overdueBills : pendingBills;
    bills.sort((a, b) => (toTime(a.dueDate) || Infinity) - (toTime(b.dueDate) || Infinity));
    this.updateVisibleBills(bills, 1, { collectionTab, overdueCount: overdueBills.length, pendingCount: pendingBills.length, overdueAmount, pendingAmount });
  },

  onHouseCodeSearch(e) {
    this.setData({ houseCodeSearch: e.detail.value, currentPage: 1 }, () => this.applyCollectionFilters());
  },

  setFilter(e) {
    const { key, val } = e.currentTarget.dataset;
    const filters = { ...this.data.filters };
    filters[key] = filters[key] === val ? '' : val;
    this.setData({ filters, currentPage: 1 }, () => this.applyCollectionFilters());
  },

  setCollectionTab(e) {
    const collectionTab = e.currentTarget.dataset.tab;
    if (!collectionTab || collectionTab === this.data.collectionTab) return;
    this.setData({ collectionTab, currentPage: 1 }, () => this.applyCollectionFilters());
  },

  filterBillsByDateRange(bills = []) {
    const { dateStart = '', dateEnd = '' } = this.data.filters || {};
    if (!dateStart && !dateEnd) return bills;
    const paymentsByBillId = (this.data.allPayments || []).reduce((map, payment) => {
      if (!payment.billId) return map;
      if (!map[payment.billId]) map[payment.billId] = [];
      map[payment.billId].push(payment);
      return map;
    }, {});
    return bills.filter(bill => {
      const relatedPayments = paymentsByBillId[bill._id] || [];
      if (relatedPayments.length) {
        return relatedPayments.some(payment => {
          const key = dateKey(payment.paymentDate || payment.createdAt);
          return key && (!dateStart || key >= dateStart) && (!dateEnd || key <= dateEnd);
        });
      }
      const key = dateKey(bill.dueDate);
      return key && (!dateStart || key >= dateStart) && (!dateEnd || key <= dateEnd);
    });
  },

  onDateStartChange(e) {
    const dateStart = e.detail.value;
    const { dateEnd = '' } = this.data.filters || {};
    if (dateEnd && dateStart > dateEnd) {
      wx.showToast({ title: '开始日期不能晚于结束日期', icon: 'none' });
      return;
    }
    this.setData({ filters: { ...this.data.filters, dateStart }, currentPage: 1 }, () => this.loadBills());
  },

  onDateEndChange(e) {
    const dateEnd = e.detail.value;
    const { dateStart = '' } = this.data.filters || {};
    if (dateStart && dateEnd < dateStart) {
      wx.showToast({ title: '结束日期不能早于开始日期', icon: 'none' });
      return;
    }
    this.setData({ filters: { ...this.data.filters, dateEnd }, currentPage: 1 }, () => this.loadBills());
  },

  clearDateRange() {
    this.setData({ filters: { ...this.data.filters, dateStart: '', dateEnd: '' }, currentPage: 1 }, () => this.loadBills());
  },

  onDisplayLimitChange(e) {
    const displayLimitIndex = Number(e.detail.value);
    const displayLimit = this.data.displayLimitOptions[displayLimitIndex] || 10;
    this.updateVisibleBills(this.data.bills || [], 1, { displayLimit, displayLimitIndex });
  },

  updateVisibleBills(bills = [], page = 1, extraData = {}) {
    const displayLimit = extraData.displayLimit || this.data.displayLimit || 10;
    const totalPages = Math.max(1, Math.ceil(bills.length / displayLimit));
    const currentPage = Math.min(Math.max(1, page), totalPages);
    const start = (currentPage - 1) * displayLimit;
    this.setData({
      ...extraData,
      bills,
      currentPage,
      totalPages,
      visibleBills: bills.slice(start, start + displayLimit)
    });
  },

  changePage(e) {
    const direction = Number(e.currentTarget.dataset.direction || 0);
    this.updateVisibleBills(this.data.bills || [], this.data.currentPage + direction);
  },

  toggleFinancialDetail() {
    this.setData({ showFinancialDetail: !this.data.showFinancialDetail });
  },

  onHouseFilterChange(e) {
    const idx = Number(e.detail.value);
    if (idx === 0) {
      this.setData({ houseFilterId: '', houseFilterLabel: '全部房屋', currentPage: 1 }, () => this.applyCollectionFilters());
    } else {
      const house = this.data.allHouses[idx - 1];
      if (!house) {
        this.setData({ houseFilterId: '', houseFilterLabel: '全部房屋', currentPage: 1 }, () => this.applyCollectionFilters());
        return;
      }
      this.setData({ houseFilterId: house._id, houseFilterLabel: house.code, currentPage: 1 }, () => this.applyCollectionFilters());
    }
  },

  // 缴费弹窗
  showPayModal(e) {
    const bill = e.currentTarget.dataset.bill;
    this.openPayBills([bill]);
  },

  openPayBills(bills = []) {
    const openBills = bills.filter(item => item && billRemaining(item) > 0 && item.status !== 'paid')
      .sort((a, b) => rentCoverageStartTime(a) - rentCoverageStartTime(b));
    if (!openBills.length) return;
    const totalAmount = money(openBills.reduce((sum, item) => sum + billRemaining(item), 0));
    const isBatch = openBills.length > 1;
    const bill = openBills[0];
    const warning = this.buildRentGapWarning(bill);
    this.setData({
      showPayModal: true,
      payBillId: bill._id,
      payTargetBillId: bill._id,
      payBillIds: openBills.map(item => item._id),
      payAmount: totalAmount,
      payMethod: 'cash',
      payDate: new Date().toISOString().slice(0, 10),
      payBillInfo: bill,
      payGroupInfo: isBatch ? {
        count: openBills.length,
        totalAmount,
        typeText: bill.typeText,
        periodText: openBills.map(item => item.period || item.dueDateStr || '未标注日期').join('、')
      } : null,
      payBillDetails: openBills.map(item => ({
        id: item._id,
        typeText: item.typeText,
        billDateText: item.billDateText || item.period || '日期未记录',
        houseLabel: item.houseLabel || '未关联房屋',
        tenantName: item.tenantName || '未关联租客',
        dueDateStr: item.dueDateStr || '未标到期日',
        amount: item.amount,
        remaining: billRemaining(item),
        utilityDetail: item.utilityDetail || ''
      })),
      // 已选中同一待收分组的全部租金账单，按最早账期分配，不需要逐笔跳转确认。
      rentGapWarning: isBatch ? null : warning,
      rentGapConfirmed: isBatch || !warning
    });
  },

  closePay() { this.setData({ showPayModal: false, rentGapWarning: null, rentGapConfirmed: false, payBillIds: [], payGroupInfo: null, payBillDetails: [] }); },
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
    const { payBillId, payBillIds, payAmount, payDate, payMethod, rentGapWarning, rentGapConfirmed } = this.data;
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
      const batch = (payBillIds || []).filter(Boolean);
      const result = batch.length > 1
        ? await api.payBillBatch(batch, payAmount, payDate, payMethod)
        : await api.payBill(payBillId, payAmount, payDate, payMethod);
      wx.showToast({ title: batch.length > 1 ? `已处理${result.settledCount || batch.length}笔账单` : '缴费成功', icon: 'success' });
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
