const api = require('../../services/api');

const PERIOD_OPTIONS = [
  { label: '全部年份', value: 'all' },
  { label: '1年前及更早', value: 'older1' },
  { label: '5年前及更早', value: 'older5' },
  { label: '指定年份', value: 'year' }
];

const STATUS_OPTIONS = [
  { label: '全部合同', value: 'all' },
  { label: '生效中', value: 'active' },
  { label: '历史合同', value: 'terminated' }
];

function toDate(value) {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (value.$date) return new Date(value.$date);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function yearOf(value) {
  const d = toDate(value);
  return d ? d.getFullYear() : null;
}

function money(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function cycleLabel(cycle) {
  return ({ month: '月付', quarter: '季付', half_year: '半年付', year: '年付' })[cycle] || cycle || '';
}

function occupancyText(lease) {
  if (lease.occupancyState === 'continued_without_renewal') return '到期后继续居住';
  if (lease.occupancyState === 'ended') return '已退租';
  return lease.status === 'active' ? '合同期内/无固定期限' : '历史合同';
}

function groupBy(rows, key) {
  return (rows || []).reduce((map, row) => {
    const id = row[key];
    if (!map[id]) map[id] = [];
    map[id].push(row);
    return map;
  }, {});
}

Page({
  data: {
    loading: true,
    deleting: false,
    mode: 'list',
    contract: null,
    leases: [],
    filteredLeases: [],
    periodOptions: PERIOD_OPTIONS.map(o => o.label),
    statusOptions: STATUS_OPTIONS.map(o => o.label),
    periodIndex: 0,
    statusIndex: 0,
    yearInput: '',
    stats: {
      count: 0,
      activeCount: 0,
      historyCount: 0,
      paymentIncome: 0,
      rentIncome: 0,
      utilityIncome: 0,
      lossIncome: 0,
      depositIncome: 0,
      billReceivable: 0,
      billOutstanding: 0
    }
  },

  onLoad(options) {
    const leaseId = options.leaseId;
    const tenantId = options.tenantId;
    if (leaseId) {
      this.setData({ mode: 'detail' });
      this.loadContractByLease(leaseId);
    } else if (tenantId) {
      this.setData({ mode: 'detail' });
      this.loadContractByTenant(tenantId);
    } else {
      this.setData({ mode: 'list' });
      this.loadContractList();
    }
  },

  onPullDownRefresh() {
    if (this.data.mode === 'list') {
      this.loadContractList().finally(() => wx.stopPullDownRefresh());
    } else {
      wx.stopPullDownRefresh();
    }
  },

  async loadContractList() {
    this.setData({ loading: true });
    try {
      const leaseRes = await api.getLeases();
      const leases = leaseRes.data || [];
      const leaseIds = leases.map(l => l._id);

      const [housesRes, tenantsRes, billsRes, paymentsRes] = await Promise.all([
        api.getHouses().catch(() => ({ data: [] })),
        api.getTenants().catch(() => ({ data: [] })),
        leaseIds.length ? api.getBills({ leaseIds }) : Promise.resolve({ data: [] }),
        leaseIds.length ? api.getPayments({ leaseIds }) : Promise.resolve({ data: [] })
      ]);

      const houseMap = {};
      (housesRes.data || []).forEach(h => { houseMap[h._id] = h; });
      const tenantMap = {};
      (tenantsRes.data || []).forEach(t => { tenantMap[t._id] = t; });
      const bills = billsRes.data || [];
      const payments = paymentsRes.data || [];
      const billsByLease = groupBy(bills, 'leaseId');
      const paymentsByLease = groupBy(payments, 'leaseId');
      const billMap = {};
      bills.forEach(b => { billMap[b._id] = b; });

      const enriched = leases.map(lease => {
        const house = houseMap[lease.houseId] || {};
        const tenant = tenantMap[lease.tenantId] || {};
        const leaseBills = billsByLease[lease._id] || [];
        const leasePayments = paymentsByLease[lease._id] || [];
        const income = this.calcIncome(leaseBills, leasePayments, billMap);
        const refundBillTypes = ['deposit_return', 'rent_refund'];
        const billReceivable = money(leaseBills
          .filter(b => refundBillTypes.indexOf(b.type) < 0)
          .reduce((sum, b) => sum + Number(b.amount || 0), 0));
        const billOutstanding = money(leaseBills
          .filter(b => refundBillTypes.indexOf(b.type) < 0 && b.status !== 'paid')
          .reduce((sum, b) => sum + Math.max(0, Number(b.amount || 0) - Number(b.paidAmount || 0)), 0));
        const basisDate = lease.endDate || lease.startDate || lease.createdAt;
        return {
          ...lease,
          houseCode: house.code || '',
          houseAddress: house.address || '',
          tenantName: tenant.name || '',
          statusText: lease.status === 'active' ? (lease.occupancyState === 'continued_without_renewal' ? '续住中' : '生效中') : '历史合同',
          occupancyText: occupancyText(lease),
          documentPeriodText: lease.documentStartDate ? `${api.formatDate(lease.documentStartDate)} 至 ${lease.documentEndDate ? api.formatDate(lease.documentEndDate) : '未约定'}` : '',
          paymentCycleText: cycleLabel(lease.paymentCycle),
          startDateText: api.formatDate(lease.startDate),
          endDateText: lease.endDate ? api.formatDate(lease.endDate) : '至今',
          contractYear: yearOf(basisDate),
          billCount: leaseBills.length,
          paymentCount: leasePayments.length,
          billReceivable,
          billOutstanding,
          ...income,
          lossIncome: money(Number(lease.damageAmount || 0)),
          paymentIncome: money(income.rentIncome + income.utilityIncome + Number(lease.damageAmount || 0) + income.otherIncome)
        };
      });

      this.setData({ leases: enriched });
      this.applyFilters();
    } catch (e) {
      console.error('加载合同列表失败', e);
      wx.showToast({ title: e.message || '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  calcIncome(leaseBills, leasePayments, billMap) {
    const incomeTypes = ['rent', 'utility', 'extra_due', 'other'];
    const refundTypes = ['rent_refund', 'deposit_return'];
    const total = { paymentIncome: 0, rentIncome: 0, utilityIncome: 0, lossIncome: 0, otherIncome: 0, depositIncome: 0, refundAmount: 0 };
    (leasePayments || []).forEach(payment => {
      const amount = Number(payment.amount || 0);
      const bill = billMap[payment.billId] || {};
      const direction = payment.direction || (refundTypes.indexOf(bill.type) >= 0 ? 'out' : 'in');
      // 押金抵扣不产生新的现金流，但会结清对应经营账单。
      if (payment.paymentMethod === 'deposit_offset') {
        total.depositIncome -= amount;
        if (bill.type === 'rent') total.rentIncome += amount;
        else if (bill.type === 'utility') total.utilityIncome += amount;
        else if (bill.type === 'extra_due') total.lossIncome += amount;
        else if (bill.type === 'other') total.otherIncome += amount;
        return;
      }
      if (bill.type === 'deposit') {
        const signed = direction === 'out' ? -amount : amount;
        total.depositIncome += signed;
        return;
      }
      if (bill.type === 'deposit_return') {
        total.depositIncome -= amount;
        total.refundAmount += amount;
        return;
      }
      if (bill.type === 'rent_refund') {
        total.paymentIncome -= amount;
        total.rentIncome -= amount;
        total.refundAmount += amount;
        return;
      }
      if (incomeTypes.indexOf(bill.type) < 0) return;
      const signedAmount = direction === 'out' ? -amount : amount;
      total.paymentIncome += signedAmount;
      if (bill.type === 'rent') total.rentIncome += signedAmount;
      else if (bill.type === 'utility') total.utilityIncome += signedAmount;
      else if (bill.type === 'extra_due') total.lossIncome += signedAmount;
      else if (bill.type === 'other') total.otherIncome += signedAmount;
    });
    total.paymentIncome = total.rentIncome + total.utilityIncome + total.lossIncome + total.otherIncome;
    return {
      paymentIncome: money(total.paymentIncome),
      rentIncome: money(total.rentIncome),
      utilityIncome: money(total.utilityIncome),
      lossIncome: money(total.lossIncome),
      otherIncome: money(total.otherIncome),
      depositIncome: money(total.depositIncome),
      refundAmount: money(total.refundAmount)
    };
  },

  applyFilters() {
    const currentYear = new Date().getFullYear();
    const period = PERIOD_OPTIONS[this.data.periodIndex].value;
    const status = STATUS_OPTIONS[this.data.statusIndex].value;
    const year = Number(this.data.yearInput);

    let rows = this.data.leases.slice();
    if (status !== 'all') rows = rows.filter(l => l.status === status);
    if (period === 'older1') rows = rows.filter(l => l.contractYear && l.contractYear <= currentYear - 1);
    if (period === 'older5') rows = rows.filter(l => l.contractYear && l.contractYear <= currentYear - 5);
    if (period === 'year' && year) rows = rows.filter(l => l.contractYear === year);

    const stats = rows.reduce((s, l) => ({
      count: s.count + 1,
      activeCount: s.activeCount + (l.status === 'active' ? 1 : 0),
      historyCount: s.historyCount + (l.status === 'terminated' ? 1 : 0),
      paymentIncome: money(s.paymentIncome + l.paymentIncome),
      rentIncome: money(s.rentIncome + l.rentIncome),
      utilityIncome: money(s.utilityIncome + l.utilityIncome),
      lossIncome: money(s.lossIncome + l.lossIncome),
      depositIncome: money(s.depositIncome + l.depositIncome),
      refundAmount: money(s.refundAmount + l.refundAmount),
      billReceivable: money(s.billReceivable + l.billReceivable),
      billOutstanding: money(s.billOutstanding + l.billOutstanding)
    }), {
      count: 0,
      activeCount: 0,
      historyCount: 0,
      paymentIncome: 0,
      rentIncome: 0,
      utilityIncome: 0,
      lossIncome: 0,
      depositIncome: 0,
      refundAmount: 0,
      billReceivable: 0,
      billOutstanding: 0
    });

    this.setData({ filteredLeases: rows, stats });
  },

  onPeriodChange(e) {
    this.setData({ periodIndex: Number(e.detail.value) });
    this.applyFilters();
  },

  onStatusChange(e) {
    this.setData({ statusIndex: Number(e.detail.value) });
    this.applyFilters();
  },

  onYearInput(e) {
    this.setData({ yearInput: e.detail.value });
    this.applyFilters();
  },

  viewContract(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/contract/index?leaseId=${id}` });
  },

  goToHistoricalImport() {
    wx.navigateTo({ url: '/pages/historical-contract-ocr/index' });
  },

  deleteContract(e) {
    const id = e.currentTarget.dataset.id || (this.data.contract && this.data.contract.id);
    if (!id || this.data.deleting) return;
    wx.showModal({
      title: '删除合同',
      content: '删除后会同时删除该合同对应的账单、流水和水电记录，不可恢复。确定删除吗？',
      confirmText: '删除',
      confirmColor: '#DC2626',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ deleting: true });
        try {
          await api.deleteLease(id);
          wx.showToast({ title: '已删除', icon: 'success' });
          if (this.data.mode === 'list') {
            await this.loadContractList();
          } else {
            setTimeout(() => wx.navigateBack(), 600);
          }
        } catch (err) {
          console.error('删除合同失败', err);
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        } finally {
          this.setData({ deleting: false });
        }
      }
    });
  },

  async loadContractByLease(leaseId) {
    this.setData({ loading: true });
    try {
      const lease = await api.getLeaseById(leaseId);
      if (!lease) { this.setData({ loading: false }); return; }

      const [house, tenant, billsRes, paymentsRes] = await Promise.all([
        api.getHouseById(lease.houseId).catch(() => null),
        api.getTenantById(lease.tenantId).catch(() => null),
        api.getBills({ leaseId }).catch(() => ({ data: [] })),
        api.getPayments({ leaseId }).catch(() => ({ data: [] }))
      ]);
      const bills = billsRes.data || [];
      const payments = paymentsRes.data || [];
      const billMap = {};
      bills.forEach(b => { billMap[b._id] = b; });
      const income = this.calcIncome(bills, payments, billMap);

      const cycle = lease.paymentCycle || 'month';
      const cycleMonths = { month: 1, quarter: 3, half_year: 6, year: 12 };
      const paymentMonths = cycleMonths[cycle] || 1;
      const monthlyRent = lease.rent || 0;
      const paymentAmount = monthlyRent * paymentMonths;
      const deposit = lease.deposit || 0;
      const startDate = toDate(lease.startDate) || new Date();

      const contract = {
        id: leaseId,
        contractNo: `HT-${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, '0')}${String(startDate.getDate()).padStart(2, '0')}-${leaseId.substring(0, 6)}`,
        signDate: startDate.toLocaleDateString('zh-CN'),
        statusText: lease.status === 'active' ? (lease.occupancyState === 'continued_without_renewal' ? '续住中' : '生效中') : '历史合同',
        occupancyText: occupancyText(lease),
        houseCode: house?.code || '未知',
        houseAddress: house?.address || '未知',
        moveInDate: api.formatDate(lease.startDate),
        endDate: lease.endDate ? api.formatDate(lease.endDate) : '至今',
        documentPeriod: lease.documentStartDate ? `${api.formatDate(lease.documentStartDate)} 至 ${lease.documentEndDate ? api.formatDate(lease.documentEndDate) : '未约定'}` : '',
        rentCoveredUntil: lease.rentCoveredUntil ? api.formatDate(lease.rentCoveredUntil) : '未确认',
        nextRentDueDate: lease.nextRentDueDate ? api.formatDate(lease.nextRentDueDate) : '未生成',
        monthlyRent,
        paymentCycleLabel: cycleLabel(cycle),
        paymentMonths,
        paymentAmount,
        deposit,
        firstPaymentTotal: deposit + paymentAmount,
        damageAmount: Number(lease.damageAmount || 0),
        tenant: {
          name: tenant?.name || '未知',
          idCard: tenant?.idCard || '未填写',
          phone: tenant?.phone || '未填写'
        },
        bills,
        payments,
        billCount: bills.length,
        paymentCount: payments.length,
        ...income,
        lossIncome: money(Number(lease.damageAmount || 0)),
        paymentIncome: money(income.rentIncome + income.utilityIncome + Number(lease.damageAmount || 0) + income.otherIncome)
      };

      this.setData({ contract });
    } catch (e) {
      console.error('加载合同信息失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadContractByTenant(tenantId) {
    this.setData({ loading: true });
    try {
      const leaseRes = await api.getLeases({ tenantId });
      const leases = leaseRes.data || [];
      if (leases.length === 0) {
        this.setData({ loading: false });
        return;
      }
      const active = leases.find(l => l.status === 'active');
      const lease = active || leases[0];
      await this.loadContractByLease(lease._id);
    } catch (e) {
      console.error('加载合同失败', e);
      this.setData({ loading: false });
    }
  }
});
