const dbService = require('../../services/database');
const V = require('../../utils/validate');

Page({
  data: {
    loading: false, saving: false,
    showAddModal: false, showDetailModal: false,
    detailPayment: null,
    payments: [],
    allHouses: [], allTenants: [],
    filters: { houseId: '', paymentType: '', status: '' },

    stats: { rentTotal: 0, depositTotal: 0, utilityTotal: 0 },

    form: {
      houseId: '', houseIndex: -1,
      tenantId: '', tenantName: '',
      typeIndex: 0, paymentType: 'rent',
      amount: 0, paymentDate: '', description: '',
      electricityReading: 0, waterReading: 0
    },

    houseLabels: ['全部房屋'],
    houseFilterLabel: '全部房屋',
    rentedHouseLabels: [],

    computedElectricityUsage: 0,
    computedWaterUsage: 0,
    computedElectricityCost: 0,
    computedWaterCost: 0,
    computedTotalCost: 0,
    utilityPrices: { electricityPrice: 0.8, waterPrice: 3.5 }
  },

  onLoad() {
    const today = new Date().toISOString().slice(0, 10);
    this.setData({ 'form.paymentDate': today });
    this.loadAll();
    this.loadUtilityPrices();
  },

  async loadUtilityPrices() {
    try {
      const prices = await dbService.getUtilityPrices();
      this.setData({ utilityPrices: prices });
    } catch (e) { console.error(e); }
  },

  onPullDownRefresh() {
    this.loadAll().then(() => wx.stopPullDownRefresh());
  },

  onShow() { this.loadAll(); },

  async loadAll() {
    await this.loadHouses();
    await this.loadTenants();
    await this.loadPayments();
  },

  async loadHouses() {
    try {
      const result = await dbService.getHouses();
      const houses = result.data || [];
      this.setData({ allHouses: houses });
      const labels = ['全部房屋'].concat(houses.map(h => `${h.code} - ${h.address}`));
      const rentedLabels = houses.filter(h => h.status === 'rented').map(h => `${h.code} - ${h.address}`);
      this.setData({ houseLabels: labels, rentedHouseLabels: rentedLabels });
    } catch (e) { console.error(e); }
  },

  async loadTenants() {
    try {
      const result = await dbService.getTenants();
      this.setData({ allTenants: result.data || [] });
    } catch (e) { console.error(e); }
  },

  async loadPayments() {
    this.setData({ loading: true });
    try {
      const result = await dbService.getPayments(this.data.filters);
      const payments = (result.data || []).map(p => {
        const item = Object.assign({}, p);
        item.isSettlement = item.description && item.description.indexOf('退租结算') !== -1;
        // 格式化日期
        if (item.paymentDate) {
          const d = new Date(item.paymentDate);
          item.dateStr = d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
        } else {
          item.dateStr = '';
        }
        // 房屋标签
        const house = this.data.allHouses.find(h => h._id === item.houseId);
        item.houseLabel = house ? house.code + ' - ' + house.address : item.houseId;
        return item;
      });
      this.setData({ payments });
      await this.calcStats();
    } catch (e) {
      console.error('加载缴费记录失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  async calcStats() {
    const paid = this.data.payments.filter(p => p.status === 'paid');
    const rentTotal = paid.filter(p => p.paymentType === 'rent').reduce((s, p) => s + (p.amount || 0), 0);
    const utilityTotal = paid.filter(p => p.paymentType === 'utility').reduce((s, p) => s + (p.amount || 0), 0);
    let depositTotal = 0;
    try {
      const active = await dbService.getTenants({ status: 'active' });
      depositTotal = active.data.reduce((s, t) => s + (t.deposit || 0), 0);
    } catch (e) { /* ignore */ }
    this.setData({ stats: { rentTotal, depositTotal, utilityTotal } });
  },

  setFilter(e) {
    const { key, val } = e.currentTarget.dataset;
    const filters = this.data.filters;
    filters[key] = val;
    this.setData({ filters }, () => this.loadPayments());
  },

  togglePaidFilter() {
    const filters = this.data.filters;
    filters.status = filters.status === 'paid' ? '' : 'paid';
    this.setData({ filters }, () => this.loadPayments());
  },

  onHouseFilterChange(e) {
    const idx = e.detail.value;
    const houses = this.data.allHouses;
    const filters = this.data.filters;
    if (idx === 0) {
      filters.houseId = '';
      this.setData({ filters, houseFilterLabel: '全部房屋' }, () => this.loadPayments());
    } else {
      const house = houses[idx - 1];
      filters.houseId = house._id;
      this.setData({ filters, houseFilterLabel: house.code }, () => this.loadPayments());
    }
  },

  _getHouseLabel(houseId) {
    const h = this.data.allHouses.find(h => h._id === houseId);
    return h ? `${h.code} - ${h.address}` : '未知房屋';
  },

  _getTypeText(type) {
    return { rent: '租金', utility: '水电费', deposit: '押金', other: '其他' }[type] || type;
  },

  _formatAmount(val) {
    return Number(val).toFixed(1);
  },

  _formatDate(date) {
    if (!date) return '未设置';
    return new Date(date).toLocaleDateString('zh-CN');
  },

  // ---- Detail Modal ----
  showDetail(e) {
    this.setData({ detailPayment: e.currentTarget.dataset.payment, showDetailModal: true });
  },

  closeDetail() { this.setData({ showDetailModal: false, detailPayment: null }); },

  async markAsPaid() {
    const p = this.data.detailPayment;
    if (!p) return;
    try {
      await dbService.updatePayment(p._id, { status: 'paid' });
      wx.showToast({ title: '已标记', icon: 'success' });
      this.closeDetail();
      this.loadPayments();
    } catch (e) {
      wx.showToast({ title: '操作失败', icon: 'none' });
    }
  },

  async deletePayment() {
    const p = this.data.detailPayment;
    if (!p) return;
    wx.showModal({
      title: '确认删除',
      success: async (res) => {
        if (res.confirm) {
          try {
            await dbService.deletePayment(p._id);
            wx.showToast({ title: '已删除', icon: 'success' });
            this.closeDetail();
            this.loadPayments();
          } catch (e) {
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // ---- Add Modal ----
  showAddModal() {
    this.setData({
      showAddModal: true,
      form: {
        houseId: '', houseIndex: -1, tenantId: '', tenantName: '',
        typeIndex: 0, paymentType: 'rent',
        amount: 0, paymentDate: new Date().toISOString().slice(0, 10),
        description: '', electricityReading: 0, waterReading: 0
      },
      computedElectricityUsage: 0, computedWaterUsage: 0,
      computedElectricityCost: 0, computedWaterCost: 0, computedTotalCost: 0
    });
  },

  closeAdd() { this.setData({ showAddModal: false }); },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    const data = {};
    data['form.' + field] = e.detail.value;
    this.setData(data);
  },

  onTypeChange(e) {
    const idx = e.detail.value;
    const types = ['rent', 'utility', 'deposit', 'other'];
    this.setData({
      'form.typeIndex': idx,
      'form.paymentType': types[idx]
    });
    if (this.data.form.houseId) this._loadTenantForHouse();
  },

  onHouseChange(e) {
    const idx = e.detail.value;
    const rentedHouses = this.data.allHouses.filter(h => h.status === 'rented');
    const house = rentedHouses[idx];
    const updates = {
      'form.houseId': house?._id || '',
      'form.houseIndex': idx,
      'form.amount': 0
    };
    this.setData(updates);
    if (house?._id) {
      this._loadTenantForHouse();
    }
  },

  _loadTenantForHouse() {
    const form = this.data.form;
    const active = this.data.allTenants.find(t => t.houseId === form.houseId && t.status === 'active');
    if (active) {
      this.setData({
        'form.tenantId': active._id,
        'form.tenantName': active.name
      });
      if (form.paymentType === 'utility') this._loadLastUtilityReading(active._id);
    } else {
      this.setData({
        'form.tenantId': '',
        'form.tenantName': '未找到活跃租客'
      });
    }
  },

  async _loadLastUtilityReading(tenantId) {
    try {
      const result = await dbService.getUtilityRecords({ tenantId });
      this.setData({ lastReading: result.data?.[0] || null });
    } catch (e) { /* ignore */ }
  },

  onDateChange(e) {
    this.setData({ 'form.paymentDate': e.detail.value });
  },

  // compute utility costs from wxml via data binding (watch-like)
  _updateComputed() {
    const form = this.data.form;
    if (form.paymentType !== 'utility') return;
    const elecReading = Number(form.electricityReading) || 0;
    const waterReading = Number(form.waterReading) || 0;
    // Baseline from last reading or move-in
    const lastRec = this.data.lastReading;
    const tenant = this.data.allTenants.find(t => t._id === form.tenantId);
    const baselineElec = lastRec?.electricityReading || tenant?.moveInElectricity || 0;
    const baselineWater = lastRec?.waterReading || tenant?.moveInWater || 0;
    const elecUsage = Math.max(0, elecReading - baselineElec);
    const waterUsage = Math.max(0, waterReading - baselineWater);
    const prices = this.data.utilityPrices;
    this.setData({
      computedElectricityUsage: elecUsage,
      computedWaterUsage: waterUsage,
      computedElectricityCost: elecUsage * prices.electricityPrice,
      computedWaterCost: waterUsage * prices.waterPrice,
      computedTotalCost: elecUsage * prices.electricityPrice + waterUsage * prices.waterPrice
    });
  },

  async savePayment() {
    const form = this.data.form;
    const msg = V.run([
      { fn: V.required, args: [form.houseId, '房屋'] },
      { fn: V.required, args: [form.tenantId, '租客'] },
      { fn: V.positiveNumber, args: [form.amount, '金额'] },
    ]);
    if (msg) { wx.showToast({ title: msg, icon: 'none' }); return; }

    this.setData({ saving: true });
    try {
      if (form.paymentType === 'utility') {
        const totalCost = this.data.computedTotalCost;
        const elecUsage = this.data.computedElectricityUsage;
        const waterUsage = this.data.computedWaterUsage;
        if (elecUsage > 0 || waterUsage > 0) {
          await dbService.addUtilityRecord({
            houseId: form.houseId, tenantId: form.tenantId,
            electricityReading: Number(form.electricityReading) || 0,
            waterReading: Number(form.waterReading) || 0,
            electricityUsage: elecUsage, waterUsage: waterUsage,
            electricityCost: this.data.computedElectricityCost,
            waterCost: this.data.computedWaterCost,
            totalCost
          });
        }
        await dbService.addPayment({
          houseId: form.houseId, tenantId: form.tenantId,
          paymentType: 'utility', amount: totalCost,
          paymentDate: form.paymentDate,
          description: form.description || `水电费 ¥${totalCost.toFixed(1)}`,
          period: `${new Date(form.paymentDate).getMonth() + 1}月`,
          status: 'paid'
        });
      } else {
        await dbService.addPayment({
          houseId: form.houseId, tenantId: form.tenantId,
          paymentType: form.paymentType,
          amount: Number(form.amount) || 0,
          paymentDate: form.paymentDate,
          description: form.description || this._getTypeText(form.paymentType),
          period: form.paymentType === 'rent' ? '租金' : (form.paymentType === 'deposit' ? '押金' : ''),
          status: 'paid'
        });
      }
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.closeAdd();
      this.loadPayments();
    } catch (e) {
      console.error('保存缴费失败', e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  stopPropagation() {}
});
