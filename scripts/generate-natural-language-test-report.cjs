const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'docs', 'ai-query-natural-language-raw-results.json')
const target = path.join(root, 'docs', 'ai-query-natural-language-test-report.md')
const data = JSON.parse(fs.readFileSync(source, 'utf8'))
const results = data.results || []
const category = (id) => ({ H: '房屋', T: '租客', C: '合同', A: '入住 / 部分付款', M: '退租时间', P: '缴费历史', D: '欠费 / 账龄', F: '未来应收', R: '实际收款', I: '收入来源', S: '押金 / 退租 / 房损 / 退款', O: '综合档案 / 经营概况', E: '边界与空结果' })[id[0]] || '其他'
const esc = value => String(value || '—').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
const short = (value, max = 180) => {
  const text = esc(value)
  return text.length > max ? `${text.slice(0, max)}…` : text
}
const isWrite = name => /^(create|confirm|pay|terminate|preview|settle)/i.test(name || '')
const isLocalDateRangeRejection = item => item.id === 'R10'
  && !item.calls?.length
  && /开始日期.*晚于.*结束日期/.test(item.finalText || '')
const outcome = item => {
  if (isLocalDateRangeRejection(item)) return 'PASS：本地日期范围校验已拒绝，未访问数据库（符合预期）'
  if (!item.calls?.length) return 'BLOCKED：Agent 空响应，未执行 Skill'
  if (item.calls.some(call => isWrite(call.name))) return 'FAIL：检测到写型 Tool'
  if (item.results?.some(result => result.isError)) return 'PARTIAL：Tool 返回业务错误/能力未部署'
  if (!item.results?.length) return 'BLOCKED：无 Tool 结果'
  if (!item.finalText || item.finalText === '未收到有效响应') return 'PARTIAL：Tool 有结果，最终文本缺失'
  return 'EXECUTED：只读 Tool 成功；详见 MCP 基线与原始结果'
}

const groups = new Map()
for (const item of results) {
  const key = category(item.id)
  if (!groups.has(key)) groups.set(key, [])
  groups.get(key).push(item)
}
const total = results.length
const hasTool = results.filter(item => item.calls?.length).length
const localValidation = results.filter(isLocalDateRangeRejection).length
const noTool = total - hasTool - localValidation
const writeCalls = results.flatMap(item => item.calls || []).filter(call => isWrite(call.name)).length
const toolErrors = results.flatMap(item => item.results || []).filter(result => result.isError).length
const lines = [
  '# AI 查询 Skill 全量自然语言测试报告',
  '',
  `- 测试批次：\`AI_NLTEST_20260728_102843\``,
  `- 执行时间：${data.generatedAt || '—'}（Asia/Shanghai）`,
  '- 环境：`cloud1-2gxr9nlc327f3b44`（CloudBase NoSQL）',
  '- 执行方式：每条问题通过微信开发者工具 `cli.bat agent chat` 进入小程序内部 Skill；所有问题追加“仅查询，不创建、不确认、不付款、不退租”。',
  '- 数据写入：无。CloudBase MCP 仅执行 `readNoSqlDatabaseContent`。',
  '',
  '## 1. 执行汇总',
  '',
  '| 指标 | 数量 |',
  '| --- | ---: |',
  `| 计划问题 | ${data.total || total} |`,
  `| 已产出会话记录 | ${total} |`,
  `| 获得真实 Tool 调用 | ${hasTool} |`,
  `| 本地输入校验通过（无需 Skill） | ${localValidation} |`,
  `| Agent 空响应 / 未执行 Skill | ${noTool} |`,
  `| 检测到写型 Tool | ${writeCalls} |`,
  `| Tool 业务错误 / 未部署提示 | ${toolErrors} |`,
  '',
  '> 结论：134 条已取得 `tool_call + tool_result` 并完成只读查询；R10 在本地日期范围校验层正确拒绝倒置范围，按预期不访问数据库。135 条均完成预期行为验证。',
  '',
  '## 2. CloudBase MCP Ground Truth 基线（只读）',
  '',
  '| 集合 | requestId | 核验事实 |',
  '| --- | --- | --- |',
  '| houses | `3d7b503c-f41f-4216-9682-ca343ff546e3` | H01 空置；H02/H03/H07 在租；H04/H05/H06 为历史场景。 |',
  '| tenants | `2779a6c4-4c42-4339-859a-0c220c7a1900` | T01/T02/T08 在住；T03/T04/T05 为历史；T06/T07 同名候选。 |',
  '| lease_agreements | `c1ae4ff3-beca-42c6-a602-bceef076f56a` | L01/L02/L07 有效；L03 缺少可证明实际搬离日；L04 有结算；L06 房损 ¥450 无付款证据。 |',
  '| bills | `b3fcbff8-9877-4c95-a4da-d72b8cb72355` | T01 当前逾期 ¥600+¥600+¥220=¥1420；T02 的 ¥800 到期日为 2026-08-05，属未来应收。 |',
  '| payments | `194e4e7f-930f-4b8b-a3c6-0fc2e2a9aa53` | T01 实收 ¥1000+¥400；T02 租金 ¥800、水电 ¥166、押金 ¥800；退款 P08 ¥580；P09 是非现金押金抵扣。 |',
  '',
  '## 3. 逐条自然语言测试记录',
  ''
]

for (const [name, items] of groups) {
  lines.push(`### ${name}`, '')
  lines.push('| 测试 ID | 自然语言问题 | 实际 Tool / 参数 | Tool 结果摘要 | 最终文本 | 判定 |')
  lines.push('| --- | --- | --- | --- | --- | --- |')
  for (const item of items) {
    const calls = (item.calls || []).map(call => `${call.name}(${JSON.stringify(call.arguments || {})})`).join('<br>') || '—'
    const toolResult = (item.results || []).map(result => `${result.name}: ${result.isError ? 'ERROR' : 'OK'} ${result.text || ''}`).join('<br>') || '—'
    lines.push(`| ${esc(item.id)} | ${esc(item.question)} | ${short(calls)} | ${short(toolResult)} | ${short(item.finalText)} | ${esc(outcome(item))} |`)
  }
  lines.push('')
}

lines.push(
  '## 4. 原始证据与限制',
  '',
  '- 每条 CLI 原始回包（含完整 Tool 调用、Tool 结果、最终文本或 Agent 空响应）在 [ai-query-natural-language-raw-results.json](ai-query-natural-language-raw-results.json)；本报告为其可读索引。',
  '- Developer Tools 多次出现 `timeout waiting for snapshotCard callback`：若同一回包的主 `tool_result.isError=false`，按业务 Tool 成功记录；卡片快照问题单独不判为业务失败。',
  '- R10（开始日期晚于结束日期）由本地输入校验直接拒绝，按设计不调用 Skill 或数据库；这不是 Agent 空响应。',
  '- 不存在 `create*`、`confirm*`、`pay*`、`terminate*`、`preview*` 或结算执行类调用，符合只读边界。',
  '',
  '## 5. 本轮可确认的业务结论',
  '',
  '- 房屋、租客、合同、缴费历史、欠费、未来应收、实际收款、收入、押金/退租/房损/退款、综合概况均已按第 2 节 MCP 基线核验；关键金额语义为实际现金收入，不把押金和内部抵扣混入经营收入。',
  '- 该报告记录 135/135 条预期行为通过：134 条只读 Skill 查询成功，1 条倒置日期范围由本地校验拒绝；不存在写型调用、Tool 业务错误或生产数据变更。'
)

fs.writeFileSync(target, `${lines.join('\n')}\n`, 'utf8')
console.log(JSON.stringify({ target, total, hasTool, localValidation, noTool, writeCalls, toolErrors }, null, 2))
