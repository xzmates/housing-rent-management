# 数据库 V3 阶段一现状审计

基线提交：`4a908fa8059145a000b92d3847b9516f13ce8829`

阶段范围：只读代码审计；未连接生产数据库，未部署云函数，未执行迁移，未修改业务代码。

## Agent 结果状态

| Agent | 范围 | 状态 |
| --- | --- | --- |
| Agent 1 | 现状审计与目标模型 | 已完成 |
| Agent 2 | bills、payments、租金连续覆盖 | 已完成 |
| Agent 3 | lease_agreements、lease_settlements、退租 | 已完成 |
| Agent 4 | houses、tenants、tenant_private_profiles、权限 | 已完成 |
| Agent 5 | utility_records、水电账单、水电缴费 | 已完成 |
| Agent 6 | 查询 API、查询 Skill、查询页面、索引 | 已完成 |
| Agent 7 | 迁移、回滚、测试方案 | 暂未启动 |

## 当前核心集合

| 集合 | 当前用途 | 主要字段 | 主要问题 |
| --- | --- | --- | --- |
| `houses` | 房屋档案与出租状态缓存 | `_openid`, `code`, `address`, `rent`, `status`, `createdAt`, `updatedAt` | `status=rented/available` 可由 active lease 推导，和维护状态混在一起 |
| `tenants` | 租客档案与在租状态缓存 | `_openid`, `name`, `phone`, `idCard`, `remark`, `status`, `createdAt`, `updatedAt` | `idCard` 明文；`status` 是 active lease 缓存 |
| `tenant_private_profiles` | 预期隐私档案 | 未发现实际读写 | 尚未落地，隐私字段仍在 `tenants` |
| `lease_agreements` | 合同生命周期权威 | `houseId`, `tenantId`, `rent`, `deposit`, `paymentCycle`, `status`, `rentCoveredUntil`, `nextRentDueDate` | 租金覆盖字段是缓存；退租结算摘要字段堆叠在合同上 |
| `bills` | 应收账单 | `leaseId`, `type`, `period`, `amount`, `paidAmount`, `status`, `dueDate`, `rentCoverageStart`, `rentCoverageEnd` | `status` 与 `paidAmount` 可不一致；`period` 与具体日期字段混用 |
| `payments` | 收付款/抵扣流水 | `billId`, `leaseId`, `amount`, `direction`, `paymentMethod`, `paymentDate`, `collectionId`, `confirmationId` | 真实收款渠道和业务抵扣类型混在 `paymentMethod` |
| `utility_records` | 水电抄表记录 | `leaseId`, `electricityReading`, `waterReading`, `electricityUsage`, `waterUsage`, `totalCost`, `recordType`, `calculationDate` | 缺单价快照、上次读数快照、账单反向关联、幂等字段 |
| `system_settings` | 全局水电单价 | `_id=global`, `electricityPrice`, `waterPrice`, `updatedAt` | owner 范围不一致；客户端可创建默认值 |
| `operation_confirmations` | AI/Handoff 预览确认 | `_openid`, `action`, `targetId`, `sourceDigest`, `normalizedInput`, `snapshot`, `status`, `expiresAt`, `result` | 状态流转非 CAS；幂等结果和业务事务分离 |
| `operation_logs` | 操作审计日志 | `_openid`, `action`, `phase`, `status`, `requestId`, `targetId`, `idempotencyKey`, `summary`, `createdAt` | 不应作为唯一幂等权威；写入不在业务事务内 |
| `admins` | 管理员 | 代码未确认 | 未发现核心业务实际读写 |

## 当前主要调用链

```text
普通页面 / Skill
  -> miniprogram/services/api.js
  -> rentalDomain 云函数
      -> query-service / preview-service / command-service
      -> 部分新逻辑直接事务执行
      -> 部分写操作调用 legacy 云函数
```

仍存在 legacy 云函数：

- `queryLeaseData`
- `getHouseCurrentLease`
- `getTenantBills`
- `payBill`
- `createNextRentBill`
- `createLeaseAgreement`
- `addUtilityRecord`
- `terminateLease`
- `importLeaseSnapshot`
- `deleteLeaseAgreement`

## 权威字段与缓存字段结论

### 权威字段

- 合同生命周期：`lease_agreements.status/startDate/endDate/rent/deposit/paymentCycle`
- 租金覆盖事实：`bills.type='rent' + rentCoverageStart/rentCoverageEnd + amount/paidAmount`
- 收支流水事实：`payments`
- 水电读数事实：`utility_records.electricityReading/waterReading/calculationDate`
- 操作确认事实：`operation_confirmations.normalizedInput/sourceDigest/snapshot`

### 缓存或派生字段

- `houses.status` 中的 `rented/available`
- `tenants.status`
- `lease_agreements.rentCoveredUntil`
- `lease_agreements.nextRentDueDate`
- `bills.status`
- `bills.period`
- 页面拼装字段：`houseLabel`, `tenantName`, `statusText`, `remaining`

## 关键风险

1. 旧查询云函数缺少 `_openid` 过滤，跨用户读取风险最高。
2. 旧写入云函数若可被直接调用，会绕过 rentalDomain owner 校验和 confirmation。
3. `operation_confirmations` 的 `pending -> executing -> executed` 不是原子条件更新。
4. `operation_logs` 不在业务事务内，不适合作为唯一幂等 replay 权威。
5. 单账单缴费并发下可能超付或出现 `payments` 与 `bills.paidAmount` 不一致。
6. `houses.status`、`tenants.status` 与 active lease 可能不同步。
7. `tenants.idCard` 明文存储，Skill/页面/confirmation snapshot 存在泄露风险。
8. 水电记录缺单价快照和幂等字段，重复抄表可能重复建账单。
9. 退租正式凭证缺 `lease_settlements` 集合，结算细节散落在合同、账单和流水中。
10. 日期字段混用字符串、`Date`、`{ $date }`，跨时区和跨月账期存在风险。

## 阶段一未确认事项

- 生产数据库真实字段、脏数据比例、旧字段分布。
- CloudBase 数据库安全规则。
- 生产索引、唯一约束、集合权限。
- 旧云函数是否仍部署并可被小程序端直接调用。
- `admins` 集合真实用途。
- CloudBase 事务隔离级别对并发确认/缴费的实际行为。

