const { db, cmd } = require('../utils/cloudbase');

// ========== 集合名称常量 ==========
const COLLECTIONS = {
  HOUSES: 'houses',
  TENANTS: 'tenants',
  PAYMENTS: 'payments',
  UTILITY_RECORDS: 'utility_records',
  SYSTEM_SETTINGS: 'system_settings'
};

// ========== 数据库服务类 ==========
const DatabaseService = {
  /**
   * 获取数据库引用
   */
  _db() {
    return db();
  },

  /**
   * 获取 command
   */
  _cmd() {
    return cmd();
  },

  // ==================== 房屋管理 ====================

  async addHouse(houseData) {
    const d = this._db();
    return d.collection(COLLECTIONS.HOUSES).add({
      data: Object.assign({}, houseData, {
        createdAt: db().serverDate(),
        updatedAt: db().serverDate(),
        status: 'available'
      })
    });
  },

  async getHouses(filters) {
    const d = this._db();
    const collection = d.collection(COLLECTIONS.HOUSES);
    const whereConditions = {};

    if (filters) {
      if (filters.status) whereConditions.status = filters.status;
      if (filters.code) whereConditions.code = filters.code;
      if (filters.minRent || filters.maxRent) {
        const rentConds = [];
        if (filters.minRent) rentConds.push(d.command.gte(Number(filters.minRent)));
        if (filters.maxRent) rentConds.push(d.command.lte(Number(filters.maxRent)));
        whereConditions.rent = rentConds.length === 1 ? rentConds[0] : d.command.and(rentConds);
      }
    }

    let result;
    if (Object.keys(whereConditions).length > 0) {
      result = await collection.where(whereConditions).orderBy('createdAt', 'desc').get();
    } else {
      result = await collection.orderBy('createdAt', 'desc').get();
    }
    return { data: result.data || [], total: result.data?.length || 0 };
  },

  async updateHouse(id, houseData) {
    const d = this._db();
    return d.collection(COLLECTIONS.HOUSES).doc(id).update({
      data: Object.assign({}, houseData, { updatedAt: db().serverDate() })
    });
  },

  async deleteHouse(id) {
    const d = this._db();
    return d.collection(COLLECTIONS.HOUSES).doc(id).remove();
  },

  async updateHouseStatus(houseId, status) {
    const d = this._db();
    return d.collection(COLLECTIONS.HOUSES).doc(houseId).update({
      data: { status, updatedAt: db().serverDate() }
    });
  },

  async getHouseById(id) {
    const d = this._db();
    const result = await d.collection(COLLECTIONS.HOUSES).doc(id).get();
    return result.data;
  },

  // ==================== 租客管理 ====================

  async addTenant(tenantData) {
    const d = this._db();

    // 检查房屋是否已有活跃租客
    const existing = await d.collection(COLLECTIONS.TENANTS)
      .where({ houseId: tenantData.houseId, status: 'active' })
      .limit(1)
      .get();
    if (existing.data.length > 0) {
      throw new Error('该房屋已有租客入住，无法重复绑定');
    }

    const lastPaymentDate = tenantData.lastPaymentDate
      ? new Date(tenantData.lastPaymentDate)
      : (tenantData.moveInDate ? new Date(tenantData.moveInDate) : new Date());

    // 添加租客
    const tenantResult = await d.collection(COLLECTIONS.TENANTS).add({
      data: {
        name: tenantData.name,
        idCard: tenantData.idCard || '',
        phone: tenantData.phone || '',
        houseId: tenantData.houseId,
        paymentCycle: tenantData.paymentCycle || 'month',
        deposit: Number(tenantData.deposit) || 0,
        rent: Number(tenantData.rent) || 0,
        moveInDate: tenantData.moveInDate || db().serverDate(),
        lastPaymentDate: lastPaymentDate,
        moveInElectricity: Number(tenantData.moveInElectricity) || 0,
        moveInWater: Number(tenantData.moveInWater) || 0,
        createdAt: db().serverDate(),
        updatedAt: db().serverDate(),
        status: 'active'
      }
    });

    const tenantId = tenantResult._id;

    // 创建押金缴费记录
    const depositAmount = Number(tenantData.deposit) || 0;
    if (depositAmount > 0) {
      await this.addPayment({
        houseId: tenantData.houseId,
        tenantId,
        paymentType: 'deposit',
        amount: depositAmount,
        description: '押金',
        period: '押金',
        paymentDate: lastPaymentDate,
        status: 'paid'
      });
    }

    // 根据支付周期计算首次租金
    const monthlyRent = Number(tenantData.rent) || 0;
    let paymentMonths = 1;
    switch (tenantData.paymentCycle) {
      case 'quarter': paymentMonths = 3; break;
      case 'half_year': paymentMonths = 6; break;
      case 'year': paymentMonths = 12; break;
      default: paymentMonths = 1;
    }
    const rentAmount = monthlyRent * paymentMonths;

    if (rentAmount > 0) {
      const cycleLabels = { month: '月付', quarter: '季付', half_year: '半年付', year: '年付' };
      const refDate = new Date(lastPaymentDate);
      await this.addPayment({
        houseId: tenantData.houseId,
        tenantId,
        paymentType: 'rent',
        amount: rentAmount,
        description: `最近一次租金（${cycleLabels[tenantData.paymentCycle] || '月付'}，${paymentMonths}个月）`,
        paymentDate: refDate,
        period: `${refDate.getFullYear()}-${refDate.getMonth() + 1}`,
        status: 'paid'
      });
    }

    // 更新房屋状态为已租
    await this.updateHouseStatus(tenantData.houseId, 'rented');

    return { success: true, id: tenantId, message: '租客添加成功' };
  },

  async getTenants(filters) {
    const d = this._db();
    const collection = d.collection(COLLECTIONS.TENANTS);
    const whereConditions = {};

    if (filters) {
      if (filters.status) whereConditions.status = filters.status;
      if (filters.houseId) whereConditions.houseId = filters.houseId;
    }

    let result;
    if (Object.keys(whereConditions).length > 0) {
      result = await collection.where(whereConditions).orderBy('createdAt', 'desc').get();
    } else {
      result = await collection.orderBy('createdAt', 'desc').get();
    }
    return { data: result.data || [], total: result.data?.length || 0 };
  },

  async updateTenant(id, tenantData) {
    const d = this._db();
    return d.collection(COLLECTIONS.TENANTS).doc(id).update({
      data: Object.assign({}, tenantData, { updatedAt: db().serverDate() })
    });
  },

  async moveOutTenant(id, moveOutDate) {
    const d = this._db();

    const tenantResult = await d.collection(COLLECTIONS.TENANTS).doc(id).get();
    const houseId = tenantResult.data?.houseId;

    // 更新租客状态
    await d.collection(COLLECTIONS.TENANTS).doc(id).update({
      data: { status: 'moved_out', moveOutDate, updatedAt: db().serverDate() }
    });

    // 更新房屋状态为可租
    if (houseId) {
      await this.updateHouseStatus(houseId, 'available');
    }

    return { success: true, houseId };
  },

  async deleteTenant(id) {
    const d = this._db();
    return d.collection(COLLECTIONS.TENANTS).doc(id).remove();
  },

  async getTenantById(id) {
    const d = this._db();
    const result = await d.collection(COLLECTIONS.TENANTS).doc(id).get();
    return result.data;
  },

  // ==================== 缴费记录 ====================

  async addPayment(paymentData) {
    const d = this._db();

    const result = await d.collection(COLLECTIONS.PAYMENTS).add({
      data: {
        houseId: paymentData.houseId,
        tenantId: paymentData.tenantId,
        paymentType: paymentData.paymentType,
        amount: Number(paymentData.amount) || 0,
        description: paymentData.description || '',
        paymentDate: paymentData.paymentDate || db().serverDate(),
        period: paymentData.period || '',
        status: paymentData.status || 'paid',
        createdAt: db().serverDate()
      }
    });

    // 如果是已缴租金，更新租金覆盖期限
    if ((paymentData.status === 'paid' || !paymentData.status)
        && paymentData.paymentType === 'rent' && paymentData.tenantId) {
      await this._updateRentCoverage(paymentData.tenantId, Number(paymentData.amount) || 0);
    }

    return { success: true, id: result._id, message: '缴费记录添加成功' };
  },

  async getPayments(filters) {
    const d = this._db();
    const collection = d.collection(COLLECTIONS.PAYMENTS);
    const whereConditions = {};

    if (filters) {
      if (filters.houseId) whereConditions.houseId = filters.houseId;
      if (filters.tenantId) whereConditions.tenantId = filters.tenantId;
      if (filters.paymentType) whereConditions.paymentType = filters.paymentType;
      if (filters.status) whereConditions.status = filters.status;
    }

    let result;
    if (Object.keys(whereConditions).length > 0) {
      result = await collection.where(whereConditions).orderBy('paymentDate', 'desc').get();
    } else {
      result = await collection.orderBy('paymentDate', 'desc').get();
    }

    let data = result.data || [];

    // 日期前端过滤（NoSQL对日期比较支持有限）
    if (filters) {
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        data = data.filter(d => new Date(d.paymentDate) >= start);
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setDate(end.getDate() + 1);
        data = data.filter(d => new Date(d.paymentDate) < end);
      }
    }

    // 按缴费日期降序+创建时间降序排列
    data.sort((a, b) => {
      const dateA = new Date(a.paymentDate).getTime();
      const dateB = new Date(b.paymentDate).getTime();
      if (dateA !== dateB) return dateB - dateA;
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();
    });

    return { data, total: data.length };
  },

  async updatePayment(id, paymentData) {
    const d = this._db();
    const result = await d.collection(COLLECTIONS.PAYMENTS).doc(id).update({
      data: Object.assign({}, paymentData, { updatedAt: db().serverDate() })
    });

    if (paymentData.status === 'paid') {
      const paymentResult = await d.collection(COLLECTIONS.PAYMENTS).doc(id).get();
      const payment = paymentResult.data;
      if (payment && payment.paymentType === 'rent' && payment.tenantId) {
        await this._updateRentCoverage(payment.tenantId, payment.amount);
      }
    }

    return result;
  },

  async deletePayment(id) {
    const d = this._db();

    let deletedPayment = null;
    try {
      const paymentResult = await d.collection(COLLECTIONS.PAYMENTS).doc(id).get();
      deletedPayment = paymentResult.data;
    } catch (e) { /* ignore */ }

    const result = await d.collection(COLLECTIONS.PAYMENTS).doc(id).remove();

    if (deletedPayment && deletedPayment.paymentType === 'rent'
        && deletedPayment.status === 'paid' && deletedPayment.tenantId) {
      await this._recalculateRentCoverage(deletedPayment.tenantId);
    }

    return result;
  },

  // ==================== 水电费记录 ====================

  async addUtilityRecord(recordData) {
    const d = this._db();
    return d.collection(COLLECTIONS.UTILITY_RECORDS).add({
      data: {
        houseId: recordData.houseId,
        tenantId: recordData.tenantId,
        electricityReading: Number(recordData.electricityReading) || 0,
        waterReading: Number(recordData.waterReading) || 0,
        electricityUsage: Number(recordData.electricityUsage) || 0,
        waterUsage: Number(recordData.waterUsage) || 0,
        electricityCost: Number(recordData.electricityCost) || 0,
        waterCost: Number(recordData.waterCost) || 0,
        totalCost: Number(recordData.totalCost) || 0,
        createdAt: db().serverDate(),
        calculationDate: db().serverDate()
      }
    });
  },

  async getUtilityRecords(filters) {
    const d = this._db();
    const collection = d.collection(COLLECTIONS.UTILITY_RECORDS);
    const whereConditions = {};

    if (filters) {
      if (filters.houseId) whereConditions.houseId = filters.houseId;
      if (filters.tenantId) whereConditions.tenantId = filters.tenantId;
      if (filters.startDate) {
        whereConditions.calculationDate = d.command.gte(filters.startDate);
      }
      if (filters.endDate) {
        whereConditions.calculationDate = whereConditions.calculationDate
          ? d.command.and([whereConditions.calculationDate, d.command.lte(filters.endDate)])
          : d.command.lte(filters.endDate);
      }
    }

    if (Object.keys(whereConditions).length > 0) {
      return collection.where(whereConditions).orderBy('calculationDate', 'desc').get();
    }
    return collection.orderBy('calculationDate', 'desc').get();
  },

  // ==================== 系统设置 ====================

  async getSystemSettings() {
    const d = this._db();
    const result = await d.collection(COLLECTIONS.SYSTEM_SETTINGS).limit(1).get();
    if (result.data.length === 0) {
      await d.collection(COLLECTIONS.SYSTEM_SETTINGS).add({
        data: { electricityPrice: 0.8, waterPrice: 3.5, updatedAt: db().serverDate() }
      });
      const created = await d.collection(COLLECTIONS.SYSTEM_SETTINGS).limit(1).get();
      return created;
    }
    return result;
  },

  async updateSystemSettings(settings) {
    const d = this._db();
    const current = await this.getSystemSettings();
    if (current.data.length > 0) {
      const id = current.data[0]._id;
      return d.collection(COLLECTIONS.SYSTEM_SETTINGS).doc(id).update({
        data: Object.assign({}, settings, { updatedAt: db().serverDate() })
      });
    }
    return d.collection(COLLECTIONS.SYSTEM_SETTINGS).add({
      data: Object.assign({}, settings, { updatedAt: db().serverDate() })
    });
  },

  async getUtilityPrices() {
    const settings = await this.getSystemSettings();
    return {
      electricityPrice: settings.data[0]?.electricityPrice || 0.8,
      waterPrice: settings.data[0]?.waterPrice || 3.5
    };
  },

  // ==================== 水电费计算 ====================

  async calculateUtilityBill(houseId, tenantId, currentElectricity, currentWater) {
    const d = this._db();

    const lastRecord = await d.collection(COLLECTIONS.UTILITY_RECORDS)
      .where({ houseId, tenantId })
      .orderBy('calculationDate', 'desc')
      .limit(1)
      .get();

    let lastElectricity = 0, lastWater = 0;
    if (lastRecord.data.length > 0) {
      const record = lastRecord.data[0];
      lastElectricity = record.electricityReading || 0;
      lastWater = record.waterReading || 0;
    }

    const settingsResult = await this.getSystemSettings();
    const settings = settingsResult.data[0];

    const electricityUsage = Math.max(0, currentElectricity - lastElectricity);
    const waterUsage = Math.max(0, currentWater - lastWater);
    const electricityCost = electricityUsage * (settings.electricityPrice || 0.8);
    const waterCost = waterUsage * (settings.waterPrice || 3.5);
    const totalCost = electricityCost + waterCost;

    await this.addUtilityRecord({
      houseId, tenantId,
      electricityReading: currentElectricity,
      waterReading: currentWater,
      electricityUsage, waterUsage, electricityCost, waterCost, totalCost
    });

    await this.addPayment({
      houseId, tenantId,
      paymentType: 'utility',
      amount: totalCost,
      description: `水电费：电${electricityUsage}度×${settings.electricityPrice}元/度 + 水${waterUsage}吨×${settings.waterPrice}元/吨`,
      period: `${new Date().getMonth() + 1}月`
    });

    return { electricityUsage, waterUsage, electricityCost, waterCost, totalCost };
  },

  // ==================== 预付租金核心逻辑 ====================

  /**
   * 计算租金覆盖期限
   */
  _calcRentCoverage(currentCoveredUntil, moveInDate, paymentAmount, monthlyRent) {
    const halfThreshold = monthlyRent / 2;
    const fullMonths = Math.floor(paymentAmount / monthlyRent);
    const remaining = paymentAmount - fullMonths * monthlyRent;

    let actualCoverageStart;
    if (currentCoveredUntil) {
      actualCoverageStart = new Date(currentCoveredUntil);
      actualCoverageStart.setDate(actualCoverageStart.getDate() + 1);
    } else {
      actualCoverageStart = new Date(moveInDate);
    }

    const endDate = new Date(actualCoverageStart);
    endDate.setMonth(endDate.getMonth() + fullMonths);

    let hasHalfMonth = false, depositIncrease = 0;
    if (remaining >= halfThreshold) {
      endDate.setDate(endDate.getDate() + 15);
      hasHalfMonth = true;
      depositIncrease = remaining - halfThreshold;
    } else if (remaining > 0) {
      depositIncrease = remaining;
    }

    const coveredUntil = new Date(endDate);
    coveredUntil.setDate(coveredUntil.getDate() - 1);
    const monthsCovered = fullMonths + (hasHalfMonth ? 0.5 : 0);

    return { newCoveredUntil: coveredUntil, monthsCovered, depositIncrease };
  },

  /**
   * 更新租金覆盖期限
   */
  async _updateRentCoverage(tenantId, paymentAmount) {
    try {
      const d = this._db();
      const tenantResult = await d.collection(COLLECTIONS.TENANTS).doc(tenantId).get();
      const tenant = tenantResult.data;
      if (!tenant) return;

      const monthlyRent = tenant.rent || 0;
      if (monthlyRent <= 0 || paymentAmount <= 0) return;

      const currentCoveredUntil = tenant.rentCoveredUntil ? new Date(tenant.rentCoveredUntil) : null;
      const moveInDate = new Date(tenant.moveInDate);

      const { newCoveredUntil, depositIncrease } = this._calcRentCoverage(
        currentCoveredUntil, moveInDate, paymentAmount, monthlyRent
      );

      const updateData = { rentCoveredUntil: newCoveredUntil, updatedAt: db().serverDate() };
      if (depositIncrease > 0) {
        updateData.deposit = (tenant.deposit || 0) + depositIncrease;
        updateData.rentDepositOverflow = (tenant.rentDepositOverflow || 0) + depositIncrease;
      }

      await d.collection(COLLECTIONS.TENANTS).doc(tenantId).update({ data: updateData });
    } catch (e) {
      console.warn('更新租金覆盖期限失败', e);
    }
  },

  /**
   * 重新计算租金覆盖期限（删除支付记录后调用）
   */
  async _recalculateRentCoverage(tenantId) {
    try {
      const d = this._db();
      const tenantResult = await d.collection(COLLECTIONS.TENANTS).doc(tenantId).get();
      const tenant = tenantResult.data;
      if (!tenant) return;

      const monthlyRent = tenant.rent || 0;
      if (monthlyRent <= 0) return;

      const allPayments = await d.collection(COLLECTIONS.PAYMENTS)
        .where({ tenantId, paymentType: 'rent', status: 'paid' })
        .orderBy('paymentDate', 'asc')
        .get();

      const remainingPayments = (allPayments.data || []).filter(p => p.amount > 0);
      const moveInDate = new Date(tenant.moveInDate);

      let currentCoveredUntil = null;
      let totalDepositOverflow = 0;
      for (const payment of remainingPayments) {
        const { newCoveredUntil, depositIncrease } = this._calcRentCoverage(
          currentCoveredUntil, moveInDate, payment.amount, monthlyRent
        );
        currentCoveredUntil = newCoveredUntil;
        totalDepositOverflow += depositIncrease;
      }

      const baseDeposit = (tenant.deposit || 0) - (tenant.rentDepositOverflow || 0);
      await d.collection(COLLECTIONS.TENANTS).doc(tenantId).update({
        data: {
          rentCoveredUntil: currentCoveredUntil,
          deposit: baseDeposit + totalDepositOverflow,
          rentDepositOverflow: totalDepositOverflow,
          updatedAt: db().serverDate()
        }
      });
    } catch (e) {
      console.warn('重新计算租金覆盖期限失败', e);
    }
  },

  // ==================== 下次收租计算 ====================

  async _calcNextRentDue(tenant, house) {
    let rentCoveredUntil;
    if (tenant.rentCoveredUntil) {
      rentCoveredUntil = new Date(tenant.rentCoveredUntil);
    } else {
      const d = this._db();
      const paymentsResult = await d.collection(COLLECTIONS.PAYMENTS)
        .where({ tenantId: tenant._id, paymentType: 'rent' })
        .orderBy('paymentDate', 'desc')
        .limit(1)
        .get();

      if (paymentsResult.data && paymentsResult.data.length > 0) {
        const baseDate = new Date(paymentsResult.data[0].paymentDate);
        const cycleMonths = { month: 1, quarter: 3, half_year: 6, year: 12 };
        const monthsToAdd = cycleMonths[tenant.paymentCycle] || 1;
        rentCoveredUntil = new Date(baseDate);
        rentCoveredUntil.setMonth(rentCoveredUntil.getMonth() + monthsToAdd);
        rentCoveredUntil.setDate(rentCoveredUntil.getDate() - 1);
      } else if (tenant.lastPaymentDate) {
        rentCoveredUntil = new Date(tenant.lastPaymentDate);
      } else {
        rentCoveredUntil = new Date(tenant.moveInDate);
      }
    }

    const nextDueDate = new Date(rentCoveredUntil);
    nextDueDate.setDate(nextDueDate.getDate() + 1);

    const cycleMonths = { month: 1, quarter: 3, half_year: 6, year: 12 };
    const monthsToAdd = cycleMonths[tenant.paymentCycle] || 1;
    const monthlyRent = tenant.rent || house.rent || 0;
    const rentAmount = monthlyRent * monthsToAdd;

    return {
      rentCoveredUntil, nextDueDate, amount: rentAmount,
      monthlyRent, houseCode: house.code, houseAddress: house.address,
      paymentMonths: monthsToAdd
    };
  },

  async getNextRentDueDate(tenantId) {
    const d = this._db();
    const tenantResult = await d.collection(COLLECTIONS.TENANTS).doc(tenantId).get();
    const tenant = tenantResult.data;
    if (!tenant) throw new Error('租客不存在');
    if (!tenant.houseId) throw new Error('租客房屋ID无效');

    const houseResult = await d.collection(COLLECTIONS.HOUSES).doc(tenant.houseId).get();
    const house = houseResult.data;
    if (!house) throw new Error('房屋不存在');

    return this._calcNextRentDue(tenant, house);
  },

  // ==================== 临近收费 ====================

  async getUpcomingRentHouses(days = 3) {
    const d = this._db();
    const tenantsResult = await d.collection(COLLECTIONS.TENANTS)
      .where({ status: 'active' }).get();
    const activeTenants = tenantsResult.data || [];

    const houseIds = [...new Set(activeTenants.map(t => t.houseId).filter(Boolean))];
    let houseMap = new Map();
    if (houseIds.length > 0) {
      const batchSize = 50;
      for (let i = 0; i < houseIds.length; i += batchSize) {
        const batch = houseIds.slice(i, i + batchSize);
        const housesResult = await d.collection(COLLECTIONS.HOUSES)
          .where({ _id: d.command.in(batch) }).get();
        (housesResult.data || []).forEach(h => houseMap.set(h._id, h));
      }
    }

    const upcomingHouses = [];
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + days);

    for (const tenant of activeTenants) {
      try {
        const house = houseMap.get(tenant.houseId);
        if (!house) continue;

        const rentInfo = await this._calcNextRentDue(tenant, house);
        const coveredUntil = rentInfo.rentCoveredUntil;
        const cycleM = rentInfo.paymentMonths;

        const firstDueDate = new Date(coveredUntil);
        firstDueDate.setDate(firstDueDate.getDate() + 1);

        const allDueDates = [firstDueDate];
        for (let i = 1; i <= 12; i++) {
          const d = new Date(firstDueDate);
          d.setMonth(d.getMonth() + i * cycleM);
          if (d.getDate() !== firstDueDate.getDate()) d.setDate(0);
          allDueDates.push(d);
        }

        const overdueItems = [];
        let upcomingItem = null;

        for (const dueDate of allDueDates) {
          const daysDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (dueDate < today) {
            overdueItems.push({ dueDate, amount: rentInfo.amount, daysOverdue: -daysDiff });
          } else if (dueDate <= targetDate && !upcomingItem) {
            upcomingItem = { dueDate, amount: rentInfo.amount, daysUntilDue: daysDiff };
          }
        }

        if (overdueItems.length > 0 || upcomingItem) {
          const totalOverdue = overdueItems.reduce((s, i) => s + i.amount, 0);
          const cycleLabels = { month: '月付', quarter: '季付', half_year: '半年付', year: '年付' };
          upcomingHouses.push({
            houseId: tenant.houseId,
            houseCode: rentInfo.houseCode,
            houseAddress: rentInfo.houseAddress,
            tenantId: tenant._id,
            tenantName: tenant.name,
            monthlyRent: rentInfo.monthlyRent,
            rentCoveredUntil: rentInfo.rentCoveredUntil,
            cycleLabel: cycleLabels[tenant.paymentCycle] || '月付',
            cycleAmount: rentInfo.amount,
            overdueItems,
            totalOverdue,
            upcomingItem,
            nextDueDate: upcomingItem?.dueDate || overdueItems[overdueItems.length - 1]?.dueDate,
            amount: rentInfo.amount,
            daysUntilDue: upcomingItem?.daysUntilDue ?? -(overdueItems[overdueItems.length - 1]?.daysOverdue ?? 0)
          });
        }
      } catch (e) {
        console.error(`计算租客 ${tenant._id} 收租日失败`, e);
      }
    }

    upcomingHouses.sort((a, b) => (a.daysUntilDue || 0) - (b.daysUntilDue || 0));
    return upcomingHouses;
  },

  // ==================== 退租结算 ====================

  async calculateMoveOutSettlement(tenantId, moveOutDate) {
    const d = this._db();
    const tenantResult = await d.collection(COLLECTIONS.TENANTS).doc(tenantId).get();
    const tenant = tenantResult.data;
    if (!tenant) throw new Error('租客不存在');
    if (!tenant.houseId) throw new Error('租客房屋ID无效');

    const houseResult = await d.collection(COLLECTIONS.HOUSES).doc(tenant.houseId).get();
    const house = houseResult.data;
    if (!house) throw new Error('房屋不存在');

    const moveOutDateObj = new Date(moveOutDate);
    const moveInDate = new Date(tenant.moveInDate);
    const daysUsed = Math.max(0, Math.ceil((moveOutDateObj.getTime() - moveInDate.getTime()) / (1000 * 60 * 60 * 24)));

    // 按实际日历月计算：跨越的月份边界数，不足整月按一个月计
    const _calcOwedMonths = (start, end) => {
      let months = (end.getFullYear() - start.getFullYear()) * 12
                  + (end.getMonth() - start.getMonth());
      if (end.getDate() > start.getDate()) months++;
      return Math.max(1, months);
    };

    const monthlyRent = tenant.rent || house.rent || 0;
    const owedMonths = _calcOwedMonths(moveInDate, moveOutDateObj);
    const owedRent = monthlyRent * owedMonths;
    const owedRentNote = `入住${daysUsed}天，按${owedMonths}个月计`;

    const rentPaymentsResult = await d.collection(COLLECTIONS.PAYMENTS)
      .where({ tenantId, paymentType: 'rent' }).get();
    const prepaidRent = rentPaymentsResult.data.reduce((sum, p) => sum + (p.amount || 0), 0);
    const depositAmount = tenant.deposit || 0;

    // 水电费结算
    const allUtilityRecords = await d.collection(COLLECTIONS.UTILITY_RECORDS)
      .where({ tenantId }).orderBy('calculationDate', 'asc').get();
    const records = allUtilityRecords.data || [];

    const utilityPaymentsResult = await d.collection(COLLECTIONS.PAYMENTS)
      .where({ tenantId, paymentType: 'utility', status: 'paid' }).get();
    const totalPaidUtility = utilityPaymentsResult.data.reduce((sum, p) => sum + (p.amount || 0), 0);

    let baselineElec = tenant.moveInElectricity || 0;
    let baselineWater = tenant.moveInWater || 0;
    let cumulativeCost = 0;

    for (const record of records) {
      cumulativeCost += record.totalCost || 0;
      if (totalPaidUtility >= cumulativeCost) {
        baselineElec = record.electricityReading || baselineElec;
        baselineWater = record.waterReading || baselineWater;
      }
    }

    let pendingUtility = 0;
    const latestRecord = records.length > 0 ? records[records.length - 1] : null;
    if (latestRecord && totalPaidUtility < cumulativeCost) {
      const elecUsed = Math.max(0, (latestRecord.electricityReading || 0) - baselineElec);
      const waterUsed = Math.max(0, (latestRecord.waterReading || 0) - baselineWater);
      const settingsResult = await this.getSystemSettings();
      const settings = settingsResult.data[0];
      pendingUtility = Math.max(0, elecUsed * (settings?.electricityPrice || 0.8) + waterUsed * (settings?.waterPrice || 3.5));
    }

    // 其他未结清
    const pendingPaymentsResult = await d.collection(COLLECTIONS.PAYMENTS)
      .where({ tenantId, status: d.command.in(['pending', 'overdue']) }).get();
    const otherPending = pendingPaymentsResult.data.reduce((sum, p) => sum + (p.amount || 0), 0);

    const totalOwed = owedRent + pendingUtility + otherPending;
    const totalPaid = prepaidRent + depositAmount;
    const balance = totalPaid - totalOwed;

    let refundAmount = 0, extraDue = 0, settlementLabel = '';
    if (balance >= 0) { refundAmount = balance; settlementLabel = '退费'; }
    else { extraDue = -balance; settlementLabel = '应缴'; }

    return {
      tenantName: tenant.name, houseCode: house.code, houseAddress: house.address,
      moveInDate, moveOutDate: moveOutDateObj, daysUsed,
      monthlyRent, prepaidRent, owedRent, owedRentNote, depositAmount,
      pendingUtility, baselineElec, baselineWater, otherPending,
      refundAmount, extraDue, settlementLabel,
      totalPaid, totalOwed, balance,
      adjustRentRefund: 0
    };
  }
};

module.exports = DatabaseService;
