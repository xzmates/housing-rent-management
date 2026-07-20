# 数据库 V3 测试计划

本文件记录阶段二前必须补强的测试，不代表已经实现。

## 安全与权限

- `queryLeaseData` 跨 `_openid` 查询必须拒绝或返回空。
- `getHouseCurrentLease` 跨 `_openid` 查询必须拒绝或返回空。
- `getTenantBills` 跨 `_openid` 查询必须拒绝或返回空。
- legacy `payBill/createNextRentBill/terminateLease/addUtilityRecord` 直调必须校验 owner。
- 查询 Skill 默认脱敏手机号、身份证。

## confirmation 与幂等

- 同一 `confirmationId` 并发确认 10 次，只能执行一次业务写入。
- `pending -> executing` 必须原子。
- 业务事务成功但 `operation_logs` 写失败时，重复请求可从 `operation_confirmations.result` replay。
- 已过期、已取消、已完成 confirmation 不能重复执行。
- sourceDigest 变化后旧 confirmation 失效。

## bills/payments/RentCollection

- `paidAmount >= amount` 时查询统一返回 paid。
- dirty `status=partial` 但待缴为 0 时不显示部分缴。
- 单账单并发缴费不能超付。
- 多账期 RentCollection 账单和 payment 可追溯到同一 `collectionId/confirmationId`。
- 非租金账单缴费不更新 `rentCoveredUntil`。
- 中间有欠租缺口时，未来已缴不能推进 `rentCoveredUntil`。
- 补齐缺口后，连续覆盖日期正确推进。
- payments 筛选租金/水电/已缴时统计不混入损失费、押金退款、租金退款。

## 退租

- 无 confirmationId 的 `settleMoveOut` 应禁止或走兼容安全路径。
- preview 与 settle 对补租、退款、水电、押金抵扣金额一致。
- 非月初起租的退租账期按合同缴费周期取整。
- 未来 unpaid rent 不应被错误纳入退租待结清。
- 退租写入 `lease_settlements` 后，合同、账单、流水可追溯。
- 双击确认退租只执行一次。

## houses / tenants / 隐私

- active lease 与 `houses.status` 不一致时，以 active lease 为准。
- active lease 与 `tenants.status` 不一致时，以 active lease 为准。
- 创建合同同步 house/tenant 缓存。
- 退租同步 house/tenant 缓存。
- 租客列表和 Skill 不返回完整身份证。
- `tenant_private_profiles` 回填后，详情页按权限读取隐私字段。

## 水电

- 普通抄表写 `utility_records`，同时保存单价快照。
- 普通抄表产生 utility bill，`bill.utilityRecordId` 与 `record.billId` 可追溯。
- 零用量只写记录，不写账单。
- 读数小于上次读数时拒绝，除非明确换表。
- 换表后允许新基准读数。
- 重复 confirmation 不重复写水电记录/账单。
- 水电预览后系统单价或最新读数变化，旧 confirmation 失效。
- 批量抄表部分失败有批次结果。

## 查询与索引

- dashboard 不提醒已缴账单。
- payments 页面统计口径和 bill type 枚举一致。
- contract 页面历史合同包含 terminated 合同。
- 日期字段兼容 string、Date、`{ $date }`。
- owner-scoped query-service 覆盖所有页面主查询。
- 索引计划至少通过文档化 dry-run 验证。

## 回归测试

阶段二每个子任务完成后至少运行：

```bash
npm test -- __tests__/v2/moveout-handoff.test.cjs
npm test -- __tests__/v2/prepay-handoff.test.cjs
npm test -- __tests__/v2/rent-collection-handoff.test.cjs
npm test
```

新增迁移测试建议：

- `__tests__/v2/database-v3-migration.test.cjs`
- `__tests__/v2/database-v3-security.test.cjs`
- `__tests__/v2/utility-v3.test.cjs`

