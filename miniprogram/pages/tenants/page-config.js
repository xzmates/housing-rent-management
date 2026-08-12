const api = require('../../services/api');
const V = require('../../utils/validate');
const dataRefresh = require('../../utils/data-refresh');

const tenantPageConfig = {
  data: {
    loading: false, saving: false,
    showAddModal: false, showMoveOutModal: false,
    editingTenant: null, moveOutLease: null,
    tenants: [],
    filteredTenants: [],
    filters: { status: '' },
    nameSearch: '',
    form: { name: '', idCard: '', phone: '' },
    moveOutDate: '',
    damageAmount: 0,
    moveOutElectricity: '',
    moveOutWater: '',
    lastElectricityReading: 0,
    lastWaterReading: 0,
    electricityPrice: 0.8,
    waterPrice: 3.5,
    settlementPreview: null,
    outstandingBills: [],
    outstandingAmount: 0,
    loadingMoveOutBills: false,
    settlementResult: null,
    processingMoveOut: false
  },

  onLoad(options = {}) {
    const today = new Date().toISOString().slice(0, 10);
    this.setData({ moveOutDate: today });
    this.consumeCreateTenantHandoff();
  },

  onPullDownRefresh() { this.loadTenants(true).then(() => wx.stopPullDownRefresh()); },
  onShow() {
    this.consumeCreateTenantHandoff();
    if (dataRefresh.needsRefresh(this)) this.loadTenants();
  },

  openHouseTab() {
    wx.removeStorageSync('propertyManagerTab');
    wx.switchTab({ url: '/pages/houses/index' });
  },

  consumeCreateTenantHandoff() {
    const app = getApp();
    const pageId = typeof this.getPageId === 'function' ? this.getPageId() : '';
    const handoff = app && app.takeAgentHandoff && pageId ? app.takeAgentHandoff(pageId) : null;
    const payload = handoff && handoff.payload;
    if (!payload || payload.mode !== 'create_tenant') return;
    const fields = payload.fields || {};
    this.setData({ showAddModal: true, editingTenant: null, form: { name: fields.name || '', phone: fields.phone || '', idCard: fields.idCard || '' } });
  },

  async loadTenants() {
    this.setData({ loading: true });
    try {
      const [result, houseRes] = await Promise.all([api.getTenantsWithOccupancy(), api.getHouses()]);
      const tenants = result.data || [];
      const houseMap = Object.fromEntries((houseRes.data || []).map(item => [item._id, item]));

      const enriched = tenants.map((t) => {
        const tenant = {
          ...t,
          isActive: false,
          houseLabel: '',
          leaseInfo: null,
          rentText: '',
          contractDateText: '无合同',
          statusText: '无合同',
          statusClass: 'status-orange'
        };
          const lease = t.activeLease;
          if (lease) {
            tenant.isActive = true;
            tenant.leaseInfo = lease;
            tenant.rentText = lease.rent ? `¥${lease.rent}/月` : '';
            tenant.contractDateText = lease.rentCoveredUntil ? `租金覆盖至 ${api.formatDate(lease.rentCoveredUntil)}` : `入住 ${api.formatDate(lease.startDate)}`;
            tenant.statusText = '在租';
            tenant.statusClass = 'status-green';
              const house = houseMap[lease.houseId];
              tenant.houseLabel = house ? `${house.code} - ${house.address}` : '';
          }
        return tenant;
      });

      // 排序：在住的排前面
      enriched.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });

      this.setData({ tenants: enriched }, () => this._applyFilter());
      dataRefresh.markLoaded(this);
    } catch (e) {
      console.error('加载租客失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  _applyFilter() {
    const keyword = (this.data.nameSearch || '').trim().toLowerCase();
    const statusFilter = this.data.filters.status;
    let filtered = this.data.tenants;

    if (statusFilter === 'active') {
      filtered = filtered.filter(t => t.isActive);
    } else if (statusFilter === 'inactive') {
      filtered = filtered.filter(t => !t.isActive);
    }

    if (keyword) {
      filtered = filtered.filter(t => (t.name || '').toLowerCase().indexOf(keyword) >= 0);
    }

    this.setData({ filteredTenants: filtered });
  },

  setFilter(e) {
    const { key, val } = e.currentTarget.dataset;
    const filters = this.data.filters;
    filters[key] = val;
    this.setData({ filters }, () => this._applyFilter());
  },

  onNameSearchInput(e) {
    this.setData({ nameSearch: e.detail.value }, () => this._applyFilter());
  },

  showAddModal() {
    this.setData({
      showAddModal: true, editingTenant: null,
      form: { name: '', idCard: '', phone: '' }
    });
  },

  closeModal() { this.setData({ showAddModal: false, editingTenant: null }); },

  onFormInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['form.' + field]: e.detail.value });
  },

  editTenant(e) {
    const tenant = e.currentTarget.dataset.tenant;
    this.setData({
      showAddModal: true, editingTenant: tenant,
      form: { name: tenant.name || '', idCard: tenant.idCard || '', phone: tenant.phone || '' }
    });
  },

  showTenantMore(e) {
    const tenant = e.currentTarget.dataset.tenant;
    if (!tenant) return;
    const itemList = tenant.isActive
      ? ['编辑资料', '办理退租']
      : ['创建合同', '编辑资料', '删除租客'];
    wx.showActionSheet({
      itemList,
      success: (res) => {
        const action = itemList[res.tapIndex];
        if (action === '创建合同') {
          wx.navigateTo({ url: `/pages/create-lease/index?tenantId=${tenant._id}` });
          return;
        }
        if (action === '编辑资料') {
          this.editTenant({ currentTarget: { dataset: { tenant } } });
          return;
        }
        if (action === '办理退租') {
          this.handleMoveOut({ currentTarget: { dataset: { tenant } } });
          return;
        }
        if (action === '删除租客') {
          this.deleteTenant({ currentTarget: { dataset: { id: tenant._id } } });
        }
      }
    });
  },

  async saveTenant() {
    if (this.data.saving) return;
    const form = this.data.form;
    const msg = V.run([
      { fn: V.required, args: [form.name, '租客姓名'] },
      { fn: V.phone, args: [form.phone] },
      { fn: V.idCard, args: [form.idCard] },
    ]);
    if (msg) { wx.showToast({ title: msg, icon: 'none' }); return; }

    this.setData({ saving: true });
    try {
      if (this.data.editingTenant) {
        await api.updateTenant(this.data.editingTenant._id, form);
      } else {
        await api.addTenant(form);
      }
      wx.showToast({ title: '保存成功', icon: 'success' });
      this.closeModal();
      this.loadTenants();
    } catch (e) {
      console.error('保存租客失败', e);
      wx.showToast({ title: e.message || '保存失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  },

  async deleteTenant(e) {
    const id = (e.currentTarget.dataset && e.currentTarget.dataset.id)
      || (this.data.editingTenant && this.data.editingTenant._id);
    if (!id) return;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个租客吗？有活跃合同时无法删除。',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.deleteTenant(id);
            wx.showToast({ title: '已删除', icon: 'success' });
            this.closeModal();
            this.loadTenants();
          } catch (e) {
            wx.showToast({ title: e.message || '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  async handleMoveOut(e) {
    const tenant = e.currentTarget.dataset.tenant;
    if (!tenant.leaseInfo) {
      wx.showToast({ title: '该租客无活跃合同', icon: 'none' });
      return;
    }
    const today = new Date().toISOString().slice(0, 10);
    this.setData({
      showMoveOutModal: true,
      moveOutLease: tenant.leaseInfo,
      moveOutTenantName: tenant.name,
      moveOutTenantHouse: tenant.houseLabel,
      moveOutDate: today,
      damageAmount: 0,
      moveOutElectricity: '',
      moveOutWater: '',
      lastElectricityReading: Number(tenant.leaseInfo.moveInElectricity || 0),
      lastWaterReading: Number(tenant.leaseInfo.moveInWater || 0),
      settlementPreview: null,
      outstandingBills: [],
      outstandingAmount: 0,
      loadingMoveOutBills: true,
      settlementResult: null,
      paidRentBills: [],
      totalPaidRent: 0,
      paidRentDetails: []
    });
    await this.loadMoveOutSettlementData(tenant.leaseInfo);
  },

  async loadMoveOutSettlementData(lease) {
    try {
      const [res, recordsRes, prices] = await Promise.all([
        api.getBills({ leaseId: lease._id }),
        api.getUtilityRecords({ leaseId: lease._id }),
        api.getUtilityPrices()
      ]);
      const allBills = res.data || [];
      const bills = allBills.filter(b => b.status !== 'paid').map(b => ({
        ...b,
        remaining: Number(b.amount || 0) - Number(b.paidAmount || 0)
      })).filter(b => b.remaining > 0);
      const outstandingAmount = bills.reduce((sum, b) => sum + b.remaining, 0);
      const records = recordsRes.data || [];
      const lastRecord = records[0] || null;
      const lastElectricityReading = Number(lastRecord ? lastRecord.electricityReading : (lease.moveInElectricity || 0));
      const lastWaterReading = Number(lastRecord ? lastRecord.waterReading : (lease.moveInWater || 0));
      const paidRentBills = allBills.filter(b => b.type === 'rent' && ['paid', 'partial'].includes(b.status));
      const totalPaidRent = paidRentBills.reduce((sum, b) => sum + Number(b.paidAmount || 0), 0);
      const paidRentDetails = paidRentBills.map(b => ({
        period: b.period,
        amount: Number(b.paidAmount || 0),
        coverageStart: b.rentCoverageStart || '',
        coverageEnd: b.rentCoverageEnd || ''
      }));
      this.setData({
        outstandingBills: bills,
        outstandingAmount,
        lastElectricityReading,
        lastWaterReading,
        electricityPrice: Number(prices.electricityPrice || 0.8),
        waterPrice: Number(prices.waterPrice || 3.5),
        moveOutElectricity: String(lastElectricityReading),
        moveOutWater: String(lastWaterReading),
        paidRentBills,
        totalPaidRent,
        paidRentDetails
      }, () => this.updateSettlementPreview());
    } catch (e) {
      console.error('加载退租欠款失败', e);
      wx.showToast({ title: '欠款检查失败，请稍后重试', icon: 'none' });
    } finally {
      this.setData({ loadingMoveOutBills: false });
    }
  },

  closeMoveOut() { this.setData({ showMoveOutModal: false, moveOutLease: null }); },

  onMoveOutDateChange(e) { this.setData({ moveOutDate: e.detail.value }); },
  onDamageAmountInput(e) { this.setData({ damageAmount: Number(e.detail.value) || 0 }, () => this.updateSettlementPreview()); },
  onMoveOutElectricityInput(e) { this.setData({ moveOutElectricity: e.detail.value }, () => this.updateSettlementPreview()); },
  onMoveOutWaterInput(e) { this.setData({ moveOutWater: e.detail.value }, () => this.updateSettlementPreview()); },

  updateSettlementPreview() {
    const electricityReading = Number(this.data.moveOutElectricity);
    const waterReading = Number(this.data.moveOutWater);
    const electricityUsage = Math.max(0, electricityReading - Number(this.data.lastElectricityReading || 0));
    const waterUsage = Math.max(0, waterReading - Number(this.data.lastWaterReading || 0));
    const utilityCost = Math.round((
      electricityUsage * Number(this.data.electricityPrice || 0.8) +
      waterUsage * Number(this.data.waterPrice || 3.5)
    ) * 100) / 100;
    const lease = this.data.moveOutLease;
    const deposit = Number(lease ? lease.deposit : 0);
    const damageAmount = Number(this.data.damageAmount || 0);
    const refundableDeposit = deposit - damageAmount;
    const payableBeforeDeposit = Math.round((Number(this.data.outstandingAmount || 0) + utilityCost) * 100) / 100;
    const depositForOffset = Math.max(0, refundableDeposit);
    const depositOffset = Math.round(Math.min(depositForOffset, payableBeforeDeposit) * 100) / 100;
    const refundAmount = Math.round(Math.max(0, depositForOffset - depositOffset) * 100) / 100;
    const damageExtraDue = damageAmount > deposit ? Math.round((damageAmount - deposit) * 100) / 100 : 0;
    const extraPayment = Math.round((Math.max(0, payableBeforeDeposit - depositOffset) + damageExtraDue) * 100) / 100;

    const moveInDate = lease ? new Date(lease.startDate) : null;
    const moveOutDate = this.data.moveOutDate ? new Date(this.data.moveOutDate) : null;
    let rentRefund = null;
    if (moveInDate && moveOutDate && moveOutDate >= moveInDate) {
      const occupiedMonths = (moveOutDate.getFullYear() - moveInDate.getFullYear()) * 12
                             + moveOutDate.getMonth() - moveInDate.getMonth()
                             + (moveOutDate.getDate() >= moveInDate.getDate() ? 1 : 0);
      const monthlyRent = Number(lease.rent || 0);
      const actualRentDue = Math.round(occupiedMonths * monthlyRent * 100) / 100;
      const totalPaidRent = Number(this.data.totalPaidRent || 0);
      const overpaidRent = Math.max(0, totalPaidRent - actualRentDue);
      const startDateStr = `${moveInDate.getFullYear()}-${String(moveInDate.getMonth() + 1).padStart(2, '0')}-${String(moveInDate.getDate()).padStart(2, '0')}`;
      const endDateStr = `${moveOutDate.getFullYear()}-${String(moveOutDate.getMonth() + 1).padStart(2, '0')}-${String(moveOutDate.getDate()).padStart(2, '0')}`;
      rentRefund = {
        occupiedPeriod: `${startDateStr} 至 ${endDateStr}`,
        occupiedMonths,
        actualRentDue,
        paidRentDetails: this.data.paidRentDetails || [],
        totalPaidRent,
        overpaidRent
      };
    }
    const overpaidRentAmount = rentRefund ? rentRefund.overpaidRent : 0;
    const totalRefund = Math.round((refundAmount + overpaidRentAmount - extraPayment) * 100) / 100;

    this.setData({
      settlementPreview: {
        electricityUsage,
        waterUsage,
        utilityCost,
        payableBeforeDeposit,
        depositOffset,
        refundAmount,
        extraPayment,
        rentRefund,
        totalRefund,
        damageAmount,
        damageExtraDue
      }
    });
  },

  async confirmMoveOut() {
    const lease = this.data.moveOutLease;
    if (!lease) return;
    if (this.data.loadingMoveOutBills) {
      wx.showToast({ title: '正在检查欠款', icon: 'none' });
      return;
    }
    const electricityReading = Number(this.data.moveOutElectricity);
    const waterReading = Number(this.data.moveOutWater);
    if (Number.isNaN(electricityReading) || Number.isNaN(waterReading)) {
      wx.showToast({ title: '请输入水电读数', icon: 'none' });
      return;
    }
    if (electricityReading < this.data.lastElectricityReading || waterReading < this.data.lastWaterReading) {
      wx.showToast({ title: '读数不能小于上次读数', icon: 'none' });
      return;
    }

    this.setData({ processingMoveOut: true });
    try {
      const result = await api.terminateLease({
        leaseId: lease._id,
        endDate: this.data.moveOutDate,
        damageAmount: this.data.damageAmount,
        electricityReading,
        waterReading
      });
      this.setData({ settlementResult: result });
      wx.showToast({ title: '退租成功', icon: 'success' });
      setTimeout(() => {
        this.setData({ showMoveOutModal: false, moveOutLease: null, settlementResult: null });
        this.loadTenants();
      }, 1500);
    } catch (e) {
      console.error('退租失败', e);
      wx.showToast({ title: e.message || '退租失败', icon: 'none' });
    } finally {
      this.setData({ processingMoveOut: false });
    }
  },

  // 跳转创建合同（为该租客创建合同）
  goToCreateLease(e) {
    const tenantId = e.currentTarget.dataset.tenantId;
    wx.navigateTo({ url: `/pages/create-lease/index?tenantId=${tenantId}` });
  },

  viewTenantDetail(e) {
    const tenantId = e.currentTarget.dataset.tenantId;
    wx.navigateTo({ url: `/pages/tenant-detail/index?tenantId=${tenantId}` });
  },

  stopPropagation() {}
};

module.exports = tenantPageConfig;
