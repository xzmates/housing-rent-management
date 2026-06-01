const V = require('../utils/validate');

describe('validate.js', () => {
  describe('required', () => {
    it('returns null when value is non-empty string', () => {
      expect(V.required('hello', '名称')).toBeNull();
    });
    it('returns error when value is empty string', () => {
      expect(V.required('', '名称')).toBe('名称不能为空');
    });
    it('returns error when value is whitespace', () => {
      expect(V.required('   ', '名称')).toBe('名称不能为空');
    });
    it('returns null when value is 0 (valid number)', () => {
      expect(V.required(0, '金额')).toBeNull();
    });
    it('returns error when value is null', () => {
      expect(V.required(null, '名称')).toBe('名称不能为空');
    });
    it('returns error when value is undefined', () => {
      expect(V.required(undefined, '名称')).toBe('名称不能为空');
    });
  });

  describe('phone', () => {
    it('passes valid phone', () => {
      expect(V.phone('13800138000')).toBeNull();
    });
    it('rejects 10-digit phone', () => {
      expect(V.phone('1380013800')).toBe('手机号格式不正确（需11位数字）');
    });
    it('rejects 12-digit phone', () => {
      expect(V.phone('138001380000')).toBe('手机号格式不正确（需11位数字）');
    });
    it('rejects non-numeric string', () => {
      expect(V.phone('abcdefghijk')).toBe('手机号格式不正确（需11位数字）');
    });
    it('returns null for empty string (optional)', () => {
      expect(V.phone('')).toBeNull();
    });
  });

  describe('idCard', () => {
    it('passes 18-digit ID', () => {
      expect(V.idCard('110101199001011234')).toBeNull();
    });
    it('passes 18-digit ID with X', () => {
      expect(V.idCard('11010119900101123X')).toBeNull();
    });
    it('passes 15-digit ID', () => {
      expect(V.idCard('110101900101123')).toBeNull();
    });
    it('rejects invalid length', () => {
      expect(V.idCard('123')).toBe('身份证号格式不正确');
    });
    it('returns null for empty (optional)', () => {
      expect(V.idCard('')).toBeNull();
    });
  });

  describe('positiveNumber', () => {
    it('passes positive number', () => {
      expect(V.positiveNumber(100, '租金')).toBeNull();
    });
    it('passes zero', () => {
      expect(V.positiveNumber(0, '租金')).toBeNull();
    });
    it('rejects negative number', () => {
      expect(V.positiveNumber(-1, '租金')).toBe('租金不能为负数');
    });
    it('rejects non-numeric string', () => {
      expect(V.positiveNumber('abc', '租金')).toBe('租金必须是数字');
    });
  });

  describe('run', () => {
    it('returns null when all rules pass', () => {
      const msg = V.run([
        { fn: V.required, args: ['hello', '名称'] },
      ]);
      expect(msg).toBeNull();
    });
    it('returns first error message', () => {
      const msg = V.run([
        { fn: V.required, args: ['', '名称'] },
        { fn: V.required, args: ['', '金额'] },
      ]);
      expect(msg).toBe('名称不能为空');
    });
  });
});
