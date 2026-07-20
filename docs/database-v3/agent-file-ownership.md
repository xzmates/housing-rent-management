# 数据库 V3 Agent 文件所有权

阶段二实施前必须明确公共文件唯一负责人，避免多 Agent 同时改同一核心文件。

## Agent 分工

| Agent | 领域 | 主责文件 |
| --- | --- | --- |
| Agent 1 | 总模型、公共字段、schema 冲突 | `docs/database-v3/*`, 公共 schema 文档 |
| Agent 2 | bills/payments/RentCollection | `cloudfunctions/rentalDomain/domain/rent-coverage.js`, `cloudfunctions/payBill/index.js`, `cloudfunctions/createNextRentBill/index.js`, `miniprogram/pages/payments/index.js`, `miniprogram/pages/prepay-rent/index.js` |
| Agent 3 | lease/退租/settlement | `cloudfunctions/terminateLease/index.js`, `cloudfunctions/rentalDomain/domain/settlement.js`, `miniprogram/pages/ai-moveout-detail/*`, `miniprogram/skills/move-out-skill/*` |
| Agent 4 | houses/tenants/隐私/权限 | `miniprogram/pages/houses/*`, `miniprogram/pages/tenants/*`, `miniprogram/pages/tenant-detail/*`, `miniprogram/skills/house-skill/*`, `miniprogram/skills/tenant-skill/*` |
| Agent 5 | utility_records/水电 | `cloudfunctions/addUtilityRecord/index.js`, `miniprogram/pages/utility/*`, `miniprogram/pages/batch-meter/*`, `miniprogram/skills/meter-reading-skill/*` |
| Agent 6 | 查询 API/页面/索引 | `cloudfunctions/queryLeaseData/index.js`, `cloudfunctions/getHouseCurrentLease/index.js`, `cloudfunctions/getTenantBills/index.js`, `cloudfunctions/rentalDomain/application/query-service.js`, 查询相关页面 |
| Agent 7 | 迁移/回滚/测试方案 | 迁移脚本、dry-run、回滚文档、测试计划 |

## 公共高冲突文件唯一协调人

| 文件 | 唯一协调人 | 参与方 |
| --- | --- | --- |
| `cloudfunctions/rentalDomain/application/command-service.js` | Agent 1 | Agent 2/3/5 |
| `cloudfunctions/rentalDomain/application/preview-service.js` | Agent 1 | Agent 2/3/5 |
| `cloudfunctions/rentalDomain/application/query-service.js` | Agent 6 | Agent 1/2/3/4/5 |
| `cloudfunctions/rentalDomain/repositories/rental-repository.js` | Agent 6 | Agent 1 |
| `cloudfunctions/rentalDomain/domain/presenters.js` | Agent 6 | Agent 1/4 |
| `miniprogram/services/api.js` | Agent 1 | 全部 Agent |
| `__tests__/setup.cjs` | Agent 7 | 全部 Agent |
| `miniprogram/app.json` | Agent 1 | Skill 相关 Agent |
| `miniprogram/page-meta.json` | Agent 1 | Handoff 相关 Agent |

## 冲突处理规则

1. 公共文件改动必须先在设计文档中登记。
2. 每轮只允许一个 Agent 修改公共文件。
3. 测试 setup 改动必须由 Agent 7 统一做。
4. 业务字段枚举冲突由 Agent 1 统一裁决。
5. 查询 owner scope 和脱敏规则由 Agent 6 统一落地。

