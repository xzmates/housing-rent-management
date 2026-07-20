# 数据库 V3 兼容计划

## 兼容目标

- 不破坏当前页面。
- 不破坏已验证的退租 Handoff、提前收租/RentCollection Handoff。
- 不破坏旧字段读取。
- 不暴露新的高风险 AI 最终写入接口。

## 字段兼容

| 旧字段 | 新字段/策略 | 兼容方式 |
| --- | --- | --- |
| `houses.status` | `availabilityStatusCache`, `maintenanceStatus` | 继续返回 `status`，但查询层以 active lease 推导占用 |
| `tenants.status` | `occupancyStatusCache`, `profileStatus` | 继续返回 `status`，但查询层以 active lease 推导在租 |
| `tenants.idCard` | `tenant_private_profiles`, `idCardLast4`, `idCardHash` | 阶段二先复制，不立即删除 |
| `lease.rentCoveredUntil` | `rentCoveredUntilCache` | 继续写旧字段，同时由 rent bills 重算校验 |
| `lease.nextRentDueDate` | `nextRentDueDateCache` | 同上 |
| `bills.type` | `billType` | 继续写旧 `type` |
| `bills.period` | `periodStart/periodEnd/periodLabel` | 继续展示 `period`，计算改用日期字段 |
| `payments.paymentMethod` | `paymentChannel/allocationKind/cashFlowType` | 继续写旧字段，新增结构化字段 |

## API 兼容

继续保留：

- `previewPrepayRent`
- `confirmPrepayRent`
- `previewRentCollection`
- `confirmRentCollection`
- `payBill` service 名称
- `/pages/prepay-rent/index` 路由
- `/pages/ai-moveout-detail/index` 路由

收口方向：

- 页面 service 逐步统一走 `rentalDomain`。
- legacy 云函数先加权限和兼容，不直接删除。
- 查询类旧函数逐步替换为 owner-scoped query-service。

## Skill 暴露面

应保留：

- 查询工具。
- preview 工具。
- Handoff 所需工具。

应收回或避免新增：

- `confirmCollectRent`
- `confirmRentCollection`
- `confirmPrepayRent`
- `confirmMoveOut`
- `settleMoveOut`
- `confirmMeterReading`
- `confirmCreateHouse`
- `confirmCreateTenant`
- `confirmCreateLease`

说明：底层 Domain 能力可保留，但不应作为 AI 可自由调用工具暴露。

## 页面兼容

- 手动入口没有 `pageId` 时仍应工作。
- Handoff payload 只用于首屏摘要，不作为最终权威。
- 页面进入后必须重新从云端读取/预览。
- 返回和刷新不应触发正式写入。

## 数据兼容

迁移脚本需处理：

- 无 `_openid` 的旧记录。
- 只有 `period` 无 `rentCoverageStart/End` 的租金账单。
- `status=partial` 但 `paidAmount >= amount` 的脏账单。
- `payments.paymentMethod` 混合枚举。
- 旧 `tenants.idCard` 明文字段。
- 已退租但无 `lease_settlements` 的合同。
- 水电账单有 `utilityRecordId` 但记录无 `billId`。

