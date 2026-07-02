const api = require('../../services/api');
const V = require('../../utils/validate');

Page({
  data: {
    loading: false, saving: false, showModal: false,
    editingHouse: null, houses: [],
    filters: { status: '', code: '' },
    form: { code: '', address: '', rent: 0, status: 'available' },
    addressOptions: ['东楼北', '东楼南', '里召'],
    addressIndex: -1,
    statusOptions: ['可租', '已租'],
    statusIndex: 0
  },

  onLoad() { this.loadHouses(); },
  onPullDownRefresh() { this.loadHouses().then(() => wx.stopPullDownRefresh()); },
  onShow() { this.loadHouses(); },

  async loadHouses() {
    this.setData({ loading: true });
    try {
      const [result, utilityRes] = await Promise.all([
        api.getHousesWithOccupancy(this.data.filters),
        api.getUtilityRecords().catch(() => ({ data: [] }))
      ]);
      const houses = result.data || [];
      const latestMeterByHouse = {};
      (utilityRes.data || []).forEach(record => {
        if (record.houseId && !latestMeterByHouse[record.houseId]) {
          latestMeterByHouse[record.houseId] = record;
        }
      });

      // 按地址+编号排序
      const addrOrder = { '东楼北': 1, '东楼南': 2, '里召': 3 };
      houses.sort((a, b) => {
        const aa = addrOrder[a.address] ?? 99, bb = addrOrder[b.address] ?? 99;
        if (aa !== bb) return aa - bb;
        return (parseInt(a.code, 10) || 0) - (parseInt(b.code, 10) || 0);
      });

      // 为已租房屋批量加载租客信息
      const enriched = await Promise.all(houses.map(async (house) => {
        const h = { ...house };
        const latestMeter = latestMeterByHouse[house._id];
        if (latestMeter) {
          h.lastMeterDate = api.formatDate(latestMeter.calculationDate || latestMeter.createdAt);
          h.electricityReading = latestMeter.electricityReading;
          h.waterReading = latestMeter.waterReading;
        }
        if (house.hasActiveLease) {
          try {
            const leaseData = await api.getHouseCurrentLease(house._id);
            if (leaseData.tenant) {
              h.tenantInfo = {
                name: leaseData.tenant.name,
                id: leaseData.tenant._id,
                leaseId: leaseData.currentLease._id,
                moveInDateStr: api.formatDate(leaseData.currentLease.startDate)
              };
            }
            // 计算下次收租日（从最近的 unpaid bill 的 dueDate）
            const bills = leaseData.recentBills || [];
            const unpaidBill = bills.find(b => b.status === 'unpaid' && b.type === 'rent');
            if (unpaidBill) {
              const dueDate = new Date(unpaidBill.dueDate);
              const today = new Date();
              const daysUntilDue = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
              h.nextRentDue = {
                dateStr: api.formatDate(dueDate),
                amount: unpaidBill.amount - unpaidBill.paidAmount,
                daysUntilDue
              };
            }
          } catch (e) {
            console.warn(`加载房屋 ${house.code} 租客信息失败`, e);
          }
        }
        return h;
      }));

      this.setData({ houses: enriched });
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
      showModal: true, editingHouse: null,
      form: { code: '', address: '', rent: 0, status: 'available' },
      addressIndex: -1, statusIndex: 0
    });
  },

  closeModal() { this.setData({ showModal: false, editingHouse: null }); },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  onAddressChange(e) {
    const idx = e.detail.value;
    this.setData({ addressIndex: idx, 'form.address': this.data.addressOptions[idx] });
  },

  onStatusChange(e) {
    const idx = e.detail.value;
    this.setData({ statusIndex: idx, 'form.status': idx === 0 ? 'available' : 'rented' });
  },

  editHouse(e) {
    const house = e.currentTarget.dataset.house;
    const addrIdx = this.data.addressOptions.indexOf(house.address);
    const stIdx = house.status === 'available' ? 0 : 1;
    this.setData({
      showModal: true, editingHouse: house,
      form: { code: house.code || '', address: house.address || '', rent: house.rent || 0, status: house.status || 'available' },
      addressIndex: addrIdx, statusIndex: stIdx
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
        await api.updateHouse(this.data.editingHouse._id, form);
      } else {
        await api.addHouse(form);
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
    const id = e && e.currentTarget ? e.currentTarget.dataset.id : e;
    if (!id) return;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个房屋吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.deleteHouse(id);
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadHouses();
          } catch (e) {
            wx.showToast({ title: e.message || '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  viewTenantDetail(e) {
    const tenantId = e.currentTarget.dataset.tenantId;
    wx.navigateTo({ url: `/pages/tenant-detail/index?tenantId=${tenantId}` });
  },

  showHouseMore(e) {
    const house = e.currentTarget.dataset.house;
    if (!house) return;
    const itemList = house.status === 'rented' && house.tenantInfo
      ? ['查看租客', '编辑房屋']
      : ['编辑房屋', '删除房屋'];
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const action = itemList[res.tapIndex];
        if (action === '查看租客') {
          wx.navigateTo({ url: `/pages/tenant-detail/index?tenantId=${house.tenantInfo.id}` });
          return;
        }
        if (action === '编辑房屋') {
          this.editHouse({ currentTarget: { dataset: { house } } });
          return;
        }
        if (action === '删除房屋') {
          this.deleteHouse(house._id);
        }
      }
    });
  },

  stopPropagation() {}
});
