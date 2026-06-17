const api = require('../../services/api');
const V = require('../../utils/validate');

Page({
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
    damageDeduction: 0,
    settlementResult: null,
    processingMoveOut: false
  },

  onLoad() {
    const today = new Date().toISOString().slice(0, 10);
    this.setData({ moveOutDate: today });
  },

  onPullDownRefresh() { this.loadTenants().then(() => wx.stopPullDownRefresh()); },
  onShow() { this.loadTenants(); },

  async loadTenants() {
    this.setData({ loading: true });
    try {
      const result = await api.getTenants();
      const tenants = result.data || [];

      // 为每个租客查询是否有活跃合同
      const enriched = await Promise.all(tenants.map(async (t) => {
        const tenant = { ...t, isActive: false, houseLabel: '', leaseInfo: null };
        try {
          const leaseRes = await api.getLeases({ tenantId: t._id, status: 'active' });
          if (leaseRes.data && leaseRes.data.length > 0) {
            tenant.isActive = true;
            const lease = leaseRes.data[0];
            tenant.leaseInfo = lease;
            // 加载房屋信息
            try {
              const house = await api.getHouseById(lease.houseId);
              tenant.houseLabel = house ? `${house.code} - ${house.address}` : '';
            } catch (e) { /* ignore */ }
          }
        } catch (e) { /* ignore */ }
        return tenant;
      }));

      // 排序：在住的排前面
      enriched.sort((a, b) => {
        if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
        return (a.name || '').localeCompare(b.name || '');
      });

      this.setData({ tenants: enriched }, () => this._applyFilter());
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

  async saveTenant() {
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
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个租客吗？有活跃合同时无法删除。',
      success: async (res) => {
        if (res.confirm) {
          try {
            await api.deleteTenant(id);
            wx.showToast({ title: '已删除', icon: 'success' });
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
      damageDeduction: 0,
      settlementResult: null
    });
  },

  closeMoveOut() { this.setData({ showMoveOutModal: false, moveOutLease: null }); },

  onMoveOutDateChange(e) { this.setData({ moveOutDate: e.detail.value }); },
  onDamageInput(e) { this.setData({ damageDeduction: Number(e.detail.value) || 0 }); },

  async confirmMoveOut() {
    const lease = this.data.moveOutLease;
    if (!lease) return;

    this.setData({ processingMoveOut: true });
    try {
      const result = await api.terminateLease(
        lease._id,
        this.data.moveOutDate,
        this.data.damageDeduction
      );
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
});
