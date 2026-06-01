const dbService = require('../../services/database');
const V = require('../../utils/validate');

Page({
  data: {
    loading: false, saving: false, movingOut: false,
    showAddModal: false, showConfirmAddModal: false, showMoveOutModal: false,
    editingTenant: null, moveOutTenant: null,
    tenants: [],
    allHouses: [],
    rentableHouses: [],
    filters: { status: '', houseId: '' },

    form: {
      name: '', idCard: '', phone: '', houseId: '', houseIndex: -1,
      paymentCycle: 'month', paymentIndex: 0,
      deposit: 0, rent: 0,
      moveInDate: '', moveInElectricity: 0, moveInWater: 0
    },
    rentableHouseLabels: [],
    houseFilterLabel: '全部房屋',
    houseFilterOptions: ['全部房屋'],
    houseOptions: [],

    moveOutDate: '', moveOutElectricity: 0, moveOutWater: 0,
    settlementInfo: null,
    adjustRentRefund: 0,
    utilityPrices: { electricityPrice: 0.8, waterPrice: 3.5 }
  },

  onLoad() {
    const today = new Date().toISOString().slice(0, 10);
    this.setData({ moveOutDate: today, 'form.moveInDate': today });
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

  onShow() {
    this.loadAll();
  },

  async loadAll() {
    await Promise.all([this.loadTenants(), this.loadHouses()]);
  },

  async loadHouses() {
    try {
      const result = await dbService.getHouses();
      const houses = result.data || [];
      const addrOrder = { '东楼北': 1, '东楼南': 2, '里召': 3 };
      houses.sort((a, b) => {
        const aa = addrOrder[a.address] ?? 99, bb = addrOrder[b.address] ?? 99;
        if (aa !== bb) return aa - bb;
        return (parseInt(a.code, 10) || 0) - (parseInt(b.code, 10) || 0);
      });
      const rentable = houses.filter(h => h.status === 'available');
      const labels = rentable.map(h => `${h.code} - ${h.address}（¥${h.rent}/月）`);

      const filterOptions = ['全部房屋'].concat(houses.map(h => `${h.code} - ${h.address}`));
      this.setData({
        allHouses: houses,
        rentableHouses: rentable,
        rentableHouseLabels: labels,
        houseOptions: filterOptions,
        houseFilterOptions: filterOptions
      });
    } catch (e) {
      console.error('加载房屋失败', e);
    }
  },

  async loadTenants() {
    this.setData({ loading: true });
    try {
      const result = await dbService.getTenants(this.data.filters);
      const addrO = { '东楼北': 1, '东楼南': 2, '里召': 3 };
      const hMap = new Map(this.data.allHouses.map(h => [h._id, h]));
      const tenants = (result.data || []).sort((a, b) => {
        if (a.status !== b.status) return a.status === 'active' ? -1 : 1;
        const ha = hMap.get(a.houseId) || {}, hb = hMap.get(b.houseId) || {};
        const aa = addrO[ha.address] ?? 99, ab = addrO[hb.address] ?? 99;
        if (aa !== ab) return aa - ab;
        return (parseInt(ha.code, 10) || 0) - (parseInt(hb.code, 10) || 0);
      });
      this.setData({ tenants });
    } catch (e) {
      console.error('加载租客失败', e);
    } finally {
      this.setData({ loading: false });
    }
  },

  setFilter(e) {
    const { key, val } = e.currentTarget.dataset;
    const filters = this.data.filters;
    filters[key] = val;
    this.setData({ filters }, () => this.loadTenants());
  },

  onHouseFilterChange(e) {
    const idx = e.detail.value;
    const houses = this.data.allHouses;
    const filters = this.data.filters;
    if (idx === 0) {
      filters.houseId = '';
      this.setData({ filters, houseFilterLabel: '全部房屋' }, () => this.loadTenants());
    } else {
      const house = houses[idx - 1];
      filters.houseId = house._id;
      this.setData({ filters, houseFilterLabel: house.code }, () => this.loadTenants());
    }
  },

  _getHouseLabel(houseId) {
    const house = this.data.allHouses.find(h => h._id === houseId);
    return house ? `${house.code} - ${house.address}` : '未知房屋';
  },

  showAddModal() {
    const today = new Date().toISOString().slice(0, 10);
    // 编辑模式时将编辑房屋加入可选列表
    this.setData({
      showAddModal: true,
      editingTenant: null,
      form: {
        name: '', idCard: '', phone: '', houseId: '', houseIndex: -1,
        paymentCycle: 'month', paymentIndex: 0,
        deposit: 0, rent: 0, moveInDate: today,
        moveInElectricity: 0, moveInWater: 0
      }
    });
  },

  closeAddModal() { this.setData({ showAddModal: false, editingTenant: null }); },
  closeConfirmAdd() { this.setData({ showConfirmAddModal: false }); },
  closeMoveOut() { this.setData({ showMoveOutModal: false, settlementInfo: null, adjustRentRefund: 0 }); },

  onHouseChange(e) {
    const idx = e.detail.value;
    const house = this.data.rentableHouses[idx];
    const updates = { 'form.houseId': house?._id || '', 'form.houseIndex': idx };
    if (house && !this.data.editingTenant) {
      updates['form.rent'] = house.rent;
    }
    this.setData(updates);
  },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    const data = {};
    data['form.' + field] = e.detail.value;
    this.setData(data);
  },

  onPaymentChange(e) {
    const idx = e.detail.value;
    const cycles = ['month', 'quarter', 'half_year', 'year'];
    this.setData({
      'form.paymentIndex': idx,
      'form.paymentCycle': cycles[idx]
    });
  },

  onMoveInDateChange(e) {
    this.setData({ 'form.moveInDate': e.detail.value });
  },

  showConfirmAdd() {
    const form = this.data.form;
    const msg = V.run([
      { fn: V.required, args: [form.name, '租客姓名'] },
      { fn: V.required, args: [form.houseId, '房屋'] },
      { fn: V.positiveNumber, args: [form.rent, '月租金'] },
      { fn: V.positiveNumber, args: [form.deposit, '押金'] },
      { fn: V.phone, args: [form.phone] },
      { fn: V.idCard, args: [form.idCard] },
    ]);
    if (msg) { wx.showToast({ title: msg, icon: 'none' }); return; }
    const cycleMonths = [1, 3, 6, 12];
    const months = cycleMonths[form.paymentIndex] || 1;
    const total = (Number(form.rent) * months + Number(form.deposit)).toFixed(1);
    this.setData({ showConfirmAddModal: true, confirmTotal: total });
  },

  async saveTenant() {
    // 编辑模式直接保存
    this.setData({ saving: true });
    try {
      await dbService.updateTenant(this.data.editingTenant._id, this.data.form);
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.closeAddModal();
      this.loadAll();
    } catch (e) {
      console.error('保存租客失败', e);
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async finalizeAddTenant() {
    this.setData({ saving: true });
    try {
      await dbService.addTenant(this.data.form);
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.setData({ showConfirmAddModal: false, showAddModal: false });
      this.loadAll();
    } catch (e) {
      console.error('添加租客失败', e);
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  editTenant(e) {
    const tenant = e.currentTarget.dataset.tenant;
    const allHouses = this.data.allHouses;
    // 把当前房屋加入可租列表
    let rentable = this.data.rentableHouses.slice();
    if (tenant.houseId && !rentable.find(h => h._id === tenant.houseId)) {
      const currentHouse = allHouses.find(h => h._id === tenant.houseId);
      if (currentHouse) rentable.push(currentHouse);
    }
    const houseIdx = rentable.findIndex(h => h._id === tenant.houseId);
    const cycles = ['month', 'quarter', 'half_year', 'year'];
    const payIdx = cycles.indexOf(tenant.paymentCycle) >= 0 ? cycles.indexOf(tenant.paymentCycle) : 0;
    const labels = rentable.map(h => `${h.code} - ${h.address}（¥${h.rent}/月）`);

    this.setData({
      rentableHouses: rentable,
      rentableHouseLabels: labels
    });

    this.setData({
      showAddModal: true,
      editingTenant: tenant,
      form: {
        name: tenant.name || '',
        idCard: tenant.idCard || '',
        phone: tenant.phone || '',
        houseId: tenant.houseId || '',
        houseIndex: houseIdx,
        paymentCycle: tenant.paymentCycle || 'month',
        paymentIndex: payIdx,
        deposit: tenant.deposit || 0,
        rent: tenant.rent || 0,
        moveInDate: tenant.moveInDate ? new Date(tenant.moveInDate).toISOString().slice(0, 10) : '',
        moveInElectricity: tenant.moveInElectricity || 0,
        moveInWater: tenant.moveInWater || 0
      }
    });
  },

  async deleteTenant(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个租客吗？',
      success: async (res) => {
        if (res.confirm) {
          try {
            await dbService.deleteTenant(id);
            wx.showToast({ title: '已删除', icon: 'success' });
            this.loadAll();
          } catch (e) {
            console.error('删除租客失败', e);
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  async handleMoveOut(e) {
    const tenant = e.currentTarget.dataset.tenant;
    const today = new Date().toISOString().slice(0, 10);
    this.setData({
      showMoveOutModal: true,
      moveOutTenant: tenant,
      moveOutTenantName: tenant.name || '',
      moveOutTenantHouseLabel: this._getHouseLabel(tenant.houseId),
      moveOutDate: today,
      moveOutElectricity: 0,
      moveOutWater: 0,
      adjustRentRefund: 0,
      settlementInfo: null
    });

    try {
      const result = await dbService.calculateMoveOutSettlement(tenant._id, new Date(today));
      this.setData({
        settlementInfo: result,
        moveOutElectricity: result.baselineElec || 0,
        moveOutWater: result.baselineWater || 0
      });
    } catch (e) {
      console.error('计算结算失败', e);
    }
  },

  onMoveOutDateChange(e) {
    this.setData({ moveOutDate: e.detail.value });
  },

  onAdjustRefundInput(e) {
    const val = Number(e.detail.value) || 0;
    this.setData({ adjustRentRefund: val });
  },

  _finalRefundAmount() {
    const s = this.data.settlementInfo;
    const adjustRefund = Number(this.data.adjustRentRefund) || 0;
    if (!s) return 0;
    return s.refundAmount > 0 ? s.refundAmount + adjustRefund : Math.max(0, adjustRefund - s.extraDue);
  },

  _finalExtraDue() {
    const s = this.data.settlementInfo;
    const adjustRefund = Number(this.data.adjustRentRefund) || 0;
    if (!s) return 0;
    const adjustedOwed = s.extraDue - adjustRefund;
    return adjustedOwed > 0 ? adjustedOwed : 0;
  },

  async confirmMoveOut() {
    const tenant = this.data.moveOutTenant;
    const s = this.data.settlementInfo;
    if (!tenant || !s) return;

    this.setData({ movingOut: true });
    try {
      const moveOutDateObj = new Date(this.data.moveOutDate);
      const houseId = tenant.houseId;
      const tenantId = tenant._id;

      // 水电费记录
      const prices = this.data.utilityPrices;
      if (Number(this.data.moveOutElectricity) > 0 || Number(this.data.moveOutWater) > 0) {
        const baselineElec = s.baselineElec || tenant.moveInElectricity || 0;
        const baselineWater = s.baselineWater || tenant.moveInWater || 0;
        const elecUsed = Math.max(0, Number(this.data.moveOutElectricity) - baselineElec);
        const waterUsed = Math.max(0, Number(this.data.moveOutWater) - baselineWater);
        if (elecUsed > 0 || waterUsed > 0) {
          await dbService.addUtilityRecord({
            houseId, tenantId,
            electricityReading: Number(this.data.moveOutElectricity),
            waterReading: Number(this.data.moveOutWater),
            electricityUsage: elecUsed, waterUsage: waterUsed,
            electricityCost: elecUsed * prices.electricityPrice,
            waterCost: waterUsed * prices.waterPrice,
            totalCost: elecUsed * prices.electricityPrice + waterUsed * prices.waterPrice
          });
          await dbService.addPayment({
            houseId, tenantId, paymentType: 'utility',
            amount: elecUsed * prices.electricityPrice + waterUsed * prices.waterPrice,
            description: `退租结算 - 水电费（电${elecUsed}度×${prices.electricityPrice} + 水${waterUsed}吨×${prices.waterPrice}）`,
            paymentDate: moveOutDateObj, period: '退租结算', status: 'paid'
          });
        }
      }

      // 退租退款/补缴记录（含手动调整）
      const finalRefund = this._finalRefundAmount();
      const finalExtraDue = this._finalExtraDue();
      if (finalRefund > 0) {
        const depositShortfall = Math.max(0, s.pendingUtility - s.depositAmount);
        const rentRefund = Math.max(0, s.prepaidRent - s.owedRent - depositShortfall);
        if (rentRefund > 0) {
          await dbService.addPayment({
            houseId, tenantId, paymentType: 'rent',
            amount: -(rentRefund + Math.max(0, finalRefund - s.refundAmount)),
            description: `退租结算 - 退还预付租金（已预付¥${s.prepaidRent.toFixed(1)}，实住应缴¥${s.owedRent.toFixed(1)}）`,
            paymentDate: moveOutDateObj, period: '退租结算', status: 'paid'
          });
        }
        const depositRefund = Math.max(0, s.depositAmount - s.pendingUtility);
        if (depositRefund > 0) {
          await dbService.addPayment({
            houseId, tenantId, paymentType: 'deposit',
            amount: -depositRefund,
            description: `退租结算 - 退还押金（押金¥${s.depositAmount.toFixed(1)}，扣除水电费¥${s.pendingUtility.toFixed(1)}）`,
            paymentDate: moveOutDateObj, period: '退租结算', status: 'paid'
          });
        }
      }
      if (finalExtraDue > 0) {
        const adjustNote = this.data.adjustRentRefund > 0 ? `，手动减免¥${Number(this.data.adjustRentRefund).toFixed(1)}` : '';
        await dbService.addPayment({
          houseId, tenantId, paymentType: 'rent',
          amount: finalExtraDue,
          description: `退租结算 - 补缴租金（${s.owedRentNote}，预缴已抵扣¥${Math.min(s.prepaidRent, s.owedRent).toFixed(1)}${adjustNote}）`,
          paymentDate: moveOutDateObj, period: '退租结算', status: 'paid'
        });
      }

      await dbService.moveOutTenant(tenantId, moveOutDateObj);
      wx.showToast({ title: '退租成功', icon: 'success' });
      this.setData({ showMoveOutModal: false, settlementInfo: null });
      this.loadAll();
    } catch (e) {
      console.error('退租失败', e);
      wx.showToast({ title: e.message || '退租失败', icon: 'none' });
    } finally {
      this.setData({ movingOut: false });
    }
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
