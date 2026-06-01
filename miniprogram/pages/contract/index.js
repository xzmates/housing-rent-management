const dbService = require('../../services/database');

Page({
  data: {
    loading: true,
    contract: null
  },

  onLoad(options) {
    const tenantId = options.tenantId;
    if (tenantId) {
      this.loadContract(tenantId);
    } else {
      this.setData({ loading: false });
    }
  },

  async loadContract(tenantId) {
    this.setData({ loading: true });
    try {
      const tenant = await dbService.getTenantById(tenantId);

      if (!tenant) {
        this.setData({ loading: false });
        return;
      }

      const house = tenant.houseId ? await dbService.getHouseById(tenant.houseId) : null;

      let landlordInfo = { name: '房东姓名', phone: '请填写联系电话' };
      try {
        const settingsResult = await dbService.getSystemSettings();
        if (settingsResult.data && settingsResult.data[0]) {
          const s = settingsResult.data[0];
          if (s.landlordName) landlordInfo.name = s.landlordName;
          if (s.landlordPhone) landlordInfo.phone = s.landlordPhone;
        }
      } catch (e) { /* ignore */ }

      const cycle = tenant.paymentCycle || 'month';
      const cycleMonths = { month: 1, quarter: 3, half_year: 6, year: 12 };
      const paymentMonths = cycleMonths[cycle] || 1;
      const monthlyRent = tenant.rent || house?.rent || 0;
      const paymentAmount = monthlyRent * paymentMonths;
      const deposit = tenant.deposit || 0;
      const moveInDate = tenant.moveInDate ? new Date(tenant.moveInDate) : new Date();
      const cycleLabels = { month: '月付', quarter: '季付', half_year: '半年付', year: '年付' };

      const contract = {
        contractNo: `HT-${moveInDate.getFullYear()}${String(moveInDate.getMonth() + 1).padStart(2, '0')}${String(moveInDate.getDate()).padStart(2, '0')}-${tenantId.substring(0, 6)}`,
        signDate: moveInDate.toLocaleDateString('zh-CN'),
        houseCode: house?.code || '未知',
        houseAddress: house?.address || '未知',
        moveInDate: tenant.moveInDate ? new Date(tenant.moveInDate).toLocaleDateString('zh-CN') : '未设置',
        monthlyRent,
        paymentCycle: cycle,
        paymentCycleLabel: cycleLabels[cycle] || cycle,
        paymentMonths,
        paymentAmount,
        deposit,
        firstPaymentTotal: deposit + paymentAmount,
        landlord: landlordInfo,
        tenant: {
          name: tenant.name,
          idCard: tenant.idCard || '未填写',
          phone: tenant.phone || '未填写'
        }
      };

      this.setData({ contract });
    } catch (e) {
      console.error('加载合同信息失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  }
});
