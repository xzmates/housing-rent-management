const automator = require('miniprogram-automator')
const fs = require('fs')

async function main() {
  const action = process.argv[2]
  const rawParams = process.argv[3] || ''
  const params = rawParams ? JSON.parse(rawParams.startsWith('@') ? fs.readFileSync(rawParams.slice(1), 'utf8') : rawParams) : {}
  if (!action) throw new Error('缺少查询 action')
  const mini = await automator.connect({ wsEndpoint: `ws://127.0.0.1:${process.env.AGENT_PORT || '9420'}` })
  try {
    if (action === '__status') {
      const pages = await mini.pageStack()
      const current = await mini.currentPage()
      process.stdout.write(JSON.stringify({ pages: pages.map(page => ({ path: page.path, query: page.query })), current: current ? { path: current.path, data: await current.data() } : null }, null, 2))
      return
    }
    if (action === '__probe') {
      const result = await mini.evaluate(() => ({ hasCloud: !!wx.cloud, hasCallFunction: !!(wx.cloud && wx.cloud.callFunction), env: wx.cloud && wx.cloud.DYNAMIC_CURRENT_ENV }))
      process.stdout.write(JSON.stringify(result, null, 2))
      return
    }
    if (action === '__binding') {
      const result = await new Promise(async (resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Agent 回调绑定超时')), 5000)
        await mini.exposeFunction('agentQueryResult', payload => { clearTimeout(timer); resolve(payload) })
        await mini.evaluate(() => agentQueryResult('binding-ok'))
      })
      process.stdout.write(String(result))
      return
    }
    const result = await new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('小程序云函数调用超时')), 25000)
      await mini.exposeFunction('agentQueryResult', payload => {
        clearTimeout(timer)
        try { resolve(JSON.parse(payload)) } catch (_) { resolve(payload) }
      })
      await mini.evaluate((queryAction, queryParams) => {
        wx.cloud.callFunction({ name: 'rentalDomain', data: { action: queryAction, params: queryParams } })
          .then(response => agentQueryResult(JSON.stringify(response.result)))
          .catch(error => agentQueryResult(JSON.stringify({ code: -1, message: error && error.errMsg ? error.errMsg : String(error) })))
        return 'started'
      }, action, params)
    })
    process.stdout.write(JSON.stringify(result, null, 2))
  } finally {
    mini.disconnect()
  }
}

main().catch(error => {
  console.error(error.stack || error.message)
  process.exitCode = 1
})
