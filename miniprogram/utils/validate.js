/**
 * 表单验证工具
 */
const Validators = {
  required(val, label) {
    if (!val && val !== 0) return `${label}不能为空`;
    if (typeof val === 'string' && !val.trim()) return `${label}不能为空`;
    return null;
  },

  phone(val) {
    if (!val) return null;
    return /^1\d{10}$/.test(val) ? null : '手机号格式不正确（需11位数字）';
  },

  idCard(val) {
    if (!val) return null;
    return /(^\d{15}$)|(^\d{18}$)|(^\d{17}(\d|X|x)$)/.test(val) ? null : '身份证号格式不正确';
  },

  positiveNumber(val, label) {
    const n = Number(val);
    if (isNaN(n)) return `${label}必须是数字`;
    if (n < 0) return `${label}不能为负数`;
    return null;
  },

  min(val, min, label) {
    const n = Number(val);
    if (!isNaN(n) && n < min) return `${label}不能小于${min}`;
    return null;
  },

  /**
   * 运行一组验证规则，返回第一个错误消息或 null
   */
  run(rules) {
    for (const rule of rules) {
      const msg = rule.fn(...rule.args);
      if (msg) return msg;
    }
    return null;
  }
};

module.exports = Validators;
