const { ensureCloudInit, errorResult } = require('./utils/util')
const getRentBills = require('./apis/getRentBills')
const confirmRentPayment = require('./apis/confirmRentPayment')
const payRentBill = require('./apis/payRentBill')
const getRentPaymentHistory = require('./apis/getRentPaymentHistory')

const skill = wx.modelContext.createSkill('skills/rent-bill-skill')

skill.use(async (ctx, next) => {
  try {
    ensureCloudInit()
    console.info('[ai-mode] rent-bill-skill middleware start name=', ctx.name)
    await next()
    console.info('[ai-mode] rent-bill-skill middleware finish name=', ctx.name)
  } catch (err) {
    console.error('[ai-mode] rent-bill-skill middleware error:', err.message)
    return errorResult(err.message || '租金账单处理失败')
  }
})

skill.registerAPI('getRentBills', getRentBills)
skill.registerAPI('confirmRentPayment', confirmRentPayment)
skill.registerAPI('payRentBill', payRentBill)
skill.registerAPI('getRentPaymentHistory', getRentPaymentHistory)

console.info('[ai-mode] rent-bill-skill APIs registered')
