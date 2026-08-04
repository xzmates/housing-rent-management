const BUSINESS_TIME_ZONE = 'Asia/Shanghai'

// 将日期统一为中国业务日。纯日期表示业务日期；带时区的时间戳先换算到上海，
// 以兼容 CloudBase Date 序列化后的 UTC（Z）字符串。
function businessDateKey(value) {
  if (!value) return ''
  const raw = value && value.$date ? value.$date : value
  const source = typeof raw === 'string' ? raw : ''
  const direct = source.match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (direct && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(source)) return direct[0]

  const date = raw instanceof Date ? raw : new Date(raw)
  if (Number.isNaN(date.getTime())) return ''
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: BUSINESS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${values.year}-${values.month}-${values.day}`
}

function businessDateValue(value, endOfDay = false) {
  const key = businessDateKey(value)
  if (!key) return null
  const [year, month, day] = key.split('-').map(Number)
  return Date.UTC(year, month - 1, day, endOfDay ? 23 : 0, endOfDay ? 59 : 0, endOfDay ? 59 : 0, endOfDay ? 999 : 0)
}

module.exports = { BUSINESS_TIME_ZONE, businessDateKey, businessDateValue }
