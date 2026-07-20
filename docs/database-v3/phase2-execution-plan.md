# 数据库 V3 阶段二执行计划（冻结前准备）

本文件只定义阶段二拆分、依赖和验收，不代表已经启动实施。

## 基线要求

- 基线提交：以阶段 1.5 结束后的提交为准。
- 开始阶段二前必须确认工作区干净。
- 不直接连接生产数据库；迁移脚本必须先 dry-run。
- 不删除旧字段、旧集合、旧 API。
- 每批完成后运行对应专项测试和 `npm test`。

## 建议分支 / worktree

| 批次 | 建议分支 |
| --- | --- |
| Phase2-A 安全收口 | `db-v3-phase2-a-security` |
| Phase2-B 账单与支付模型 | `db-v3-phase2-b-billing` |
| Phase2-C 退租 settlement | `db-v3-phase2-c-settlement` |
| Phase2-D 房屋租客隐私 | `db-v3-phase2-d-privacy` |
| Phase2-E 水电模型 | `db-v3-phase2-e-utility` |
| Phase2-F 查询与索引 | `db-v3-phase2-f-query-index` |
| Phase2-G 迁移脚本 dry-run | `db-v3-phase2-g-migration` |
| Phase2-H 全量回归与真机验收 | `db-v3-phase2-h-verify` |

## 执行批次

### Phase2-A：安全收口优先

| 项目 | 内容 |
| --- | --- |
| 负责人 | Agent 6 主责，Agent 1 协调 |
| 前置 | 阶段 1.5 文档冻结 |
| 允许修改 | `queryLeaseData/getHouseCurrentLease/getTenantBills`、相关 security 测试、Skill mcp 暴露面文档或配置 |
| 禁止修改 | 字段迁移脚本、UI 大改、退租/RentCollection 产品流程 |
| 验收 | 跨 `_openid` 查询拒绝；AI 不暴露最终写工具；现有 155+ 测试通过 |
| 回滚 | 只允许回滚代理层，不允许回滚 `_openid` 安全过滤 |

### Phase2-B：bills/payments/RentCollection 字段兼容

| 项目 | 内容 |
| --- | --- |
| 负责人 | Agent 2 |
| 前置 | Phase2-A |
| 允许修改 | bills/payments helper、RentCollection 写入、payments 页面统计、相关测试 |
| 验收 | `paidAmount>=amount` 显示 paid；租金/水电/损失费统计互不污染；rentCoveredUntil 连续规则通过 |
| 回滚 | 新字段可忽略读取，旧 `type/paymentMethod` 保留 |

### Phase2-C：退租 settlement 凭证

| 项目 | 内容 |
| --- | --- |
| 负责人 | Agent 3 |
| 前置 | Phase2-B 的 bill/payment 冻结字段 |
| 允许修改 | 退租事务、`lease_settlements` 写入、退租测试 |
| 验收 | 退租生成 settlement，可追溯 bills/payments/utility；moveout Handoff 专项通过 |
| 回滚 | lease 摘要字段保留，settlement 可忽略读取 |

### Phase2-D：房屋/租客/隐私

| 项目 | 内容 |
| --- | --- |
| 负责人 | Agent 4 |
| 前置 | Phase2-A |
| 允许修改 | houses/tenants 字段兼容、tenant_private_profiles、脱敏 presenter、相关测试 |
| 验收 | active lease 为状态权威；列表和 Skill 不返回完整身份证 |
| 回滚 | 主档案兼容字段仍保留 |

### Phase2-E：水电模型

| 项目 | 内容 |
| --- | --- |
| 负责人 | Agent 5 |
| 前置 | Phase2-A、Phase2-B |
| 允许修改 | `addUtilityRecord`、水电预览/确认、utility 页面/批量抄表最小兼容、相关测试 |
| 验收 | 单价快照、billId 追溯、重复提交幂等；水电缴费不影响租金覆盖 |
| 回滚 | legacy 水电字段保留 |

### Phase2-F：查询 API 与索引计划

| 项目 | 内容 |
| --- | --- |
| 负责人 | Agent 6 |
| 前置 | Phase2-B/C/D/E 字段稳定 |
| 允许修改 | Domain query-service、presenters、旧查询函数代理、索引文档 |
| 验收 | 首页提醒、payments、合同、租客详情按统一 presenter 输出；索引计划完成 dry-run 文档验证 |
| 回滚 | 保留旧查询签名 |

### Phase2-G：迁移脚本 dry-run

| 项目 | 内容 |
| --- | --- |
| 负责人 | Agent 7 |
| 前置 | Phase2-B/C/D/E/F |
| 允许修改 | `scripts/database-v3/*`、迁移测试、runbook |
| 验收 | dry-run、checkpoint、resume、rollback、anomaly 报告全部可重复执行 |
| 回滚 | 使用 rollback runbook 和迁移前备份 |

### Phase2-H：总体验收

| 项目 | 内容 |
| --- | --- |
| 负责人 | 总协调 Agent |
| 前置 | Phase2-A 至 G 全部通过 |
| 验收 | 全量自动化测试、三个 Handoff 专项、真机核心路径、迁移 dry-run 报告 |
| 输出 | 阶段二总结、剩余风险、是否进入生产迁移窗口 |

## 公共文件所有权

以 `docs/database-v3/agent-file-ownership.md` 为准。公共文件冲突必须由唯一负责人合并，其他 Agent 不直接改。

## 阶段二启动前人工确认

1. 是否允许修改业务代码。
2. 是否允许新增 `tenant_private_profiles` 和 `lease_settlements` 集合。
3. 是否允许收回 Skill 中 `confirmCreateHouse/confirmCreateTenant/confirmCreateLease/confirmMeterReading`。
4. 是否允许 legacy 查询函数先补 `_openid` 后再代理到 Domain。
5. 是否有生产数据库备份窗口和 dry-run 环境。

