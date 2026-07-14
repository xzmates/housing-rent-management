# 房租管理双模式 Skill 技术设计

## 1. 架构原则

系统区分两个维度：

- 交互入口：普通页面、AI Skill。
- Skill 运行数据：Preview seed、Production CloudBase。

四种组合最终共享服务端领域规则；Preview 仅模拟领域结果，不触碰云数据。

```text
pages/* -> services/api.js -----------+
                                        +-> rentalDomain -> domain services -> NoSQL
skills/*/apis/* -> skills/_shared ----+

skills preview -> data/seed.js + local storage
```

## 2. 目录设计

```text
cloudfunctions/rentalDomain/
├─ index.js
├─ package.json
├─ application/
│  ├─ house-service.js
│  ├─ tenant-service.js
│  ├─ lease-service.js
│  ├─ rent-service.js
│  ├─ meter-service.js
│  └─ moveout-service.js
├─ domain/
│  ├─ billing.js
│  ├─ settlement.js
│  ├─ presenters.js
│  └─ validators.js
├─ repositories/
│  └─ rental-repository.js
└─ infrastructure/
   ├─ auth.js
   ├─ confirmations.js
   ├─ errors.js
   └─ idempotency.js

miniprogram/skills/
├─ _shared/
│  ├─ domain-client.js
│  └─ result.js
├─ house-skill/
├─ tenant-skill/
├─ lease-skill/
├─ rent-collection-skill/
├─ meter-reading-skill/
└─ move-out-skill/
```

每个 Skill 仍包含独立 `SKILL.md`、`mcp.json`、`index.js`、`apis/`、`components/`、`data/seed.js` 和 `utils/util.js`。`_shared` 只放调用与返回适配，不放业务规则。

## 3. 服务端接口

统一请求：

```js
{ action, params, confirmationId, idempotencyKey, clientContext }
```

统一响应：

```js
{ code: 0, message: 'ok', data: {}, requestId }
```

领域异常使用稳定错误码：`VALIDATION_ERROR`、`NOT_FOUND`、`AMBIGUOUS_TARGET`、`STALE_CONFIRMATION`、`CONFIRMATION_EXPIRED`、`ALREADY_EXECUTED`、`FORBIDDEN`、`CONFLICT`。

## 4. 领域服务

### 4.1 房屋与租客

- 搜索支持编号、地址、姓名、手机号和状态组合。
- 创建前统一标准化字符串、金额和日期。
- 页面原有直接数据库写入迁移到 `rentalDomain`。

### 4.2 合同

- 创建和续租统一检查房屋、租客的活跃合同冲突。
- 初始账单、租金覆盖期、下次收租日期在事务中生成。

### 4.3 收租

- `previewCollectRent` 返回账单余额、收款金额、付款方式和收款后状态。
- `confirmCollectRent` 在事务中写流水、更新账单并推进租金覆盖日期。

### 4.4 抄表

- 预览读取上次读数与系统单价，校验新读数不得回退。
- 确认时重新读取最新读数，生成抄表记录和水电账单。

### 4.5 退租

- 前端现有 `updateSettlementPreview` 仅保留展示，不再承担业务计算。
- 服务端统一计算欠款、押金抵扣、水电、损坏、租金退还、应退/应补。
- 确认事务关闭合同、处理账单和流水、更新房屋及租客状态。

## 5. 确认与幂等

新增集合：

- `operation_confirmations`：`_openid`、`action`、`normalizedInput`、`snapshot`、`digest`、`status`、`expiresAt`、`createdAt`、`executedAt`。
- `operation_logs`：请求、结果摘要、入口、状态、错误码、时间和操作者。

确认请求只提交 `confirmationId + idempotencyKey`。事务内复核确认状态、过期时间、对象版本和关键余额。

## 6. 展示模型复用

`domain/presenters.js` 输出页面和 Skill 共用的稳定结构：

- `houseView`
- `tenantView`
- `leaseView`
- `billView`
- `meterPreviewView`
- `settlementView`

普通页面的 `setData` 与 Skill 的 `structuredContent` 都消费这些结构。WXML 无法跨独立分包直接复用，因此复用的是字段模型、格式化、状态文案和交互顺序，而不是复制页面模板。

## 7. 安全策略

- 身份只取 `cloud.getWXContext().OPENID`。
- 新数据记录 `_openid`；读取、更新和删除均带所有权条件。
- 历史数据先审计再回填，迁移前保持兼容查询开关，迁移后关闭。
- 金额内部以整数分计算，对外展示元。
- 写操作全部走云函数事务。

## 8. 旧链路处理

- 删除 `cloudfunctions/executeVoiceScenario/`。
- 删除 `services/api.js` 的对应方法。
- `pages/import` 和 `pages/ai-moveout-detail` 不再调用旧函数；需要保留的交互改接 `rentalDomain`。
- 清理 `voicePlanCommand` 中把下一步描述为 `executeVoiceScenario` 的元数据。
- 历史文档标记为已废弃，不把过时名称保留在运行时代码。

## 9. 测试策略

- 领域单元测试：金额、周期、抄表、退租边界。
- 云函数动作测试：权限、确认过期、重复提交、并发版本冲突。
- Skill：validate、execute、render。
- 页面回归：创建房屋/租客/合同、收租、抄表、退租。
- 微信开发者工具：编译、分包加载、Agent 路由、真机确认操作。
