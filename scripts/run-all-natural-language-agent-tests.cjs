/*
 * 只读自然语言回归运行器：每个用例均由微信开发者工具 Agent 处理，
 * 不直接调用业务 Skill，不执行任何数据库写入。
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const cli = 'D:\\微信开发者工具\\AI版本\\微信web开发者工具\\cli.bat'
const output = path.join(root, 'docs', 'ai-query-natural-language-raw-results.json')
const sessionPrefix = 'AI_NLALL_20260731_RETRY'
// 对上一轮没有留下 tool_call 的问题强制取证；业务问题原文不变，且只允许只读 Skill。
const suffix = '仅查询，不创建、不确认、不付款、不退租。回答前必须调用合适的只读 Skill；不要凭记忆、经验或上次回答直接作答。'

const cases = [
  // 房屋
  ['H01', '现在有哪些房子租出去了？'], ['H02', '现在出租中的房屋一共有几套？'], ['H03', '把目前有人住的房子全部列出来。'],
  ['H04', '哪些房屋现在有有效合同？'], ['H05', '现在还有哪些房子没有租出去？'], ['H06', '目前一共有多少套空房？'],
  ['H07', '把所有没有有效合同的房屋列出来。'], ['H08', 'NLTEST-2810现在租出去了吗？'], ['H09', 'NLTEST-2810现在谁住？'],
  ['H10', 'NLTEST-2810现在是什么情况？'], ['H11', '查一下NLTEST-2810目前的租赁情况。'], ['H12', 'NLTEST-2810现在的租客是谁，合同什么时候开始、什么时候结束？'],
  ['H13', 'NLTEST-2810现在月租多少，押金多少？'], ['H14', 'NLTEST-2801现在有人住吗？'], ['H15', '为什么NLTEST-2801被认为是空房？'],
  ['H16', 'NLTEST-2801最后一份合同是什么时候结束的？'], ['H17', 'NLTEST-2801以前住过哪些租客？'], ['H18', 'NLTEST-2901以前都住过谁？'],
  ['H19', '列出NLTEST-2901所有历史租客。'], ['H20', 'NLTEST-2901最近三个租客是谁？'], ['H21', 'NLTEST-2901历史上一共出租过几次？'],
  ['H22', '把NLTEST-2901的历史合同按时间顺序列出来。'],
  // 租客与合同
  ['T01', '现在一共有多少个在住租客？'], ['T02', '现在有哪些租客正在入住？'], ['T03', '列出所有当前有效合同对应的租客。'],
  ['T04', 'NL测试正常缴费租客现在还住着吗？'], ['T05', 'NL测试正常缴费租客现在住哪个房间？'], ['T06', 'NL测试正常缴费租客是什么时候入住的？'],
  ['T07', 'NL测试正常缴费租客合同什么时候到期？'], ['T08', '查一下NL测试正常缴费租客的资料。'], ['T09', 'NL测试正常缴费租客的手机号是多少？'],
  ['T10', 'NL测试正常缴费租客的身份证信息是多少？'], ['T11', 'NL测试历史甲现在还住着吗？'], ['T12', 'NL测试历史甲以前住哪个房间？'],
  ['T13', 'NL测试历史甲具体是哪一天搬走的？'], ['T14', 'NL测试多合同租客在这里租过几次房？'], ['T15', 'NL测试多合同租客所有历史合同给我看看。'],
  ['C01', '现在一共有多少份有效合同？'], ['C02', '把当前所有有效合同列出来。'], ['C03', 'NLTEST-2810现在的合同是什么？'],
  ['C04', 'NL测试正常缴费租客现在的合同详细信息给我看看。'], ['C05', '未来7天有哪些合同到期？'], ['C06', '未来10天有哪些合同到期？'],
  ['C07', '未来30天哪些合同到期？'], ['C08', '下个月有哪些合同到期？'], ['C09', '今年还有哪些合同会到期？'], ['C10', '哪一份有效合同最先到期？'],
  ['C11', '有没有合同已经到期但是还显示有效？'], ['C12', '有没有房屋同时存在两份有效合同？'], ['C13', '有没有租客同时存在多份有效入住合同？'],
  // 入住、退租和时间
  ['A01', '今天有谁入住？'], ['A02', '昨天有谁入住？'], ['A03', '这个月有哪些租客入住？'], ['A04', '上个月有哪些租客入住？'],
  ['A05', '今年有哪些租客入住？'], ['A06', '去年有哪些租客入住？'], ['A07', '最近7天有哪些人入住？'], ['A08', '最近30天有哪些人入住？'],
  ['A09', '2026年7月有哪些租客入住？'], ['A10', '2026年7月1日有哪些人入住？'], ['A11', '2026年1月到6月有哪些租客入住？'],
  ['A12', '查2026年3月1日到2026年5月31日的入住名单。'], ['M01', '今天谁退租了？'], ['M02', '昨天有退租记录吗？'],
  ['M03', '本周有哪些人退租？'], ['M04', '上个月有哪些租客退租？'], ['M05', '今年有哪些租客退租？'], ['M06', '去年退租名单给我看看。'],
  ['M07', '最近30天有哪些退租记录？'], ['M08', '2026年1月到6月有哪些人退租？'],
  // 付款、欠费、未来应收
  ['P01', 'NL测试正常缴费租客交过哪些钱？'], ['P02', 'NL测试正常缴费租客今年交过哪些费用？'], ['P03', 'NL测试正常缴费租客这个月交过钱吗？'],
  ['P04', 'NL测试正常缴费租客从入住到现在一共付了多少钱？'], ['P05', 'NL测试正常缴费租客所有付款明细给我列出来。'], ['P06', 'NLTEST-2803今年有哪些付款记录？'],
  ['P07', 'NL测试正常缴费租客今年交了多少租金？'], ['P08', 'NL测试正常缴费租客今年交过多少水电费？'], ['P09', 'NL测试正常缴费租客除了房租还交过哪些费用？'],
  ['A13', 'NL测试欠费租客现在还有没付完的钱吗？'], ['A14', 'NL测试欠费租客那笔账单应付多少，已经付了多少，还剩多少？'],
  ['A15', 'NL测试欠费租客哪些账单只是部分付款？'], ['A16', 'NL测试欠费租客总欠款是多少？'], ['D01', '现在谁欠钱？'],
  ['D02', '现在有哪些未缴账单？'], ['D03', '现在一共有多少欠费？'], ['D04', '谁还没交房租？'], ['D05', '哪些租客有未结清费用？'],
  ['D06', 'NL测试欠费租客欠的是什么费用？'], ['D07', 'NL测试欠费租客有几笔没付？'], ['D08', 'NL测试欠费租客最早哪笔欠款是什么时候的？'],
  ['D09', 'NL测试正常缴费租客现在还欠钱吗？'], ['D10', '现在有哪些欠费超过7天？'], ['D11', '欠费超过30天的租客有哪些？'],
  ['D12', '欠费超过60天的是谁？'], ['F01', '未来7天有哪些费用要收？'], ['F02', '未来10天哪些租客该交房租？'],
  ['F03', '下周有哪些账单到期？'], ['F04', '未来30天应收金额是多少？'], ['F05', '现在已经逾期的金额是多少？'],
  // 收款、收入、结算与综合
  ['R01', '今天实际收了多少钱？'], ['R02', '昨天实际收了多少钱？'], ['R03', '这个月实际收了多少钱？'], ['R04', '上个月实际收了多少钱？'],
  ['R05', '今年实际收款是多少？'], ['R06', '去年实际收款是多少？'], ['R07', '2026年7月实际收到多少钱？'], ['R08', '2026年1月到6月实际收款多少？'],
  ['R09', '查2026年3月1日至5月31日所有实际付款。'], ['R10', '查2026年8月1日到2026年7月1日的付款。'],
  ['I01', '这个月收到的钱分别是什么来源？'], ['I02', '今年实际收到多少租金？'], ['I03', '今年实际收到多少水电费？'], ['I04', '今年各类费用分别收到多少钱？'],
  ['S01', 'NL测试正常缴费租客合同押金是多少？'], ['S02', 'NL测试正常缴费租客实际交了多少押金？'], ['S03', 'NL测试退租结算租客退租时是怎么结算的？'],
  ['S04', 'NL测试退租结算租客退租时总共扣了多少钱？'], ['S05', 'NL测试退租结算租客退租最后退了多少钱？'], ['S06', 'NL测试退租结算租客退租有没有需要补钱？'],
  ['S07', 'NL测试退租结算租客退租水电费合计是多少？'], ['S08', 'NL测试多合同租客退租时有没有房屋损失费？'],
  ['S09', 'NL测试多合同租客房损金额是多少？'], ['S10', 'NL测试多合同租客今年实际收到多少房损费？'], ['S11', '今年有哪些退款？'],
  ['S12', 'NL测试退租结算租客有没有退款？实际退款多少？'], ['O01', 'NLTEST-2810整体情况怎么样？'],
  ['O02', 'NL测试正常缴费租客现在整体情况怎么样？'], ['O03', '现在整体经营情况怎么样？'], ['O04', '现在房屋出租情况怎么样？'],
  ['O05', '给我做一个当前出租经营概况。'], ['E01', 'NL不存在房屋现在谁住？'], ['E02', 'NL不存在租客住在哪里？'],
  ['E03', 'NL测试同名租客住在哪里？'], ['E04', '查2026年2月有哪些租客入住？']
]

function parsePayload(raw) {
  const start = raw.indexOf('\n{\n')
  if (start < 0) return null
  const after = raw.slice(start + 1)
  const end = after.indexOf('\n- 初始化')
  const json = end >= 0 ? after.slice(0, end) : after
  try { return JSON.parse(json) } catch { return null }
}

function runOne([id, question], index) {
  return new Promise(resolve => {
    const sessionId = `${sessionPrefix}_${String(index + 1).padStart(3, '0')}_${id}`
    const extra = id === 'H22'
      ? '该问题必须先调用 getHouseProfileByKeyword 查询房屋档案中的 leases，再按 startDate 排序回答。'
      : ''
    const args = ['agent', 'chat', '--project', root, '--port', '24793', '--query', `${question}${suffix}${extra}`, '--session-id', sessionId, '--timeout', '60000', '--trust-project', '--lang', 'zh', '--debug']
    const child = spawn(cli, args, { cwd: root, shell: true, windowsHide: true })
    let raw = ''
    child.stdout.on('data', data => { raw += data.toString() })
    child.stderr.on('data', data => { raw += data.toString() })
    const timer = setTimeout(() => child.kill(), 70000)
    child.on('close', code => {
      clearTimeout(timer)
      const payload = parsePayload(raw)
      const contents = payload?.peek?.data?.contents || payload?.contents || []
      const calls = contents.filter(x => x.type === 'tool_call').map(x => ({ name: x.name, arguments: x.arguments }))
      const results = contents.filter(x => x.type === 'tool_result').map(x => ({ name: x.name, isError: x.executeResult?.invokeResult?.isError, text: x.executeResult?.invokeResult?.content?.[0]?.text || '' }))
      resolve({ id, question, sessionId, exitCode: code, parsed: !!payload, partial: !!payload?.partial, calls, results, finalText: payload?.finalText || payload?.peek?.data?.finalText || '', raw })
    })
  })
}

async function main() {
  const previous = fs.existsSync(output) ? JSON.parse(fs.readFileSync(output, 'utf8')) : { results: [] }
  const byId = new Map((previous.results || []).map(item => [item.id, item]))
  const pending = cases.filter(([id]) => !byId.get(id)?.calls?.length)
  for (let index = 0; index < pending.length; index += 1) {
    const item = pending[index]
    const absoluteIndex = cases.findIndex(([id]) => id === item[0])
    const result = await runOne(item, absoluteIndex)
    byId.set(result.id, result)
    const results = cases.map(([id]) => byId.get(id)).filter(Boolean)
    fs.writeFileSync(output, JSON.stringify({ generatedAt: new Date().toISOString(), total: cases.length, completed: results.length, pending: pending.length - index - 1, results }, null, 2))
    console.log(`[retry ${index + 1}/${pending.length}] ${result.id}:${result.calls.map(call => call.name).join(',') || 'NO_TOOL'}`)
  }
}

main().catch(error => { console.error(error); process.exit(1) })
