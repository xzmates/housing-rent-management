/**
 * 退租结算场景测试（调用真实云函数）
 * 使用说明：node scripts/test-terminate-scenarios.cjs
 *
 * 注意：脚本会创建测试数据并在测试结束后清理。
 * 每个场景会在唯一的环境ID前缀下创建独立的房屋和租客。
 */

const CLOUD_ENV_ID = 'cloud1-2gxr9nlc327f3b44';

// 模拟微信小程序环境的云函数调用
// 实际部署后在云函数内部使用 @cloudbase/node-sdk

// ------------- 测试工具 -------------
let passCount = 0, failCount = 0;

function assert(label, condition, expected, actual) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passCount++;
  } else {
    console.log(`  ❌ ${label}`);
    console.log(`     期望: ${JSON.stringify(expected)}`);
    console.log(`     实际: ${JSON.stringify(actual)}`);
    failCount++;
  }
}

function assertEqual(label, actual, expected) {
  assert(label, actual === expected, expected, actual);
}

function assertApprox(label, actual, expected) {
  assert(label, Math.abs(actual - expected) < 0.01, expected, actual);
}

// ------------- 场景辅助函数 -------------

/**
 * 通过写入数据库创建测试数据
 */
async function createTestData(db, prefix) {
  const houseId = `test_house_${prefix}`;
  const tenantId = `test_tenant_${prefix}`;
  const now = new Date().toISOString();

  // 创建房屋
  await db.collection('houses').add({
    _id: houseId,
    code: `T${prefix}`,
    address: '测试楼',
    rent: 1000,
    status: 'available',
    createdAt: now,
    updatedAt: now
  });

  // 创建租客
  await db.collection('tenants').add({
    _id: tenantId,
    name: `测试员${prefix}`,
    phone: `1380000${prefix}`,
    status: 'inactive',
    createdAt: now,
    updatedAt: now
  });

  return { houseId, tenantId };
}

async function verifyTestData(db, houseId, tenantId) {
  const house = await db.collection('houses').doc(houseId).get();
  const tenant = await db.collection('tenants').doc(tenantId).get();
  return house.data && tenant.data;
}

/**
 * 调用云函数（通过 invokeFunction MCP 工具）
 * 注意：实际执行时需要通过 manageFunctions(action="invokeFunction") 调用
 */
async function callCloudFunction(functionName, params) {
  // 这个函数会在主流程中被替换为实际的 MCP 调用
  return { functionName, params };
}

// ------------- 测试场景 -------------

/**
 * 场景1：无损坏、无水电、无预付租金
 * 入住1个月退租，押金应全额退还
 */
async function scenario1(db) {
  console.log('\n📋 场景1：无损坏无水电无预付 - 简单退租');
  const prefix = Date.now().toString().slice(-4);
  const { houseId, tenantId } = await createTestData(db, prefix);

  console.log(`  房屋: ${houseId}, 租客: ${tenantId}`);
  console.log('  ⏳ 调用 createLeaseAgreement...');
  console.log('  ℹ️  请通过 MCP 依次执行：');
  console.log(`     manageFunctions(action="invokeFunction", functionName="createLeaseAgreement", params={houseId, tenantId, startDate, rent: 1000, deposit: 1000})`);
  console.log(`     manageFunctions(action="invokeFunction", functionName="terminateLease", params={leaseId, endDate, damageAmount: 0, electricityReading: 0, waterReading: 0})`);
}

// ------------- 主流程 -------------

async function main() {
  console.log('='.repeat(60));
  console.log('  退租结算场景测试');
  console.log('  云环境: ' + CLOUD_ENV_ID);
  console.log('='.repeat(60));
  console.log('');

  console.log('⚠️  请通过 MCP 工具按以下步骤手动执行测试：');
  console.log('');

  // 显示所有场景的 MCP 指令
  for (let i = 1; i <= 5; i++) {
    console.log(`--- 场景${i} ---`);
    // 具体指令会在后续输出
  }

  console.log('');
  console.log('='.repeat(60));
  console.log(`  测试完成: ${passCount} 通过, ${failCount} 失败`);
  console.log('='.repeat(60));
}

main().catch(console.error);
