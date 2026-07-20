# 数据库 V3 迁移计划

本文件是阶段一后的迁移规划，不代表已执行。阶段一禁止连接生产数据库、禁止执行迁移。

## 原则

1. 先补字段和兼容读取，再切换写入，最后清理旧字段。
2. 旧 API 和旧页面不一次性下线。
3. 所有迁移脚本必须先支持 dry-run。
4. 生产迁移前必须导出备份。
5. 回滚策略必须先于正式写入。

## 阶段 0：只读盘点

Agent 7 启动后执行：

- 只读统计集合字段分布。
- 统计缺 `_openid` 文档。
- 统计 `bills.status` 与 `paidAmount/amount` 不一致文档。
- 统计 `bills.period` 格式。
- 统计 `payments.paymentMethod` 枚举。
- 统计 `tenants.idCard` 存在率。
- 统计 `utility_records` 是否存在重复读数/重复账单。
- 统计 terminated 合同是否缺结算凭证。

## 阶段 1：兼容字段回填

建议新增但不删除旧字段：

- `schemaVersion`
- `version`
- `periodStart/periodEnd/periodLabel`
- `paymentChannel/allocationKind/cashFlowType`
- `idCardLast4/idCardHash/privateProfileId`
- `utility_records.previous* / price snapshot / billId`
- `lease_agreements.*Cache`

## 阶段 2：安全收口

优先级最高：

1. `queryLeaseData/getHouseCurrentLease/getTenantBills` 加 `_openid` 过滤。
2. 旧写入云函数加 owner 校验。
3. `operation_confirmations` 状态流转改为条件更新。
4. replay 改为读取 `operation_confirmations.result`。

## 阶段 3：模型迁移

- 从 `tenants.idCard` 回填 `tenant_private_profiles`。
- 从 terminated `lease_agreements` 回填 `lease_settlements`。
- 从 `bills.period` 解析并补 `periodStart/periodEnd/periodLabel`。
- 给 `utility_records` 回填 `billId`，给 utility bill 补水电结构字段。
- 给 `payments` 回填 `paymentChannel/allocationKind/cashFlowType`。

## 阶段 4：查询切换

- 页面查询逐步从旧查询函数迁移到 owner-scoped domain query。
- presenter 统一返回 `effectiveStatus`、脱敏字段和标准日期。
- dashboard、payments、contract 不再各自重复拼装关键经营统计。

## 阶段 5：清理与冻结

在所有测试和真机验证通过后：

- 标记旧字段 deprecated。
- 标记旧云函数只读或仅内部调用。
- 不立即删除旧字段，至少保留一个版本周期。

## 回滚策略

- 所有新增字段可忽略读取，不破坏旧版本。
- 新写入链路保留兼容旧字段。
- 迁移脚本保留 before/after diff 输出。
- 对隐私迁移，先复制到新集合，不删除 `tenants.idCard`；确认后再遮蔽或清理。

## Agent 7 后续任务

Agent 7 应在目标结构确认后编写：

- dry-run 迁移脚本设计。
- 回滚脚本设计。
- 数据校验清单。
- 上线窗口和灰度方案。
- 迁移前后自动化测试命令。

