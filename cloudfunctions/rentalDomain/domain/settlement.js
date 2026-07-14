const { number } = require('./presenters')
const { invariant } = require('../infrastructure/errors')

function calculateMeterPreview(input) {
  const electricityReading = number(input.electricityReading)
  const waterReading = number(input.waterReading)
  const lastElectricity = number(input.lastElectricity)
  const lastWater = number(input.lastWater)
  invariant(electricityReading >= lastElectricity, 'VALIDATION_ERROR', '电表读数不能小于上次读数')
  invariant(waterReading >= lastWater, 'VALIDATION_ERROR', '水表读数不能小于上次读数')
  const electricityUsage = number(electricityReading - lastElectricity)
  const waterUsage = number(waterReading - lastWater)
  const electricityCost = number(electricityUsage * number(input.electricityPrice || 0.8))
  const waterCost = number(waterUsage * number(input.waterPrice || 3.5))
  return { electricityReading, waterReading, lastElectricity, lastWater, electricityUsage, waterUsage, electricityCost, waterCost, utilityCost: number(electricityCost + waterCost) }
}

function calculateSettlement(input) {
  const meter = calculateMeterPreview(input)
  const outstandingAmount = number(input.outstandingAmount)
  const deposit = number(input.deposit)
  const damageAmount = number(input.damageAmount)
  const payableBeforeDeposit = number(outstandingAmount + meter.utilityCost)
  const refundableDeposit = number(deposit - damageAmount)
  const depositForOffset = Math.max(0, refundableDeposit)
  const depositOffset = number(Math.min(depositForOffset, payableBeforeDeposit))
  const refundAmount = number(Math.max(0, depositForOffset - depositOffset))
  const damageExtraDue = damageAmount > deposit ? number(damageAmount - deposit) : 0
  const extraPayment = number(Math.max(0, payableBeforeDeposit - depositOffset) + damageExtraDue)
  const overpaidRent = number(input.overpaidRent)
  const totalRefund = number(refundAmount + overpaidRent - extraPayment)
  return {
    ...meter,
    outstandingAmount,
    payableBeforeDeposit,
    deposit,
    damageAmount,
    depositOffset,
    refundAmount,
    damageExtraDue,
    extraPayment,
    overpaidRent,
    totalRefund,
    finalLabel: totalRefund >= 0 ? '应退总额' : '仍需补缴',
    finalAmount: Math.abs(totalRefund)
  }
}

module.exports = { calculateMeterPreview, calculateSettlement }
