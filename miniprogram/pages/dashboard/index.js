const api = require('../../services/api');

Page({
  data: {
    loading: true,
    stats: { houses: 0, activeLeases: 0, monthlyIncome: 0, unpaidAmount: 0 },
    overdueBills: [],
    upcomingBills: [],
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

      const now = new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const bills = billsRes.data || [];

      const stats = {
        houses: (housesRes.data || []).length,
        activeLeases: (leasesRes.data || []).length,
        monthlyIncome: bills
          .filter(b => b.status === 'paid' && b.period && b.period.startsWith(thisMonth))
          .reduce((s, b) => s + b.paidAmount, 0),
        unpaidAmount: bills
          .filter(b => b.status !== 'paid')
          .reduce((s, b) => s + (b.amount - b.paidAmount), 0)
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
      const in10Days = new Date(today);
      in10Days.setDate(in10Days.getDate() + 10);

      const unpaidBills = (billsRes.data || [])
        .filter(b => b.status !== 'paid' && b.type === 'rent')
        .map(b => {
          const lease = leaseMap[b.leaseId] || {};
          const house = houseMap[lease.houseId] || {};
          const tenant = tenantMap[lease.tenantId] || {};
          const dueDate = new Date(b.dueDate);
          dueDate.setHours(0, 0, 0, 0);
          const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          return {
            ...b,
            houseCode: house.code || '',
            houseAddress: house.address || '',
            tenantName: tenant.name || '',
            dueDateStr: api.formatDate(b.dueDate),
            remaining: b.amount - b.paidAmount,
            daysUntilDue,
            isOverdue: daysUntilDue < 0
          };
        })
        .sort((a, b) => a.daysUntilDue - b.daysUntilDue);

      const overdueBills = unpaidBills.filter(b => b.isOverdue);
      const upcomingBills = unpaidBills.filter(b => !b.isOverdue && b.daysUntilDue <= 10);

      const stats = this.data.stats;
      stats.unpaidAmount = unpaidBills.reduce((s, b) => s + b.remaining, 0);

      this.setData({ overdueBills, upcomingBills, stats });
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
        activities.push({
          id: 'bill_' + b._id,
          title: `${typeText}账单 ¥${b.amount} ${b.status === 'paid' ? '已缴' : '待缴'}`,
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
  }
});
