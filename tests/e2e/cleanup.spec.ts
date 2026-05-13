import { test } from '@playwright/test';

test('清空所有租客和缴费记录，保留房屋', async ({ page }) => {
  await page.goto('/#/');
  await page.waitForTimeout(3000);

  const result = await page.evaluate(async () => {
    try {
      const mod = await import('/src/utils/cloudbase.ts');
      const app = mod.app;
      const db = app.database();
      const collections = ['utility_records', 'payments', 'tenants'];
      const stats: Record<string, number> = {};

      for (const collName of collections) {
        let deleted = 0;
        while (true) {
          const res = await db.collection(collName).get();
          const items = res.data || [];
          if (items.length === 0) break;
          for (const item of items) {
            await db.collection(collName).doc(item._id).remove();
            deleted++;
          }
        }
        stats[collName] = deleted;
      }
      return JSON.stringify(stats);
    } catch (e: any) {
      return JSON.stringify({ error: e.message });
    }
  });

  console.log('清理结果:', result);
});
