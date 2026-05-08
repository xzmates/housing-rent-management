import { app } from '../src/utils/cloudbase';
import { COLLECTIONS } from '../src/lib/database';

// 数据库初始化脚本
async function initializeDatabase() {
  console.log('开始初始化数据库...');

  try {
    const db = app.database();

    // 测试连接
    console.log('测试数据库连接...');

    // 尝试创建一个测试文档来检查每个集合是否存在
    const collections = [
      COLLECTIONS.HOUSES,
      COLLECTIONS.TENANTS,
      COLLECTIONS.PAYMENTS,
      COLLECTIONS.UTILITY_RECORDS,
      COLLECTIONS.SYSTEM_SETTINGS
    ];

    for (const collectionName of collections) {
      try {
        console.log(`检查集合 ${collectionName}...`);
        const testResult = await db.collection(collectionName).limit(1).get();
        console.log(`✓ 集合 ${collectionName} 已存在，包含 ${testResult.data.length} 条记录`);
      } catch (error: any) {
        if (error.code === 'DATABASE_COLLECTION_NOT_EXIST' || error.message?.includes('Db or Table not exist')) {
          console.log(`⚠️ 集合 ${collectionName} 不存在，尝试创建...`);

          // 尝试添加一个测试文档来创建集合
          try {
            await db.collection(collectionName).add({
              _createdAt: new Date(),
              _isTestDocument: true,
              message: '测试文档 - 集合初始化'
            });
            console.log(`✓ 集合 ${collectionName} 创建成功`);
          } catch (createError: any) {
            console.error(`✗ 集合 ${collectionName} 创建失败:`, createError.message);
          }
        } else {
          console.error(`✗ 检查集合 ${collectionName} 失败:`, error.message);
        }
      }
    }

    // 初始化系统设置
    try {
      console.log('初始化系统设置...');
      const systemSettings = db.collection(COLLECTIONS.SYSTEM_SETTINGS);
      const settingsResult = await systemSettings.limit(1).get();

      if (settingsResult.data.length === 0) {
        await systemSettings.add({
          electricityPrice: 0.8,
          waterPrice: 3.5,
          updatedAt: new Date(),
          _createdAt: new Date()
        });
        console.log('✓ 系统设置初始化完成');
      } else {
        console.log('✓ 系统设置已存在');
      }
    } catch (error: any) {
      console.error('✗ 初始化系统设置失败:', error.message);
    }

    console.log('\n✅ 数据库初始化完成');

  } catch (error: any) {
    console.error('❌ 数据库初始化失败:', error.message);
    process.exit(1);
  }
}

// 执行初始化
initializeDatabase();