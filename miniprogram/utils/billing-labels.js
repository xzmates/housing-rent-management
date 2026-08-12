const BILL_TYPE_TEXT = {
  rent: '租金',
  deposit: '押金',
  utility: '水电费',
  deposit_return: '押金退还',
  rent_refund: '租金退还',
  extra_due: '退租补缴',
  damage: '退租补缴',
  other: '其他费用'
};

const PAYMENT_METHOD_TEXT = {
  cash: '现金',
  wechat: '微信支付',
  bank: '银行转账',
  other: '其他方式',
  deposit_offset: '押金抵扣',
  deposit_damage: '押金扣损',
  refund_offset: '退款冲抵',
  refund: '原路退款',
  settlement_payment: '退租结算收款'
};

function billTypeText(type) {
  return BILL_TYPE_TEXT[type] || '其他费用';
}

function paymentMethodText(method) {
  if (!method) return '未记录';
  return PAYMENT_METHOD_TEXT[method] || '其他方式';
}

module.exports = { billTypeText, paymentMethodText };
