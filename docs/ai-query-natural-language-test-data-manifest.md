# AI 自然语言查询测试数据清单

## 本轮标记与边界

- `testRunId` / `testTag`：`AI_NLTEST_20260728_102843`
- 目标环境：`cloud1-2gxr9nlc327f3b44`（上海，CloudBase NoSQL）
- 创建方式：通过 CloudBase MCP `writeNoSqlDatabaseContent` 建立；2026-07-30 仅按 `_id + testRunId + testTag` 修复本轮隔离测试文档的时间线，不部署云函数，不修改集合/索引，不触碰真实业务文档。
- 隔离方式：每条测试文档均包含 `testRunId`、`testTag`、`remark`；所有 `houseId`、`tenantId`、`leaseId`、`billId` 仅指向本清单中的测试 ID。为让小程序当前登录用户的 Query Skill 能读取，本轮文档使用该用户已有的归属标识；这不产生任何与真实房屋、租客、合同、账单或付款的业务关联。

## 创建前只读核验

| 项目 | MCP 工具 | requestId | 结论 |
| --- | --- | --- | --- |
| 环境 | `queryEnv(info)` | `5e7b8f0c-4876-4b9f-9cce-db344e5fe491` | 环境正常，主后端为 NoSQL。 |
| 集合 | `readNoSqlDatabaseStructure(listCollections)` | `c617589f-db57-40ae-9c1a-719ff021023c` | 使用既有 `houses`、`tenants`、`lease_agreements`、`bills`、`payments`、`utility_records`。 |
| 房屋结构 | `readNoSqlDatabaseStructure(describeCollection)` | `37789a3b-7aac-4be8-900b-b02a9f01068e` | 无业务唯一索引；仅插入新测试房屋。 |
| 租客结构 | `readNoSqlDatabaseStructure(describeCollection)` | `d767b7e5-cf70-42cd-9201-62eb29b6f47b` | `orderNo_unique` 存在；每位测试租客使用唯一 `orderNo`。 |
| 合同结构 | `readNoSqlDatabaseStructure(describeCollection)` | `9d6073c8-af9c-4728-98e9-b502112e36d4` | 仅插入与测试房屋、测试租客相连的合同。 |
| 账单结构 | `readNoSqlDatabaseStructure(describeCollection)` | `d3688b5c-5cf4-49f5-b79d-b44d82382532` | 使用 `amount`、`paidAmount`、`status`、`type`、`dueDate`。 |
| 付款结构 | `readNoSqlDatabaseStructure(describeCollection)` | `33c5bce6-e571-45a5-af11-0b43e59c4db0` | 付款均通过测试 `billId` 关联测试账单。 |
| 水电结构 | `readNoSqlDatabaseStructure(describeCollection)` | `ef6236db-aa3f-41d5-a831-7f0967a1ecf5` | 使用测试合同与测试房屋/租客外键。 |

## P0 场景图谱

| 场景 | 可提问对象 | 文档 ID | 预期事实 |
| --- | --- | --- | --- |
| 空房 | `NLTEST-2801`（AI测试楼） | `NLTEST_20260728_102843_H01` | 没有合同，查询应判定为空房。 |
| 在租、即将到期短约 | `NLTEST-2802` / `NL测试短租到期租客` | `H02` / `T08` / `L01` | 当前有效合同，2026-08-03 到期；故意不承载欠费账单。 |
| 在租、历史欠费、部分付款、水电欠费 | `NLTEST-2810` / `NL测试欠费租客` | `H07` / `T01` / `L07` | 5 月租金欠 ¥1,000、6 月已缴 ¥1,000、7 月部分缴 ¥400、未缴水电 ¥220。 |
| 在租、正常缴费、无逾期、未来应收、水电、押金 | `NLTEST-2803` / `NL测试正常缴费租客` | `H03` / `T02` / `L02` | 已缴租金和水电；仅有 2026-08-05 的未来待缴租金，语义上不是当前欠费。 |
| 多历史租客 | `NLTEST-2901` | `H04` / `L03` / `L04` | `NL测试历史甲` 与 `NL测试退租结算租客` 先后承租。 |
| 退租结算、房损、退款、水电 | `NL测试退租结算租客` | `L04` | 退租日 2026-07-18；押金 1000，房损 300，水电 120，实际退款 580。 |
| 多合同租客 | `NL测试多合同租客` | `T05` / `L05` / `L06` | 两份历史合同，第二份有 450 房损但没有任何付款记录，用于“不能证明实际到账”。 |
| 同名歧义 | `NL测试同名租客` | `T06` / `T07` | 两位同名、不同手机号的无合同租客，查询必须返回候选而非静默选择。 |

## 预计插入量

| 集合 | 数量 | 内容 |
| --- | ---: | --- |
| `houses` | 7 | 1 空房、3 在租房、3 历史房。 |
| `tenants` | 8 | 当前、历史、退租、多合同、同名对象。 |
| `lease_agreements` | 7 | 3 生效、4 已终止。 |
| `bills` | 13 | 已缴、部分缴、逾期、未来应收、押金、退租退款、房损抵扣、历史付款。 |
| `payments` | 10 | 正常收款、部分收款、押金收款、退款及历史收款。 |
| `utility_records` | 3 | 当前常规水电和退租水电。 |

## 精确清理顺序（待测试结束后执行）

1. 先以 `testRunId: AI_NLTEST_20260728_102843` 查询并核对每个集合的 `_id`。
2. 仅按已核对的 `_id` 删除 `payments`、`utility_records`、`bills`。
3. 再删除 `lease_agreements`、`tenants`、`houses`。
4. 逐集合再次以 `testRunId` 精确查询，预期计数均为 `0`；如发现任何外键指向非测试文档，立即停止清理并上报。

> 本文件只记录本轮测试数据，不授权清理或修改任何既有真实数据。

## P0 实际写入与读回核验（2026-07-28）

| 集合 | 写入数量 | 写入 requestId | 读回数量 | 读回 requestId |
| --- | ---: | --- | ---: | --- |
| `houses` | 6 | `1f62253d-7eed-40b7-9d13-6a19a30a7acf` | 6 | `0001f3fe-6f0e-4d37-a25e-490c2686dca1` |
| `tenants` | 7 | `423c8a34-1f47-43f0-b0a8-913971b627e7` | 7 | `901acf20-df35-4a8b-ba8a-d9cb066ce048` |
| `lease_agreements` | 6 | `f6205cf2-d835-4642-992b-450a21fb7366` | 6 | `905d0e6c-8838-44d2-9e59-fd5ed43c6bb3` |
| `bills` | 13 | `6f5b9123-145c-4bb0-aa66-21e667c533f2` | 13 | `af68f633-0c3f-4bda-8d42-b2d783628a69` |
| `payments` | 10 | `ec3af412-37ab-4daf-b441-97b4aedf71bc` | 10 | `ca66bebd-831c-4c54-a205-d89e276f8047` |
| `utility_records` | 3 | `b0da2311-8a85-4c96-921d-283d547d4d4f` | 3 | `aa202a83-236c-4aaf-9f01-c5854a508332` |

读回核验确认：测试合同外键仅指向 `H01`–`H06`、`T01`–`T05`，账单/付款/水电外键仅指向测试合同与测试账单；未发现任何指向既有真实业务 `_id` 的关联。测试数据保留中，尚未清理。

## P0 时间线修复与读回核验（2026-07-30）

- 修复范围：仅 `AI_NLTEST_20260728_102843` 标记下的测试文档；新增 `H07` / `T08` / `L07`，其余均为精确 `_id` 更新。
- 隔离：账单 `B01`–`B04`、付款 `P01`–`P02`、水电 `U01` 已原位迁移至 `H07/T01/L07`，没有克隆，避免双计。
- 时间线：租金覆盖为 `2026-05-01~05-31`（未缴）→ `06-01~06-30`（已缴）→ `07-01~07-31`（部分缴）；不存在重叠或超出 L07 合同范围的租金账期。
- 终止合同：L03 与 L04 已清除错误的 `nextRentDueDate`；L03 仍未补造 `actualMoveOutDate`。
- 抵扣：B12/P09 明确标注为 `deposit_offset`、非新增现金；现有收款汇总是否排除该类内部抵扣需由后续查询回归单独验证。

| 集合 | 写入 requestId（摘要） | 读回 requestId | 读回数量 |
| --- | --- | --- | ---: |
| `houses` | `ee1ab48c-cc29-4fa4-9d64-05e92c6ba210`（H07），`97aaaadd-ab2e-4aae-804a-ebb5c71c0297` 等 | `f42a1964-f0a0-4eb3-9aa2-4c778e4de257`，H02 最终 `5aa41b94-8139-49b2-8436-d11c0e6c0d94` | 7 |
| `tenants` | `13d18eca-7406-46fe-adc2-636adc675696`（T08），`d751c1b3-c4ba-41c6-9409-c390b5ee04ef`（T01） | `3a450525-82d6-49e4-9464-792c728105e6` | 8 |
| `lease_agreements` | `96c89ef6-6c79-41a9-b329-e36c6a98e81e`（L07）及 L01–L04 精确更新 | `690b4840-484e-4eb7-bf0d-357099b7d15c` | 7 |
| `bills` | `fdd4a842-365f-4c0a-8545-976bab56f8e3` 至 `bc444503-b812-40ae-ba19-ec957eaac69d` | `b3fcbff8-9877-4c95-a4da-d72b8cb72355` | 13 |
| `payments` | `3830f85e-b6b4-4d87-bea2-5e6be27d31a6`、`a24735ed-fca6-40f3-87f8-570a99131d9c`、`cd99d9f1-8640-4d5b-ac27-ce0c4ba7b97e` | `7463db38-5661-44b3-a07d-712e9d206c77` | 10 |
| `utility_records` | `1da50b20-cfe9-4b03-a41a-2454c70ce5e8` | `69f26ad9-6c96-4af0-999d-a50ef4e93419` | 3 |

最终核验：所有账单、付款、水电记录的 `houseId`、`tenantId`、`leaseId`、`billId` 都指向同一测试标记集合内的文档；未发现与真实业务 `_id` 的关联。
