# 数据库 V3 回滚 Runbook（设计稿）

本文件定义迁移失败后的回滚原则。阶段 1.5 不执行任何回滚。

## 回滚层级

| 层级 | 场景 | 处理 |
| --- | --- | --- |
| R0 | 仅新增兼容字段导致问题 | 代码回退读取旧字段，保留新增字段 |
| R1 | 新字段值错误但旧字段完整 | 使用 migration diff 反向更新新增字段 |
| R2 | 新集合回填错误 | 标记新集合记录 `isDeleted=true` 或删除迁移批次生成记录 |
| R3 | 旧字段被错误覆盖 | 从迁移前备份恢复受影响记录 |

## 禁止事项

- 不允许无备份覆盖生产。
- 不允许硬删除历史账务记录。
- 不允许回滚 `_openid` 安全过滤。
- 不允许回滚已收回的 AI 最终写接口暴露面。

## 回滚输入

- `migrationId`
- 迁移前备份位置
- checkpoint 文件
- before/after diff 文件
- anomaly catalog

## 集合回滚策略

| 集合 | 回滚策略 |
| --- | --- |
| `bills` | 新增字段可置空或忽略；若 `status` 被修正错误，从 diff 恢复 |
| `payments` | 新增结构字段可置空；不得删除真实收付款流水 |
| `lease_agreements` | `rentCoveredUntil/nextRentDueDate` 可由 bills 重新计算 |
| `lease_settlements` | 迁移生成记录用 `migrationId` 标识，可软删除 |
| `tenant_private_profiles` | 可软删除迁移生成隐私档案；主档案兼容字段仍保留 |
| `utility_records` | 新增快照字段可置空；不得删除原始读数 |
| `system_settings` | 可退回 global fallback |

## 回滚验收

- 旧页面可正常打开。
- 首页待收、缴费记录、合同详情、退租详情无异常。
- `npm test` 通过。
- 抽样记录与备份一致。

