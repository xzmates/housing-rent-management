# 房租管理双模式 Skill 需求文档

## 1. 简介

将现有房屋租赁小程序改造为“普通页面手动操作 + 小程序 AI Skill 原子接口”双入口架构。两个入口必须复用同一套服务端业务规则，Skill 另支持本地 Preview 数据和 CloudBase Production 数据两种运行模式。

本次保留现有页面视觉体系，不做页面重设计。新增 Skill 卡片沿用页面的字段顺序、状态文案、金额摘要和确认语义。

## 2. 范围

### 2.1 包含

- 房屋、租客、合同、收租、抄表、退租六个独立 Skill。
- 一个共享的 `rentalDomain` 云函数及领域 Service。
- 页面 API 迁移到共享领域 Service。
- Preview、确认、幂等、权限、审计能力。
- 删除 `executeVoiceScenario` 及其调用链，不保留兼容适配器。
- Skill 静态校验、接口执行、组件渲染和微信开发者工具编译验证。

### 2.2 不包含

- 重做现有普通页面。
- 登录页或自定义登录流程。
- 支付渠道扣款、电子合同签章、消息订阅。
- 不将旧 `executeVoiceScenario` 保留为兼容层或旁路适配器。

## 3. 需求与验收标准

### R1：共享业务核心

**用户故事：** 作为维护者，我希望页面与 Skill 调用同一套业务规则，避免规则更新后产生分叉。

1. 当普通页面或 Skill 发起同一业务操作时，系统应调用 `rentalDomain` 中相同的领域 Service。
2. 当租金、水电或退租规则变化时，系统应只需修改一处领域实现。
3. 当返回页面或 Skill 时，领域 Service 不应依赖 WXML、MCP 或 `wx.modelContext`。

### R2：Skill 原子化

**用户故事：** 作为用户，我希望用自然语言准确选择业务能力，并在信息不足时得到明确引导。

1. 当用户表达房屋、租客、合同、收租、抄表或退租意图时，系统应路由到对应独立 Skill。
2. 当目标为零条时，系统应返回需要补充的信息。
3. 当目标为多条时，系统应展示候选选择卡，不得自行选择。
4. 当一个 Skill 声明接口时，每个接口应保持单一职责，数量控制在 3 至 6 个。

### R3：安全预览与确认

**用户故事：** 作为房东，我希望资金和合同状态变更前看到准确预览，避免误操作。

1. 当执行收租、抄表计费、合同创建/续租或退租时，系统应先返回服务端计算的预览结果。
2. 当用户确认时，系统应使用服务端保存的确认记录重新校验，不得信任客户端回传金额。
3. 当确认记录过期、已执行或数据版本变化时，系统应拒绝执行并要求重新预览。
4. 当相同幂等键重复提交时，系统应只产生一次业务写入。

### R4：展示逻辑复用

**用户故事：** 作为用户，我希望页面和 Skill 卡片看到一致的对象名称、金额、状态和结算明细。

1. 当页面和 Skill 展示同一账单时，系统应返回一致的 `houseLabel`、`tenantName`、`remaining`、`typeText` 和 `statusText`。
2. 当页面和 Skill 展示退租预览时，系统应消费同一 `settlementView`，不得分别计算。
3. 当新增 Skill 卡片时，卡片应沿用普通页面的字段顺序与业务文案，并符合 WeCard 约束。

### R5：运行模式隔离

**用户故事：** 作为开发者，我希望无需云环境即可演示 Skill，同时保证演示不会污染生产数据。

1. 当 `mp_skills_preview_mode=true` 时，Skill 应只使用 seed/local storage，不得调用生产云函数。
2. 当 `mp_skills_preview_mode=false` 时，Skill 应调用 `rentalDomain`，不得回退到 seed 数据伪装成功。
3. 当普通页面运行时，页面应始终连接当前 CloudBase 环境，不受 Skill Preview 开关影响。

### R6：身份与数据隔离

**用户故事：** 作为房东，我只能查看和操作自己管理的数据。

1. 当云函数处理请求时，系统应从 `cloud.getWXContext().OPENID` 获取身份，不得接受客户端传入的 openid。
2. 当查询或写入业务数据时，系统应按所有者字段过滤。
3. 当历史数据缺少所有者字段时，系统应先完成可审计的数据迁移，再启用严格隔离。

### R7：删除旧执行链

**用户故事：** 作为维护者，我希望彻底移除旧语音执行器，避免业务规则继续分叉。

1. 当改造完成时，仓库中不应存在 `cloudfunctions/executeVoiceScenario`。
2. 当搜索源码时，不应存在对 `executeVoiceScenario` 的运行时调用。
3. 当原语音页面仍保留时，其业务执行应改用新领域接口或 Skill，不得复制旧执行逻辑。

### R8：质量验证

1. 当提交实现时，所有 Skill 静态校验应满足 `errors=0` 且 `buildStatus=pass`。
2. 当接口带 UI 组件时，系统应完成 execute 与 render 验证。
3. 当小程序编译时，不应出现 JSON、分包、组件路径或云函数引用错误。

## 4. Skill 接口清单

- `house-skill`：`searchHouses`、`getHouseDetail`、`previewCreateHouse`、`confirmCreateHouse`
- `tenant-skill`：`searchTenants`、`getTenantDetail`、`previewCreateTenant`、`confirmCreateTenant`
- `lease-skill`：`getActiveLeases`、`previewCreateLease`、`confirmCreateLease`、`previewRenewLease`、`confirmRenewLease`
- `rent-collection-skill`：`getUnpaidBills`、`previewCollectRent`、`confirmCollectRent`、`getPaymentHistory`
- `meter-reading-skill`：`getMeterTargets`、`previewMeterReading`、`confirmMeterReading`
- `move-out-skill`：`getMoveOutTargets`、`previewMoveOutSettlement`、`settleMoveOut`

## 5. UI 约束

- Purpose：为房东，尤其是年长用户，提供可核对、可撤回、低误触的业务确认。
- Aesthetic：Industrial/utilitarian。
- Palette：`#EEF7FF`、`#1677FF`、`#0F172A`、`#F8FBFF`、`#DC2626`。
- Typography：`MiSans`、`Noto Sans SC`，受 WeCard 字体白名单约束时使用其允许回退。
- Layout：左侧业务信息流，右侧金额/状态锚点，底部整宽确认操作带；不改变现有页面整体布局。
