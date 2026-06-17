const parser = require('../../utils/parser');
const api = require('../../services/api');

const ACTION_LABELS = {
  create_house: '新建房屋',
  update_house: '更新房屋',
  create_tenant: '新建租客',
  update_tenant: '补全租客',
  create_lease: '创建合同',
  create_payment: '记录缴费',
  checkout_tenant: '退租结算'
};

const ACTION_COLORS = {
  create_house: 'primary',
  update_house: 'primary',
  create_tenant: 'success',
  update_tenant: 'success',
  create_lease: 'primary',
  create_payment: 'warning',
  checkout_tenant: 'danger'
};

Page({
  data: {
    inputText: '',
    operations: [],
    showPreview: false,
    importing: false,
    importResult: null,
    expandedIndex: -1,
    actionLabels: ACTION_LABELS,
    actionColors: ACTION_COLORS
  },

  onTextInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  async onParse() {
    const text = this.data.inputText.trim();
    if (!text) {
      wx.showToast({ title: '请输入内容', icon: 'none' });
      return;
    }

    wx.showLoading({ title: 'AI智能识别中...' });
    try {
      const rawOps = await parser.aiParseInput(text);
      if (rawOps.length === 0) {
        wx.showToast({ title: '未识别到有效信息', icon: 'none' });
        return;
      }

      wx.showLoading({ title: '匹配已有记录中...' });
      const ops = await parser.resolveOperations(rawOps, api);

      this.setData({
        operations: ops,
        showPreview: true,
        expandedIndex: 0
      });
    } catch (e) {
      console.error('解析失败', e);
      wx.showToast({ title: '解析失败，请重试', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  toggleExpand(e) {
    const idx = e.currentTarget.dataset.index;
    this.setData({ expandedIndex: this.data.expandedIndex === idx ? -1 : idx });
  },

  onFieldEdit(e) {
    const { opIndex, field } = e.currentTarget.dataset;
    let value = e.detail.value;
    if (['rent', 'deposit', 'amount', 'electricityReading', 'waterReading',
         'moveInElectricity', 'moveInWater'].includes(field) && value !== '') {
      value = Number(value) || 0;
    }
    const key = `operations[${opIndex}].data.${field}`;
    const update = { [key]: value };

    if (field === 'paymentCycleLabel') {
      const CYCLE_MAP = { '月付': 'month', '季付': 'quarter', '半年付': 'half_year', '年付': 'year' };
      update[`operations[${opIndex}].data.paymentCycle`] = CYCLE_MAP[value] || 'month';
    }

    this.setData(update);
  },

  onDatePick(e) {
    const { opIndex, field } = e.currentTarget.dataset;
    const value = e.detail.value;
    this.setData({ [`operations[${opIndex}].data.${field}`]: value });
  },

  removeOp(e) {
    const idx = e.currentTarget.dataset.index;
    const ops = this.data.operations;
    ops.splice(idx, 1);
    this.setData({ operations: ops });
  },

  resetInput() {
    this.setData({
      inputText: '',
      operations: [],
      showPreview: false,
      importResult: null,
      expandedIndex: -1
    });
  },

  async confirmImport() {
    const ops = this.data.operations;
    if (ops.length === 0) return;

    wx.showModal({
      title: '确认执行',
      content: `即将执行 ${ops.length} 个操作，确定继续？`,
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ importing: true });
        try {
          const result = await parser.executeOperations(ops, api);
          this.setData({ importResult: result, showPreview: false });
          if (result.failed === 0) {
            wx.showToast({ title: `成功执行${result.success}个操作`, icon: 'success' });
          }
        } catch (e) {
          console.error('执行失败', e);
          wx.showToast({ title: '执行失败', icon: 'none' });
        } finally {
          this.setData({ importing: false });
        }
      }
    });
  },

  stopPropagation() {}
});
