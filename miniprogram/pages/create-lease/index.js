const api = require('../../services/api');
const V = require('../../utils/validate');

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
      remark: ''
    },
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
        api.getHouses(),
        api.getTenants()
      ]);

      const houses = (houseRes.data || []).filter(h => h.status === 'available');
      const tenants = tenantRes.data || [];

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

      this.setData(updates);
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
    const idx = e.detail.value;
    const house = this.data.houses[idx];
    const updates = {
      'form.houseIndex': idx,
      'form.houseId': house ? house._id : ''
    };
    if (house) {
      updates['form.rent'] = house.rent;
    }
    this.setData(updates);
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
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
