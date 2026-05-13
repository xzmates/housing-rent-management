import { test } from '@playwright/test';

test('直接通过数据库清理所有测试数据', async ({ page }) => {
  await page.goto('/#/');
  await page.waitForTimeout(3000);

  const result = await page.evaluate(async () => {
    try {
      // 通过 Vite dev server 动态导入 cloudbase 实例
      const cloudbaseModule = await import('/src/utils/cloudbase.ts');
      const app = cloudbaseModule.app;
      if (!app || !app.database) return JSON.stringify({ error: 'app not found' });

      const db = app.database();
      const _ = db.command;

      // 收集所有测试房屋ID和关联数据
      const housesRes = await db.collection('houses').get();
      const testHouses = (housesRes.data || []).filter((h: any) => String(h.code || '').startsWith('T'));
      const testHouseIds = testHouses.map((h: any) => h._id);

      if (testHouseIds.length === 0) return JSON.stringify({ message: '无测试数据', deleted: 0 });

      // 删除关联的租客
      const tenantsRes = await db.collection('tenants').get();
      const testTenants = (tenantsRes.data || []).filter((t: any) =>
        testHouseIds.includes(t.houseId) || /\d{10,}/.test(t.name || '')
      );
      for (const t of testTenants) {
        // 先删关联付款记录
        const paymentsRes = await db.collection('payments').where({ tenantId: t._id }).get();
        for (const p of (paymentsRes.data || [])) {
          await db.collection('payments').doc(p._id).remove();
        }
        // 删水电记录
        const utilityRes = await db.collection('utility_records').where({ tenantId: t._id }).get();
        for (const u of (utilityRes.data || [])) {
          await db.collection('utility_records').doc(u._id).remove();
        }
        await db.collection('tenants').doc(t._id).remove();
      }

      // 删除测试房屋
      for (const h of testHouses) {
        await db.collection('houses').doc(h._id).remove();
      }

      return JSON.stringify({ deletedHouses: testHouses.length, deletedTenants: testTenants.length });
    } catch (e: any) {
      return JSON.stringify({ error: e.message, stack: e.stack });
    }
  });

  console.log('数据库清理结果:', result);
});
