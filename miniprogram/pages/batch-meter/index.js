const api = require('../../services/api');

function dateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDateText(value) {
  return dateKey(value).replace(/-/g, '/');
}

Page({
  data: {
    loading: true, submitting: false,
    meters: [],
    utilityPrices: { electricityPrice: 0.8, waterPrice: 3.5 },
    today: dateKey(),
    totalCost: 0,
    totalCostText: '0.0'
  },

  onLoad() {
    const today = dateKey();
    this.setData({ today });
    this.loadData();
  },
  onShow() { this.loadData(); },

  onCalculationDateChange(e) {
    const index = Number(e.currentTarget.dataset.index);
    const calculationDate = e.detail.value;
    if (!calculationDate || !Number.isInteger(index)) return;
    this.setData({ [`meters[${index}].calculationDate`]: calculationDate });
  },

  async loadData() {
    this.setData({ loading: true });
    try {
      const prices = await api.getUtilityPrices();
      const leaseRes = await api.getLeases({ status: 'active' });
      const leases = leaseRes.data || [];

      const meters = [];
      for (const lease of leases) {
        let house = null, tenant = null;
        try {
          [house, tenant] = await Promise.all([
            api.getHouseById(lease.houseId).catch(() => null),
            api.getTenantById(lease.tenantId).catch(() => null)
          ]);
        } catch (e) { continue; }

        // 获取上次抄表读数
        let lastElec = lease.moveInElectricity || 0;
        let lastWater = lease.moveInWater || 0;
        let lastReadDate = '入住读数';
        let latest = null;
        try {
          const records = await api.getUtilityRecords({ houseId: lease.houseId });
          if (records.data && records.data.length > 0) {
            latest = records.data[0];
            lastElec = latest.electricityReading || lastElec;
            lastWater = latest.waterReading || lastWater;
            lastReadDate = api.formatDate(latest.calculationDate || latest.createdAt) || '未知时间';
          }
        } catch (e) { /* use move-in readings */ }

        meters.push({
          leaseId: lease._id,
          houseId: lease.houseId,
          houseLabel: house ? `${house.code} - ${house.address}` : '未知房屋',
          tenantName: tenant?.name || '未知租客',
          lastElec, lastWater, lastReadDate,
          lastReadDateKey: lastReadDate === '入住读数' ? dateKey(lease.startDate) : dateKey(latest && (latest.calculationDate || latest.createdAt)),
          calculationDate: this.data.today || dateKey(),
          currentElec: '', currentWater: '',
          elecUsage: 0, waterUsage: 0,
          elecCost: 0, waterCost: 0, rowCost: 0,
          elecCostText: '0.0', waterCostText: '0.0', rowCostText: '0.0',
          hasError: false, errorMsg: ''
        });
      }

      // 排序
      const addrOrder = { '东楼北': 1, '东楼南': 2, '里召': 3 };
      meters.sort((a, b) => {
        const ha = a.houseLabel, hb = b.houseLabel;
        const aa = addrOrder[ha.split(' - ')[1]] ?? 99;
        const bb = addrOrder[hb.split(' - ')[1]] ?? 99;
        if (aa !== bb) return aa - bb;
        return ha.localeCompare(hb);
      });

      this.setData({ meters, utilityPrices: prices, loading: false });
    } catch (e) {
      console.error('加载数据失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
      this.setData({ loading: false });
    }
  },

  onElecInput(e) {
    this._updateRow(e.currentTarget.dataset.index, 'currentElec', e.detail.value);
  },

  onWaterInput(e) {
    this._updateRow(e.currentTarget.dataset.index, 'currentWater', e.detail.value);
  },

  _updateRow(idx, field, val) {
    const meters = this.data.meters;
    const row = meters[idx];
    row[field] = val;

    const currentElec = Number(row.currentElec) || 0;
    const currentWater = Number(row.currentWater) || 0;

    row.hasError = false;
    row.errorMsg = '';
    if (currentElec > 0 && currentElec < row.lastElec) {
      row.hasError = true;
      row.errorMsg = '电表读数小于上次';
    }
    if (currentWater > 0 && currentWater < row.lastWater) {
      row.hasError = true;
      row.errorMsg = (row.errorMsg ? row.errorMsg + '，' : '') + '水表读数小于上次';
    }

    const prices = this.data.utilityPrices;
    row.elecUsage = row.hasError ? 0 : Math.max(0, currentElec - row.lastElec);
    row.waterUsage = row.hasError ? 0 : Math.max(0, currentWater - row.lastWater);
    row.elecCost = row.elecUsage * prices.electricityPrice;
    row.waterCost = row.waterUsage * prices.waterPrice;
    row.rowCost = row.elecCost + row.waterCost;
    row.elecCostText = row.elecCost.toFixed(1);
    row.waterCostText = row.waterCost.toFixed(1);
    row.rowCostText = row.rowCost.toFixed(1);

    this.setData({ [`meters[${idx}]`]: row }, () => this._calcTotal());
  },

  _calcTotal() {
    const total = this.data.meters.reduce((sum, m) => sum + m.rowCost, 0);
    this.setData({ totalCost: total, totalCostText: total.toFixed(1) });
  },

  async submitAll() {
    const meters = this.data.meters;
    const toSubmit = meters.filter(m => {
      const hasInput = (Number(m.currentElec) > 0) || (Number(m.currentWater) > 0);
      return hasInput && !m.hasError;
    });

    if (toSubmit.length === 0) {
      wx.showToast({ title: '请至少填写一条有效读数', icon: 'none' });
      return;
    }

    const dateConflict = toSubmit.find(m => m.lastReadDateKey && (m.calculationDate || dateKey()) < m.lastReadDateKey);
    if (dateConflict) {
      wx.showToast({ title: `${dateConflict.houseLabel} 的抄表日期不能早于 ${formatDateText(dateConflict.lastReadDateKey)}`, icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认提交',
      content: `将按各房屋选择的日期提交 ${toSubmit.length} 条抄表记录，合计 ¥${this.data.totalCost.toFixed(1)}`,
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ submitting: true });

        let successCount = 0;
        for (const m of toSubmit) {
          try {
            await api.addMeterReading({
              leaseId: m.leaseId,
              electricityReading: Number(m.currentElec) || 0,
              waterReading: Number(m.currentWater) || 0,
              calculationDate: m.calculationDate || dateKey()
            });
            successCount++;
          } catch (e) {
            console.error(`提交失败: ${m.houseLabel}`, e);
            break;
          }
        }

        this.setData({ submitting: false });
        wx.showToast({ title: `成功提交 ${successCount} 条`, icon: 'success' });
        this.loadData();
      }
    });
  }
});
