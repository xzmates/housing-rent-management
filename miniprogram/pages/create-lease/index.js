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
    mode: 'new',
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
    history: {
      houseMode: 'existing',
      tenantMode: 'create',
      documentStartDate: '',
      documentEndDate: '',
      documentRent: '',
      documentDeposit: '',
      documentPaymentCycle: 'month',
      documentPaymentIndex: 0,
      occupancyState: 'active_contract',
      actualEndDate: '',
      rentCoveredUntil: '',
      updateHouseRent: true,
      systemHouseRent: 0,
      newHouseCode: '',
      newHouseAddress: '',
      newTenantName: '',
      newTenantIdCard: '',
      newTenantPhone: '',
      newTenantRemark: '',
      utilityDate: '',
      utilityElectricity: '',
      utilityWater: '',
      houseOriginalText: '',
      paymentTermsText: '',
      ocrText: '',
      ocrExpanded: false,
      uncertainLabels: [],
      uncertainText: ''
    },
    historyDraft: null,
    lastHouseReading: null,
    lastHouseReadDate: '',
    // 预填参数
    presetTenantId: '',
    presetHouseId: '',
    // 外部流程明确提供的押金；未提供时随房屋月租自动带入
    presetDeposit: null,
    confirmationId: ''
  },

  onLoad(options) {
    const today = new Date().toISOString().slice(0, 10);
    const mode = options.mode === 'history' ? 'history' : 'new';
    const app = getApp();
    const pageId = typeof this.getPageId === 'function' ? this.getPageId() : '';
    const handoff = app && app.takeAgentHandoff && pageId ? app.takeAgentHandoff(pageId) : null;
    const payload = handoff && handoff.payload;
    const input = payload && payload.type === 'createLease' ? (payload.input || {}) : {};
    const inputDeposit = Number(input.deposit);
    const hasPresetDeposit = Number.isFinite(inputDeposit) && inputDeposit > 0;
    this.setData({
      mode,
      'form.startDate': mode === 'history' ? '' : today,
      'form.rent': mode === 'history' ? '' : 0,
      'form.deposit': mode === 'history' ? '' : 0,
      presetTenantId: input.tenantId || options.tenantId || '',
      presetHouseId: input.houseId || options.houseId || '',
      confirmationId: payload && payload.confirmationId || '',
      presetDeposit: hasPresetDeposit ? inputDeposit : null,
      'form.startDate': input.startDate || (mode === 'history' ? '' : today),
      'form.rent': input.rent || (mode === 'history' ? '' : 0),
      'form.deposit': hasPresetDeposit ? inputDeposit : (mode === 'history' ? '' : 0),
      'form.paymentCycle': input.paymentCycle || 'month',
      'form.moveInElectricity': Number(input.moveInElectricity || 0),
      'form.moveInWater': Number(input.moveInWater || 0),
      'form.meterReplaced': !!input.meterReplaced,
      'form.remark': input.remark || ''
    });
    if (mode === 'history') {
      const channel = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (channel && channel.on) {
        channel.on('historicalLeaseDraft', draft => {
          this.setData({ historyDraft: draft || {} });
          this.applyHistoricalDraft(draft || {});
        });
      }
    }
    this.loadData();
  },

  applyHistoricalDraft(draft) {
    const today = new Date().toISOString().slice(0, 10);
    const warningLabels = {
      tenantName: '租客姓名', idCard: '身份证', phone: '手机号', houseOriginalText: '房屋描述',
      startDate: '起租日期', endDate: '合同结束日期', rent: '月租金', deposit: '押金',
      paymentTermsText: '付款方式', rentCoveredUntil: '租金已缴至', utilityDate: '水电结清日期',
      utilityElectricity: '电表读数', utilityWater: '水表读数'
    };
    const updates = {
      'form.startDate': draft.startDate || '',
      'form.rent': draft.rent === '' || draft.rent === undefined ? '' : draft.rent,
      'form.deposit': draft.deposit === '' || draft.deposit === undefined ? '' : draft.deposit,
      'form.paymentCycle': draft.paymentCycle || 'month',
      'form.paymentIndex': ['month', 'quarter', 'half_year', 'year'].indexOf(draft.paymentCycle || 'month'),
      'history.documentStartDate': draft.startDate || '',
      'history.documentEndDate': draft.endDate || '',
      'history.documentRent': draft.rent === '' || draft.rent === undefined ? '' : draft.rent,
      'history.documentDeposit': draft.deposit === '' || draft.deposit === undefined ? '' : draft.deposit,
      'history.documentPaymentCycle': draft.paymentCycle || 'month',
      'history.documentPaymentIndex': ['month', 'quarter', 'half_year', 'year'].indexOf(draft.paymentCycle || 'month'),
      'history.occupancyState': draft.endDate && (draft.endDate < (draft.rentCoveredUntil || '') || draft.endDate < today) ? 'continued_without_renewal' : 'active_contract',
      'history.houseOriginalText': draft.houseOriginalText || '',
      'history.paymentTermsText': draft.paymentTermsText || '',
      'history.rentCoveredUntil': draft.rentCoveredUntil || '',
      'history.utilityDate': draft.utilityDate || '',
      'history.utilityElectricity': draft.utilityElectricity === '' || draft.utilityElectricity === undefined ? '' : draft.utilityElectricity,
      'history.utilityWater': draft.utilityWater === '' || draft.utilityWater === undefined ? '' : draft.utilityWater,
      'history.ocrText': draft.ocrText || '',
      'history.ocrExpanded': false,
      'history.newTenantName': draft.tenantName || '',
      'history.newTenantIdCard': draft.idCard || '',
      'history.newTenantPhone': draft.phone || '',
      'history.uncertainLabels': (draft.uncertainFields || []).map(key => warningLabels[key] || key),
      'history.uncertainText': (draft.uncertainFields || []).map(key => warningLabels[key] || key).join('、')
    };
    this.setData(updates, () => this.selectExactTenantCandidate());
  },

  selectExactTenantCandidate() {
    if (this.data.mode !== 'history' || !this.data.tenants.length) return;
    const draft = this.data.historyDraft || {};
    const idCard = String(draft.idCard || '').replace(/\s+/g, '').toUpperCase();
    const phone = String(draft.phone || '').replace(/[\s-]/g, '');
    if (!idCard && !phone) return;
    const index = this.data.tenants.findIndex(item => (
      (idCard && String(item.idCard || '').replace(/\s+/g, '').toUpperCase() === idCard) ||
      (phone && String(item.phone || '').replace(/[\s-]/g, '') === phone)
    ));
    if (index >= 0) {
      this.setData({
        'history.tenantMode': 'existing',
        'form.tenantIndex': index,
        'form.tenantId': this.data.tenants[index]._id
      });
    }
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const [houseRes, tenantRes] = await Promise.all([
        api.getHousesWithOccupancy(),
        api.getTenantsWithOccupancy()
      ]);

      const historyMode = this.data.mode === 'history';
      const houses = (houseRes.data || []).filter(h => !h.hasActiveLease && (historyMode || h.status === 'available'));
      const tenants = (tenantRes.data || []).filter(t => !t.isActive);

      // 排序
      const addrOrder = { '东楼北': 1, '东楼南': 2, '里召': 3 };
      houses.sort((a, b) => {
        const aa = addrOrder[a.address] ?? 99, bb = addrOrder[b.address] ?? 99;
        if (aa !== bb) return aa - bb;
        return (parseInt(a.code, 10) || 0) - (parseInt(b.code, 10) || 0);
      });
      tenants.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

      const houseLabels = houses.map(h => `${h.code} - ${h.address}（¥${h.rent}/月${h.status !== 'available' ? '，状态待同步' : ''}）`);
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
          updates['form.deposit'] = this.data.presetDeposit || houses[idx].rent;
        }
      }

      this.setData(updates, () => {
        if (this.data.mode === 'history') this.selectExactTenantCandidate();
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
      if (this.data.mode !== 'history' || !Number(this.data.form.rent)) updates['form.rent'] = house.rent;
      if (this.data.mode !== 'history') updates['form.deposit'] = house.rent;
      if (this.data.mode === 'history') {
        updates['history.systemHouseRent'] = Number(house.rent || 0);
        updates['history.updateHouseRent'] = true;
      }
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

  onHistoryInput(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['history.' + field]: e.detail.value });
  },

  onHistoryDateChange(e) {
    const field = e.currentTarget.dataset.field;
    this.setData({ ['history.' + field]: e.detail.value });
  },

  onDocumentPaymentChange(e) {
    const index = Number(e.detail.value);
    const values = ['month', 'quarter', 'half_year', 'year'];
    this.setData({
      'history.documentPaymentIndex': index,
      'history.documentPaymentCycle': values[index] || 'month'
    });
  },

  chooseOccupancyState(e) {
    const occupancyState = e.currentTarget.dataset.state;
    this.setData({
      'history.occupancyState': occupancyState,
      'history.actualEndDate': occupancyState === 'ended' ? this.data.history.actualEndDate : ''
    });
  },

  toggleOcrText() {
    this.setData({ 'history.ocrExpanded': !this.data.history.ocrExpanded });
  },

  chooseHouseMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      'history.houseMode': mode,
      'form.houseId': mode === 'existing' ? this.data.form.houseId : '',
      'form.houseIndex': mode === 'existing' ? this.data.form.houseIndex : -1
    });
  },

  chooseTenantMode(e) {
    const mode = e.currentTarget.dataset.mode;
    this.setData({
      'history.tenantMode': mode,
      'form.tenantId': mode === 'existing' ? this.data.form.tenantId : '',
      'form.tenantIndex': mode === 'existing' ? this.data.form.tenantIndex : -1
    });
  },

  onUpdateHouseRentChange(e) {
    this.setData({ 'history.updateHouseRent': !!e.detail.value });
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
    if (this.data.mode === 'history') {
      await this.submitHistoricalImport();
      return;
    }
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
            confirmationId: this.data.confirmationId || undefined,
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
  },

  async submitHistoricalImport() {
    if (this.data.saving) return;
    const form = this.data.form;
    const history = this.data.history;
    const required = [
      [form.startDate, '请确认起租日期'],
      [form.rent, '请确认合同月租'],
      [history.rentCoveredUntil, '请确认租金已缴至日期']
    ];
    const missing = required.find(item => !item[0]);
    if (missing) { wx.showToast({ title: missing[1], icon: 'none' }); return; }
    if (form.deposit === '' || form.deposit === null || Number(form.deposit) < 0) {
      wx.showToast({ title: '请确认押金，未收押金请输入0', icon: 'none' }); return;
    }
    if (history.occupancyState === 'ended' && !history.actualEndDate) {
      wx.showToast({ title: '请确认实际退租日期', icon: 'none' }); return;
    }
    if (history.houseMode === 'existing' && !form.houseId) { wx.showToast({ title: '请选择现有房屋', icon: 'none' }); return; }
    if (history.houseMode === 'create' && (!history.newHouseCode || !history.newHouseAddress)) { wx.showToast({ title: '请填写新房屋编号和地址', icon: 'none' }); return; }
    if (history.tenantMode === 'existing' && !form.tenantId) { wx.showToast({ title: '请选择现有租客', icon: 'none' }); return; }
    if (history.tenantMode === 'create' && !history.newTenantName) { wx.showToast({ title: '请填写租客姓名', icon: 'none' }); return; }

    const utilityStarted = history.utilityDate || history.utilityElectricity !== '' || history.utilityWater !== '';
    if (utilityStarted && (!history.utilityDate || history.utilityElectricity === '' || history.utilityWater === '')) {
      wx.showToast({ title: '水电日期和两个读数需同时填写', icon: 'none' }); return;
    }

    const params = {
      house: history.houseMode === 'existing' ? {
        mode: 'existing', houseId: form.houseId, updateRent: history.updateHouseRent, rent: Number(form.rent)
      } : {
        mode: 'create', code: history.newHouseCode, address: history.newHouseAddress, rent: Number(form.rent)
      },
      tenant: history.tenantMode === 'existing' ? {
        mode: 'existing', tenantId: form.tenantId
      } : {
        mode: 'create', name: history.newTenantName, idCard: history.newTenantIdCard,
        phone: history.newTenantPhone, remark: history.newTenantRemark
      },
      lease: {
        startDate: form.startDate,
        actualEndDate: history.actualEndDate,
        documentStartDate: history.documentStartDate || form.startDate,
        documentEndDate: history.documentEndDate,
        documentTerms: {
          rent: Number(history.documentRent || form.rent),
          deposit: Number(history.documentDeposit === '' ? form.deposit : history.documentDeposit),
          paymentCycle: history.documentPaymentCycle || form.paymentCycle
        },
        occupancyState: history.occupancyState,
        rent: Number(form.rent), deposit: Number(form.deposit),
        paymentCycle: form.paymentCycle, rentCoveredUntil: history.rentCoveredUntil, remark: form.remark
      },
      utilityBaseline: utilityStarted ? {
        calculationDate: history.utilityDate,
        electricityReading: Number(history.utilityElectricity),
        waterReading: Number(history.utilityWater)
      } : null
    };

    this.setData({ saving: true });
    try {
      const preview = await api.previewHistoricalLeaseImport(params);
      const view = preview.historicalImportView || {};
      const confirmed = await new Promise(resolve => wx.showModal({
        title: '确认历史合同建档',
        content: `历史已缴租金不生成账单或收款流水。将从 ${view.nextRentDueDate || '下一期'} 起生成待收账单 ${view.unpaidBillCount || 0} 笔。确定写入吗？`,
        confirmText: '确认建档',
        success: res => resolve(!!res.confirm),
        fail: () => resolve(false)
      }));
      if (!confirmed) return;
      await api.confirmHistoricalLeaseImport(preview.confirmationId);
      wx.showToast({ title: '历史合同已建档', icon: 'success' });
      setTimeout(() => wx.navigateBack({ delta: 2 }), 900);
    } catch (error) {
      console.error('历史合同建档失败', error);
      wx.showToast({ title: error.message || '建档失败', icon: 'none' });
    } finally {
      this.setData({ saving: false });
    }
  }
});
