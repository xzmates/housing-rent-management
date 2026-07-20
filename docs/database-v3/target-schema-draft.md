# 数据库 V3 目标结构草案与争议点

本文件记录阶段一尚未完全定稿的设计问题。阶段二实施前需要最终确认。

## 争议 1：是否新增 collections 集合

Agent 2 建议将“一次真实收款/退款动作”从 `payments` 中拆出：

```text
collections
  -> payment_allocations
```

优点：

- 一次线下收款可以自然覆盖多张账单。
- 现金流统计与账单分摊分离。
- 押金抵扣、退款、退租结算更清晰。

缺点：

- 改动范围较大。
- 页面、测试和历史数据迁移成本较高。

阶段二建议：先不新增必需集合，短期在 `payments` 增加 `collectionId/paymentChannel/allocationKind/cashFlowType`；V3.1 再评估拆表。

## 争议 2：system_settings 是全局还是 owner scoped

当前代码有两种口径：

- `system_settings._id = global`
- rentalDomain owner-scoped repo 可能要求 `_openid`

阶段二建议：

- 先保留 `_id='global'` 兼容。
- 增加 `_openid` 或 `ownerId` 后，以当前用户配置为优先。
- 无 owner 配置时 fallback 到全局默认。

## 争议 3：houses.status / tenants.status 是否保留

建议：

- 保留旧字段兼容页面。
- V3 查询层以 active lease 推导占用状态。
- 字段命名上新增 `availabilityStatusCache` / `occupancyStatusCache`，避免误认为权威。

## 争议 4：bill.status 是否权威

当前多处通过 `paidAmount >= amount` 归一化。

阶段二建议：

- `amount/paidAmount` 是金额权威。
- `status` 是事务维护的缓存字段。
- 所有查询 presenter 返回 `effectiveStatus`。
- 后台迁移修复脏状态。

## 争议 5：tenant_private_profiles 加密方式

本阶段无法确认项目是否已有加密密钥管理。

阶段二建议：

- 先迁移 `idCardLast4/idCardHash`。
- 完整身份证暂不默认返回。
- 是否加密存储 `idCardEncrypted` 由后续安全方案确认。

## 争议 6：退租是否必须新增 lease_settlements

Agent 3 强烈建议新增正式凭证集合。

阶段二建议：

- 新退租写入 `lease_settlements`。
- 历史已退租合同通过迁移脚本回填最佳努力版本。
- `lease_agreements` 只保留 `settlementId/settlementSummary`。

## 争议 7：水电抄表是否强制 Handoff 页面确认

当前 `meter-reading-skill` 暴露 `confirmMeterReading`，AI 可直接写入。

阶段二建议：

- 资金/状态变更类原则上都应 preview + 页面确认。
- 若暂不改造 UI，至少先从 AI 可调用工具中收回 `confirmMeterReading`。

## 争议 8：旧云函数是否下线

旧函数仍被代码或兼容路径引用。

阶段二建议：

- 先加 owner 校验和安全测试。
- 再逐步改页面/API 统一走 `rentalDomain`。
- 最后再评估下线，不在 V3 第一阶段直接删除。

