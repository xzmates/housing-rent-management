# 数据库 V3 目标结构（阶段 1.5 冻结稿）

本文件是阶段二实施的字段命名与状态枚举冻结依据。阶段二只能做兼容扩展和回填，不一次性删除旧字段；旧字段可作为兼容字段读取，但不得再新增同义字段。

## 统一词汇表

| 术语 | 冻结含义 |
| --- | --- |
| 权威字段 | 业务判断、事务校验、迁移回填的依据 |
| 缓存字段 | 为列表、筛选、首页统计保留的冗余展示字段，必须可由权威字段重算 |
| `servicePeriodStart/servicePeriodEnd` | 账单覆盖的真实服务日期，租金、水电、退款都必须使用具体日期 |
| `direction` | 账单方向：`receivable` 应收、`payable` 应付/应退 |
| `category` | 账单分类：`rent/deposit/utility/damage/rent_refund/deposit_refund/adjustment/other` |
| `paymentChannel` | 线下实际收款/退款记录方式：`cash/wechat/alipay/bank_transfer/other`，不代表在线支付 |
| `allocationKind` | 流水分摊性质：`direct_payment/deposit_offset/refund/reversal/adjustment` |
| `cashFlowType` | 现金流类型：`cash/noncash` |
| `accountingClass` | 账务归类：`operating_income/deposit_liability/operating_refund/other` |
| `operation_confirmations` | 高风险操作确认、幂等和 sourceDigest 的权威集合 |

## 公共字段

所有业务集合统一：

| 字段 | 含义 |
| --- | --- |
| `_openid` | 当前房东/用户归属，所有云端查询和写入必须强制校验 |
| `createdAt` | 创建时间 |
| `updatedAt` | 最后更新时间 |
| `schemaVersion` | 结构版本 |
| `isDeleted` | 软删除标记，默认 `false` |
| `deletedAt` | 软删除时间 |
| `version` | 乐观锁版本 |

## houses

权威：房屋基础档案。租住关系以有效合同为准，房屋状态字段是缓存或运营状态。

```js
{
  _id,
  _openid,
  houseKey,              // 房东内唯一房屋编号/助记键，建议由 code/address 规范化生成
  code,
  address,
  defaultRent,
  operationalStatus,    // normal | maintenance | disabled
  occupancyStatus,      // vacant | occupied，仅缓存，按 active lease 可重算
  currentLeaseId,       // 缓存
  currentTenantId,      // 缓存
  vacantSince,
  lastOccupiedAt,
  lastVacatedAt,
  isDeleted,
  createdAt,
  updatedAt,
  schemaVersion,
  version
}
```

兼容字段：

- `rent` 兼容读取为 `defaultRent`。
- `status` 兼容旧页面，长期由 `operationalStatus + occupancyStatus` 替代。

## tenants

权威：租客基础档案。租住关系以合同为准，列表默认不返回完整身份证。

```js
{
  _id,
  _openid,
  name,
  nameNormalized,
  phone,
  phoneNormalized,
  profileStatus,        // normal | archived | blocked
  occupancyStatus,      // active | inactive，仅缓存
  currentLeaseId,       // 缓存
  currentHouseId,       // 缓存
  idCardLast4,
  idCardHash,
  privateProfileId,
  remark,
  isDeleted,
  createdAt,
  updatedAt,
  schemaVersion,
  version
}
```

兼容字段：

- `status` 兼容旧页面，长期由 `profileStatus/occupancyStatus` 替代。
- `idCard` 迁移后不得默认查询返回；只允许受控详情或管理流程读取。

## tenant_private_profiles

隐私档案集合，默认不参与列表、Skill、日志和 confirmation snapshot。

```js
{
  _id,
  _openid,
  tenantId,
  idCardEncrypted,
  idCardLast4,
  idCardHash,
  phoneEncrypted,
  createdAt,
  updatedAt,
  schemaVersion
}
```

要求：

- `idCardHash` 只对非空身份证生成；空值不得参与唯一约束。
- Skill、operation logs、confirmation snapshot 不得包含完整身份证。

## lease_agreements

权威：合同生命周期和合同条款。

```js
{
  _id,
  _openid,
  houseId,
  tenantId,
  startDate,
  endDate,
  rent,
  deposit,
  paymentCycle,
  moveInElectricity,
  moveInWater,
  meterReplaced,
  status,               // active | terminated | cancelled
  rentCoveredUntil,
  nextRentDueDate,
  rentCoverageCalculatedAt,
  settlementId,
  terminatedAt,
  terminationReason,
  remark,
  isDeleted,
  createdAt,
  updatedAt,
  schemaVersion,
  version
}
```

规则：

- `status/startDate/endDate/rent/deposit/paymentCycle` 是权威字段。
- `rentCoveredUntil/nextRentDueDate` 是事务维护的缓存，可由 rent bills 连续缴清情况重算。
- 房屋和租客当前租住状态必须以 `lease_agreements.status === 'active'` 为最终裁决。

## lease_settlements

权威：退租结算正式凭证。必须新增，不能只依赖 confirmation snapshot 或 lease 摘要字段。

```js
{
  _id,
  _openid,
  leaseId,
  houseId,
  tenantId,
  confirmationId,
  sourceDigest,
  status,               // settled | cancelled
  moveOutDate,
  settledAt,
  amounts: {
    deposit,
    damageAmount,
    utilityCost,
    outstandingAmount,
    supplementalRent,
    depositOffsetAmount,
    depositRefundAmount,
    rentRefundAmount,
    extraPayment,
    cashSettlementAmount,
    totalRefund
  },
  meter: {
    previousElectricityReading,
    previousWaterReading,
    electricityReading,
    waterReading,
    electricityUsage,
    waterUsage,
    electricityPrice,
    waterPrice,
    utilityRecordId,
    utilityBillId
  },
  rentRefund: {
    occupiedPeriodStart,
    occupiedPeriodEnd,
    billingCycleMonths,
    actualRentDue,
    totalPaidRent,
    overpaidRent,
    rentRefundBillId
  },
  billIds,
  paymentIds,
  offsetDetails,
  cashSettlementDetails,
  createdAt,
  updatedAt,
  schemaVersion
}
```

## bills

权威：应收、应退和抵扣目标账单。账单必须使用具体服务起止日期。

```js
{
  _id,
  _openid,
  leaseId,
  houseId,
  tenantId,
  direction,            // receivable | payable
  category,             // rent | deposit | utility | damage | rent_refund | deposit_refund | adjustment | other
  type,                 // 兼容旧字段
  sourceType,           // lease_creation | rent_collection | meter_reading | move_out_settlement | manual_bill | migration | adjustment
  amount,
  paidAmount,
  outstandingAmount,
  status,               // unpaid | partial | paid | cancelled
  dueDate,
  issuedAt,
  servicePeriodStart,
  servicePeriodEnd,
  periodLabel,
  rentCoverageStart,    // 兼容/租金专用；应与 servicePeriodStart 对齐
  rentCoverageEnd,      // 兼容/租金专用；应与 servicePeriodEnd 对齐
  utilityRecordId,
  settlementId,
  uniqueKey,
  sourceOperationId,
  sourceConfirmationId,
  voidedAt,
  remark,
  isDeleted,
  createdAt,
  updatedAt,
  schemaVersion,
  version
}
```

规则：

- `amount/paidAmount` 是金额权威；`outstandingAmount` 可缓存但必须能由金额重算。
- `status` 是查询缓存，写入事务必须维护；查询 presenter 仍应按金额兜底规范化。
- `paidAmount >= amount` 时有效状态必须视为 `paid`，不得显示 `partial`。
- `overdue` 不作为持久化 `status`，由 `dueDate + outstandingAmount > 0` 动态推导；作废统一使用 `cancelled`。
- 租金账单唯一性建议用 `_openid + leaseId + category + servicePeriodStart + servicePeriodEnd + direction + sourceType` 形成 `uniqueKey`。

## payments

权威：账单分摊流水。一张 bill 可对应多条 payment；一批租金收款用 `collectionId` 或 `confirmationId` 追溯。

```js
{
  _id,
  _openid,
  billId,
  leaseId,
  houseId,
  tenantId,
  amount,
  direction,            // in | out
  paymentChannel,       // cash | wechat | alipay | bank_transfer | other
  allocationKind,       // direct_payment | deposit_offset | refund | reversal | adjustment
  cashFlowType,         // cash | noncash
  accountingClass,      // operating_income | deposit_liability | operating_refund | other
  paymentDate,
  collectionId,
  confirmationId,
  settlementId,
  status,               // posted | voided | reversed
  remark,
  createdAt,
  updatedAt,
  schemaVersion
}
```

兼容字段：

- `paymentMethod` 保留读取兼容，并迁移映射到 `paymentChannel`。
- 老数据中 `paymentMethod='bank'` 兼容映射为 `paymentChannel='bank_transfer'`。

## 12 个账务案例冻结

| 案例 | Bill 记录 | Payment 记录 |
| --- | --- | --- |
| 现金收租 | `direction=receivable`, `category=rent` | `direction=in`, `paymentChannel=cash`, `allocationKind=direct_payment`, `cashFlowType=cash`, `accountingClass=operating_income`, `status=posted` |
| 微信线下收租 | `direction=receivable`, `category=rent` | `direction=in`, `paymentChannel=wechat`, `allocationKind=direct_payment`, `cashFlowType=cash`, `accountingClass=operating_income`, `status=posted` |
| 收到押金 | `direction=receivable`, `category=deposit` | `direction=in`, `allocationKind=direct_payment`, `cashFlowType=cash`, `accountingClass=deposit_liability`, `status=posted` |
| 押金抵扣欠租 | 被抵扣 bill 为 `category=rent` | `direction=in`, `paymentChannel=other`, `allocationKind=deposit_offset`, `cashFlowType=noncash`, `accountingClass=deposit_liability`, `status=posted` |
| 押金抵扣水电 | 被抵扣 bill 为 `category=utility` | 同上 |
| 押金抵扣房损 | 被抵扣 bill 为 `category=damage` | 同上 |
| 退还押金 | `direction=payable`, `category=deposit_refund` | `direction=out`, `allocationKind=refund`, `cashFlowType=cash`, `accountingClass=deposit_liability`, `status=posted` |
| 退还多收租金 | `direction=payable`, `category=rent_refund` | `direction=out`, `allocationKind=refund`, `cashFlowType=cash`, `accountingClass=operating_refund`, `status=posted` |
| 房损超过押金后租客现金补缴 | `direction=receivable`, `category=damage` | `direction=in`, `paymentChannel=cash`, `allocationKind=direct_payment`, `cashFlowType=cash`, `accountingClass=other`, `status=posted` |
| 一笔收款分配多张账单 | 多个 bill 各自保持自身 `category` | 多条 payment 共用同一 `collectionId`，渠道、发生日和状态一致 |
| 一张账单被多次部分付款 | 单个 bill，`paidAmount=sum(posted payments)` | 多条 payment 指向同一 `billId` |
| 已登记流水被冲销 | 原 bill 重新计算 `paidAmount/status` | 原 payment 标记 `status=reversed`，新增反向 payment：`allocationKind=reversal`, `cashFlowType=noncash` |

## utility_records

权威：水电读数与结算快照。单价必须在记录和账单中保留快照。

```js
{
  _id,
  _openid,
  leaseId,
  houseId,
  tenantId,
  recordType,           // move_in_baseline | periodic | move_out | meter_replacement | correction
  source,               // manual_page | ai_skill | move_out | batch_meter | migration
  batchId,
  previousRecordId,
  previousElectricityReading,
  previousWaterReading,
  electricityReading,
  waterReading,
  electricityUsage,
  waterUsage,
  electricityPrice,
  waterPrice,
  electricityCost,
  waterCost,
  totalCost,
  calculationDate,
  servicePeriodStart,
  servicePeriodEnd,
  billId,
  status,               // draft | confirmed | voided
  confirmedAt,
  voidedAt,
  operatorOpenId,
  idempotencyKey,
  remark,
  isDeleted,
  createdAt,
  updatedAt,
  schemaVersion,
  version
}
```

兼容字段：

- `billingPeriodStart/billingPeriodEnd` 若旧代码已产生，可迁移到 `servicePeriodStart/servicePeriodEnd`。
- `recordType='regular'` 兼容映射为 `periodic`。

## operation_confirmations

权威：高风险操作确认、幂等和 sourceDigest。

```js
{
  _id,
  _openid,
  action,
  actionName,           // 兼容旧字段
  targetId,
  leaseId,
  source,               // ai_skill | manual_page | migration
  pagePath,
  actorOpenid,
  resourceVersion,
  payloadVersion,
  idempotencyKey,
  sourceDigest,
  normalizedInput,
  snapshot,
  status,               // pending | executing | executed | expired | cancelled | failed
  result,
  errorCode,
  errorMessage,
  expiresAt,
  createdAt,
  executingAt,
  executedAt,
  failedAt,
  cancelledAt,
  updatedAt,
  schemaVersion
}
```

要求：

- `pending -> executing -> executed` 必须条件更新。
- 重复请求优先 replay `operation_confirmations.result`。
- confirmation 绑定 `_openid/action/targetId/sourceDigest/expiresAt/status`。
- confirmation snapshot 可用于预览和审计，但最终执行必须重新校验权威数据。

## system_settings

短期保留 `system_settings._id='global'` 兼容读取，V3 推荐按房东归属隔离配置。

```js
{
  _id,
  _openid,
  settingKey,           // global | utility_price | ...
  electricityPrice,
  waterPrice,
  effectiveFrom,
  updatedBy,
  updatedAt,
  schemaVersion,
  version
}
```

规则：

- 读取顺序：当前 `_openid` 配置优先，`global` 仅兜底。
- 水电账单和水电记录必须保存单价快照，不能以后续 `system_settings` 变化重算历史账。

## 金额核算场景冻结

### 租金收款登记

- 房东线下已收到钱后，系统登记 `payment`，不发起任何在线支付。
- RentCollection 只处理 `category='rent'` 且 `direction='receivable'`。
- 补交欠租、当期收租、提前收租和混合收租共用同一套匹配/创建/分摊逻辑。
- 已存在租金账单优先匹配；缺失账期才创建账单。
- `rentCoveredUntil` 只能推进到连续缴清的最后一天，不能跨过中间欠租缺口。

### 退租结算

- 退租按合同缴费周期计费：月付不满一月按一月，季付不满一季度按一季度，以此类推。
- 未来已缴但退租后不应占用的租金，生成 `direction='payable' + category='rent_refund'` 或等价退款账单。
- 押金抵扣生成 `allocationKind='deposit_offset'` 的非现金流水。
- 押金退还生成 `direction='payable' + category='deposit_refund'`，实际退还记录为 `allocationKind='refund'`。
- 损坏赔偿为 `direction='receivable' + category='damage'`，不得混入水电或租金统计。

### 水电费

- 水电读数确认后生成 `category='utility'` 应收账单。
- 水电缴费不得更新 `rentCoveredUntil`。
- 单价、上次读数、本次读数、用量、费用必须在 `utility_records` 和相关 bill 中可追溯。

### 押金

- 在管押金是负债，不是经营收入。
- 收押金 payment 使用 `accountingClass='deposit_liability'`。
- 押金抵扣和押金退还不得计入租金实收。

### 损失费

- 损失费是独立 `category='damage'`。
- 筛选水电或租金时不得把损失费纳入实收合计。
