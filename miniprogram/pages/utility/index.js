const api = require('../../services/api');

Page({
  data: {
    calculating: false,
    recordsLoading: false,
    settings: { electricityPrice: 0.8, waterPrice: 3.5 },
    allHouses: [],
    houseLabels: [],
    currentLease: null,
    currentTenant: null,
    lastReading: null,
    lastReadingDate: '',
    utilityRecords: [],
    result: null,
    confirmationId: '',
    form: {
      houseId: '',
      houseIndex: -1,
      currentElectricity: 0,
      currentWater: 0
    }
  },

  onLoad() { this.consumeMeterHandoff(); this.loadInit(); },
  onPullDownRefresh() { this.loadInit().then(() => wx.stopPullDownRefresh()); },

  consumeMeterHandoff() {
    const app = getApp(); const pageId = typeof this.getPageId === 'function' ? this.getPageId() : '';
    const handoff = app && app.takeAgentHandoff && pageId ? app.takeAgentHandoff(pageId) : null;
    const payload = handoff && handoff.payload;
    if (!payload || payload.type !== 'meterReading') return;
    const input = payload.input || {};
    this.pendingMeterHandoff = payload;
    this.pendingHouseId = payload.lease?.house?.id || '';
    this.pendingMeterInput = { electricityReading: Number(input.electricityReading || 0), waterReading: Number(input.waterReading || 0) };
    this.setData({ confirmationId: payload.confirmationId || '', 'form.currentElectricity': Number(input.electricityReading || 0), 'form.currentWater': Number(input.waterReading || 0), result: payload.meterView || null });
  },

  async loadInit() {
    await Promise.all([this.loadSettings(), this.loadHouses()]);
  },

  async loadSettings() {
    try {
      const prices = await api.getUtilityPrices();
      this.setData({ settings: prices });
    } catch (e) {
      console.error(e);
    }
  },

  async loadHouses() {
    try {
      const result = await api.getHousesWithOccupancy();
      const houses = (result.data || []).filter(h => h.hasActiveLease);
      const addrOrder = { '东楼区': 1, '东楼北': 2, '里召': 3 };
      houses.sort((a, b) => {
        const aa = addrOrder[a.address] ?? 99;
        const bb = addrOrder[b.address] ?? 99;
        if (aa !== bb) return aa - bb;
        return (parseInt(a.code, 10) || 0) - (parseInt(b.code, 10) || 0);
      });
      this.setData({
        allHouses: houses,
        houseLabels: houses.map(h => `${h.code} - ${h.address}`)
      });
      const handoffIndex = houses.findIndex(h => h._id === this.pendingHouseId);
      if (handoffIndex >= 0) this.onHouseChange({ detail: { value: handoffIndex }, fromHandoff: true });
    } catch (e) {
      console.error(e);
    }
  },

  async onHouseChange(e) {
    const idx = Number(e.detail.value);
    const house = this.data.allHouses[idx];
    this.setData({
      'form.houseId': house?._id || '',
      'form.houseIndex': idx,
      currentLease: null,
      currentTenant: null,
      lastReading: null,
      lastReadingDate: '',
      utilityRecords: [],
      result: null
    });
    if (!house) return;

    try {
      wx.showLoading({ title: '加载租客...' });
      const data = await api.getHouseCurrentLease(house._id);
      if (data.currentLease && data.tenant) {
        const lastReading = data.utilityRecords?.[0] || null;
        const handoffInput = e.fromHandoff ? this.pendingMeterInput : null;
        this.setData({
          currentLease: data.currentLease,
          currentTenant: data.tenant,
          lastReading,
          lastReadingDate: lastReading ? (api.formatDate(lastReading.calculationDate || lastReading.createdAt) || '未知时间') : '',
          utilityRecords: data.utilityRecords || [],
          'form.currentElectricity': handoffInput ? handoffInput.electricityReading : (lastReading ? Number(lastReading.electricityReading || 0) : 0),
          'form.currentWater': handoffInput ? handoffInput.waterReading : (lastReading ? Number(lastReading.waterReading || 0) : 0)
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

  onElecInput(e) {
    this.setData({ 'form.currentElectricity': e.detail.value, confirmationId: '', result: null });
  },

  onWaterInput(e) {
    this.setData({ 'form.currentWater': e.detail.value, confirmationId: '', result: null });
  },

  async calculateBill() {
    const form = this.data.form;
    const lease = this.data.currentLease;
    if (!lease) {
      wx.showToast({ title: '请先选择房屋', icon: 'none' });
      return;
    }

    const last = this.data.lastReading;
    if (last) {
      const lastElectricity = Number(last.electricityReading || 0);
      const lastWater = Number(last.waterReading || 0);
      if ((Number(form.currentElectricity) || 0) < lastElectricity || (Number(form.currentWater) || 0) < lastWater) {
        wx.showToast({
          title: `抄表读数不能低于上次：电${lastElectricity}，水${lastWater}`,
          icon: 'none'
        });
        return;
      }
    }

    this.setData({ calculating: true });
    try {
      const result = await api.previewMeterReading({
        leaseId: lease._id,
        electricityReading: Number(form.currentElectricity) || 0,
        waterReading: Number(form.currentWater) || 0
      });
      this.setData({ result, confirmationId: result.confirmationId || '' });
      wx.showToast({ title: '请核对后确认', icon: 'none' });
    } catch (e) {
      console.error('计算水电费失败', e);
      wx.showToast({ title: e.message || '计算失败', icon: 'none' });
    } finally {
      this.setData({ calculating: false });
    }
  },

  async confirmMeterReading() {
    if (this.data.calculating || !this.data.confirmationId) return;
    this.setData({ calculating: true });
    try {
      await api.addMeterReading({ confirmationId: this.data.confirmationId });
      const data = await api.getHouseCurrentLease(this.data.form.houseId);
      const latest = data.utilityRecords?.[0] || null;
      this.setData({ confirmationId: '', utilityRecords: data.utilityRecords || [], lastReading: latest, lastReadingDate: latest ? (api.formatDate(latest.calculationDate || latest.createdAt) || '未知时间') : '', 'form.currentElectricity': latest ? Number(latest.electricityReading || 0) : 0, 'form.currentWater': latest ? Number(latest.waterReading || 0) : 0 });
      wx.showToast({ title: '抄表已确认', icon: 'success' });
    } catch (e) {
      wx.showToast({ title: e.message || '确认失败', icon: 'none' });
    } finally { this.setData({ calculating: false }); }
  },

  stopPropagation() {}
});
