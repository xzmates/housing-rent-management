# 房租管理系统小程序测试方案

> 版本：2026-06-23  
> 测试口径：数据库保留账单明细，页面/统计层做汇总展示；不再自动生成“月租账单”，只做当月/逾期收租提醒；退租时生成结算预览，并用可退押金自动抵扣未结清租金/水电，最后再生成押金退还或补缴。

## 一、测试目标

1. 验证房屋、租客、合同、账单、缴费、水电、退租的完整业务闭环。
2. 验证 CloudBase 云函数事务和数据库状态一致性。
3. 验证小程序运行态页面数据和云端数据一致。
4. 验证历史逾期租金按分期明细入库，页面/统计层能汇总展示。
5. 验证退租结算按新业务规则计算：补租 + 水电 + 可调整押金退还值。
6. 建立安全可清理的测试数据管理机制，避免污染真实业务数据。

---

## 二、核心数据模型

### 2.1 核心集合

| 集合 | 关键字段 | 状态/类型 |
|------|----------|-----------|
| `houses` | `_id`, `_openid`, `code`, `address`, `rent`, `status`, `testRunId` | `available`, `rented`, `maintenance` |
| `tenants` | `_id`, `_openid`, `orderNo`, `name`, `phone`, `status`, `testRunId` | `active`, `inactive` |
| `lease_agreements` | `_id`, `houseId`, `tenantId`, `startDate`, `endDate`, `rent`, `deposit`, `paymentCycle`, `rentCoveredUntil`, `nextRentDueDate`, `status`, `testRunId` | `active`, `terminated` |
| `bills` | `_id`, `leaseId`, `houseId`, `tenantId`, `type`, `period`, `amount`, `paidAmount`, `status`, `dueDate`, `testRunId` | `rent`, `deposit`, `utility`, `deposit_return`, `extra_due` / `unpaid`, `partial`, `paid` |
| `payments` | `_id`, `billId`, `leaseId`, `houseId`, `tenantId`, `amount`, `paymentDate`, `paymentMethod`, `testRunId` | 流水记录 |
| `utility_records` | `_id`, `leaseId`, `houseId`, `tenantId`, `electricityReading`, `waterReading`, `electricityUsage`, `waterUsage`, `totalCost`, `testRunId` | 抄表记录 |
| `system_settings` | `_id='global'`, `electricityPrice`, `waterPrice` | 水电单价 |

### 2.2 关联关系

```text
houses 1 -> N lease_agreements
tenants 1 -> N lease_agreements
lease_agreements 1 -> N bills
lease_agreements 1 -> N utility_records
bills 1 -> N payments
utility_records 1 -> 1 bills(type=utility)
```

### 2.3 全局一致性规则

| 规则 | 验证标准 |
|------|----------|
| 活跃合同 | `lease.status='active'` 时，房屋应为 `rented`，租客应为 `active` |
| 退租合同 | `lease.status='terminated'` 后，房屋应为 `available`，租客应为 `inactive` |
| 账单关联 | 每条 `bills.leaseId` 必须存在；租金/押金/水电账单应带 `houseId`、`tenantId` |
| 流水关联 | 每条 `payments.billId` 必须存在；缴费流水应带 `leaseId`、`houseId`、`tenantId` |
| 金额一致 | 同一账单下 `sum(payments.amount) === bill.paidAmount` |
| 抄表连续 | 新读数必须大于等于上次读数，首次以上次入住读数为基准 |

---

## 三、云函数与业务能力矩阵

| 能力 | 云函数/实现位置 | 说明 | 必测重点 |
|------|----------------|------|----------|
| 创建合同 | `createLeaseAgreement` | 创建合同、更新房屋/租客状态、生成首期租金/押金/历史逾期租金账单 | 账单金额、覆盖期、逾期明细、事务一致性 |
| 缴费 | `payBill` | 更新账单 `paidAmount/status`，写入 `payments` | 部分支付、超额拒绝、流水关联 |
| 抄表计费 | `addUtilityRecord` | 按上次读数计算用量并生成水电账单 | 读数连续、单价、账单关联 |
| 退租结算 | `terminateLease` | 按退租日计算补租、水电、押金调整，并自动用押金抵扣未结清账单，更新状态并生成退还/补缴记录 | 押金抵扣流水、退租水电、补缴/退还、状态一致性 |
| 收租提醒 | 页面/查询逻辑，非账单生成 | 不自动生成月租账单，只提醒哪些房屋本月/已逾期需要收租 | 提醒列表准确性，不产生新账单 |
| 通用查询 | `queryLeaseData` | 查询合同、账单、抄表记录 | 排序、筛选、退租后历史记录 |
| 租客/房屋详情 | `getTenantBills`, `getHouseCurrentLease` | 查询聚合数据 | 统计金额、当前合同、历史账单 |

> 注意：`generateMonthlyRentBills` 不再作为核心业务能力使用。测试方案不再要求自动生成月租账单，只验证收租提醒。

---

## 四、业务规则确认

### 4.1 合同创建和历史逾期账单

合同创建时自动生成：

1. 首期租金账单：`amount = rent × paymentCycleMonths`，`status='paid'`。
2. 押金账单：默认 `amount = rent`，如传入 `deposit` 则使用指定值，`status='paid'`。
3. 历史逾期租金账单：从 `nextRentDueDate` 起，按付款周期逐期生成明细账单，直到测试执行日所在的已到期周期。

数据库标准：

- 逾期账单必须是多条分期明细，不是一条汇总账单。
- 每条逾期租金账单 `type='rent'`、`status='unpaid'`、`amount=rent×paymentCycleMonths`。

页面/统计标准：

- 页面可以把多条逾期租金汇总显示为“逾期合计”。
- 明细仍应可追溯每一期，如 `2025-04~2025-06`、`2025-07~2025-09`。

### 4.2 收租提醒

系统不再自动生成“月租账单”。收租相关逻辑只做提醒：

- 本月到期提醒：`nextRentDueDate` 落在当前月份，且合同仍为 `active`。
- 已逾期提醒：存在 `rent` 类型 `unpaid/partial` 账单，或 `nextRentDueDate < today`。
- 已退租合同不进入收租提醒，但历史账单仍在缴费页显示。
- 提醒不写入 `bills`，只返回/展示待收租房屋、租客、合同、应收金额和到期日。

### 4.3 退租结算

退租确认前展示结算预览，内容包括：

```text
未结清账单 = 当前合同下 rent/utility/extra_due 等 unpaid/partial 账单剩余金额
应补租金 = 未生成租金账单的退租补租区间 × 单月房租
应补水电 = (当前电表读数 - 上次电表读数) × 电价
        + (当前水表读数 - 上次水表读数) × 水价
退租前应结款 = 未结清账单 + 应补租金 + 应补水电
```

押金处理：

```text
初始可退押金 = 合同押金
实际可退押金 = 用户检查房屋损坏后手动设置的 refundDepositValue
押金抵扣额 = min(max(实际可退押金, 0), 退租前应结款)
应退押金 = max(实际可退押金 - 押金抵扣额, 0)
仍需补缴 = max(退租前应结款 - 押金抵扣额, 0) + max(-实际可退押金, 0)
```

结算结果：

- 押金抵扣必须写入 `payments.paymentMethod='deposit_offset'`，并更新被抵扣账单的 `paidAmount/status`。
- `应退押金 > 0`：生成 `deposit_return` 账单，状态为 `paid`，页面显示“已退”。
- `仍需补缴 > 0`：保留被部分抵扣后的原账单待缴余额；若来自负押金赔偿，则生成 `extra_due`。
- `refundDepositValue < 0` 表示租客损失全部押金后仍需额外赔偿，赔偿额生成 `extra_due`。
- 退租完成后，合同为 `terminated`，房屋为 `available`，租客为 `inactive`。

建议参数：

```js
{
  leaseId,
  endDate,
  electricityReading,
  waterReading,
  refundDepositValue,
  remark
}
```

---

## 五、分层测试策略

### 5.1 本地单元/服务层测试

目标：快速验证核心业务计算，不依赖真实云环境。

| 范围 | 验证内容 |
|------|----------|
| 日期计算 | `rentCoveredUntil`, `nextRentDueDate`, 月末/闰年/跨年 |
| 逾期账单 | 分期明细条数、每期金额、合计金额 |
| 缴费 | 全额、部分、超额、重复支付 |
| 抄表 | 首次抄表、连续抄表、倒读数拒绝 |
| 退租 | 补租、水电、押金调整、负押金退还值 |
| 查询排序 | 未缴优先、按到期日排序、历史账单可见 |

执行标准：

```bash
npm test
```

要求：全部通过；时间相关测试固定 `today=2026-06-23` 或显式注入测试日期。

### 5.2 云函数集成测试

目标：验证真实 CloudBase 云函数、事务和数据库写入。

工具：

- `manageFunctions(action="invokeFunction")`
- `readNoSqlDatabaseContent`
- `writeNoSqlDatabaseContent`

要求：

- 所有测试数据带 `testRunId`。
- 每个测试用例使用独立房屋、租客、合同，避免交叉污染。
- 不直接跳过业务云函数写核心状态，除非是在准备测试数据。

### 5.3 数据一致性巡检

目标：在测试前后批量检查数据库状态。

必须巡检：

- 孤儿账单：`bills.leaseId` 不存在。
- 孤儿流水：`payments.billId` 不存在。
- 活跃合同但房屋非 `rented`。
- 活跃合同但租客非 `active`。
- 已退租合同但房屋仍 `rented`。
- `bill.paidAmount` 与 `payments` 汇总不一致。
- 水电账单缺 `houseId/tenantId`。

### 5.4 小程序运行态测试

使用 `.agents/skills/wechat-devtools-stable-test/SKILL.md`。

必测页面：

- `pages/payments/index`
- `pages/houses/index`
- `pages/tenants/index`
- `pages/utility/index`
- `pages/create-lease/index`
- `pages/contract/index`

验收标准：

- 编译 `errors=[]`、`warnings=[]`、`wxml_errors=[]`。
- 缴费页能显示退租合同历史账单。
- 房屋页 `relationMismatch=false`。
- 租客页 `status/isActive/leaseInfo` 与合同状态一致。
- 收租提醒只展示应提醒房屋，不新增账单。

---

## 六、详细测试用例

### 6.1 合同创建

| ID | 场景 | 输入 | 预期 |
|----|------|------|------|
| TC-001 | 创建月付合同 | `rent=2000`, `paymentCycle='month'` | 首期租金 2000 已缴，押金 2000 已缴 |
| TC-002 | 创建季付合同 | `rent=2000`, `paymentCycle='quarter'` | 首期租金 6000 已缴，押金 2000 已缴 |
| TC-003 | 创建半年付合同 | `paymentCycle='half_year'` | 首期租金 `rent×6` |
| TC-004 | 创建年付合同 | `paymentCycle='year'` | 首期租金 `rent×12` |
| TC-005 | 自定义押金 | `deposit=3000` | 押金账单金额为 3000 |
| TC-006 | 入住水电底数 | `moveInElectricity=100`, `moveInWater=50` | 合同保存入住读数 |
| TC-007 | 房屋维修中 | `house.status='maintenance'` | 创建失败，返回 400 |
| TC-008 | 房屋已有活跃合同 | 同一 `houseId` 有 active 合同 | 创建失败，返回 400 |
| TC-009 | 租客已有活跃合同 | 同一 `tenantId` 有 active 合同 | 创建失败，返回 400 |
| TC-010 | 缺少必要参数 | 缺少 `houseId/tenantId/startDate/rent` | 返回 400 |
| TC-011 | 房屋不存在 | 无效 `houseId` | 返回 404 |
| TC-012 | 租客不存在 | 无效 `tenantId` | 返回 404 |

### 6.2 历史逾期账单

测试基准日期：`2026-06-23`。

| ID | 场景 | 输入 | 数据库预期 | 页面/统计预期 |
|----|------|------|------------|----------------|
| TC-013 | 季付历史逾期 | `startDate='2025-01-01'`, `rent=1000`, `paymentCycle='quarter'` | 首期租金 3000 已缴；押金 1000 已缴；5 条逾期租金账单，每条 3000，共 15000 | 显示逾期合计 15000，可查看 5 期明细 |
| TC-014 | 月付历史逾期 | `startDate='2025-01-01'`, `rent=1000`, `paymentCycle='month'` | 17 条逾期租金账单，共 17000 | 显示逾期合计 17000 |
| TC-015 | 季付未逾期 | `startDate='2026-05-01'`, `rent=1000`, `paymentCycle='quarter'` | 首期覆盖到 2026-07-31，无逾期账单 | 不显示逾期 |
| TC-016 | 当天入住 | `startDate='2026-06-23'`, `paymentCycle='month'` | 首期租金和押金已缴，无逾期 | 不显示逾期 |
| TC-017 | 半年付历史逾期 | `startDate='2025-01-01'`, `rent=1000`, `paymentCycle='half_year'` | 2 条逾期账单，每条 6000，共 12000 | 显示逾期合计 12000 |
| TC-018 | 年付历史逾期 | `startDate='2025-01-01'`, `rent=1000`, `paymentCycle='year'` | 1 条逾期账单，金额 12000 | 显示逾期合计 12000 |

明细示例：`2025-01-01` 季付、月租 1000：

```text
首期已缴：2025-01~2025-03，3000
押金已缴：1000
逾期明细：
  2025-04~2025-06，3000
  2025-07~2025-09，3000
  2025-10~2025-12，3000
  2026-01~2026-03，3000
  2026-04~2026-06，3000
逾期合计：15000
```

### 6.3 收租提醒

| ID | 场景 | 前置条件 | 预期 |
|----|------|----------|------|
| TC-019 | 本月到期提醒 | active 合同 `nextRentDueDate` 在当前月 | 提醒该房屋/租客应收租，不新增账单 |
| TC-020 | 已逾期提醒 | 存在未缴租金账单或 `nextRentDueDate < today` | 提醒逾期，显示逾期合计 |
| TC-021 | 已缴至未来 | `rentCoveredUntil` 晚于当前月末 | 不提醒 |
| TC-022 | 已退租合同 | `status='terminated'` | 不进入收租提醒 |
| TC-023 | 多合同排序 | 多个到期/逾期合同 | 逾期优先，再按到期日升序 |

### 6.4 缴费

| ID | 场景 | 输入 | 预期 |
|----|------|------|------|
| TC-024 | 全额缴费 | `amount=remaining` | `bill.status='paid'`，写入 payment |
| TC-025 | 部分缴费 | `amount<remaining` | `bill.status='partial'` |
| TC-026 | 多次缴费 | 先部分，再补齐 | 第二次后 `paid`，流水合计等于账单金额 |
| TC-027 | 超额缴费 | `amount>remaining` | 返回 400，不写 payment |
| TC-028 | 已缴账单再次缴费 | `bill.status='paid'` | 返回 400 |
| TC-029 | 无效账单 | 无效 `billId` | 返回 404 |
| TC-030 | 金额非法 | `amount<=0` | 返回 400 |

### 6.5 抄表计费

| ID | 场景 | 输入 | 预期 |
|----|------|------|------|
| TC-031 | 首次抄表 | 当前读数大于入住读数 | 生成 `utility_records` 和 `utility` 账单 |
| TC-032 | 连续抄表 | 当前读数大于上次读数 | 用量按差值计算 |
| TC-033 | 倒读数 | 当前读数小于上次读数 | 返回 400，不生成账单 |
| TC-034 | 自定义计费日期 | `calculationDate` | 账单 `period/dueDate` 正确 |
| TC-035 | 已退租合同抄表 | `lease.status='terminated'` | 返回 400 |

### 6.6 退租结算

| ID | 场景 | 前置条件/输入 | 预期 |
|----|------|---------------|------|
| TC-036 | 无补租、无水电、全额退押金 | `refundDepositValue=deposit`，无应补费用 | 生成 `deposit_return` |
| TC-037 | 退租日需补租 | 退租日超过已生成/已覆盖租金账单范围 | 生成补租租金账单，并参与押金抵扣 |
| TC-038 | 退租时补水电 | 传当前水电读数 | 生成退租抄表记录；水电费按差值和单价计入结算 |
| TC-039 | 用户调低退还押金 | `refundDepositValue < deposit` | 按用户设置值参与抵扣和退还 |
| TC-040 | 退还押金设为 0 | `refundDepositValue=0` | 不抵扣押金，未结清账单保持待缴 |
| TC-041 | 退还押金为负 | `refundDepositValue=-500` | 租客额外赔偿 500，生成 `extra_due` |
| TC-042 | 押金不足抵扣 | 退租前应结款 > 实际可退押金 | 押金先抵扣，剩余待缴金额保留在原账单或 `extra_due` |
| TC-043 | 合同不存在 | 无效 `leaseId` | 返回 404 |
| TC-044 | 合同已终止 | `status='terminated'` | 返回 400 |
| TC-045 | 部分缴租后押金抵扣 | 租金待缴 2700，先缴 1800，押金 900 | 退租确认后租金账单 `paidAmount=2700/status=paid`，新增 `deposit_offset` 流水 900，无补缴/退还 |
| TC-046 | 押金退还显示 | 生成 `deposit_return` paid 账单 | 缴费记录状态文案显示“已退”，不计入已收收入 |
| TC-047 | 在管押金统计 | 多个 active 合同 | `在管押金=sum(active leases.deposit)`；退租后该合同押金不再计入 |

### 6.7 查询和页面显示

| ID | 范围 | 预期 |
|----|------|------|
| TC-045 | `queryLeaseData.listBills` | 未缴/部分缴优先，再按 `dueDate` 升序 |
| TC-046 | 缴费页 | active/terminated 合同的历史账单都可显示 |
| TC-047 | 房屋页 | active 合同房屋显示 `rented`；退租后显示 `available`；`relationMismatch=false` |
| TC-048 | 租客页 | active 租客 `isActive=true` 且有 `leaseInfo`；退租后 `inactive` 且无活跃合同 |
| TC-049 | 租客账单详情 | 返回合同、房屋、账单、统计金额 |
| TC-050 | 房屋当前租约 | 空置房返回 `currentLease=null` |

### 6.8 事务和失败恢复

| ID | 场景 | 预期 |
|----|------|------|
| TC-051 | 创建合同中途失败 | 合同、账单、房屋/租客状态全部回滚 |
| TC-052 | 缴费中途失败 | payment 和 bill 更新全部回滚 |
| TC-053 | 抄表中途失败 | 不留下孤儿 `utility_records` 或 `utility` 账单 |
| TC-054 | 退租中途失败 | 合同、房屋、租客、结算账单全部回滚 |

### 6.9 边界值

| ID | 场景 | 输入 | 预期 |
|----|------|------|------|
| TC-055 | 租金为 0 | `rent=0` | 返回 400 |
| TC-056 | 租金为负 | `rent=-100` | 返回 400 |
| TC-057 | 月末入住 | `startDate='2026-06-30'` | 覆盖期正确，不发生日期漂移 |
| TC-058 | 年末入住 | `startDate='2026-12-31'` | 跨年正确 |
| TC-059 | 闰年入住 | `startDate='2028-02-29'` | 闰年正确 |
| TC-060 | 超长备注 | `remark.length=1000` | 按业务规则截断或返回错误 |
| TC-061 | 中文/特殊字符备注 | 中文、符号 | 正常保存和展示 |

---

## 七、端到端主流程

### E2E-001 历史逾期合同完整闭环

1. 创建测试房屋：`available`，租金 1000。
2. 创建测试租客：`inactive`。
3. 创建合同：`startDate='2025-01-01'`，`paymentCycle='quarter'`，`rent=1000`。
4. 验证合同：
   - `rentCoveredUntil=2025-03-31`
   - `nextRentDueDate=2025-04-01`
5. 验证账单：
   - 首期租金 3000 已缴
   - 押金 1000 已缴
   - 5 条逾期租金账单，共 15000
6. 验证缴费页：
   - 明细账单可见
   - 页面/统计展示逾期合计 15000
7. 执行水电抄表，生成水电账单。
8. 按退租规则传入退租日、水电读数、`refundDepositValue`。
9. 验证结算账单、缴费流水、房屋/租客/合同状态。
10. 验证退租后缴费页仍可查看历史记录。

### E2E-002 当月收租提醒

1. 创建多个合同，覆盖本月到期、已逾期、已缴至未来、已退租。
2. 打开首页/收租提醒入口。
3. 验证仅展示本月到期和逾期合同。
4. 验证没有新增任何 `rent` 账单。

---

## 八、小程序开发工具测试流程

使用 `wechat-devtools-stable-test` skill。

1. 确认项目根目录为包含 `project.config.json` 的目录。
2. 验证 `appid`、`miniprogramRoot`、`cloudfunctionRoot`。
3. `wechat_ide(action="status")`。
4. `wechat_ide(action="open", cdp_enabled=true)`。
5. `wechat_build(action="compile")`。
6. 若 `wechat_automator` 超时：
   - 使用编译输出的 IDE HTTP port 启动 `cli.bat auto`。
   - 若 `page_stack` 卡住，用 CDP 点击工具栏“普通编译”。
   - 若 MCP wrapper 仍超时，用原生 `miniprogram-automator` 连接 auto port。
7. 逐页读取 `page.data()`，验证关键字段。

编译验收：

- `compiled=true`
- `errors=[]`
- `warnings=[]`
- `wxml_errors=[]`
- AppID 正常

---

## 九、安全测试数据管理

### 9.1 测试数据标识

每次测试生成唯一：

```text
testRunId = E2E_YYYYMMDD_HHmmss_<shortRandom>
```

所有测试集合都写入：

```js
{
  test: true,
  testRunId,
  createdBy: 'codex-e2e'
}
```

命名建议：

- 房屋：`TEST_HOUSE_<testRunId>_001`
- 租客：`TEST_TENANT_<testRunId>_001`
- 租客 `orderNo`：`T_<testRunId>_<seq>`，避免唯一索引冲突。

通过 MCP 服务端直写给小程序可见数据时，必须补 `_openid`，否则可能被行级权限挡住。

### 9.2 清理顺序

清理必须只按 `testRunId`，禁止按宽泛 `TEST_` 全量删除。

顺序：

1. `payments`
2. `bills`
3. `utility_records`
4. `lease_agreements`
5. `tenants`
6. `houses`

每次清理前先 dry-run 查询数量，确认只命中当前 `testRunId`。

### 9.3 保留策略

- 失败用例默认保留测试数据，并在报告中记录 `testRunId`。
- 通过用例可自动清理。
- 若要复盘小程序页面，保留最后一次 E2E 的数据 24 小时。

---

## 十、测试报告格式

每次测试输出 Markdown 报告：

```markdown
# 房租管理系统测试报告

- 日期：
- 环境 ID：
- testRunId：
- Git commit：
- 云函数版本/部署时间：
- 微信开发者工具端口：IDE HTTP / CDP / auto

## 结果总览
- 通过：
- 失败：
- 阻塞：

## 关键业务断言
- 逾期账单明细：
- 页面逾期汇总：
- 收租提醒：
- 退租结算：
- 数据一致性：

## 失败详情
| ID | 场景 | 预期 | 实际 | 日志/数据 |

## 清理结果
- 清理集合：
- 保留数据：
```

---

## 十一、优先级

| 优先级 | 范围 |
|--------|------|
| P0 | 合同创建、历史逾期明细、缴费、退租结算、缴费页显示、数据一致性 |
| P1 | 收租提醒、水电抄表、查询排序、测试数据清理、小程序运行态验证 |
| P2 | 并发、事务故障注入、批量数据、字符串边界、性能 |
