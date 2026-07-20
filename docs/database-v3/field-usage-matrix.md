# 字段使用矩阵

## houses

| 字段 | 写入位置 | 读取位置 | V3 判断 |
| --- | --- | --- | --- |
| `_openid` | 新增房屋、导入/测试 | 查询、owner 过滤 | 权威归属 |
| `code/address/rent` | `createHouse`, `api.updateHouse` | 房屋列表、合同、账单展示、Skill 查询 | 权威档案 |
| `status` | `createLeaseAgreement`, `terminateLease`, `api.updateHouse` | 页面、query-service、Skill | 缓存/兼容；占用状态应由 active lease 推导 |

## tenants

| 字段 | 写入位置 | 读取位置 | V3 判断 |
| --- | --- | --- | --- |
| `_openid` | 新增租客 | 查询、owner 过滤 | 权威归属 |
| `name/phone` | `createTenant`, `api.updateTenant` | 页面、Skill、合同/账单展示 | 权威档案；Skill 应默认脱敏 phone |
| `idCard` | `createTenant`, `api.updateTenant` | 租客详情 | 隐私字段，应迁移到 `tenant_private_profiles` |
| `status` | 创建合同、退租 | 页面、Skill | 缓存/兼容；在租状态应由 active lease 推导 |

## lease_agreements

| 字段 | 写入位置 | 读取位置 | V3 判断 |
| --- | --- | --- | --- |
| `houseId/tenantId` | 创建合同、导入 | 全局查询 | 权威关联 |
| `rent/deposit/paymentCycle` | 创建合同、导入 | 收租、退租、查询展示 | 合同条款权威 |
| `status` | 创建、退租、删除/取消 | 所有业务 | 合同生命周期权威 |
| `rentCoveredUntil/nextRentDueDate` | 创建、缴费、RentCollection | dashboard、prepay、审计 | 缓存，需由 rent bills 重算 |
| 退租摘要字段 | `terminateLease` | 退租页面/历史查询 | 应迁入 `lease_settlements` |

## bills

| 字段 | 写入位置 | 读取位置 | V3 判断 |
| --- | --- | --- | --- |
| `type` | 创建合同、收租、水电、退租 | payments、dashboard、query-service | 兼容字段；V3 建议 `billType` |
| `amount` | 各账单创建 | 统计、缴费、退租 | 应收/应退金额权威 |
| `paidAmount` | 缴费、抵扣、退款 | 状态推导、统计 | 已分配金额权威 |
| `status` | 各写入路径 | 页面/查询 | 缓存，需统一归一化 |
| `period` | 多处生成 | 页面展示、历史兼容 | 展示兼容，不应再作为计算权威 |
| `rentCoverageStart/End` | 租金账单/RentCollection | rent coverage | 租金账期权威 |
| `utilityRecordId` | 水电账单 | 水电追溯 | 应补反向 `utility_records.billId` |

## payments

| 字段 | 写入位置 | 读取位置 | V3 判断 |
| --- | --- | --- | --- |
| `amount/direction` | 缴费、退租、抵扣 | payments、contract、统计 | 流水金额和方向 |
| `paymentMethod` | 多写入路径 | 展示/统计 | 混用字段，应拆为 `paymentChannel/allocationKind` |
| `collectionId/confirmationId` | RentCollection | 追溯 | 应推广到所有资金动作 |
| `paymentDate` | 缴费/收款 | 历史查询 | 账务发生日 |
| `createdAt` | 所有写入 | 审计/排序 | 操作创建日 |

## utility_records

| 字段 | 写入位置 | 读取位置 | V3 判断 |
| --- | --- | --- | --- |
| `electricityReading/waterReading` | 抄表、退租、入住基准 | 水电页面、退租 | 读数权威 |
| `electricityUsage/waterUsage` | 云端计算 | 展示/账单 | 结算快照 |
| `electricityCost/waterCost/totalCost` | 云端计算 | 展示/账单 | 费用快照 |
| `recordType` | 入住/普通/退租 | 查询/展示 | 需统一枚举 |
| `calculationDate` | 抄表日期 | 排序/展示 | 账务日期 |
| `billId` | 当前缺失 | - | V3 建议新增 |

## operation_confirmations

| 字段 | 写入位置 | 读取位置 | V3 判断 |
| --- | --- | --- | --- |
| `action/targetId` | preview | confirm | 操作绑定权威 |
| `sourceDigest` | preview | confirm | 数据一致性校验权威 |
| `normalizedInput` | preview | confirm | 参数锁定权威 |
| `snapshot` | preview | 页面展示/confirm | 预览快照 |
| `status` | preview/confirm | replay/安全校验 | 需 CAS |
| `result` | confirm | replay | 应成为幂等 replay 权威 |

