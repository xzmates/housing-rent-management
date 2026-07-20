# 数据库 V3 迁移 Runbook（设计稿）

本文件为阶段二/迁移阶段设计，不代表已执行。所有脚本必须默认 dry-run，生产写入必须二次确认。

## 运行原则

1. 默认拒绝生产写入：未显式传入 `--env staging` 或 `--confirm-prod-token` 时只允许 dry-run。
2. 先备份，再迁移；无备份不写入。
3. 每个集合分批处理，支持 checkpoint、resume、rollback。
4. 每条记录输出 before/after diff 摘要。
5. 发现异常只记录 anomaly，不静默猜测业务含义。

## 建议目录

```text
scripts/database-v3/
  README.md
  specs/
    migration-input.md
    migration-output.md
    checkpoint-format.md
```

阶段 1.5 只允许设计文档；脚本实现放到阶段二后半段。

## 迁移批次

| 批次 | 集合 | 迁移内容 |
| --- | --- | --- |
| M1 | `bills` | 回填 `direction/category/sourceType/servicePeriodStart/servicePeriodEnd/outstandingAmount/uniqueKey/schemaVersion` |
| M2 | `payments` | 回填 `paymentChannel/allocationKind/cashFlowType/accountingClass/status/collectionId/schemaVersion` |
| M3 | `lease_agreements` | 校验并回填 `rentCoveredUntil/nextRentDueDate/rentCoverageCalculatedAt/schemaVersion` |
| M4 | `lease_settlements` | 从 terminated 合同和退租账务回填正式结算凭证 |
| M5 | `houses/tenants` | 回填状态缓存、规范化字段、软删除字段 |
| M6 | `tenant_private_profiles` | 复制隐私字段、生成 last4/hash，主档案保留兼容字段 |
| M7 | `utility_records` | 回填单价快照、服务周期、状态、billId、schemaVersion |
| M8 | `system_settings` | 从 global 复制 owner-scoped 默认配置 |

## Dry-run 输出

每批必须输出：

- 扫描记录数。
- 可安全迁移记录数。
- anomaly 数量和分类。
- 字段 before/after 示例。
- 预计写入数量。
- 是否需要人工确认。

## Checkpoint 设计

```json
{
  "migrationId": "db-v3-M1-20260720",
  "envId": "staging",
  "collection": "bills",
  "batchNo": 12,
  "lastId": "xxx",
  "processed": 1200,
  "updated": 1100,
  "skipped": 80,
  "anomalies": 20,
  "startedAt": "2026-07-20T00:00:00.000Z",
  "updatedAt": "2026-07-20T00:05:00.000Z"
}
```

## 写入前检查

- `git status` 干净。
- 阶段二安全收口已上线并验证。
- 已有完整数据库导出。
- dry-run 报告由人工确认。
- 回滚 runbook 已演练。

## 写入后检查

- 运行最终验证计划中的自动化测试。
- 抽样核对 bills/payments/leases/utility/settlements。
- 首页提醒、缴费记录、退租、RentCollection 真机主链路复测。
- anomaly catalog 归档。

