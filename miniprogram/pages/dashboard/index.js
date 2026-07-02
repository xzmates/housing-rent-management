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

Page({
  data: {
    loading: true,
    stats: { houses: 0, activeLeases: 0, unpaidAmount: 0, managedDeposit: 0 },
    overdueBills: [],
    upcomingBills: [],
    visibleReminderBills: [],
    reminderSummary: { count: 0, amount: 0 },
    recentActivities: []
  },

  onLoad() { this.loadAll(); },
  onPullDownRefresh() { this.loadAll().then(() => wx.stopPullDownRefresh()); },
  onShow() { this.loadAll(); },

  async loadAll() {
    this.setData({ loading: true });
    try {
      await Promise.all([
        this.loadStats(),
        this.loadBills(),
        this.loadRecentActivities()
      ]);
    } catch (e) {
      console.error('加载仪表盘失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadStats() {
    try {
      const [housesRes, leasesRes, billsRes] = await Promise.all([
        api.getHouses(),
        api.getLeases({ status: 'active' }),
        api.getBills()
      ]);

      const bills = billsRes.data || [];

      const stats = {
        houses: (housesRes.data || []).length,
        activeLeases: (leasesRes.data || []).length,
        unpaidAmount: bills
          .filter(b => b.status !== 'paid')
          .reduce((s, b) => s + (b.amount - b.paidAmount), 0),
        managedDeposit: (leasesRes.data || []).reduce((s, l) => s + Number(l.deposit || 0), 0)
      };

      this.setData({ stats });
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
      const monthEnd = new Date(today.getFullYear(), today.getMonth() + 1, 0);

      const unpaidBills = (billsRes.data || [])
        .filter(b => b.status !== 'paid' && b.type === 'rent')
        .map(b => {
          const lease = leaseMap[b.leaseId] || {};
          const house = houseMap[lease.houseId] || {};
          const tenant = tenantMap[lease.tenantId] || {};
          const dueDate = startOfDay(b.dueDate);
          const daysUntilDue = dueDate ? Math.ceil((dueDate.getTime() - today.getTime()) / DAY) : 0;
          return {
            ...b,
            reminderKind: 'bill',
            billId: b._id,
            houseCode: house.code || '',
            houseAddress: house.address || '',
            tenantName: tenant.name || '',
            dueDateStr: api.formatDate(b.dueDate),
            remaining: b.amount - b.paidAmount,
            daysUntilDue,
            isOverdue: daysUntilDue < 0,
            statusText: daysUntilDue < 0 ? '已逾期' : daysUntilDue === 0 ? '今日应缴' : '本月到期',
            statusClass: daysUntilDue < 0 ? 'status-red' : daysUntilDue === 0 ? 'status-orange' : 'status-blue'
          };
        })
        .filter(b => b.isOverdue || startOfDay(b.dueDate) <= monthEnd);

      const unpaidBillKeys = new Set(unpaidBills.map(b => `${b.leaseId}:${dateKey(b.dueDate)}`));
      const leaseReminders = leases
        .map(lease => {
          const dueDate = startOfDay(lease.nextRentDueDate || (lease.rentCoveredUntil ? new Date(startOfDay(lease.rentCoveredUntil).getTime() + DAY) : null));
          if (!dueDate || dueDate > monthEnd) return null;
          const key = `${lease._id}:${dateKey(dueDate)}`;
          if (unpaidBillKeys.has(key)) return null;
          const house = houseMap[lease.houseId] || {};
          const tenant = tenantMap[lease.tenantId] || {};
          const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / DAY);
          return {
            _id: `lease_due_${lease._id}`,
            reminderKind: 'lease_due',
            leaseId: lease._id,
            houseCode: house.code || '',
            houseAddress: house.address || '',
            tenantName: tenant.name || '',
            dueDate,
            dueDateStr: api.formatDate(dueDate),
            remaining: Number(lease.rent || 0),
            daysUntilDue,
            isOverdue: daysUntilDue < 0,
            statusText: daysUntilDue < 0 ? '已逾期' : daysUntilDue === 0 ? '今日应收' : `${daysUntilDue}天后应收`,
            statusClass: daysUntilDue < 0 ? 'status-red' : daysUntilDue === 0 ? 'status-orange' : 'status-blue'
          };
        })
        .filter(Boolean);

      const reminderBills = unpaidBills.concat(leaseReminders)
        .sort((a, b) => {
          if (a.isOverdue !== b.isOverdue) return a.isOverdue ? -1 : 1;
          if (a.daysUntilDue !== b.daysUntilDue) return a.daysUntilDue - b.daysUntilDue;
          return String(a.houseCode || '').localeCompare(String(b.houseCode || ''), 'zh-CN', { numeric: true });
        });

      const overdueBills = reminderBills.filter(b => b.isOverdue);
      const upcomingBills = reminderBills.filter(b => !b.isOverdue);
      const visibleReminderBills = reminderBills.slice(0, 4);
      const reminderSummary = {
        count: reminderBills.length,
        amount: reminderBills.reduce((sum, b) => sum + Number(b.remaining || 0), 0)
      };

      const stats = this.data.stats;
      const allUnpaidBills = (billsRes.data || []).filter(b => b.status !== 'paid');
      stats.unpaidAmount = allUnpaidBills.reduce((s, b) => s + (b.amount - b.paidAmount), 0);

      this.setData({ overdueBills, upcomingBills, visibleReminderBills, reminderSummary, stats });
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
        const statusText = b.type === 'deposit_return' && b.status === 'paid' ? '已退' : b.status === 'paid' ? '已缴' : '待缴';
        activities.push({
          id: 'bill_' + b._id,
          title: `${typeText}账单 ¥${b.amount} ${statusText}`,
          time: this._getRelativeTime(d),
          timestamp: d.getTime(),
          status: b.status === 'paid' ? 'success' : 'pending'
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

  openReminder(e) {
    const item = e && e.currentTarget ? e.currentTarget.dataset.item : null;
    if (item && item.reminderKind === 'lease_due' && item.leaseId) {
      wx.navigateTo({ url: `/pages/prepay-rent/index?leaseId=${item.leaseId}` });
      return;
    }
    wx.switchTab({ url: '/pages/payments/index' });
  }
});
