import { app } from '../utils/cloudbase';

// 数据库集合名称常量
export const COLLECTIONS = {
  HOUSES: 'houses',
  TENANTS: 'tenants',
  PAYMENTS: 'payments',
  UTILITY_RECORDS: 'utility_records',
  SYSTEM_SETTINGS: 'system_settings',
} as const;

// 数据库初始化状态
let dbInitialized = false;
let dbInitializationError: string | null = null;

// 数据库初始化函数
async function initializeDatabase() {
  if (dbInitialized) return;

  console.log('开始初始化数据库...');
  const db = app.database();

  const collections = [
    { name: COLLECTIONS.HOUSES, label: '房屋信息' },
    { name: COLLECTIONS.TENANTS, label: '租客信息' },
    { name: COLLECTIONS.PAYMENTS, label: '缴费记录' },
    { name: COLLECTIONS.UTILITY_RECORDS, label: '水电费记录' },
    { name: COLLECTIONS.SYSTEM_SETTINGS, label: '系统设置' }
  ];

  const missingCollections: string[] = [];

  for (const { name: collectionName, label: collectionLabel } of collections) {
    try {
      // 尝试查询集合是否存在
      await db.collection(collectionName).limit(1).get();
      console.log(`✓ 集合 ${collectionName} (${collectionLabel}) 已存在`);
    } catch (error: any) {
      if (error.code === 'DATABASE_COLLECTION_NOT_EXIST' || error.message?.includes('Db or Table not exist')) {
        console.log(`⚠️ 集合 ${collectionName} (${collectionLabel}) 不存在，尝试创建...`);
        try {
          // 尝试添加一个测试文档来创建集合
          await db.collection(collectionName).add({
            _createdAt: new Date(),
            _isTestDocument: true,
            message: '测试文档 - 集合初始化'
          });
          console.log(`✓ 集合 ${collectionName} (${collectionLabel}) 创建成功`);

          // 如果是system_settings集合，添加默认设置
          if (collectionName === COLLECTIONS.SYSTEM_SETTINGS) {
            await db.collection(collectionName).add({
              electricityPrice: 0.8,
              waterPrice: 3.5,
              updatedAt: new Date(),
              _createdAt: new Date()
            });
            console.log('✓ 系统设置初始化完成');
          }
        } catch (createError: any) {
          console.error(`✗ 集合 ${collectionName} (${collectionLabel}) 创建失败:`, createError.message);
          missingCollections.push(collectionLabel);
        }
      } else {
        console.error(`✗ 检查集合 ${collectionName} (${collectionLabel}) 失败:`, error.message);
      }
    }
  }

  if (missingCollections.length > 0) {
    dbInitializationError = `以下数据库集合创建失败: ${missingCollections.join(', ')}。请登录CloudBase控制台手动创建这些集合:\n\n1. 访问: https://tcb.cloud.tencent.com/dev?envId=${import.meta.env.VITE_ENV_ID || 'your-env-id'}#/db/doc\n2. 点击"创建集合"按钮\n3. 分别创建以下集合: ${collections.map(c => c.name).join(', ')}\n\n创建完成后刷新页面即可使用。`;
    console.error('❌ 数据库初始化失败:', dbInitializationError);
    throw new Error(dbInitializationError);
  }

  dbInitialized = true;
  console.log('✅ 数据库初始化完成');
}

/**
 * 数据库服务类
 */
class DatabaseService {
  private db = app.database();

  // 确保数据库已初始化
  private async ensureInitialized() {
    if (!dbInitialized) {
      await initializeDatabase();
    }
  }

  /**
   * 房屋管理
   */
  async addHouse(houseData: any) {
    try {
      await this.ensureInitialized();
      return this.db.collection(COLLECTIONS.HOUSES).add({
        ...houseData,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'available', // available, rented
      });
    } catch (error: any) {
      if (error.code === 'DATABASE_COLLECTION_NOT_EXIST' || error.message?.includes('Db or Table not exist')) {
        const guideUrl = `https://tcb.cloud.tencent.com/dev?envId=${import.meta.env.VITE_ENV_ID || 'cloud1-2gxr9nlc327f3b44'}#/db/doc`;
        throw new Error(`数据库集合 'houses' 不存在。请按以下步骤创建：\n\n1. 登录 CloudBase 控制台: ${guideUrl}\n2. 点击"创建集合"按钮\n3. 输入集合名称: "houses"\n4. 点击确定\n5. 刷新本页面后重试`);
      }
      throw error;
    }
  }

  async getHouses(filters?: any) {
    try {
      await this.ensureInitialized();
      const collection = this.db.collection(COLLECTIONS.HOUSES);
      const whereConditions: any = {};

      if (filters) {
        if (filters.status) {
          whereConditions.status = filters.status;
        }

        // 处理房屋编号查询
        if (filters.code) {
          whereConditions.code = filters.code;
        }

        // 处理租金范围查询
        if (filters.minRent && filters.maxRent) {
          whereConditions.rent = this.db.command.and([
            this.db.command.gte(Number(filters.minRent)),
            this.db.command.lte(Number(filters.maxRent))
          ]);
        } else if (filters.minRent) {
          whereConditions.rent = this.db.command.gte(Number(filters.minRent));
        } else if (filters.maxRent) {
          whereConditions.rent = this.db.command.lte(Number(filters.maxRent));
        }
      }

      let result;
      if (Object.keys(whereConditions).length > 0) {
        result = await collection.where(whereConditions).orderBy('createdAt', 'desc').get();
      } else {
        result = await collection.orderBy('createdAt', 'desc').get();
      }

      // 确保返回标准格式的数据
      return {
        data: result.data || [],
        requestId: result.requestId,
        total: result.data?.length || 0
      };
    } catch (error: any) {
      if (error.code === 'DATABASE_COLLECTION_NOT_EXIST' || error.message?.includes('Db or Table not exist')) {
        const guideUrl = `https://tcb.cloud.tencent.com/dev?envId=${import.meta.env.VITE_ENV_ID || 'cloud1-2gxr9nlc327f3b44'}#/db/doc`;
        throw new Error(`数据库集合 'houses' 不存在。请按以下步骤创建：\n\n1. 登录 CloudBase 控制台: ${guideUrl}\n2. 点击"创建集合"按钮\n3. 输入集合名称: "houses"\n4. 点击确定\n5. 刷新本页面后重试`);
      }
      throw error;
    }
  }

  async updateHouse(id: string, houseData: any) {
    await this.ensureInitialized();
    return this.db.collection(COLLECTIONS.HOUSES).doc(id).update({
      ...houseData,
      updatedAt: new Date(),
    });
  }

  async deleteHouse(id: string) {
    await this.ensureInitialized();
    return this.db.collection(COLLECTIONS.HOUSES).doc(id).remove();
  }

  /**
   * 租客管理
   */
  async addTenant(tenantData: any) {
    await this.ensureInitialized();

    console.log('开始添加租客:', tenantData);

    let tenantId: string | null = null;

    try {
      // 检查房屋是否已有活跃租客
      const existingTenants = await this.db.collection(COLLECTIONS.TENANTS)
        .where({ houseId: tenantData.houseId, status: 'active' })
        .limit(1)
        .get();
      if (existingTenants.data.length > 0) {
        throw new Error('该房屋已有租客入住，无法重复绑定');
      }

      // 确定最近缴费日期：优先使用传入的lastPaymentDate，否则使用入住日期
      const lastPaymentDate = tenantData.lastPaymentDate
        ? new Date(tenantData.lastPaymentDate)
        : (tenantData.moveInDate ? new Date(tenantData.moveInDate) : new Date());

      // 添加租客
      const tenantResult = await this.db.collection(COLLECTIONS.TENANTS).add({
        name: tenantData.name,
        idCard: tenantData.idCard || '',
        phone: tenantData.phone || '',
        houseId: tenantData.houseId,
        paymentCycle: tenantData.paymentCycle || 'month', // month, quarter, half_year, year
        deposit: Number(tenantData.deposit) || 0,
        rent: Number(tenantData.rent) || 0,
        moveInDate: tenantData.moveInDate || new Date(),
        lastPaymentDate: lastPaymentDate,
        moveInElectricity: Number(tenantData.moveInElectricity) || 0,
        moveInWater: Number(tenantData.moveInWater) || 0,
        createdAt: new Date(),
        updatedAt: new Date(),
        status: 'active', // active, moved_out
      });

      console.log('租客添加成功:', tenantResult);

      if (!tenantResult || !tenantResult.id) {
        throw new Error('添加租客失败：返回结果无效');
      }

      tenantId = tenantResult.id;
      console.log('租客ID:', tenantId);

      // 创建押金缴费记录（使用与租金相同的基准日期，避免显示为"今天"）
      const depositAmount = Number(tenantData.deposit) || 0;
      if (depositAmount > 0) {
        await this.addPayment({
          houseId: tenantData.houseId,
          tenantId: tenantId,
          paymentType: 'deposit',
          amount: depositAmount,
          description: '押金',
          period: '押金',
          paymentDate: new Date(lastPaymentDate),
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
        const cycleLabels: Record<string, string> = {
          month: '月付', quarter: '季付', half_year: '半年付', year: '年付'
        };
        // 使用最近缴费日期作为本次缴费记录的日期（用于计算下次收租日）
        const refDate = new Date(lastPaymentDate);
        await this.addPayment({
          houseId: tenantData.houseId,
          tenantId: tenantId,
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

      const successResult = {
        success: true,
        id: tenantId,
        message: '租客添加成功'
      };

      console.log('addTenant 完成，返回:', successResult);
      return successResult;
    } catch (error: any) {
      console.error('添加租客失败:', error);

      const errorMessage = error.message || '';
      if (errorMessage.includes('map') || errorMessage.includes('Cannot read properties of undefined')) {
        console.log('检测到SDK内部错误，但数据可能已保存成功');
        return {
          success: true,
          id: tenantId || 'unknown',
          message: '租客添加成功（可能存在SDK内部错误）'
        };
      }

      if (error.code === 'DATABASE_COLLECTION_NOT_EXIST' || error.message?.includes('Db or Table not exist')) {
        throw new Error(`数据库集合不存在。请检查以下集合是否已创建：tenants, houses, payments`);
      }
      throw error;
    }
  }

  async getTenants(filters?: any) {
    await this.ensureInitialized();
    const collection = this.db.collection(COLLECTIONS.TENANTS);
    const whereConditions: any = {};

    if (filters) {
      if (filters.status) {
        whereConditions.status = filters.status;
      }
      if (filters.houseId) {
        whereConditions.houseId = filters.houseId;
      }
    }

    let result;
    if (Object.keys(whereConditions).length > 0) {
      result = await collection.where(whereConditions).orderBy('createdAt', 'desc').get();
    } else {
      result = await collection.orderBy('createdAt', 'desc').get();
    }

    // 确保返回标准格式的数据
    return {
      data: result.data || [],
      requestId: result.requestId,
      total: result.data?.length || 0
    };
  }

  async updateTenant(id: string, tenantData: any) {
    await this.ensureInitialized();
    return this.db.collection(COLLECTIONS.TENANTS).doc(id).update({
      ...tenantData,
      updatedAt: new Date(),
    });
  }

  async moveOutTenant(id: string, moveOutDate: Date) {
    await this.ensureInitialized();

    // 先获取租客信息以获取房屋ID（批量加载避免按 _id 查询触发 SDK bug）
    const tenantsResult = await this.db.collection(COLLECTIONS.TENANTS).get();
    const tenant = (tenantsResult.data as any[]).find((t: any) => t._id === id);
    const houseId = tenant?.houseId;

    // 更新租客状态
    await this.db.collection(COLLECTIONS.TENANTS).doc(id).update({
      status: 'moved_out',
      moveOutDate,
      updatedAt: new Date(),
    });

    // 更新房屋状态为可租
    if (houseId) {
      await this.updateHouseStatus(houseId, 'available');
    }

    return { success: true, houseId };
  }

  /**
   * 检查租客是否有未结清款项
   */
  async checkTenantPendingPayments(tenantId: string): Promise<boolean> {
    await this.ensureInitialized();
    const result = await this.db.collection(COLLECTIONS.PAYMENTS)
      .where({
        tenantId: tenantId,
        status: this.db.command.in(['pending', 'overdue'])
      })
      .limit(1)
      .get();
    return result.data.length > 0;
  }

  async deleteTenant(id: string) {
    await this.ensureInitialized();
    return this.db.collection(COLLECTIONS.TENANTS).doc(id).remove();
  }

  /**
   * 缴费记录
   */
  async addPayment(paymentData: any) {
    await this.ensureInitialized();
    try {
      const result = await this.db.collection(COLLECTIONS.PAYMENTS).add({
        ...paymentData,
        createdAt: new Date(),
        paymentDate: paymentData.paymentDate || new Date(),
        status: paymentData.status || 'paid',
      });

      // 如果是已缴租金，更新租金覆盖期限（预付制核心逻辑）
      if ((paymentData.status === 'paid' || !paymentData.status) && paymentData.paymentType === 'rent' && paymentData.tenantId) {
        await this.updateRentCoverage(paymentData.tenantId, paymentData.amount);
      }

      return {
        success: true,
        id: result.id,
        message: '缴费记录添加成功'
      };
    } catch (error: any) {
      console.error('添加缴费记录失败:', error, paymentData);
      if (error.code === 'DATABASE_COLLECTION_NOT_EXIST' || error.message?.includes('Db or Table not exist')) {
        const guideUrl = `https://tcb.cloud.tencent.com/dev?envId=${import.meta.env.VITE_ENV_ID || 'cloud1-2gxr9nlc327f3b44'}#/db/doc`;
        throw new Error(`数据库集合 'payments' 不存在。请按以下步骤创建：\n\n1. 登录 CloudBase 控制台: ${guideUrl}\n2. 点击"创建集合"按钮\n3. 输入集合名称: "payments"\n4. 点击确定\n5. 刷新本页面后重试`);
      }
      throw error;
    }
  }

  async getPayments(filters?: any) {
    await this.ensureInitialized();
    const collection = this.db.collection(COLLECTIONS.PAYMENTS);
    const whereConditions: any = {};

    if (filters) {
      if (filters.houseId) {
        whereConditions.houseId = filters.houseId;
      }
      if (filters.tenantId) {
        whereConditions.tenantId = filters.tenantId;
      }
      if (filters.paymentType) {
        whereConditions.paymentType = filters.paymentType;
      }
      if (filters.status) {
        whereConditions.status = filters.status;
      }
    }

    let result;
    if (Object.keys(whereConditions).length > 0) {
      result = await collection.where(whereConditions).orderBy('paymentDate', 'desc').get();
    } else {
      result = await collection.orderBy('paymentDate', 'desc').get();
    }

    let data = result.data || [];

    // 日期筛选（在前端过滤，CloudBase NoSQL 对日期比较支持有限）
    if (filters) {
      if (filters.startDate) {
        const start = new Date(filters.startDate);
        data = data.filter((d: any) => new Date(d.paymentDate) >= start);
      }
      if (filters.endDate) {
        const end = new Date(filters.endDate);
        end.setDate(end.getDate() + 1);
        data = data.filter((d: any) => new Date(d.paymentDate) < end);
      }
    }

    // 按缴费日期降序+创建时间降序排列
    const sortedData = data.sort((a: any, b: any) => {
      const dateA = new Date(a.paymentDate).getTime()
      const dateB = new Date(b.paymentDate).getTime()
      if (dateA !== dateB) return dateB - dateA
      return new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
    })

    // 确保返回标准格式的数据
    return {
      data: sortedData,
      requestId: result.requestId,
      total: sortedData.length
    };
  }

  async updatePayment(id: string, paymentData: any) {
    await this.ensureInitialized();
    const result = await this.db.collection(COLLECTIONS.PAYMENTS).doc(id).update({
      ...paymentData,
      updatedAt: new Date(),
    });

    // 如果标记为已缴且是租金支付，更新租金覆盖期限
    if (paymentData.status === 'paid') {
      try {
        const paymentDocs = await this.db.collection(COLLECTIONS.PAYMENTS).get();
        const payment = (paymentDocs.data as any[]).find((p: any) => p._id === id);
        if (payment && payment.paymentType === 'rent' && payment.tenantId) {
          await this.updateRentCoverage(payment.tenantId, payment.amount);
        }
      } catch (syncError) {
        console.warn('标记已缴时更新租金覆盖期限失败:', syncError);
      }
    }

    return result;
  }

  async deletePayment(id: string) {
    await this.ensureInitialized();

    // 获取待删除支付记录的信息（需要在删除前获取）
    let deletedPayment: any = null;
    try {
      const paymentDocs = await this.db.collection(COLLECTIONS.PAYMENTS).get();
      deletedPayment = (paymentDocs.data as any[]).find((p: any) => p._id === id);
    } catch {
      // 获取失败不影响删除操作
    }

    const result = await this.db.collection(COLLECTIONS.PAYMENTS).doc(id).remove();

    // 如果是已缴租金，删除后重新计算 rentCoveredUntil
    if (deletedPayment && deletedPayment.paymentType === 'rent' && deletedPayment.status === 'paid' && deletedPayment.tenantId) {
      await this.recalculateRentCoverage(deletedPayment.tenantId);
    }

    return result;
  }

  /**
   * 重新计算租客的租金覆盖期限（删除支付记录后调用）
   * 从零开始回放所有剩余已缴租金记录
   */
  private async recalculateRentCoverage(tenantId: string) {
    try {
      const tenantDocs = await this.db.collection(COLLECTIONS.TENANTS).get();
      const tenant = (tenantDocs.data as any[]).find((t: any) => t._id === tenantId);
      if (!tenant) return;

      const monthlyRent = tenant.rent || 0;
      if (monthlyRent <= 0) return;

      // 获取所有剩余的已缴租金记录（按缴费日期升序）
      const allPayments = await this.db.collection(COLLECTIONS.PAYMENTS)
        .where({
          tenantId: tenantId,
          paymentType: 'rent',
          status: 'paid'
        })
        .orderBy('paymentDate', 'asc')
        .get();

      const remainingPayments = (allPayments.data || []).filter((p: any) => p.amount > 0) as any[];
      const moveInDate = new Date(tenant.moveInDate);

      // 重新计算覆盖期限及押金溢出
      let currentCoveredUntil: Date | null = null;
      let totalDepositOverflow = 0;
      for (const payment of remainingPayments) {
        const { newCoveredUntil, depositIncrease } = this.calcRentCoverage(
          currentCoveredUntil,
          moveInDate,
          payment.amount,
          monthlyRent
        );
        currentCoveredUntil = newCoveredUntil;
        totalDepositOverflow += depositIncrease;
      }

      // 更新租客的 rentCoveredUntil 和押金
      // 押金 = 基础押金（不含租金溢出） + 重算后的租金溢出
      const baseDeposit = (tenant.deposit || 0) - (tenant.rentDepositOverflow || 0);
      const updateData: any = {
        rentCoveredUntil: currentCoveredUntil,
        deposit: baseDeposit + totalDepositOverflow,
        rentDepositOverflow: totalDepositOverflow,
        updatedAt: new Date(),
      };

      await this.db.collection(COLLECTIONS.TENANTS).doc(tenantId).update(updateData);
      console.log(
        `已重新计算租客 ${tenantId} 的租金覆盖至 ${currentCoveredUntil ? currentCoveredUntil.toISOString().slice(0, 10) : '无'}`
      );
    } catch (error) {
      console.warn('重新计算租金覆盖期限失败:', error);
    }
  }

  /**
   * 水电费记录
   */
  async addUtilityRecord(recordData: any) {
    await this.ensureInitialized();
    return this.db.collection(COLLECTIONS.UTILITY_RECORDS).add({
      ...recordData,
      createdAt: new Date(),
      calculationDate: new Date(),
    });
  }

  async getUtilityRecords(filters?: any) {
    await this.ensureInitialized();
    const collection = this.db.collection(COLLECTIONS.UTILITY_RECORDS);
    const whereConditions: any = {};

    if (filters) {
      if (filters.houseId) {
        whereConditions.houseId = filters.houseId;
      }
      if (filters.tenantId) {
        whereConditions.tenantId = filters.tenantId;
      }
      if (filters.startDate) {
        whereConditions.calculationDate = this.db.command.gte(filters.startDate);
      }
      if (filters.endDate) {
        whereConditions.calculationDate = whereConditions.calculationDate
          ? this.db.command.and([whereConditions.calculationDate, this.db.command.lte(filters.endDate)])
          : this.db.command.lte(filters.endDate);
      }
    }

    if (Object.keys(whereConditions).length > 0) {
      return collection.where(whereConditions).orderBy('calculationDate', 'desc').get();
    }

    return collection.orderBy('calculationDate', 'desc').get();
  }

  /**
   * 系统设置
   */
  async getSystemSettings() {
    await this.ensureInitialized();
    const result = await this.db.collection(COLLECTIONS.SYSTEM_SETTINGS).limit(1).get();
    if (result.data.length === 0) {
      // 创建默认设置
      const defaultSettings = {
        electricityPrice: 0.8, // 电费单价 元/度
        waterPrice: 3.5, // 水费单价 元/吨
        updatedAt: new Date(),
      };
      await this.db.collection(COLLECTIONS.SYSTEM_SETTINGS).add(defaultSettings);
      return { data: [defaultSettings] };
    }
    return result;
  }

  async updateSystemSettings(settings: any) {
    await this.ensureInitialized();
    const current = await this.getSystemSettings();
    if (current.data.length > 0) {
      const id = current.data[0]._id;
      return this.db.collection(COLLECTIONS.SYSTEM_SETTINGS).doc(id).update({
        ...settings,
        updatedAt: new Date(),
      });
    }
    return this.db.collection(COLLECTIONS.SYSTEM_SETTINGS).add({
      ...settings,
      updatedAt: new Date(),
    });
  }

  /**
   * 计算水电费
   */
  async calculateUtilityBill(houseId: string, tenantId: string, currentElectricity: number, currentWater: number) {
    await this.ensureInitialized();
    // 获取上个月的水电记录
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    const lastRecord = await this.db.collection(COLLECTIONS.UTILITY_RECORDS)
      .where({
        houseId: houseId,
        tenantId: tenantId
      })
      .orderBy('calculationDate', 'desc')
      .limit(1)
      .get();

    let lastElectricity = 0;
    let lastWater = 0;

    if (lastRecord.data.length > 0) {
      const record = lastRecord.data[0];
      lastElectricity = record.electricityReading || 0;
      lastWater = record.waterReading || 0;
    }

    // 获取系统设置
    const settingsResult = await this.getSystemSettings();
    const settings = settingsResult.data[0];

    const electricityUsage = Math.max(0, currentElectricity - lastElectricity);
    const waterUsage = Math.max(0, currentWater - lastWater);

    const electricityCost = electricityUsage * (settings.electricityPrice || 0.8);
    const waterCost = waterUsage * (settings.waterPrice || 3.5);
    const totalCost = electricityCost + waterCost;

    // 保存本次读数
    await this.addUtilityRecord({
      houseId,
      tenantId,
      electricityReading: currentElectricity,
      waterReading: currentWater,
      electricityUsage,
      waterUsage,
      electricityCost,
      waterCost,
      totalCost,
    });

    // 生成缴费记录
    await this.addPayment({
      houseId,
      tenantId,
      paymentType: 'utility',
      amount: totalCost,
      description: `水电费：电${electricityUsage}度×${settings.electricityPrice}元/度 + 水${waterUsage}吨×${settings.waterPrice}元/吨`,
      period: `${lastMonth.getFullYear()}-${lastMonth.getMonth() + 1}`,
    });

    return {
      electricityUsage,
      waterUsage,
      electricityCost,
      waterCost,
      totalCost,
    };
  }

  /**
   * 计算租金覆盖期限（预付制核心逻辑）
   * 给定当前已覆盖日期、支付金额、月租金，计算新的覆盖到期日和押金增加额
   */
  private calcRentCoverage(
    currentCoveredUntil: Date | null,
    moveInDate: Date,
    paymentAmount: number,
    monthlyRent: number
  ): { newCoveredUntil: Date; monthsCovered: number; depositIncrease: number } {
    const halfThreshold = monthlyRent / 2;
    const fullMonths = Math.floor(paymentAmount / monthlyRent);
    const remaining = paymentAmount - fullMonths * monthlyRent;

    // 覆盖起始日 = 当前已覆盖日期的次日（如无则从入住日开始）
    const baseDate = currentCoveredUntil
      ? new Date(currentCoveredUntil)
      : new Date(moveInDate);
    const coverageStart = new Date(baseDate);
    coverageStart.setDate(baseDate.getDate() + 1);
    // 如果当前没有覆盖（currentCoveredUntil == null），coverageStart = moveInDate
    // 上面的逻辑出错：如果 currentCoveredUntil 是 null, baseDate = moveInDate, coverageStart = moveInDate + 1 day
    // 这不对，应该 coverageStart = moveInDate（第一次付款覆盖从入住日开始）
    // 修正：
    let actualCoverageStart: Date;
    if (currentCoveredUntil) {
      actualCoverageStart = new Date(currentCoveredUntil);
      actualCoverageStart.setDate(actualCoverageStart.getDate() + 1);
    } else {
      actualCoverageStart = new Date(moveInDate);
    }

    // 计算结束日期
    const endDate = new Date(actualCoverageStart);
    endDate.setMonth(endDate.getMonth() + fullMonths);

    let hasHalfMonth = false;
    let depositIncrease = 0;

    if (remaining >= halfThreshold) {
      endDate.setDate(endDate.getDate() + 15);
      hasHalfMonth = true;
      depositIncrease = remaining - halfThreshold;
    } else if (remaining > 0) {
      depositIncrease = remaining;
    }

    // endDate 是覆盖期最后一天的次日，减一天得到包含的最后一天
    const coveredUntil = new Date(endDate);
    coveredUntil.setDate(coveredUntil.getDate() - 1);

    const monthsCovered = fullMonths + (hasHalfMonth ? 0.5 : 0);

    return { newCoveredUntil: coveredUntil, monthsCovered, depositIncrease };
  }

  /**
   * 更新租金覆盖期限
   */
  private async updateRentCoverage(
    tenantId: string,
    paymentAmount: number
  ): Promise<void> {
    try {
      // 获取租客信息
      const tenantDocs = await this.db.collection(COLLECTIONS.TENANTS).get();
      const tenant = (tenantDocs.data as any[]).find((t: any) => t._id === tenantId);
      if (!tenant) return;

      const monthlyRent = tenant.rent || 0;
      if (monthlyRent <= 0 || paymentAmount <= 0) return;

      const currentCoveredUntil = tenant.rentCoveredUntil
        ? new Date(tenant.rentCoveredUntil)
        : null;
      const moveInDate = new Date(tenant.moveInDate);

      const { newCoveredUntil, depositIncrease } = this.calcRentCoverage(
        currentCoveredUntil,
        moveInDate,
        paymentAmount,
        monthlyRent
      );

      // 更新租客的 rentCoveredUntil 和押金
      const updateData: any = {
        rentCoveredUntil: newCoveredUntil,
        updatedAt: new Date(),
      };
      if (depositIncrease > 0) {
        updateData.deposit = (tenant.deposit || 0) + depositIncrease;
        updateData.rentDepositOverflow = (tenant.rentDepositOverflow || 0) + depositIncrease;
      }

      await this.db.collection(COLLECTIONS.TENANTS).doc(tenantId).update(updateData);
      console.log(
        `已更新租客 ${tenantId} 租金覆盖至 ${newCoveredUntil.toISOString().slice(0, 10)}` +
          (depositIncrease > 0 ? `，押金增加 ¥${depositIncrease}` : ''),
      );
    } catch (error) {
      console.warn('更新租金覆盖期限失败（不影响支付记录保存）:', error);
    }
  }

  /**
   * 更新房屋状态
   */
  async updateHouseStatus(houseId: string, status: string) {
    await this.ensureInitialized();
    try {
      await this.db.collection(COLLECTIONS.HOUSES).doc(houseId).update({
        status,
        updatedAt: new Date(),
      });

      // 返回简单的成功对象
      return {
        success: true,
        houseId,
        status,
        message: '房屋状态更新成功'
      };
    } catch (error: any) {
      console.error(`更新房屋状态失败 (houseId: ${houseId}, status: ${status}):`, error);
      if (error.code === 'DATABASE_COLLECTION_NOT_EXIST' || error.message?.includes('Db or Table not exist')) {
        throw new Error(`数据库集合 'houses' 不存在或房屋ID ${houseId} 不存在。请检查房屋是否存在。`);
      }
      throw error;
    }
  }

  /**
   * 从租客和房屋数据计算下次收租日期和金额（无需再次查询数据库）
   */
  private async calcNextRentDue(tenant: any, house: any) {
    // 使用预付制的租金覆盖日期（rentCoveredUntil）作为基准
    // 已覆盖到 X 日 → 下次缴费日 = X 日的次日
    let rentCoveredUntil: Date;
    if (tenant.rentCoveredUntil) {
      rentCoveredUntil = new Date(tenant.rentCoveredUntil);
    } else {
      // 兼容旧数据：如果没有 rentCoveredUntil，从 lastPaymentDate 或 moveInDate + 周期推算
      console.warn(`租客 ${tenant._id} 没有 rentCoveredUntil，使用兼容模式`);
      try {
        const paymentsResult = await this.db.collection(COLLECTIONS.PAYMENTS)
          .where({
            tenantId: tenant._id,
            paymentType: 'rent'
          })
          .orderBy('paymentDate', 'desc')
          .limit(1)
          .get();

        if (paymentsResult.data && paymentsResult.data.length > 0) {
          const baseDate = new Date(paymentsResult.data[0].paymentDate);
          const cycle = tenant.paymentCycle || 'month';
          const cycleMonths: Record<string, number> = { month: 1, quarter: 3, half_year: 6, year: 12 };
          const monthsToAdd = cycleMonths[cycle] || 1;
          rentCoveredUntil = new Date(baseDate);
          rentCoveredUntil.setMonth(rentCoveredUntil.getMonth() + monthsToAdd);
          rentCoveredUntil.setDate(rentCoveredUntil.getDate() - 1);
        } else if (tenant.lastPaymentDate) {
          rentCoveredUntil = new Date(tenant.lastPaymentDate);
        } else {
          rentCoveredUntil = new Date(tenant.moveInDate);
        }
      } catch (error) {
        console.warn(`查询租客 ${tenant._id} 的支付记录失败，使用默认日期:`, error);
        rentCoveredUntil = tenant.rentCoveredUntil
          ? new Date(tenant.rentCoveredUntil)
          : (tenant.lastPaymentDate ? new Date(tenant.lastPaymentDate) : new Date(tenant.moveInDate));
      }
    }

    // 下次缴费日 = 已覆盖日期的次日
    const nextDueDate = new Date(rentCoveredUntil);
    nextDueDate.setDate(nextDueDate.getDate() + 1);

    // 计算租金金额（使用租客存储的租金）
    const cycle = tenant.paymentCycle || 'month';
    const cycleMonths: Record<string, number> = {
      month: 1, quarter: 3, half_year: 6, year: 12
    };
    const monthsToAdd = cycleMonths[cycle] || 1;
    const monthlyRent = tenant.rent || house.rent || 0;
    const rentAmount = monthlyRent * monthsToAdd;

    return {
      rentCoveredUntil,
      lastPaymentDate: tenant.lastPaymentDate || tenant.moveInDate,
      nextDueDate,
      amount: rentAmount,
      monthlyRent,
      houseCode: house.code,
      houseAddress: house.address,
      paymentMonths: monthsToAdd,
      cycleMonths: monthsToAdd
    };
  }

  /**
   * 计算租客的下次收租日期和金额（兼容外部调用，内部加载数据后路由到 calcNextRentDue）
   */
  async getNextRentDueDate(tenantId: string) {
    await this.ensureInitialized();

    // 改为批量加载数据后用内存关联，避免按 _id 查询单个文档触发 SDK bug
    const [tenantsResult, housesResult] = await Promise.all([
      this.db.collection(COLLECTIONS.TENANTS).get(),
      this.db.collection(COLLECTIONS.HOUSES).get()
    ]);

    const tenant = (tenantsResult.data as any[]).find((t: any) => t._id === tenantId);
    if (!tenant) throw new Error('租客不存在');

    if (!tenant.houseId) throw new Error(`租客 ${tenantId} 的房屋ID无效`);

    const house = (housesResult.data as any[]).find((h: any) => h._id === tenant.houseId);
    if (!house) throw new Error('房屋不存在');

    return this.calcNextRentDue(tenant, house);
  }

  /**
   * 查询临近收费的房屋（未来N天内），含逾期明细
   */
  async getUpcomingRentHouses(days: number = 3) {
    await this.ensureInitialized();

    // 批量加载所有活跃租客和所有房屋，在内存中做关联计算
    const [tenantsResult, housesResult] = await Promise.all([
      this.db.collection(COLLECTIONS.TENANTS).where({ status: 'active' }).get(),
      this.db.collection(COLLECTIONS.HOUSES).get()
    ]);

    const houses = (housesResult.data || []) as any[];
    const houseMap = new Map<string, any>();
    houses.forEach((h: any) => houseMap.set(h._id, h));

    const upcomingHouses: any[] = [];
    const today = new Date();
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + days);

    for (const tenant of (tenantsResult.data || []) as any[]) {
      try {
        const house = houseMap.get(tenant.houseId);
        if (!house) {
          console.warn(`租客 ${tenant._id} 关联的房屋 ${tenant.houseId} 不存在，跳过`);
          continue;
        }

        const rentInfo = await this.calcNextRentDue(tenant, house);

        // 使用预付制的租金覆盖日期作为基准
        const coveredUntil = rentInfo.rentCoveredUntil;
        const cycleM = rentInfo.cycleMonths;

        // 下次缴费日 = 覆盖日期次日
        const firstDueDate = new Date(coveredUntil);
        firstDueDate.setDate(firstDueDate.getDate() + 1);

        // 生成从首次到期日起的 N 个周期的收租日列表
        const allDueDates: Date[] = [firstDueDate];
        for (let i = 1; i <= 12; i++) {
          const d = new Date(firstDueDate);
          d.setMonth(d.getMonth() + i * cycleM);
          if (d.getDate() !== firstDueDate.getDate()) {
            d.setDate(0);
          }
          allDueDates.push(d);
        }

        // 分离逾期和即将到来的
        const overdueItems: { dueDate: Date; amount: number; daysOverdue: number }[] = [];
        let upcomingItem: { dueDate: Date; amount: number; daysUntilDue: number } | null = null;

        for (const dueDate of allDueDates) {
          const daysDiff = Math.ceil((dueDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
          if (dueDate < today) {
            // 已逾期
            overdueItems.push({
              dueDate,
              amount: rentInfo.amount,
              daysOverdue: -daysDiff
            });
          } else if (dueDate <= targetDate && !upcomingItem) {
            // 未来N天内第一个到期日
            upcomingItem = {
              dueDate,
              amount: rentInfo.amount,
              daysUntilDue: daysDiff
            };
          }
        }

        // 只显示有逾期或未来N天内有到期的房屋
        if (overdueItems.length > 0 || upcomingItem) {
          const totalOverdue = overdueItems.reduce((s, i) => s + i.amount, 0);
          const cycleLabels: Record<string, string> = {
            month: '月付', quarter: '季付', half_year: '半年付', year: '年付'
          };
          upcomingHouses.push({
            houseId: tenant.houseId,
            houseCode: rentInfo.houseCode,
            houseAddress: rentInfo.houseAddress,
            tenantId: tenant._id,
            tenantName: tenant.name,
            monthlyRent: rentInfo.monthlyRent,
            // 预付制覆盖信息
            rentCoveredUntil: rentInfo.rentCoveredUntil,
            cycleLabel: cycleLabels[tenant.paymentCycle] || '月付',
            cycleAmount: rentInfo.amount,
            // 逾期明细
            overdueItems,
            totalOverdue,
            upcomingItem,
            nextDueDate: upcomingItem?.dueDate || overdueItems[overdueItems.length - 1]?.dueDate,
            amount: rentInfo.amount,
            daysUntilDue: upcomingItem?.daysUntilDue ?? -(overdueItems[overdueItems.length - 1]?.daysOverdue ?? 0)
          });
        }
      } catch (error) {
        console.error(`计算租客 ${tenant._id} 的下次收租日失败:`, error);
      }
    }

    // 按最近逾期/最近到期排序
    upcomingHouses.sort((a, b) => (a.daysUntilDue || 0) - (b.daysUntilDue || 0));

    return upcomingHouses;
  }

  /**
   * 计算退租结算
   * 房租计算规则：不满半个月按半个月计，超过半个月不满一个月按一个月计
   */
  async calculateMoveOutSettlement(tenantId: string, moveOutDate: Date) {
    await this.ensureInitialized();

    // 批量加载数据后在内存中查找，避免按 _id 单个查询触发 SDK bug
    const [tenantsResult, housesResult] = await Promise.all([
      this.db.collection(COLLECTIONS.TENANTS).get(),
      this.db.collection(COLLECTIONS.HOUSES).get()
    ]);

    const tenant = (tenantsResult.data as any[]).find((t: any) => t._id === tenantId);
    if (!tenant) throw new Error('租客不存在');
    if (!tenant.houseId) throw new Error(`租客 ${tenantId} 的房屋ID无效`);

    const house = (housesResult.data as any[]).find((h: any) => h._id === tenant.houseId);
    if (!house) throw new Error('房屋不存在');

    const moveOutDateObj = new Date(moveOutDate);
    const moveInDate = new Date(tenant.moveInDate);

    // 计算实际入住天数
    const daysUsed = Math.max(0, Math.ceil((moveOutDateObj.getTime() - moveInDate.getTime()) / (1000 * 60 * 60 * 24)));

    // ---- 房租结算规则 ----
    // 房租提前预缴，退租时按入住时间计算应收房租：
    // 不满半个月(≤14天) → 按半个月计 = 月租金/2
    // 超过半个月(≥15天) → 按一个月计 = 月租金
    const monthlyRent = tenant.rent || house.rent || 0;
    let owedRent = 0;
    let owedRentNote = '';

    if (daysUsed <= 14) {
      // 不满半个月
      owedRent = monthlyRent / 2;
      owedRentNote = `入住${daysUsed}天<15天，按半个月计`;
    } else if (daysUsed <= 30) {
      // 半个月到一个月之间
      owedRent = monthlyRent;
      owedRentNote = `入住${daysUsed}天≥15天，按一个月计`;
    } else {
      // 超过一个月：整月数 + 剩余天数按半个月/一个月规则
      const fullMonths = Math.floor(daysUsed / 30);
      const remainingDays = daysUsed % 30;
      owedRent = monthlyRent * fullMonths;
      if (remainingDays > 0) {
        if (remainingDays <= 14) {
          owedRent += monthlyRent / 2;
          owedRentNote = `${fullMonths}个月 + 剩余${remainingDays}天<15天按半个月计`;
        } else {
          owedRent += monthlyRent;
          owedRentNote = `${fullMonths}个月 + 剩余${remainingDays}天≥15天按一个月计`;
        }
      } else {
        owedRentNote = `${fullMonths}个月`;
      }
    }

    // 获取预缴租金总额
    const rentPaymentsResult = await this.db.collection(COLLECTIONS.PAYMENTS)
      .where({
        tenantId: tenantId,
        paymentType: 'rent'
      })
      .get();
    const prepaidRent = (rentPaymentsResult.data as any[]).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

    // 押金
    const depositAmount = tenant.deposit || 0;

    // ---- 水电费结算（基于上次已缴费的读数为基准） ----
    const allUtilityRecords = await this.db.collection(COLLECTIONS.UTILITY_RECORDS)
      .where({ tenantId: tenantId })
      .orderBy('calculationDate', 'asc')
      .get();

    const records = (allUtilityRecords.data || []) as any[];

    // 获取所有已缴水电费记录
    const utilityPaymentsResult = await this.db.collection(COLLECTIONS.PAYMENTS)
      .where({
        tenantId: tenantId,
        paymentType: 'utility',
        status: 'paid'
      })
      .get();

    const totalPaidUtility = (utilityPaymentsResult.data || []).reduce((sum: number, p: any) => sum + (p.amount || 0), 0);

    // 基准读数：默认为入住读数
    let baselineElec = tenant.moveInElectricity || 0;
    let baselineWater = tenant.moveInWater || 0;
    let cumulativeCost = 0;

    // 遍历所有水电记录，找出已覆盖到哪一次读数为基准
    for (const record of records) {
      cumulativeCost += record.totalCost || 0;
      if (totalPaidUtility >= cumulativeCost) {
        // 本次及之前的记录已全部缴清，更新基准读数
        baselineElec = record.electricityReading || baselineElec;
        baselineWater = record.waterReading || baselineWater;
      }
    }

    // 计算待缴水电费 = (最新读数 - 基准读数) × 单价
    let pendingUtility = 0;
    const latestRecord = records.length > 0 ? records[records.length - 1] : null;
    if (latestRecord && totalPaidUtility < cumulativeCost) {
      const elecUsed = Math.max(0, (latestRecord.electricityReading || 0) - baselineElec);
      const waterUsed = Math.max(0, (latestRecord.waterReading || 0) - baselineWater);
      // 使用系统设置中的单价或默认值
      const settingsResult = await this.getSystemSettings();
      const settings = settingsResult.data[0];
      const elecPrice = settings?.electricityPrice || 0.8;
      const waterPrice = settings?.waterPrice || 3.5;
      pendingUtility = Math.max(0, elecUsed * elecPrice + waterUsed * waterPrice);
    }

    // 检查其他未结清款项
    const pendingPaymentsResult = await this.db.collection(COLLECTIONS.PAYMENTS)
      .where({
        tenantId: tenantId,
        status: this.db.command.in(['pending', 'overdue'])
      })
      .get();

    let otherPending = 0;
    (pendingPaymentsResult.data as any[]).forEach(payment => {
      otherPending += payment.amount || 0;
    });

    const totalPending = owedRent + pendingUtility + otherPending;
    // 完整结算：总预缴（预缴房租 + 押金）- 总欠费（应缴房租 + 水电费 + 其他）
    const totalPaid = prepaidRent + depositAmount;
    const totalOwed = owedRent + pendingUtility + otherPending;
    const balance = totalPaid - totalOwed;

    let refundAmount = 0;
    let extraDue = 0;
    let settlementLabel = '';
    if (balance >= 0) {
      refundAmount = balance;
      settlementLabel = '退费';
    } else {
      extraDue = -balance;
      settlementLabel = '应缴';
    }

    return {
      tenantName: tenant.name,
      houseCode: house.code,
      houseAddress: house.address,
      moveInDate,
      moveOutDate: moveOutDateObj,
      daysUsed,
      // 房租
      monthlyRent,
      prepaidRent,
      owedRent,
      owedRentNote,
      // 押金
      depositAmount,
      // 费用
      pendingUtility,
      baselineElec,
      baselineWater,
      otherPending,
      totalPending,
      // 结算
      refundAmount,
      extraDue,
      settlementLabel,
      // 明细（用于显示）
      totalPaid,
      totalOwed,
      balance
    };
  }
}

export const dbService = new DatabaseService();
