# 数据库 V3 安全审计计划（设计稿）

## 审计目标

阶段二先验证并修复 owner scope、隐私暴露和 AI 最终写接口暴露面。

## 审计项

| 项目 | 方法 | 通过标准 |
| --- | --- | --- |
| 旧查询函数 `_openid` | 单元测试模拟两个 openid | 跨用户返回空或拒绝 |
| Domain query scope | 检查 `repo.forOwner` 使用和测试 | 所有 query action 自动带 `_openid` |
| legacy 写入 owner 校验 | 直调云函数测试 | 非 owner 不能写 |
| Skill mcp 暴露面 | 静态扫描 mcp.json | 不暴露 confirm/settle/execute 最终写工具 |
| 租客隐私 | 静态和测试 | 列表、Skill、日志、confirmation 不含完整身份证 |
| system_settings | 代码和测试 | 客户端不能直接创建/更新全局设置 |
| confirmation | 并发测试 | pending->executing 条件更新，重复请求 replay |

## 优先修复顺序

1. `queryLeaseData/getHouseCurrentLease/getTenantBills` owner scope。
2. Skill mcp 最终写接口收回。
3. `system_settings` 云端化。
4. 租客隐私拆分和脱敏。
5. confirmation 幂等 replay 加固。

## 阶段二禁止回退项

- `_openid` 过滤。
- AI 不暴露最终写接口。
- 隐私默认脱敏。

