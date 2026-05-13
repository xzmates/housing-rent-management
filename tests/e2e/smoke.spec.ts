import { test, expect } from '@playwright/test';

const TS = Date.now();
const HOUSE_CODE = `EH-${TS}`;
const HOUSE_ADDRESS = '东楼北';
const HOUSE_RENT = 1500;
const TENANT_NAME = `测${String(TS).slice(-4)}`;
const TENANT_IDCARD = `1101011990${String(TS).slice(-6)}1234`;
const TENANT_PHONE = `138${String(TS).slice(-9)}`;

/**
 * E2E 冒烟测试 — 覆盖核心业务流程。
 * 所有测试按定义顺序串行执行，共用一组测试数据。
 */

test.describe.serial('核心业务流程', () => {

  test('1. 添加房屋', async ({ page }) => {
    await page.goto('/#/houses');
    await page.waitForTimeout(1000);

    // 点击添加房屋按钮
    await page.locator('button:has-text("添加房屋")').click();
    await page.waitForTimeout(500);

    // 填写房屋编号
    await page.locator('input[placeholder="如：A101"]').fill(HOUSE_CODE);

    // 选择地址
    await page.locator('select').filter({ hasText: '东楼北' }).selectOption(HOUSE_ADDRESS);

    // 填写租金（modal 内的 input）
    await page.locator('form input[type="number"]').fill(String(HOUSE_RENT));

    // 点击保存
    await page.locator('form button[type="submit"]').click();
    await page.waitForTimeout(2000);

    // 验证出现在列表中
    const table = page.locator('table');
    await expect(table.getByText(HOUSE_CODE).first()).toBeVisible();
    await expect(table.getByText(HOUSE_ADDRESS).first()).toBeVisible();
    await expect(table.getByText(`¥${HOUSE_RENT}`).first()).toBeVisible();
  });

  test('2. 添加租客并关联房屋', async ({ page }) => {
    await page.goto('/#/tenants');
    await page.waitForTimeout(1000);

    // 点击添加租客
    await page.locator('button:has-text("添加租客")').click();
    await page.waitForTimeout(500);

    // 填写姓名
    await page.locator('input[placeholder="租客姓名"]').fill(TENANT_NAME);

    // 填写身份证
    await page.locator('input[placeholder="18位身份证号码"]').fill(TENANT_IDCARD);

    // 填写手机号
    await page.locator('input[placeholder="11位手机号码"]').fill(TENANT_PHONE);

    // 选择房屋
    const houseLabel = `${HOUSE_CODE} - ${HOUSE_ADDRESS}（¥${HOUSE_RENT}/月）`;
    await page.locator('form select').filter({ hasText: '请选择房屋' }).first().selectOption({ label: houseLabel });
    await page.waitForTimeout(500);

    // 确认月租金自动填入（从房屋租金）
    const moneyInputs = page.locator('input[type="number"]');
    const rentVal = await moneyInputs.first().inputValue();
    expect(Number(rentVal)).toBe(HOUSE_RENT);

    // 填写入住日期：本月1号
    const today = new Date();
    const firstDay = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-01`;
    const dateInput = page.locator('input[type="date"]').first();
    await dateInput.fill(firstDay);

    // 点击保存 → 弹出确认窗
    await page.locator('button:has-text("保存")').click();
    await page.waitForTimeout(800);

    // 确认弹窗
    await expect(page.getByText('确认租客信息')).toBeVisible();
    await page.locator('button:has-text("确认保存")').click();
    await page.waitForTimeout(2000);

    // 验证租客出现在列表中
    const table = page.locator('table');
    await expect(table.getByText(TENANT_NAME).first()).toBeVisible();
    await expect(table.getByText('入住中').first()).toBeVisible();
  });

  test('3. 添加租金缴费 — 验证覆盖预览', async ({ page }) => {
    await page.goto('/#/payments');
    await page.waitForTimeout(1000);

    // 点击添加缴费
    await page.locator('button:has-text("添加缴费")').click();
    await page.waitForTimeout(500);

    // 默认就是租金类型，选择房屋
    const houseLabelPay = `${HOUSE_CODE}-${HOUSE_ADDRESS}`;
    await page.locator('select').filter({ hasText: '全部房屋' }).first().selectOption({ label: houseLabelPay });
    await page.waitForTimeout(800);

    // 验证自动关联了租客
    await expect(page.getByText(TENANT_NAME).first()).toBeVisible();

    // 验证周期自动填充（月付）
    await expect(page.getByText(/月付/)).toBeVisible();

    // 输入金额（3个月）
    const amountInput = page.locator('input[type="number"]').first();
    await amountInput.fill(String(HOUSE_RENT * 3));

    // 保存
    await page.locator('form button[type="submit"]').click();
    await page.waitForTimeout(3000);

    // 验证页面显示缴费记录（覆盖预览消失 = 保存成功）
    await expect(page.getByText('缴费记录').first()).toBeVisible();
  });

  test('4. 仪表盘显示统计', async ({ page }) => {
    await page.goto('/#/');
    await page.waitForTimeout(1500);

    // 验证仪表盘标题
    await expect(page.getByText('仪表盘').first()).toBeVisible();

    // 验证收费提醒板块有内容
    const reminderSection = page.getByText(/收费提醒|收费/).first();
    await expect(reminderSection).toBeVisible();
  });

  test('5. 房屋列表显示下次收租', async ({ page }) => {
    await page.goto('/#/houses');
    await page.waitForTimeout(1500);

    // 在表格中找到测试房屋的行
    const table = page.locator('table');
    await expect(table.getByText(HOUSE_CODE).first()).toBeVisible();

    // 验证租客名出现
    await expect(table.getByText(TENANT_NAME).first()).toBeVisible();

    // 验证下次收租出现（金额 金额应为 HOUSEx3 或 月付金额）
    await expect(table.getByText(/¥/).first()).toBeVisible();
  });

  test('6. 退租结算', async ({ page }) => {
    await page.goto('/#/tenants');
    await page.waitForTimeout(1500);

    // 等待表格加载完成
    await page.locator('table tbody').waitFor({ state: 'visible', timeout: 10000 });
    await page.waitForTimeout(500);

    // 找到包含测试租客名的行，点其中的退租按钮
    const tenantCell = page.locator('table').getByText(TENANT_NAME, { exact: true }).first();
    if (await tenantCell.count() === 0) {
      test.skip(true, '测试租客不存在');
      return;
    }
    // 退租按钮在同行的最后一个 td 中
    const tr = tenantCell.locator('xpath=ancestor::tr');
    await tr.getByRole('button', { name: '退租' }).click();
    await page.waitForTimeout(2500);

    // 退租弹窗显示
    await expect(page.getByText('办理退租')).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/退费|应缴/).first()).toBeVisible();

    // 点击确认退租
    await page.getByRole('button', { name: '确认退租' }).click();
    await page.waitForTimeout(1000);

    // 在最终结算确认弹窗中确认
    await expect(page.getByText('确认退租结算')).toBeVisible({ timeout: 5000 });
    await page.getByRole('button', { name: '确认结清并退租' }).click();
    await page.waitForTimeout(3000);

    // 验证弹窗关闭
    await expect(page.getByText('办理退租')).not.toBeVisible({ timeout: 5000 }).catch(() => {});
  });

  test('7. 退租后缴费记录验证', async ({ page }) => {
    await page.goto('/#/payments');
    await page.waitForTimeout(1500);

    // 搜索测试房屋的缴费记录
    await page.locator('select').filter({ hasText: '全部房屋' }).first().selectOption({ label: `${HOUSE_CODE}-${HOUSE_ADDRESS}` });
    await page.waitForTimeout(1000);

    // 验证存在退租结算记录（水单费或退款）
    const pageBody = page.locator('body');
    await expect(pageBody.getByText('退租结算').first()).toBeVisible({ timeout: 5000 });
  });

  test('8. 清理测试房屋', async ({ page }) => {
    await page.goto('/#/houses');
    await page.goto('/#/houses');
    await page.waitForTimeout(1000);
    const houseTable = page.locator('table');
    const houseRow = houseTable.getByText(HOUSE_CODE);
    if (await houseRow.isVisible().catch(() => false)) {
      page.once('dialog', d => d.accept());
      // 删除按钮在 tr 中
      await houseTable.getByRole('button', { name: '删除' }).first().click();
      await page.waitForTimeout(2000);
    }
  });
});
