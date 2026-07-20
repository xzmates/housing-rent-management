# 数据库 V3 架构决策记录（阶段 1.5）

本文件冻结阶段二前的关键架构选择。阶段二实现如需偏离，必须先更新对应 ADR。

## ADR-001：是否新增 `collections` 收款批次集合

| 项目 | 内容 |
| --- | --- |
| 问题 | RentCollection 一次收款可能覆盖多张租金账单，是否需要新增批次集合。 |
| 当前实现 | 现有 `payments` 可通过 `confirmationId` 追溯；退租和提前收租已依赖 `operation_confirmations` 幂等。 |
| 可选方案 | A. 新增 `collections`；B. 先在 `payments` 增加 `collectionId/confirmationId`；C. 只依赖 `operation_logs`。 |
| 推荐方案 | 阶段二采用 B，不新增 `collections`；如后续对账需要批次头，再在 V3.1 增加。 |
| 推荐理由 | 改动最小，兼容当前页面和测试；一张 bill 一条 payment 的模型仍可保留。 |
| 兼容影响 | 旧 `paymentMethod` 继续读取；新增字段均可选。 |
| 数据迁移影响 | 可用已有 `confirmationId` 或 operation id 回填 `collectionId`。 |
| 回滚方式 | 忽略新增字段即可回滚旧读取逻辑。 |
| 阶段二责任 Agent | Agent 2，Agent 7 负责迁移校验。 |
| 尚未确认事项 | 是否有外部导出报表强依赖单独收款批次编号。 |

## ADR-002：`system_settings` 全局配置还是按房东隔离

| 项目 | 内容 |
| --- | --- |
| 问题 | 水电单价等系统设置目前存在全局记录，跨用户隔离不足。 |
| 当前实现 | 多处读取 `_id='global'`；小程序 service 还存在客户端直读/直写默认配置。 |
| 可选方案 | A. 保持全局；B. 按 `_openid` 隔离并保留 global fallback；C. 新增价格版本集合。 |
| 推荐方案 | 阶段二采用 B；历史账单和水电记录必须保存单价快照。 |
| 推荐理由 | 既能保持当前默认值兼容，又能避免房东间配置互相影响。 |
| 兼容影响 | 旧 `global` 仍可读取；新增 `_openid/settingKey` 不破坏旧数据。 |
| 数据迁移影响 | 生产迁移先复制全局默认值到每个房东配置，禁止覆盖已有用户配置。 |
| 回滚方式 | 读取顺序退回 global，忽略用户级配置。 |
| 阶段二责任 Agent | Agent 5，Agent 6 配合查询安全。 |
| 尚未确认事项 | 当前生产数据库规则是否允许客户端写 `system_settings`。 |

## ADR-003：房屋/租客状态权威来源

| 项目 | 内容 |
| --- | --- |
| 问题 | `houses.status`、`tenants.status` 可能与 active lease 不一致。 |
| 当前实现 | 页面和查询函数会读取状态缓存；退租/新建合同写入时会同步部分状态。 |
| 可选方案 | A. 状态字段继续做权威；B. active lease 做权威，房屋/租客保留缓存；C. 完全删除缓存。 |
| 推荐方案 | 阶段二采用 B。 |
| 推荐理由 | 最小兼容，且能避免缓存错乱导致误收租、误退租。 |
| 兼容影响 | `status` 保留旧页面读取；新增 `operationalStatus/occupancyStatus/profileStatus/currentLeaseId/currentTenantId/currentHouseId`。 |
| 数据迁移影响 | 由 active lease 回填缓存，冲突时记录 anomaly。 |
| 回滚方式 | 页面仍可读取旧 `status`。 |
| 阶段二责任 Agent | Agent 4，Agent 3 配合退租同步。 |
| 尚未确认事项 | 多 active lease 脏数据的业务裁决规则。 |

## ADR-004：账单状态以金额为准，`status` 做查询缓存

| 项目 | 内容 |
| --- | --- |
| 问题 | 真机已出现待缴为 0 但显示部分缴的脏状态。 |
| 当前实现 | 页面、presenter 和测试已多处用 `amount/paidAmount` 兜底规范化。 |
| 可选方案 | A. 只信 `status`；B. 只动态计算不存 `status`；C. `status` 持久化但查询按金额兜底。 |
| 推荐方案 | 阶段二采用 C。 |
| 推荐理由 | 保持索引筛选性能，同时消除状态脏数据的展示风险。 |
| 兼容影响 | 旧 `status=partial` 且 `paidAmount>=amount` 查询返回 `paid`。 |
| 数据迁移影响 | 回填 `outstandingAmount` 并修正明显错误 status。 |
| 回滚方式 | 可继续使用旧 `status`，但风险会回归。 |
| 阶段二责任 Agent | Agent 2，Agent 6 负责查询 presenter。 |
| 尚未确认事项 | 是否需要保留 `overdue` 作为持久状态还是纯派生字段。 |

## ADR-005：租客隐私拆分和身份证脱敏

| 项目 | 内容 |
| --- | --- |
| 问题 | 租客身份证和手机号可能被列表、Skill、日志或 confirmation snapshot 过度暴露。 |
| 当前实现 | `tenants` 存在 `phone/idCard` 兼容字段；查询 Skill 可返回 phone。 |
| 可选方案 | A. 继续存在 tenants；B. 新增 `tenant_private_profiles`，tenants 只留 hash/last4；C. 完全删除身份证。 |
| 推荐方案 | 阶段二采用 B。 |
| 推荐理由 | 兼容详情页，同时让列表、Skill 和审计日志默认脱敏。 |
| 兼容影响 | `tenants.idCard` 暂不删除，但默认查询不得返回。 |
| 数据迁移影响 | 对非空身份证回填 `idCardHash/idCardLast4/privateProfileId`。 |
| 回滚方式 | 旧详情页仍可读取 `tenants.idCard`，但需保留权限开关。 |
| 阶段二责任 Agent | Agent 4，Agent 6 配合 presenter 脱敏。 |
| 尚未确认事项 | 加密密钥管理和已有身份证空值的唯一索引策略。 |

## ADR-006：退租必须新增 `lease_settlements`

| 项目 | 内容 |
| --- | --- |
| 问题 | 退租结算不能只存在于 confirmation snapshot 或 lease 摘要字段。 |
| 当前实现 | 退租 Handoff 已有预览、confirmation、幂等；正式结算凭证集合仍需冻结。 |
| 可选方案 | A. 只写 lease 摘要；B. 新增 `lease_settlements`；C. 只靠 operation logs。 |
| 推荐方案 | 阶段二采用 B。 |
| 推荐理由 | 退租后金额、账单、payment、水电读数都需要长期审计。 |
| 兼容影响 | lease 上保留 `settlementId` 和摘要字段兼容。 |
| 数据迁移影响 | terminated 合同回填 settlement 时，无法还原的字段进入 anomaly catalog。 |
| 回滚方式 | 旧 lease 摘要字段仍保留。 |
| 阶段二责任 Agent | Agent 3。 |
| 尚未确认事项 | 历史退租数据是否足以完整回填账单和 payment 明细。 |

## ADR-007：水电确认统一走“预览 + 页面确认 + 事务”

| 项目 | 内容 |
| --- | --- |
| 问题 | 当前 `confirmMeterReading` 暴露给 Skill，AI 可直接写水电记录和账单。 |
| 当前实现 | `previewMeterReading` 已有 confirmation，但最终确认仍可由 Skill 直接调用 legacy 写入。 |
| 可选方案 | A. 保持 AI 可直接确认；B. 收回最终写工具，页面确认后调用；C. 只保留手动页。 |
| 推荐方案 | 阶段二采用 B。 |
| 推荐理由 | 与退租/RentCollection 已验证架构一致，降低误写风险。 |
| 兼容影响 | Domain 最终能力保留，Skill mcp 不暴露最终写接口。 |
| 数据迁移影响 | 旧水电记录补 `source/idempotencyKey/billId/price snapshot`。 |
| 回滚方式 | 保留 legacy `addUtilityRecord`，但不建议重新暴露给 AI。 |
| 阶段二责任 Agent | Agent 5，Agent 1 协调 Skill 暴露面。 |
| 尚未确认事项 | 批量抄表是否接受部分成功，或必须引入批次确认。 |

## ADR-008：旧查询/写入云函数逐步收口，不立即删除

| 项目 | 内容 |
| --- | --- |
| 问题 | 旧云函数仍被页面调用，部分缺少 `_openid` 过滤。 |
| 当前实现 | `queryLeaseData/getHouseCurrentLease/getTenantBills` 未见 owner scope；`rentalDomain` 已有 `repo.forOwner` 能力。 |
| 可选方案 | A. 立即删除旧函数；B. 先补安全过滤，再逐步代理到 Domain；C. 保持现状。 |
| 推荐方案 | 阶段二采用 B。 |
| 推荐理由 | 兼容页面和真机入口，同时优先堵住跨用户查询风险。 |
| 兼容影响 | 旧函数签名保持；返回结构尽量不变。 |
| 数据迁移影响 | 无直接数据迁移，但需要补安全回归测试。 |
| 回滚方式 | 可回退代理层，但不得回退 owner scope。 |
| 阶段二责任 Agent | Agent 6，Agent 1 协调公共 API。 |
| 尚未确认事项 | 生产环境数据库规则是否已在底层拦截跨 `_openid` 读取。 |

