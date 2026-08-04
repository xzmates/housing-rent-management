/*
 * 定向重跑受修复影响的用例：传入用例 ID 列表，重跑后原位更新
 * docs/ai-query-natural-language-raw-results-20260731.json 对应条目。
 */
const { spawn } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const cli = 'D:\\微信开发者工具\\AI版本\\微信web开发者工具\\cli.bat'
const output = path.join(root, 'docs', 'ai-query-natural-language-raw-results-20260731.json')
const sessionPrefix = 'AI_NLFIX_20260731'
const suffix = '仅查询，不创建、不确认、不付款、不退租。回答前必须调用合适的只读 Skill；不要凭记忆、经验或上次回答直接作答。'

const cases = JSON.parse(process.argv[2] || '[]')
if (!cases.length) { console.error('usage: node run-nl-fix-reverify.cjs \'["D01","D05"]\''); process.exit(1) }

const existing = JSON.parse(fs.readFileSync(output, 'utf8'))
const questionById = Object.fromEntries((existing.results || []).map(r => [r.id, r.question]))
const questions = cases.map(id => [id, questionById[id] || ''])

function parsePayload(raw) {
  const start = raw.indexOf('\n{\n')
  if (start < 0) return null
  const after = raw.slice(start + 1)
  const end = after.indexOf('\n- 初始化')
  const json = end >= 0 ? after.slice(0, end) : after
  try { return JSON.parse(json) } catch { return null }
}

function looksTruncated(finalText) {
  if (!finalText) return true
  const t = finalText.trim()
  if (t.length < 20) return true
  return /[:：,，、]$/.test(t)
}

function runOne([id, question], index, attempt) {
  return new Promise(resolve => {
    const sessionId = `${sessionPrefix}_${attempt}_${String(index + 1).padStart(3, '0')}_${id}`
    const extra = id === 'H22'
      ? '该问题必须先调用 getHouseProfileByKeyword 查询房屋档案中的 leases，再按 startDate 排序回答。'
      : ''
    const args = ['agent', 'chat', '--project', root, '--port', '24793', '--query', `${question}${suffix}${extra}`, '--session-id', sessionId, '--timeout', '120000', '--trust-project', '--lang', 'zh', '--debug']
    const child = spawn(cli, args, { cwd: root, shell: true, windowsHide: true })
    let raw = ''
    child.stdout.on('data', data => { raw += data.toString() })
    child.stderr.on('data', data => { raw += data.toString() })
    const timer = setTimeout(() => child.kill(), 130000)
    child.on('close', code => {
      clearTimeout(timer)
      const payload = parsePayload(raw)
      const contents = payload?.peek?.data?.contents || payload?.contents || []
      const calls = contents.filter(x => x.type === 'tool_call').map(x => ({ name: x.name, arguments: x.arguments }))
      const results = contents.filter(x => x.type === 'tool_result').map(x => ({ name: x.name, isError: x.executeResult?.invokeResult?.isError, text: x.executeResult?.invokeResult?.content?.[0]?.text || '' }))
      resolve({
        id, question, sessionId, exitCode: code, parsed: !!payload,
        partial: !!payload?.partial, finished: payload?.peek?.finished ?? payload?.finished ?? null,
        calls, results,
        finalText: payload?.finalText || payload?.peek?.data?.finalText || '',
        raw,
      })
    })
  })
}

async function runCase([id, question], index) {
  let result = await runOne([id, question], index, 1)
  const bad = !result.calls?.length || result.results?.some(r => r.isError) || looksTruncated(result.finalText)
  if (bad) result = await runOne([id, question], index, 2)
  return result
}

async function main() {
  const data = JSON.parse(fs.readFileSync(output, 'utf8'))
  const results = data.results || []
  const byId = new Map(results.map(r => [r.id, r]))
  for (let i = 0; i < questions.length; i += 1) {
    const [id, q] = questions[i]
    if (!q) { console.log(`[SKIP] ${id} 无问题文本`); continue }
    const result = await runCase([id, q], i)
    byId.set(id, result)
    const newResults = [...byId.values()]
    fs.writeFileSync(output, JSON.stringify({ generatedAt: data.generatedAt, total: data.total, completed: newResults.length, results: newResults }, null, 2))
    const flags = []
    if (result.partial) flags.push('partial')
    if (!result.finalText) flags.push('NO_TEXT')
    if (!result.calls?.length) flags.push('NO_TOOL')
    if (result.results?.some(r => r.isError)) flags.push('ERR')
    console.log(`[${i + 1}/${questions.length}] ${id} ${flags.join(' ') || 'OK'} calls=${(result.calls || []).map(c => c.name).join(',')}`)
    console.log(`   ${(result.finalText || '').replace(/\n/g, ' ').slice(0, 120)}`)
  }
  console.log('DONE', questions.length)
}

main().catch(e => { console.error(e); process.exit(1) })
