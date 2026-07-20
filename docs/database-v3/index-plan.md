# 数据库 V3 索引计划

本文件仅为索引设计，不代表已创建索引。

## 通用索引原则

- 所有业务查询优先带 `_openid`。
- 高频列表使用 `_openid + status/date`。
- 账期和租金覆盖查询使用具体日期字段，不依赖 `period` 字符串。
- 迁移前需确认 CloudBase 当前索引清单。

## houses

| 索引 | 用途 |
| --- | --- |
| `_openid + code` | 按房号查找、Skill 匹配 |
| `_openid + status + createdAt` | 房屋列表兼容 |
| `_openid + activeLeaseIdCache` | 缓存命中 |

## tenants

| 索引 | 用途 |
| --- | --- |
| `_openid + phoneNormalized` | 手机号搜索 |
| `_openid + nameNormalized` | 姓名搜索 |
| `_openid + status + createdAt` | 租客列表兼容 |
| `_openid + currentLeaseIdCache` | 当前合同缓存 |

## tenant_private_profiles

| 索引 | 用途 |
| --- | --- |
| `_openid + tenantId` | 租客隐私档案读取 |
| `_openid + idCardHash` | 身份证去重/校验 |

## lease_agreements

| 索引 | 用途 |
| --- | --- |
| `_openid + status + createdAt` | 合同列表 |
| `_openid + houseId + status` | 房屋当前合同 |
| `_openid + tenantId + status` | 租客当前合同 |
| `_openid + houseId + startDate` | 房屋历史 |
| `_openid + tenantId + startDate` | 租客历史 |
| `_openid + status + startDate` | 入住时间报表 |
| `_openid + status + endDate` | 退租时间报表 |

## bills

| 索引 | 用途 |
| --- | --- |
| `_openid + leaseId + type + dueDate` | 合同账单 |
| `_openid + leaseId + type + rentCoverageStart` | 租金覆盖 |
| `_openid + status + type + dueDate` | 待缴/提醒 |
| `_openid + leaseId + status` | 合同未结清 |
| `_openid + type + status + dueDate` | payments 筛选 |
| `_openid + dueDate` | 总账时间范围 |
| `_openid + utilityRecordId` | 水电账单追溯 |

建议唯一逻辑：

```text
_openid + leaseId + type=rent + rentCoverageStart + rentCoverageEnd
```

CloudBase 如不支持条件唯一索引，则需在事务中用幂等/锁模型保证。

## payments

| 索引 | 用途 |
| --- | --- |
| `_openid + leaseId + paymentDate` | 合同流水 |
| `_openid + billId + paymentDate` | 账单流水 |
| `_openid + tenantId + paymentDate` | 租客流水 |
| `_openid + houseId + paymentDate` | 房屋流水 |
| `_openid + collectionId` | 一批收款追溯 |
| `_openid + confirmationId` | 操作追溯 |
| `_openid + paymentChannel + paymentDate` | 渠道统计 |

## utility_records

| 索引 | 用途 |
| --- | --- |
| `_openid + leaseId + calculationDate` | 合同水电历史 |
| `_openid + houseId + calculationDate` | 房屋水电历史 |
| `_openid + billId` | 账单反查 |
| `_openid + batchId` | 批量抄表结果 |

## operation_confirmations

| 索引 | 用途 |
| --- | --- |
| `_openid + action + targetId + createdAt` | 查询确认记录 |
| `_openid + status + expiresAt` | 过期清理 |
| `_openid + idempotencyKey` | 幂等 replay |

建议唯一逻辑：

```text
_openid + idempotencyKey
```

## operation_logs

| 索引 | 用途 |
| --- | --- |
| `_openid + idempotencyKey + createdAt` | 审计查询 |
| `_openid + action + createdAt` | 操作历史 |
| `_openid + targetId + createdAt` | 对象历史 |

