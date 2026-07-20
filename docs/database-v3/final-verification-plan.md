# 数据库 V3 最终验证计划（设计稿）

本文件定义阶段二和迁移前后的最终验收。

## 自动化测试

每个阶段二批次至少运行：

```bash
npm test -- __tests__/v2/moveout-handoff.test.cjs
npm test -- __tests__/v2/prepay-handoff.test.cjs
npm test -- __tests__/v2/rent-collection-handoff.test.cjs
npm test
```

迁移脚本阶段新增：

```bash
npm test -- __tests__/v2/database-v3-migration.test.cjs
npm test -- __tests__/v2/database-v3-security.test.cjs
npm test -- __tests__/v2/utility-v3.test.cjs
```

## 真机验收路径

- 首页临近收费提醒：已缴账单不提醒。
- 缴费记录筛选：租金、水电、押金、损失费统计互不污染。
- 租金收款登记：补交欠租、当期、提前、混合账期。
- 退租结算：周期取整、多付租金退款、押金抵扣、损失费、水电费。
- 水电抄表：普通单次、批量、换表、退租水电。
- 租客详情：默认脱敏，详情授权读取。

## 数据抽样

| 集合 | 抽样检查 |
| --- | --- |
| `bills` | 服务日期具体、状态和金额一致、category/direction 正确 |
| `payments` | allocation/accounting 分类正确，collectionId 可追溯 |
| `lease_agreements` | rentCoveredUntil 不跨越欠租缺口 |
| `lease_settlements` | settlement 可追溯 bills/payments/utility |
| `utility_records` | 单价快照、上次/本次读数、billId |
| `tenants` | 列表无完整身份证 |

## 验收出口

- 全量测试通过。
- dry-run anomaly 无高危未处理项。
- 生产写入前备份可用。
- 回滚演练通过。
- 真机核心路径通过。

