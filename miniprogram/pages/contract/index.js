const api = require('../../services/api');

Page({
  data: {
    loading: true,
    contract: null
  },

  onLoad(options) {
    const leaseId = options.leaseId;
    const tenantId = options.tenantId;
    if (leaseId) {
      this.loadContractByLease(leaseId);
    } else if (tenantId) {
      this.loadContractByTenant(tenantId);
    } else {
      this.setData({ loading: false });
    }
  },

  async loadContractByLease(leaseId) {
    this.setData({ loading: true });
    try {
      const lease = await api.getLeaseById(leaseId);
      if (!lease) { this.setData({ loading: false }); return; }

      const [house, tenant] = await Promise.all([
        api.getHouseById(lease.houseId).catch(() => null),
        api.getTenantById(lease.tenantId).catch(() => null)
      ]);

      let landlordInfo = { name: '房东姓名', phone: '请填写联系电话' };
      try {
        const settings = await api.getSystemSettings();
        if (settings.data && settings.data[0]) {
          const s = settings.data[0];
          if (s.landlordName) landlordInfo.name = s.landlordName;
          if (s.landlordPhone) landlordInfo.phone = s.landlordPhone;
        }
      } catch (e) { /* ignore */ }

      const cycle = lease.paymentCycle || 'month';
      const cycleMonths = { month: 1, quarter: 3, half_year: 6, year: 12 };
      const paymentMonths = cycleMonths[cycle] || 1;
      const monthlyRent = lease.rent || 0;
      const paymentAmount = monthlyRent * paymentMonths;
      const deposit = lease.deposit || 0;
      const startDate = lease.startDate ? new Date(lease.startDate) : new Date();
      const cycleLabels = { month: '月付', quarter: '季付', half_year: '半年付', year: '年付' };

      const contract = {
        contractNo: `HT-${startDate.getFullYear()}${String(startDate.getMonth() + 1).padStart(2, '0')}${String(startDate.getDate()).padStart(2, '0')}-${leaseId.substring(0, 6)}`,
        signDate: startDate.toLocaleDateString('zh-CN'),
        houseCode: house?.code || '未知',
        houseAddress: house?.address || '未知',
        moveInDate: api.formatDate(lease.startDate),
        monthlyRent,
        paymentCycle: cycle,
        paymentCycleLabel: cycleLabels[cycle] || cycle,
        paymentMonths,
        paymentAmount,
        deposit,
        firstPaymentTotal: deposit + paymentAmount,
        landlord: landlordInfo,
        tenant: {
          name: tenant?.name || '未知',
          idCard: tenant?.idCard || '未填写',
          phone: tenant?.phone || '未填写'
        }
      };

      this.setData({ contract });
    } catch (e) {
      console.error('加载合同信息失败', e);
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async loadContractByTenant(tenantId) {
    this.setData({ loading: true });
    try {
      const leaseRes = await api.getLeases({ tenantId });
      const leases = leaseRes.data || [];
      if (leases.length === 0) {
        this.setData({ loading: false });
        return;
      }
      // 取最新的活跃合同，没有则取最新的
      const active = leases.find(l => l.status === 'active');
      const lease = active || leases[0];
      await this.loadContractByLease(lease._id);
    } catch (e) {
      console.error('加载合同失败', e);
      this.setData({ loading: false });
    }
  }
});
