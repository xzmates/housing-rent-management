# 每日当前待收微信提醒配置

代码默认每天 09:00（Asia/Shanghai）检查首页“当前待收”。没有待收或没有订阅额度时不会发送消息。

## 微信公众平台

当前项目使用“账单通知”模板（模板编号 532），字段如下：

- 总欠金额：`amount28`
- 账单类型：`thing18`
- 账单状态：`phrase17`
- 截止日期：`time37`
- 备注：`thing9`

## rentalDomain 环境变量

- `WECHAT_RECEIVABLE_TEMPLATE_ID`：`-Hkd8jJ51wO5UZP2oh9CeAWfTtoMrUacF60LpbFmd7E`。
- `WECHAT_RECEIVABLE_TEMPLATE_FIELDS`：逻辑字段到模板字段的 JSON 映射：

```json
{"total":"amount28","count":"thing18","overdue":"phrase17","top":"thing9","date":"time37"}
```

- `WECHAT_MINIPROGRAM_STATE`：默认 `formal`；体验版联调时设置为 `trial`。
- `WECHAT_RECEIVABLE_PAGE`：默认 `pages/dashboard/index`。
- `WECHAT_REMINDER_TRIGGER_NAME`：默认 `dailyReceivableReminder0900`，需与 `config.json` 一致。
- `WECHAT_REMINDER_TRIGGER_SECRET`：管理端手动触发密钥，只保存在云函数环境变量中；小程序端不得读取或传递。
- `WECHAT_MINIPROGRAM_APP_ID`：小程序 AppID，当前为 `wxb4ede9db2f43070d`。
- `WECHAT_MINIPROGRAM_APP_SECRET`：小程序 AppSecret，只能在云函数环境变量中配置，禁止写入代码或提交到仓库。

`config.json` 已声明 `subscribeMessage.send` 云调用权限和每天 09:00 的定时触发器。部署后需在云开发控制台确认小程序与环境已关联、权限已生效、触发器时区为 Asia/Shanghai。

小程序 CLI 的 `upload` 只会生成开发版本。使用 `trial` 跳转前，还需在微信公众平台的版本管理中将已上传版本“选为体验版”；否则从订阅消息点击时会提示“体验版不存在”。正式发布后将 `WECHAT_MINIPROGRAM_STATE` 切换为 `formal`。
