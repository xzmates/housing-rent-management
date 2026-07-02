const { ensureCloudInit, errorResult } = require('./utils/util')
const getRentalActions = require('./apis/getRentalActions')
const addRentalHouse = require('./apis/addRentalHouse')
const addRentalTenant = require('./apis/addRentalTenant')
const createRentalLease = require('./apis/createRentalLease')
const confirmTargetPayment = require('./apis/confirmTargetPayment')
const addSingleMeterReading = require('./apis/addSingleMeterReading')
const prepayTargetRent = require('./apis/prepayTargetRent')
const settleMoveOut = require('./apis/settleMoveOut')
const executeRentalAction = require('./apis/executeRentalAction')

const skill = wx.modelContext.createSkill('skills/rental-assistant-skill')

skill.use(async (ctx, next) => {
  try {
    ensureCloudInit()
    console.info('[ai-mode] rental-assistant-skill middleware start name=', ctx.name)
    await next()
    console.info('[ai-mode] rental-assistant-skill middleware finish name=', ctx.name)
  } catch (err) {
    console.error('[ai-mode] rental-assistant-skill middleware error:', err.message)
    return errorResult(err.message || '租赁办理失败')
  }
})

skill.registerAPI('getRentalActions', getRentalActions)
skill.registerAPI('addRentalHouse', addRentalHouse)
skill.registerAPI('addRentalTenant', addRentalTenant)
skill.registerAPI('createRentalLease', createRentalLease)
skill.registerAPI('confirmTargetPayment', confirmTargetPayment)
skill.registerAPI('addSingleMeterReading', addSingleMeterReading)
skill.registerAPI('prepayTargetRent', prepayTargetRent)
skill.registerAPI('settleMoveOut', settleMoveOut)
skill.registerAPI('executeRentalAction', executeRentalAction)

console.info('[ai-mode] rental-assistant-skill APIs registered')
