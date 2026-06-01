const dbService = require('../../services/database');

Page({
  data: {
    loading: true,
    stats: { houses: 0, activeTenants: 0, monthlyIncome: 0, pendingPayments: 0 },
    upcomingHouses: [],
    overdueHouses: [],
    recentActivities: []
  },

  onLoad() {
    this.loadAll();
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  onShow() {
    // 每次显示页面时刷新数据
    this.loadAll();
  },

  async loadAll() {
    this.setData({ loading: true });
    try {
      await Promise.all([
        this.loadStats(),
        this.loadRecentActivities(),
        this.loadUpcomingRentHouses()
      ]);
    } catch (e) {
      console.error('加载仪表盘失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadStats() {
    try {
      const [houses, tenantsResult, payments] = await Promise.all([
        dbService.getHouses(),
        dbService.getTenants({ status: 'active' }),
        dbService.getPayments()
      ]);

      const now = new Date();
      const stats = {
        houses: houses.data.length,
        activeTenants: tenantsResult.data.length,
        monthlyIncome: 0,
        pendingPayments: 0
      };

      stats.monthlyIncome = payments.data
        .filter(p => {
          const d = new Date(p.paymentDate);
          return d.getMonth() === now.getMonth()
            && d.getFullYear() === now.getFullYear()
            && p.status === 'paid';
        })
        .reduce((sum, p) => sum + (p.amount || 0), 0);

      stats.pendingPayments = payments.data
        .filter(p => p.status === 'pending' || p.status === 'overdue')
        .reduce((sum, p) => sum + (p.amount || 0), 0);

      this.setData({ stats });
    } catch (e) {
      console.error('加载统计失败', e);
    }
  },

  async loadUpcomingRentHouses() {
    try {
      const houses = await dbService.getUpcomingRentHouses(10);
      const overdue = houses.filter(h => h.overdueItems?.length > 0);
      const upcoming = houses.filter(h => !h.overdueItems?.length);

      // 预计算格式化数值（重建纯对象避免 setData Date 序列化问题）
      const fmtAmount = (v) => { const n = Number(v); return isNaN(n) ? '0' : n.toFixed(1); };
      const fmtDate = (d) => {
        if (!d) return '';
        const date = new Date(d);
        return date.getFullYear() + '/' + (date.getMonth() + 1) + '/' + date.getDate();
      };
      const rebuild = (item) => {
        if (!item) return item;
        const result = {
          houseId: item.houseId,
          houseCode: item.houseCode,
          houseAddress: item.houseAddress,
          tenantId: item.tenantId,
          tenantName: item.tenantName,
          monthlyRent: item.monthlyRent,
          monthlyRentStr: fmtAmount(item.monthlyRent),
          rentCoveredUntilStr: fmtDate(item.rentCoveredUntil),
          amountStr: fmtAmount(item.amount),
          totalOverdueStr: fmtAmount(item.totalOverdue),
          nextDueDateStr: fmtDate(item.nextDueDate),
          daysUntilDue: item.daysUntilDue || 0,
          cycleLabel: item.cycleLabel,
          cycleAmountStr: fmtAmount(item.cycleAmount),
          overdueItems: (item.overdueItems || []).map(oi => ({
            amount: oi.amount,
            amountStr: fmtAmount(oi.amount),
            dueDateStr: fmtDate(oi.dueDate),
            daysOverdue: oi.daysOverdue || 0
          })),
          upcomingItem: item.upcomingItem ? {
            amount: item.upcomingItem.amount,
            amountStr: fmtAmount(item.upcomingItem.amount),
            dueDateStr: fmtDate(item.upcomingItem.dueDate),
            daysUntilDue: item.upcomingItem.daysUntilDue || 0
          } : null
        };
        return result;
      };

      const pendingOverdue = overdue.reduce((s, h) => s + (h.totalOverdue || 0), 0);
      const stats = this.data.stats;
      stats.pendingPayments = pendingOverdue;

      this.setData({
        upcomingHouses: upcoming.map(rebuild),
        overdueHouses: overdue.map(rebuild),
        stats
      });
    } catch (e) {
      console.error('加载收费提醒失败', e);
    }
  },

  async loadRecentActivities() {
    try {
      const activities = [];

      const [housesResult, tenantsResult, paymentsResult, utilityResult] = await Promise.all([
        dbService.getHouses(),
        dbService.getTenants(),
        dbService.getPayments(),
        dbService.getUtilityRecords()
      ]);

      housesResult.data.slice(0, 3).forEach(h => {
        const d = new Date(h.createdAt);
        activities.push({
          id: 'house_' + h._id,
          type: 'house',
          title: `新增房屋 ${h.code || ''} - ${h.address}`,
          time: this._getRelativeTime(d),
          timestamp: d.getTime(),
          status: 'success'
        });
      });

      tenantsResult.data.slice(0, 3).forEach(t => {
        const d = new Date(t.createdAt);
        activities.push({
          id: 'tenant_' + t._id,
          type: 'tenant',
          title: `${t.name} ${t.status === 'active' ? '入住' : '退租'}`,
          time: this._getRelativeTime(d),
          timestamp: d.getTime(),
          status: 'success'
        });
      });

      paymentsResult.data.slice(0, 3).forEach(p => {
        const d = new Date(p.paymentDate || p.createdAt);
        activities.push({
          id: 'payment_' + p._id,
          type: 'payment',
          title: `${p.description || '缴费'} ¥${p.amount}`,
          time: this._getRelativeTime(d),
          timestamp: d.getTime(),
          status: p.status === 'paid' ? 'success' : 'pending'
        });
      });

      utilityResult.data.slice(0, 3).forEach(r => {
        const d = new Date(r.calculationDate || r.createdAt);
        activities.push({
          id: 'utility_' + r._id,
          type: 'payment',
          title: `水电费 ¥${r.totalCost}`,
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

  _formatDate(date) {
    if (!date) return '—';
    const d = new Date(date);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}/${m}/${day}`;
  }
});
