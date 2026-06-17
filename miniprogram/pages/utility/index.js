const api = require('../../services/api');

Page({
  data: {
    calculating: false, recordsLoading: false,
    settings: { electricityPrice: 0.8, waterPrice: 3.5 },
    allHouses: [],
    houseLabels: [],
    currentLease: null,
    currentTenant: null,
    lastReading: null,
    utilityRecords: [],
    result: null,
    form: {
      houseId: '', houseIndex: -1,
      currentElectricity: 0, currentWater: 0
    }
  },

  onLoad() { this.loadInit(); },
  onPullDownRefresh() { this.loadInit().then(() => wx.stopPullDownRefresh()); },

  async loadInit() {
    await Promise.all([this.loadSettings(), this.loadHouses()]);
  },

  async loadSettings() {
    try {
      const prices = await api.getUtilityPrices();
      this.setData({ settings: prices });
    } catch (e) { console.error(e); }
  },

  async loadHouses() {
    try {
      const result = await api.getHouses();
      const houses = (result.data || []).filter(h => h.status === 'rented');
      const addrOrder = { '东楼北': 1, '东楼南': 2, '里召': 3 };
      houses.sort((a, b) => {
        const aa = addrOrder[a.address] ?? 99, bb = addrOrder[b.address] ?? 99;
        if (aa !== bb) return aa - bb;
        return (parseInt(a.code, 10) || 0) - (parseInt(b.code, 10) || 0);
      });
      this.setData({
        allHouses: houses,
        houseLabels: houses.map(h => `${h.code} - ${h.address}`)
      });
    } catch (e) { console.error(e); }
  },

  async onHouseChange(e) {
    const idx = e.detail.value;
    const house = this.data.allHouses[idx];
    this.setData({
      'form.houseId': house?._id || '',
      'form.houseIndex': idx,
      currentLease: null, currentTenant: null, lastReading: null,
      utilityRecords: [], result: null
    });
    if (!house) return;

    try {
      wx.showLoading({ title: '加载租客...' });
      const data = await api.getHouseCurrentLease(house._id);
      if (data.currentLease && data.tenant) {
        this.setData({
          currentLease: data.currentLease,
          currentTenant: data.tenant,
          lastReading: data.utilityRecords?.[0] || null,
          utilityRecords: data.utilityRecords || []
        });
      } else {
        wx.showToast({ title: '该房屋无活跃租客', icon: 'none' });
      }
    } catch (e) {
      console.error(e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onElecInput(e) { this.setData({ 'form.currentElectricity': e.detail.value }); },
  onWaterInput(e) { this.setData({ 'form.currentWater': e.detail.value }); },

  async calculateBill() {
    const form = this.data.form;
    const lease = this.data.currentLease;
    if (!lease) {
      wx.showToast({ title: '请先选择房屋', icon: 'none' });
      return;
    }

    this.setData({ calculating: true });
    try {
      const result = await api.addMeterReading({
        leaseId: lease._id,
        electricityReading: Number(form.currentElectricity) || 0,
        waterReading: Number(form.currentWater) || 0
      });
      this.setData({ result });
      // 刷新记录
      const data = await api.getHouseCurrentLease(form.houseId);
      this.setData({
        utilityRecords: data.utilityRecords || [],
        lastReading: data.utilityRecords?.[0] || null,
        'form.currentElectricity': 0,
        'form.currentWater': 0
      });
      wx.showToast({ title: '计算完成', icon: 'success' });
    } catch (e) {
      console.error('计算水电费失败', e);
      wx.showToast({ title: e.message || '计算失败', icon: 'none' });
    } finally {
      this.setData({ calculating: false });
    }
  },

  stopPropagation() {}
});
