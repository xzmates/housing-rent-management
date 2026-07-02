# 语音业务助手 V1 MVP 说明

## 目标
将 `pages/import/index` 从“智能导入”升级为语音助手中心。V1 在 mock/stub ASR 条件下跑通：

- 听写或手输文本
- 云端生成统一 `VoiceIntent`
- 大字确认卡片人工确认
- 二次确认后云端执行
- 展示成功或失败结果

## 新增云函数
- `voiceTranscribe`：短音频转写层。传入 `fileID/audioUrl` 时调用火山 ASR；传入 `text` 时作为手输或 mock fallback；密钥必须通过云端环境变量配置。
- `voicePlanCommand`：统一规划层。优先调用 DeepSeek 输出 `replyText + VoiceIntent`；DeepSeek 未配置或失败时回退规则解析。
- `voiceSynthesize`：火山 TTS 语音合成。后端把 mp3 上传到云存储，返回 `fileID/tempUrl`，前端使用 `InnerAudioContext` 播放。
- `voiceDialogueTurn`：聊天式一轮编排入口，串联 ASR、DeepSeek 规划、TTS，返回聊天回复、语音地址和确认卡数据。
- `executeVoiceScenario`：统一执行层，覆盖 V1 七类业务，避免前端串行复合写入。
- `importLeaseSnapshot`：历史建档快照导入，不复用 `createLeaseAgreement` 的日常补账单逻辑，不伪造历史现金流。

## 语音聊天链路
```text
按住说话
-> 小程序录制 16kHz 单声道 mp3
-> 上传云存储
-> voiceDialogueTurn
-> voiceTranscribe 调火山 ASR
-> voicePlanCommand 调 DeepSeek 生成 VoiceIntent
-> voiceSynthesize 调火山 TTS 并上传 mp3
-> 前端展示聊天气泡并播放语音
-> 信息齐全时展示确认卡
-> 用户二次确认
-> executeVoiceScenario 落库
```

## 环境变量
```bash
DEEPSEEK_API_KEY=
DEEPSEEK_API_URL=https://api.deepseek.com/chat/completions
DEEPSEEK_MODEL=deepseek-chat

VOLC_ASR_ENDPOINT=
VOLC_ASR_APP_ID=
VOLC_ASR_TOKEN=
VOLC_ASR_CLUSTER=
VOLC_ASR_SAMPLE_RATE=16000
VOLC_ASR_WORKFLOW=audio_in,resample,partition,vad,fe,decode

VOLC_TTS_ENDPOINT=
VOLC_TTS_APP_ID=
VOLC_TTS_TOKEN=
VOLC_TTS_CLUSTER=volcano_tts
VOLC_TTS_VOICE_TYPE=BV001_streaming
VOLC_TTS_SPEED_RATIO=0.9
VOLC_TTS_RATE=16000
```

注意：ASR、TTS、DeepSeek 使用独立密钥，不允许写入小程序前端。

## VoiceIntent 核心结构
```js
{
  scene: 'house | tenant | lease | payment | meter | batch_meter | prepay_rent | move_out | unsupported',
  sceneLabel: '新增房屋',
  mode: 'guided | free_dictation',
  operation: 'create | update | pay | record | prepay | terminate | unsupported',
  variant: 'daily | snapshot',
  target: {
    label: '',
    houseAddress: '',
    houseCode: '',
    tenantName: ''
  },
  slots: {},
  missingSlots: [{ field: 'rent', label: '月租金' }],
  warnings: [],
  candidates: [],
  reviewCards: [],
  executionPlan: [],
  canExecute: false,
  riskLevel: 'normal | high',
  transcript: '',
  normalizedText: ''
}
```

## 新增数据集合
### `voice_command_logs`
用于后续分析识别、纠错、执行失败原因。建议字段：

- `type`：可扩展为 `transcribe | plan | tts | dialogue_turn | execution | snapshot_import`
- `scene`、`mode`、`operation`
- `text`、`normalizedText`
- `slots`、`missingSlots`、`warnings`
- `success`、`failed`、`details`、`error`
- `confidence`、`provider`
- `createdAt`

### `voice_aliases`
用于维护本地别名、同音词、老人常说法。建议字段：

- `source`：原始说法，例如 `东楼被`
- `target`：标准写法，例如 `东楼北`
- `category`：`address | name | term | number | method`
- `enabled`：是否启用
- `createdAt`、`updatedAt`

## 历史建档规则
- 历史建档必须走 `importLeaseSnapshot`。
- 明确说出 `rentCoveredUntil` 或 `nextRentDueDate` 时只落当前状态。
- 只说“上次交租时间”时服务端推导覆盖截止日，并在确认卡展示后再执行。
- 未明确表达的历史支付流水、历史账单、历史抄表记录一律不生成。

## 事务与补偿说明
- `importLeaseSnapshot` 使用数据库事务，合同、房屋、租客、当前待收账单、快照抄表一并提交或回滚。
- `executeVoiceScenario` 对新建合同先做房屋和租客活跃合同冲突预检查，再写入，降低半成功风险。
- `缴费`、`抄表`、`提前收租`、`退租` 调用现有业务云函数执行，失败时不会在前端继续串行补写。
- `批量抄表` 当前是服务端逐条执行，若中途失败可能已有前面条目成功；V1 先返回明细，V2 建议改为专用事务/补偿批处理函数。

## 手动测试语句
- `东楼北一零一，月租一千二，王阿姨住，押一付三，去年三月入住`
- `101 今天收两个月租，微信收的`
- `101 电表420 水表108`
- `101、102、103 批量抄表，说完一户点下一户，最后统一提交`
- `张三今天退租，电表500，水表150，墙皮扣200`
- `东楼被一零一，月租一千二`
- `101 今天收两个月租，微信收的，不对，是收一个月`
- `101 电表说到一半，电表四百二`

## 暂不支持语音办理
- 删除房屋、租客、合同
- 导出 CSV
- 系统设置修改
- 水电单价设置
- 批量生成月租账单
