# 数据库 V3 异常目录（设计稿）

迁移和 dry-run 期间发现无法自动裁决的数据，必须记录到 anomaly catalog，不得静默修复。

## 异常格式

```json
{
  "migrationId": "db-v3-M1-20260720",
  "collection": "bills",
  "documentId": "xxx",
  "severity": "high",
  "type": "bill_status_amount_conflict",
  "summary": "paidAmount >= amount but status is partial",
  "suggestedAction": "normalize_to_paid",
  "requiresManualReview": false,
  "createdAt": "2026-07-20T00:00:00.000Z"
}
```

## 异常分类

| 类型 | 严重度 | 自动处理建议 |
| --- | --- | --- |
| `missing_openid` | high | 不自动迁移，需人工确认归属 |
| `duplicate_active_lease` | high | 不自动裁决，需人工选择权威合同 |
| `bill_status_amount_conflict` | medium | 可按金额规范化，但需记录 |
| `rent_period_overlap` | high | 不自动合并，需人工确认 |
| `missing_rent_period` | medium | 可从 `rentCoverageStart/End` 或 `period` 推导，失败则人工 |
| `payment_without_bill` | high | 不自动挂账 |
| `tenant_id_card_invalid` | medium | 不生成 hash，记录异常 |
| `utility_negative_usage` | high | 仅在换表记录明确时可迁移 |
| `terminated_without_settlement` | medium | 可生成不完整 settlement 草稿并标注 |
| `settings_without_owner` | medium | 使用 global fallback，不覆盖 owner 配置 |

## 人工复核优先级

1. 缺 `_openid`。
2. 多 active lease。
3. 租金账期重叠。
4. 付款无账单。
5. 身份证隐私迁移异常。

