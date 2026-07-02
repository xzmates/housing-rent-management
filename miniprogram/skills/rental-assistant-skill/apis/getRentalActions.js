const { successResult, actionList } = require('../utils/util')

async function getRentalActions() {
  console.info('[ai-mode] getRentalActions 入口')
  const data = {
    title: '语音助手',
    subtitle: '说完先确认，再安全办理',
    actions: actionList()
  }
  console.info('[ai-mode] getRentalActions 出口 data=', JSON.stringify(data))
  return successResult('可以办理新增房屋、新增租客、新建合同、缴费确认、单次抄表、提前收租、退租结算。', data)
}

module.exports = getRentalActions
