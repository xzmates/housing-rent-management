# 数据库 V3 安全审计方案

阶段：1.5 专项方案。本文档只形成安全修复计划，不代表已经修改业务代码、数据库规则或线上函数。

## 结论摘要

最高优先级风险是 legacy 查询函数缺少 `_openid` 过滤：

- `cloudfunctions/queryLeaseData/index.js`
- `cloudfunctions/getHouseCurrentLease/index.js`
- `cloudfunctions/getTenantBills/index.js`

这些函数没有读取 `app.auth().getUserInfo()` 或 `cloud.getWXContext()`，也没有在查询条件中追加 `_openid`。如果线上函数可被直接调用，知道 `houseId/tenantId/leaseId/billId` 即可能跨 owner 读取数据。

`rentalDomain` 新入口已通过 `getCaller(app)` 获取 caller，并使用 `repo.forOwner(caller.openId)` 做查询隔离；但仍有部分 legacy 写函数作为底层执行路径，必须确认只能经 `rentalDomain` 调用，或在自身补 owner 校验。

## 读取入口清单

| 入口 | 读取集合 | owner 来源 | 当前代码层防御 | 风险 |
| --- | --- | --- | --- | --- |
| `queryLeaseData.listLeases/getLeaseById/listBills/listUtilityRecords/listTenants/listHouses/getSystemSettings` | `lease_agreements`, `bills`, `utility_records`, `tenants`, `houses`, `system_settings` | 无 | 未追加 `_openid` | 高 |
| `getHouseCurrentLease` | `houses`, `lease_agreements`, `tenants`, `bills`, `utility_records` | 无 | 按传入 `houseId` 查询 | 高 |
| `getTenantBills` | `lease_agreements`, `bills`, `houses` | 无 | 按传入 `tenantId` 查询 | 高 |
| `rentalDomain.searchHouses/getHouseDetail/searchTenants/getTenantDetail/getActiveLeases/getUnpaidBills/getPaymentHistory/getMeterTargets/getMoveOutTargets/auditLeaseRentCoverage` | `houses`, `tenants`, `lease_agreements`, `bills`, `payments` | 云端 `app.auth().getUserInfo()` | `repo.forOwner(caller.openId)` | 低 |
| `rentalDomain.getOperationConfirmation` | `operation_confirmations` | 云端 caller | 校验 `confirmation._openid === caller.openId` | 低 |
| `miniprogram/services/api.js` 直接 `queryAll('houses')` / `queryAll('tenants')` / `queryAll('payments')` | `houses`, `tenants`, `payments` | 依赖数据库规则 | 客户端代码未追加 `_openid` | 中/高，待规则确认 |
| `api.getHouseById/getTenantById` | `houses`, `tenants` | 依赖数据库规则 | 仅按 doc id | 中/高，待规则确认 |
| `api.getSystemSettings/updateSystemSettings` | `system_settings` | 依赖数据库规则 | 直接读写 `_id='global'` | 高 |
| house/tenant/lease/rent/meter/move-out skills | 通过 `rentalDomain` | 云端 caller | 取决于对应 action | 中，需收紧敏感返回和最终写入口 |

## 写入和高风险操作入口

| 入口 | 写入集合 | 当前状态 | 风险 |
| --- | --- | --- | --- |
| `rentalDomain.confirmCreateHouse/confirmCreateTenant` | `houses`, `tenants` | 直接写入 owner `_openid` | 中：租客身份证仍可进入 `tenants.idCard` |
| `rentalDomain.confirmCreateLease/confirmRenewLease/confirmMeterReading/settleMoveOut` | 调用 legacy 函数 | `assertLegacyTargetOwner` 会先校验目标 owner | 中：legacy 函数若被直调仍缺自身 owner 校验 |
| `rentalDomain.confirmCollectRent` | `payments`, `bills`, `lease_agreements` | 事务内带 `_openid` | 中：confirmation 非必需；单账单缴费并发仍需 CAS 强化 |
| `rentalDomain.confirmPrepayRent/confirmRentCollection` | `payments`, `bills`, `lease_agreements`, `operation_confirmations` | 要求 confirmation，校验 sourceDigest | 中：`pending -> executing` 不是条件更新 |
| `payBill` legacy | `payments`, `bills`, `lease_agreements` | 函数自身不取 caller，不按 `_openid` 查询 | 高，如果可被直调 |
| `createNextRentBill` legacy | `bills` | 函数自身不取 caller，不按 `_openid` 查询 | 高，如果可被直调 |
| `addUtilityRecord` legacy | `utility_records`, `bills`, `system_settings` | 函数自身不取 caller，不按 `_openid` 查询 lease | 高，如果可被直调 |
| `terminateLease` legacy | `lease_agreements`, `houses`, `tenants`, `bills`, `payments`, `utility_records` | 函数自身不取 caller，不按 `_openid` 查询 lease | 高，如果可被直调 |
| `api.updateHouse/deleteHouse/updateTenant/deleteTenant` | `houses`, `tenants` | 客户端直接数据库写 | 高，待 CloudBase 规则确认 |
| `api.updateSystemSettings` | `system_settings` | 客户端直接写全局配置 | 高 |

## 客户端传入 `_openid` 信任风险

当前核心调用主要不是显式由客户端传 `_openid`，但存在两类间接风险：

1. legacy 函数用目标文档自带 `_openid` 写入关联记录，却不确认调用者是否等于该 `_openid`。
2. 测试和导入路径存在 `test/testRunId/createdBy` 等 meta 字段，迁移脚本不得把这些字段误当作 owner 身份。

阶段二规则：

- 所有云函数必须从云端身份获取 owner，不信任客户端传入 `_openid/openId/ownerId`。
- 对无 `_openid` 的历史数据，只允许 dry-run 报告；不得自动归属到当前用户。

## 仅凭文档 ID 跨 owner 读取或修改风险

必须优先修复的 ID 直查：

- `queryLeaseData.getLeaseById`
- `getHouseCurrentLease({ houseId })`
- `getTenantBills({ tenantId })`
- `api.getHouseById(id)`
- `api.getTenantById(id)`
- legacy `payBill({ billId })`
- legacy `addUtilityRecord({ leaseId })`
- legacy `terminateLease({ leaseId })`
- legacy `createNextRentBill({ leaseId })`

代码层最低防线：

```text
读取/写入目标文档
  -> 从云端身份得到 caller.openId
  -> where({ _id: targetId, _openid: caller.openId })
  -> 不存在统一返回 FORBIDDEN 或 NOT_FOUND，不泄露对象是否存在
```

## 旧查询函数是否可能被直接调用

从 `miniprogram/services/api.js` 证据看，页面仍直接调用：

- `getHouseCurrentLease`
- `getTenantBills`
- `queryLeaseData`

因此阶段二不能先删除；必须先补 owner 过滤，并保持返回结构兼容。

## 旧写函数是否绕过 `operation_confirmations`

存在绕过风险：

- `addUtilityRecord`：AI skill 和页面可经 `confirmMeterReading` 触发；legacy 函数自身无 confirmation 要求。
- `payBill`：虽然 `api.payBill` 现走 `rentalDomain.confirmCollectRent`，legacy 函数若仍部署则可直调。
- `terminateLease`：`rentalDomain.settleMoveOut` 可要求 confirmation freshness，但 legacy 函数自身可直调。
- `createNextRentBill`：legacy 函数自身可直调生成账单。

阶段二最低要求：legacy 写函数自身也要识别 caller 并校验 owner；高风险写入需要求有效 confirmation 或明确标记为内部调用。

## 身份证、日志、snapshot 和 AI 返回风险

已发现风险点：

- `tenants.idCard` 仍是明文字段。
- `tenant-detail` 页面展示 `tenant.idCard`。
- `tenant-skill/apis/index.js` 的租客详情字段包含“身份证”。
- 多个 skill API 使用 `console.info(JSON.stringify(params || {}))` 记录参数；如创建租客参数包含身份证，会进入日志。
- `operation_confirmations.snapshot` 存储 preview snapshot，必须确认不会包含完整身份证。
- `voicePlanCommand` 会识别手机号和身份证槽位，需避免把完整证件号写入日志或 AI 可见结果。

阶段二最低要求：

- Skill 返回和日志默认脱敏 phone/idCard。
- operation snapshot 禁止完整身份证。
- `tenants.idCard` 迁移到 `tenant_private_profiles` 后，普通查询不返回完整证件号。

## CloudBase 安全规则未知时的代码层防御

在安全规则尚未确认前，代码层必须提供以下防御：

1. 所有云函数读取和写入都从云端身份获取 caller。
2. 所有业务集合查询默认追加 `_openid`。
3. 所有按 `_id` 读取/更新/删除都必须同时匹配 `_openid`。
4. 客户端直接数据库写入逐步收口到 `rentalDomain` 或专用云函数。
5. `system_settings` 禁止客户端直接写全局 `_id='global'`。
6. AI skill 只暴露查询和 preview；最终写入要么跳转页面，要么必须有 confirmationId。
7. 高风险 confirmation 使用原子条件更新：只有 `pending` 可变为 `executing`。
8. 幂等 replay 读取 `operation_confirmations.result`，不依赖 `operation_logs`。
9. 日志和 snapshot 执行脱敏白名单。
10. 所有新增迁移命令默认拒绝生产环境。

## 阶段二安全修复最小修改集合

第一批只做安全基线，不改变数据库模型：

| 文件 | 最小修改 |
| --- | --- |
| `cloudfunctions/queryLeaseData/index.js` | 获取 caller，所有 where 追加 `_openid`；`getSystemSettings` 改 owner 优先、global fallback |
| `cloudfunctions/getHouseCurrentLease/index.js` | 获取 caller，house/lease/bills/utility_records 都按 `_openid` 查询 |
| `cloudfunctions/getTenantBills/index.js` | 获取 caller，tenant leases/bills/houses 都按 `_openid` 查询 |
| `cloudfunctions/payBill/index.js` | 函数自身 owner 校验；若保留直调，按 `_openid` 查询 bill/lease/rent bills |
| `cloudfunctions/createNextRentBill/index.js` | 函数自身 owner 校验；按 `_openid` 查询 lease/existing bill |
| `cloudfunctions/addUtilityRecord/index.js` | 函数自身 owner 校验；按 `_openid` 查询 lease/records/settings |
| `cloudfunctions/terminateLease/index.js` | 函数自身 owner 校验；按 `_openid` 查询和更新所有相关集合 |
| `cloudfunctions/rentalDomain/application/command-service.js` | confirmation CAS、replay 来源从 logs 改到 confirmation result |
| `cloudfunctions/rentalDomain/infrastructure/idempotency.js` | 查询 executed confirmation，增加状态机辅助 |
| `miniprogram/skills/*/apis/index.js` | 日志参数脱敏；移除或禁用 AI 最终写工具暴露 |
| `miniprogram/services/api.js` | 逐步减少客户端直连 DB 写入；保持页面返回结构 |
| `__tests__/v2/security.test.cjs` | 增加跨 openid 查询/写入拒绝测试 |

## 如何避免破坏现有页面

- 保持旧函数返回结构不变，只增加 owner 条件。
- 对 unauthorized 返回空列表或原有错误码形态，避免页面崩溃。
- `rentalDomain` 新查询可先作为 shadow path，不立即替换页面。
- 客户端 `api.js` 的函数名和返回字段保持不变。
- 安全测试先覆盖旧函数，再替换页面调用。

## 阶段二安全优先级

1. P0：legacy 查询函数 `_openid` 过滤。
2. P0：legacy 写函数自身 owner 校验。
3. P0：AI skill 日志和返回脱敏；收回 `confirmMeterReading` 等最终写工具暴露。
4. P1：confirmation CAS 和 replay 权威迁移到 `operation_confirmations.result`。
5. P1：客户端直写 `system_settings/houses/tenants` 收口。
6. P2：隐私集合、身份证迁移和旧字段清理。

## 待人工或只读数据库审计确认

- 生产 CloudBase 数据库安全规则。
- 线上 legacy 函数是否仍可被旧版本直接调用。
- 生产调用日志中是否出现身份证、手机号、snapshot 泄露。
- 无 `_openid` 文档数量和归属方式。
- 当前索引是否支持新增 owner-scoped 查询。
