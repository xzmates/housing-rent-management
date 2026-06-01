const dbService = require('../../services/database');

Page({
  data: {
    calculating: false, recordsLoading: false,
    settings: { electricityPrice: 0.8, waterPrice: 3.5 },
    allHouses: [], allTenants: [],
    houseLabels: [], tenantLabels: [],
    lastReading: null,
    utilityRecords: [],
    result: null,

    form: {
      houseId: '', houseIndex: -1,
      tenantId: '', tenantIndex: -1,
      currentElectricity: 0, currentWater: 0
    }
  },

  onLoad() {
    this.loadInit();
  },

  onPullDownRefresh() {
    this.loadInit().then(() => wx.stopPullDownRefresh());
  },

  async loadInit() {
    await Promise.all([this.loadSettings(), this.loadHouses(), this.loadRecords()]);
  },

  async loadSettings() {
    try {
      const result = await dbService.getSystemSettings();
      if (result.data.length > 0) {
        this.setData({ settings: result.data[0] });
      }
    } catch (e) { console.error(e); }
  },

  async loadHouses() {
    try {
      const result = await dbService.getHouses();
      const houses = result.data || [];
      this.setData({ allHouses: houses });
      this.setData({ houseLabels: houses.map(h => `${h.code} - ${h.address}`) });
    } catch (e) { console.error(e); }
  },

  onHouseChange(e) {
    const idx = e.detail.value;
    const house = this.data.allHouses[idx];
    const form = this.data.form;
    form.houseId = house?._id || '';
    form.houseIndex = idx;
    form.tenantId = '';
    form.tenantIndex = -1;
    this.setData({
      form,
      tenantLabels: [],
      lastReading: null,
      'form.currentElectricity': 0,
      'form.currentWater': 0
    });

    if (form.houseId) {
      this.loadTenantsForHouse();
    }
  },

  async loadTenantsForHouse() {
    try {
      const result = await dbService.getTenants({
        houseId: this.data.form.houseId,
        status: 'active'
      });
      const tenants = result.data || [];
      this.setData({ allTenants: tenants });
      this.setData({ tenantLabels: tenants.map(t => t.name) });
    } catch (e) { console.error(e); }
  },

  onTenantChange(e) {
    const idx = e.detail.value;
    const tenant = this.data.allTenants[idx];
    const form = this.data.form;
    form.tenantId = tenant?._id || '';
    form.tenantIndex = idx;
    this.setData({ form });
    if (form.tenantId) this.loadLastReading();
  },

  async loadLastReading() {
    try {
      const result = await dbService.getUtilityRecords({
        houseId: this.data.form.houseId,
        tenantId: this.data.form.tenantId
      });
      if (result.data.length > 0) {
        const last = result.data[0];
        this.setData({
          lastReading: last,
          lastElecReading: last.electricityReading || 0,
          lastWaterReading: last.waterReading || 0,
          'form.currentElectricity': last.electricityReading || 0,
          'form.currentWater': last.waterReading || 0
        });
      } else {
        this.setData({ lastReading: null, lastElecReading: 0, lastWaterReading: 0 });
      }
    } catch (e) { console.error(e); }
  },

  async loadRecords() {
    this.setData({ recordsLoading: true });
    try {
      const result = await dbService.getUtilityRecords();
      this.setData({ utilityRecords: (result.data || []).slice(0, 10) });
    } catch (e) { console.error(e); }
    finally { this.setData({ recordsLoading: false }); }
  },

  async calculateBill() {
    const form = this.data.form;
    if (!form.houseId || !form.tenantId) {
      wx.showToast({ title: '请选择房屋和租客', icon: 'none' });
      return;
    }

    this.setData({ calculating: true });
    try {
      const result = await dbService.calculateUtilityBill(
        form.houseId, form.tenantId,
        Number(form.currentElectricity), Number(form.currentWater)
      );
      this.setData({ result });
      this.loadRecords();
      this.loadLastReading();
      this.setData({ 'form.currentElectricity': 0, 'form.currentWater': 0 });
      wx.showToast({ title: '计算完成', icon: 'success' });
    } catch (e) {
      console.error('计算水电费失败', e);
      wx.showToast({ title: '计算失败', icon: 'none' });
    } finally {
      this.setData({ calculating: false });
    }
  },

  _getHouseLabel(houseId) {
    const h = this.data.allHouses.find(h => h._id === houseId);
    return h ? `${h.code} - ${h.address}` : '未知房屋';
  },

  _getTenantName(tenantId) {
    const t = this.data.allTenants.find(t => t._id === tenantId);
    if (t) return t.name;
    // fallback: try allTenants which might be limited to current house tenants
    return '未知租客';
  },

  _formatDate(date) {
    if (!date) return '';
    return new Date(date).toLocaleDateString('zh-CN');
  }
});
