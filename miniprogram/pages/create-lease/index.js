const api = require('../../services/api');
const V = require('../../utils/validate');

function dateMs(value) {
  if (!value) return 0;
  if (value.$date) return Number(value.$date) || new Date(value.$date).getTime() || 0;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 0 : d.getTime();
}

function sortUtilityRecords(rows) {
  return (rows || []).slice().sort((a, b) => {
    const calcDiff = dateMs(b.calculationDate) - dateMs(a.calculationDate);
    if (calcDiff !== 0) return calcDiff;
    return dateMs(b.createdAt) - dateMs(a.createdAt);
  });
}

Page({
  data: {
    loading: false, saving: false,
    // 可选列表
    houses: [],
    tenants: [],
    houseLabels: [],
    tenantLabels: [],
    // 表单
    form: {
      tenantId: '', tenantIndex: -1,
      houseId: '', houseIndex: -1,
      startDate: '', rent: 0, deposit: 0,
      paymentCycle: 'month', paymentIndex: 0,
      moveInElectricity: 0, moveInWater: 0,
      meterReplaced: false,
      remark: ''
    },
    lastHouseReading: null,
    lastHouseReadDate: '',
    // 预填参数
    presetTenantId: '',
    presetHouseId: ''
  },

  onLoad(options) {
    const today = new Date().toISOString().slice(0, 10);
    this.setData({
      'form.startDate': today,
      presetTenantId: options.tenantId || '',
      presetHouseId: options.houseId || ''
    });
    this.loadData();
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const [houseRes, tenantRes] = await Promise.all([
        api.getHousesWithOccupancy(),
        api.getTenantsWithOccupancy()
      ]);

      const houses = (houseRes.data || []).filter(h => !h.hasActiveLease && h.status === 'available');
      const tenants = (tenantRes.data || []).filter(t => !t.isActive);

      // 排序
      const addrOrder = { '东楼北': 1, '东楼南': 2, '里召': 3 };
      houses.sort((a, b) => {
        const aa = addrOrder[a.address] ?? 99, bb = addrOrder[b.address] ?? 99;
        if (aa !== bb) return aa - bb;
        return (parseInt(a.code, 10) || 0) - (parseInt(b.code, 10) || 0);
      });
      tenants.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      const houseLabels = houses.map(h => `${h.code} - ${h.address}（¥${h.rent}/月）`);
      const tenantLabels = tenants.map(t => `${t.name}${t.phone ? ' (' + t.phone + ')' : ''}`);

      const updates = {
        houses, tenants, houseLabels, tenantLabels,
        loading: false
      };

      // 预填租客
      if (this.data.presetTenantId) {
        const idx = tenants.findIndex(t => t._id === this.data.presetTenantId);
        if (idx >= 0) {
          updates['form.tenantId'] = this.data.presetTenantId;
          updates['form.tenantIndex'] = idx;
        }
      }

      // 预填房屋
      if (this.data.presetHouseId) {
        const idx = houses.findIndex(h => h._id === this.data.presetHouseId);
        if (idx >= 0) {
          updates['form.houseId'] = this.data.presetHouseId;
          updates['form.houseIndex'] = idx;
          updates['form.rent'] = houses[idx].rent;
        }
      }

      this.setData(updates, () => {
        if (this.data.form.houseId) this.loadHouseMeterBaseline(this.data.form.houseId);
      });
    } catch (e) {
      console.error('加载数据失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onTenantChange(e) {
    const idx = e.detail.value;
    const tenant = this.data.tenants[idx];
    this.setData({
      'form.tenantIndex': idx,
      'form.tenantId': tenant ? tenant._id : ''
    });
  },

  onHouseChange(e) {
    const idx = Number(e.detail.value);
    const house = this.data.houses[idx];
    const updates = {
      'form.houseIndex': idx,
      'form.houseId': house ? house._id : '',
      'form.meterReplaced': false,
      lastHouseReading: null,
      lastHouseReadDate: ''
    };
    if (house) {
      updates['form.rent'] = house.rent;
    }
    this.setData(updates, () => {
      if (house) this.loadHouseMeterBaseline(house._id);
    });
  },

  async loadHouseMeterBaseline(houseId) {
    if (!houseId) return;
    try {
      const records = await api.getUtilityRecords({ houseId });
      const latest = sortUtilityRecords(records.data)[0];
      if (!latest) {
        this.setData({
          lastHouseReading: null,
          lastHouseReadDate: '',
          'form.moveInElectricity': 0,
          'form.moveInWater': 0
        });
        return;
      }

      const updates = {
        lastHouseReading: latest,
        lastHouseReadDate: api.formatDate(latest.calculationDate || latest.createdAt) || '未知时间'
      };
      if (!this.data.form.meterReplaced) {
        updates['form.moveInElectricity'] = Number(latest.electricityReading || 0);
        updates['form.moveInWater'] = Number(latest.waterReading || 0);
      }
      this.setData(updates);
    } catch (e) {
      console.error('加载房屋上次水电读数失败', e);
      wx.showToast({ title: '加载上次水电读数失败', icon: 'none' });
    }
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  onMeterReplacedChange(e) {
    const meterReplaced = !!e.detail.value;
    const updates = { 'form.meterReplaced': meterReplaced };
    const latest = this.data.lastHouseReading;
    if (!meterReplaced && latest) {
      updates['form.moveInElectricity'] = Number(latest.electricityReading || 0);
      updates['form.moveInWater'] = Number(latest.waterReading || 0);
    }
    this.setData(updates);
  },

  onStartDateChange(e) {
    this.setData({ 'form.startDate': e.detail.value });
  },

  onPaymentChange(e) {
    const idx = e.detail.value;
    const cycles = ['month', 'quarter', 'half_year', 'year'];
    this.setData({
      'form.paymentIndex': idx,
      'form.paymentCycle': cycles[idx]
    });
  },

  async submit() {
    const form = this.data.form;
    const msg = V.run([
      { fn: V.required, args: [form.tenantId, '租客'] },
      { fn: V.required, args: [form.houseId, '房屋'] },
      { fn: V.required, args: [form.startDate, '起租日期'] },
      { fn: V.positiveNumber, args: [form.rent, '月租金'] },
      { fn: V.positiveNumber, args: [form.deposit, '押金'] },
    ]);
    if (msg) { wx.showToast({ title: msg, icon: 'none' }); return; }

    const latest = this.data.lastHouseReading;
    if (latest && !form.meterReplaced) {
      const lastElectricity = Number(latest.electricityReading || 0);
      const lastWater = Number(latest.waterReading || 0);
      if ((Number(form.moveInElectricity) || 0) < lastElectricity || (Number(form.moveInWater) || 0) < lastWater) {
        wx.showToast({
          title: `入住读数不能低于上次：电${lastElectricity}，水${lastWater}`,
          icon: 'none'
        });
        return;
      }
    }

    wx.showModal({
      title: '确认创建合同',
      content: `确定为租客创建租赁合同？将自动生成租金账单。`,
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ saving: true });
        try {
          await api.createLease({
            tenantId: form.tenantId,
            houseId: form.houseId,
            startDate: form.startDate,
            rent: Number(form.rent),
            deposit: Number(form.deposit),
            paymentCycle: form.paymentCycle,
            moveInElectricity: Number(form.moveInElectricity) || 0,
            moveInWater: Number(form.moveInWater) || 0,
            meterReplaced: !!form.meterReplaced,
            remark: form.remark
          });
          wx.showToast({ title: '合同创建成功', icon: 'success' });
          setTimeout(() => wx.navigateBack(), 1000);
        } catch (e) {
          console.error('创建合同失败', e);
          wx.showToast({ title: e.message || '创建失败', icon: 'none' });
        } finally {
          this.setData({ saving: false });
        }
      }
    });
  }
});
