const { ensureCloudInit } = require('./domain-client')

function createSkillMiddleware(skillName) {
  return async (ctx, next) => {
    try {
      ensureCloudInit()
      console.info(`[ai-mode] ${skillName} middleware start name=${ctx.name}`)
      await next()
      console.info(`[ai-mode] ${skillName} middleware finish name=${ctx.name}`)
    } catch (err) {
      console.error(`[ai-mode] ${skillName} middleware error:`, err.message)
      return { isError: true, content: [{ type: 'text', text: err.message || `${skillName} 处理失败` }] }
    }
  }
}

module.exports = { createSkillMiddleware }
