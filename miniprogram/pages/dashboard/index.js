const api = require('../../services/api');

const DAY = 1000 * 60 * 60 * 24;

function toDate(value) {
  if (!value) return null;
  if (value.$date) return new Date(value.$date);
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

function startOfDay(value) {
  const d = toDate(value);
  if (!d) return null;
  d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(value) {
  const d = startOfDay(value);
  if (!d) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function money(value) {
  const n = Number(value || 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function billRemaining(bill = {}) {
  return money(Math.max(0, Number(bill.amount || 0) - Number(bill.paidAmount || 0)));
}

function isBillPaid(bill = {}) {
  return billRemaining(bill) <= 0 && Number(bill.paidAmount || 0) >= Number(bill.amount || 0);
}

Page({
  data: {
    loading: true,
    stats: {
      houses: 0, activeLeases: 0, cashReceived: 0,
      tenants: 0, activeTenants: 0,
      currentReceivableAmount: 0, overdueAmount: 0, futureRentReminderAmount: 0, managedDeposit: 0,
      rentReceived: 0, utilityReceived: 0, depositReceived: 0,
      settlementReceived: 0, cashRefunded: 0
    },
    overdueBills: [],
    upcomingBills: [],
    visibleReminderBills: [],
    reminderSummary: { count: 0, currentCount: 0, futureCount: 0 },
    contractRentReminders: [],
    receivableGroups: [],
    recentActivities: []
  },

  onLoad() { this.loadAll(); },
  onPullDownRefresh() { this.loadAll().then(() => wx.stopPullDownRefresh()); },
  onShow() { this.loadAll(); },

  async loadAll() {
    this.setData({ loading: true });
    try {
      await this.loadStats();
    } catch (e) {
      console.error('加载仪表盘失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadStats() {
    try {
      const data = await api.callRentalDomain('getOperatingOverview');
      this.setData({
        stats: {
          houses: data.houseCount || 0,
          activeLeases: data.activeLeaseCount || 0,
          tenants: data.tenantCount || 0,
          activeTenants: data.activeTenantCount || 0,
          cashReceived: data.monthCashReceived || 0,
          currentReceivableAmount: data.currentReceivableAmount || data.unpaidAmount || 0,
          overdueAmount: data.overdueAmount || data.currentArrearsAmount || 0,
          futureRentReminderAmount: data.futureRentReminderAmount || 0,
          managedDeposit: data.managedDeposit || 0,
          rentReceived: data.monthRentReceived || 0,
          utilityReceived: data.monthUtilityReceived || 0,
          depositReceived: data.monthDepositReceived || 0,
          settlementReceived: data.monthSettlementReceived || 0,
          cashRefunded: data.monthCashRefunded || 0
        },
        contractRentReminders: data.futureRentReminders || [],
        receivableGroups: data.currentReceivableGroups || []
      });
    } catch (e) {
      console.error('加载统计失败', e);
    }
  },

  async loadBills() {
    try {
      const [leaseRes, billsRes] = await Promise.all([
        api.getLeases({ status: 'active' }),
        api.getBills()
      ]);

      const leases = leaseRes.data || [];
      const leaseMap = {};
      const houseIds = new Set();
      const tenantIds = new Set();
      leases.forEach(l => {
        leaseMap[l._id] = l;
        houseIds.add(l.houseId);
        tenantIds.add(l.tenantId);
      });

      const [houseData, tenantData] = await Promise.all([
        Promise.all([...houseIds].map(id => api.getHouseById(id).catch(() => null))),
        Promise.all([...tenantIds].map(id => api.getTenantById(id).catch(() => null)))
      ]);
      const houseMap = {};
      houseData.forEach(h => { if (h) houseMap[h._id] = h; });
      const tenantMap = {};
      tenantData.forEach(t => { if (t) tenantMap[t._id] = t; });

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const currentReceivableBills = (billsRes.data || [])
        .filter(b => !isBillPaid(b) && ['unpaid', 'partial'].includes(b.status || 'unpaid'))
        .map(b => {
          const lease = leaseMap[b.leaseId] || {};
          const house = houseMap[lease.houseId] || {};
          const tenant = tenantMap[lease.tenantId] || {};
          const dueDate = startOfDay(b.dueDate);
          const daysUntilDue = dueDate ? Math.ceil((dueDate.getTime() - today.getTime()) / DAY) : 0;
          const isOverdue = dueDate && dueDate < today;
          const isToday = dueDate && dueDate.getTime() === today.getTime();
          return {
            ...b,
            reminderKind: 'bill',
            billId: b._id,
            houseCode: house.code || '',
            houseAddress: house.address || '',
            tenantName: tenant.name || '',
            dueDateStr: api.formatDate(b.dueDate),
            remaining: billRemaining(b),
            daysUntilDue,
            isOverdue,
            statusText: isOverdue ? `已逾期${Math.abs(daysUntilDue)}天` : isToday ? '今日应收' : dueDate ? `账单已生成 · ${daysUntilDue}天后到期` : '账单已生成 · 未标到期日',
            statusClass: isOverdue ? 'status-red' : isToday ? 'status-orange' : 'status-blue'
          };
        });

      // 合同预计提醒由 rentalDomain 权威生成：仅有效合同、未来 15 天、且没有对应未结清租金账单。
      const leaseReminders = (this.data.contractRentReminders || []).map(item => ({
        ...item,
        _id: item.id,
        dueDateStr: api.formatDate(item.dueDate),
        remaining: Number(item.expectedAmount || 0),
        isOverdue: false
      }));
      const reminderBills = currentReceivableBills.concat(leaseReminders)
        .sort((a, b) => {
          if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
          if (a.daysUntilDue !== b.daysUntilDue) return a.daysUntilDue - b.daysUntilDue;
          return String(a.houseCode || '').localeCompare(String(b.houseCode || ''), 'zh-CN', { numeric: true });
        });

      const overdueBills = currentReceivableBills.filter(b => b.isOverdue);
      const upcomingBills = reminderBills.filter(b => !b.isOverdue);
      const visibleReminderBills = reminderBills.slice(0, 4);
      const reminderSummary = {
        count: reminderBills.length,
        currentCount: currentReceivableBills.length,
        futureCount: leaseReminders.length
      };

      this.setData({ overdueBills, upcomingBills, visibleReminderBills, reminderSummary });
    } catch (e) {
      console.error('加载账单提醒失败', e);
    }
  },

  async loadRecentActivities() {
    try {
      const activities = [];
      const [billsRes, leasesRes] = await Promise.all([
        api.getBills(),
        api.getLeases()
      ]);

      (billsRes.data || []).slice(0, 5).forEach(b => {
        const d = new Date(b.updatedAt || b.createdAt);
        const typeText = { rent: '租金', utility: '水电费', deposit_return: '押金退还' }[b.type] || b.type;
        const paid = isBillPaid(b) || b.status === 'paid';
        const statusText = b.type === 'deposit_return' && paid ? '已退' : paid ? '已缴' : '待缴';
        activities.push({
          id: 'bill_' + b._id,
          title: `${typeText}账单 ¥${b.amount} ${statusText}`,
          time: this._getRelativeTime(d),
          timestamp: d.getTime(),
          status: paid ? 'success' : 'pending'
        });
      });

      (leasesRes.data || []).slice(0, 3).forEach(l => {
        const d = new Date(l.createdAt);
        activities.push({
          id: 'lease_' + l._id,
          title: `新合同创建`,
          time: this._getRelativeTime(d),
          timestamp: d.getTime(),
          status: 'success'
        });
      });

      activities.sort((a, b) => b.timestamp - a.timestamp);
      this.setData({ recentActivities: activities.slice(0, 10) });
    } catch (e) {
      console.error('加载最近活动失败', e);
    }
  },

  _getRelativeTime(date) {
    const now = new Date();
    const diff = Math.floor((now.getTime() - date.getTime()) / 1000);
    if (diff < 60) return '刚刚';
    if (diff < 3600) return Math.floor(diff / 60) + '分钟前';
    if (diff < 86400) return Math.floor(diff / 3600) + '小时前';
    if (diff < 2592000) return Math.floor(diff / 86400) + '天前';
    return Math.floor(diff / 2592000) + '月前';
  },

  switchToTab(e) {
    wx.switchTab({ url: e.currentTarget.dataset.url });
  },

  goToBills() {
    wx.switchTab({ url: '/pages/payments/index' });
  },

  openWechatAiChat() {
    wx.showModal({
      title: '打开微信 AI 对话',
      content: '请点击右上角的扳手图标，打开微信 AI 对话。',
      showCancel: false,
      confirmText: '我知道了'
    });
  },

  openReceivableGroup(e) {
    const item = e && e.currentTarget ? e.currentTarget.dataset.item : null;
    const billIds = item && Array.isArray(item.billIds) ? item.billIds.filter(Boolean) : [];
    if (!billIds.length) {
      wx.showToast({ title: '未找到对应待收账单，请刷新后重试', icon: 'none' });
      return;
    }
    wx.setStorageSync('dashboardPayBillIds', billIds);
    wx.switchTab({ url: '/pages/payments/index' });
  },

  openReminder(e) {
    const item = e && e.currentTarget ? e.currentTarget.dataset.item : null;
    if (item && item.reminderKind === 'lease_due' && item.leaseId) {
      wx.navigateTo({ url: `/pages/prepay-rent/index?leaseId=${item.leaseId}` });
      return;
    }
    wx.switchTab({ url: '/pages/payments/index' });
  }
});
