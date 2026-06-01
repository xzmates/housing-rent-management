const dbService = require('../../services/database');
const V = require('../../utils/validate');

Page({
  data: {
    loading: false,
    saving: false,
    showModal: false,
    editingHouse: null,
    houses: [],
    filters: { status: '', code: '' },

    form: { code: '', address: '', rent: 0, status: 'available' },
    addressOptions: ['东楼北', '东楼南', '里召'],
    addressIndex: -1,
    statusOptions: ['可租', '已租'],
    statusIndex: 0
  },

  onLoad() {
    this.loadHouses();
  },

  onPullDownRefresh() {
    this.loadHouses().then(() => wx.stopPullDownRefresh());
  },

  onShow() {
    this.loadHouses();
  },

  async loadHouses() {
    this.setData({ loading: true });
    try {
      const result = await dbService.getHouses(this.data.filters);
      const housesData = result.data;

      const tenantsResult = await dbService.getTenants({ status: 'active' });
      const activeTenants = tenantsResult.data;

      const tenantMap = new Map();
      activeTenants.forEach(t => tenantMap.set(t.houseId, t));

      const enrichedHouses = await Promise.all(housesData.map(async (house) => {
        const enriched = Object.assign({}, house);
        if (house.status === 'rented') {
          const tenant = tenantMap.get(house._id);
          if (tenant) {
            enriched.tenantInfo = {
              name: tenant.name,
              id: tenant._id,
              moveInDate: new Date(tenant.moveInDate)
            };
            try {
              const rentInfo = await dbService.getNextRentDueDate(tenant._id);
              const today = new Date();
              const daysUntilDue = Math.ceil((rentInfo.nextDueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              enriched.nextRentDue = { date: rentInfo.nextDueDate, amount: rentInfo.amount, daysUntilDue };
            } catch (e) { /* ignore */ }
          }
        }
        return enriched;
      }));

      // 按地址分组 + 编号排序
      const addrOrder = { '东楼北': 1, '东楼南': 2, '里召': 3 };
      enrichedHouses.sort((a, b) => {
        const aa = addrOrder[a.address] ?? 99;
        const bb = addrOrder[b.address] ?? 99;
        if (aa !== bb) return aa - bb;
        return (parseInt(a.code, 10) || 0) - (parseInt(b.code, 10) || 0);
      });

      this.setData({ houses: enrichedHouses });
    } catch (e) {
      console.error('加载房屋失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  setFilter(e) {
    const { key, val } = e.currentTarget.dataset;
    const filters = this.data.filters;
    filters[key] = val;
    this.setData({ filters }, () => this.loadHouses());
  },

  onSearchInput(e) {
    const filters = this.data.filters;
    filters.code = e.detail.value;
    this.setData({ filters }, () => this.loadHouses());
  },

  showAddModal() {
    this.setData({
      showModal: true,
      editingHouse: null,
      form: { code: '', address: '', rent: 0, status: 'available' },
      addressIndex: -1,
      statusIndex: 0
    });
  },

  closeModal() {
    this.setData({ showModal: false, editingHouse: null });
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    const data = {};
    data['form.' + field] = e.detail.value;
    this.setData(data);
  },

  onAddressChange(e) {
    const idx = e.detail.value;
    this.setData({
      addressIndex: idx,
      'form.address': this.data.addressOptions[idx]
    });
  },

  onStatusChange(e) {
    const idx = e.detail.value;
    this.setData({
      statusIndex: idx,
      'form.status': idx === 0 ? 'available' : 'rented'
    });
  },

  editHouse(e) {
    const house = e.currentTarget.dataset.house;
    const addrIdx = this.data.addressOptions.indexOf(house.address);
    const stIdx = house.status === 'available' ? 0 : 1;
    this.setData({
      showModal: true,
      editingHouse: house,
      form: {
        code: house.code || '',
        address: house.address || '',
        rent: house.rent || 0,
        status: house.status || 'available'
      },
      addressIndex: addrIdx,
      statusIndex: stIdx
    });
  },

  async saveHouse() {
    const form = this.data.form;
    const msg = V.run([
      { fn: V.required, args: [form.code, '房屋编号'] },
      { fn: V.required, args: [form.address, '房屋地址'] },
      { fn: V.positiveNumber, args: [form.rent, '月租金'] },
    ]);
    if (msg) { wx.showToast({ title: msg, icon: 'none' }); return; }

    this.setData({ saving: true });
    try {
      if (this.data.editingHouse) {
        await dbService.updateHouse(this.data.editingHouse._id, form);
      } else {
        await dbService.addHouse(form);
      }
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.closeModal();
      this.loadHouses();
    } catch (e) {
      console.error('保存房屋失败', e);
      wx.showToast({ title: '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async deleteHouse(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个房屋吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await dbService.deleteHouse(id);
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadHouses();
          } catch (e) {
            console.error('删除房屋失败', e);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  viewContract(e) {
    const tenantId = e.currentTarget.dataset.tenantId;
    wx.navigateTo({ url: `/pages/contract/index?tenantId=${tenantId}` });
  },

  _formatDate(date) {
    if (!date) return '未设置';
    return new Date(date).toLocaleDateString('zh-CN');
  },

  stopPropagation() {}
});
