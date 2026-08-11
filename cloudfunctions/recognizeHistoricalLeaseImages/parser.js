function compact(value) {
  return String(value || '').replace(/\s+/g, '')
}

function stripValue(value) {
  return String(value || '').replace(/^[\s:：,，;；。._—-]+|[\s,，;；。_—-]+$/g, '').trim()
}

function normalizeDate(value) {
  const match = compact(value).match(/(20\d{2})[年./-](\d{1,2})[月./-](\d{1,2})日?/)
  if (!match) return ''
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const date = new Date(Date.UTC(year, month - 1, day))
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return ''
  return `${match[1]}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function validIdCard(value) {
  const id = String(value || '').toUpperCase()
  if (!/^\d{17}[\dX]$/.test(id)) return false
  const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2]
  const checks = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2']
  const sum = weights.reduce((total, weight, index) => total + Number(id[index]) * weight, 0)
  return checks[sum % 11] === id[17]
}

function averageConfidence(items) {
  if (!items.length) return 0
  return items.reduce((sum, item) => sum + Number(item.confidence || 0), 0) / items.length
}

function rounded(value) {
  return Math.round(Number(value || 0) * 1000) / 1000
}

const SECTION_RE = /^第[一二三四五六七八九十\d]+条/
const FIELD_LABEL_RE = /^(?:承租人(?:姓名)?|租客姓名|乙方姓名|身份证(?:号|号码)?|证件号|联系电话|手机(?:号码|号)?|电话|房屋地址|房屋坐落|租赁期限自|起租日期|合同结束日期|月租金|每月租金|押金|保证金|付款周期|付款方式|支付方式|租金已[交缴]至|水电已结清至|水电最后结清日期|电表读数|水表读数)\s*[：:]?/

function isBoundary(text) {
  const normalized = String(text || '').trim()
  return SECTION_RE.test(normalized) || FIELD_LABEL_RE.test(normalized)
}

function normalizeItems(lines) {
  return (lines || []).map((item, index) => ({
    pageIndex: Number.isInteger(item.pageIndex) ? item.pageIndex : 0,
    order: Number.isInteger(item.order) ? item.order : index,
    text: String(item.text || '').trim(),
    confidence: Number(item.confidence || 0),
    polygon: Array.isArray(item.polygon) ? item.polygon : [],
    itemPolygon: item.itemPolygon || null
  })).filter(item => item.text)
}

function evidence(label, items, confidence) {
  return {
    label,
    sourceText: items.map(item => item.text).join(' '),
    pageIndex: items[0] ? items[0].pageIndex : 0,
    confidence: rounded(confidence)
  }
}

function chooseCandidate(candidates) {
  const byValue = new Map()
  candidates.forEach(candidate => {
    if (!candidate || candidate.value === '' || candidate.value === undefined) return
    const key = String(candidate.value)
    const previous = byValue.get(key)
    if (!previous || candidate.confidence > previous.confidence) byValue.set(key, candidate)
  })
  const unique = [...byValue.values()]
  if (unique.length !== 1) return { value: '', confidence: 0, evidence: null, conflict: unique.length > 1 }
  return { ...unique[0], conflict: false }
}

function anchoredScalar(items, definitions, parseValue, options = {}) {
  const candidates = []
  items.forEach((item, index) => {
    if (options.reject && options.reject(item.text)) return
    for (const definition of definitions) {
      const match = item.text.match(definition.pattern)
      if (!match) continue
      const inline = stripValue(item.text.slice(match.index + match[0].length))
      const inlineValue = parseValue(inline)
      if (inlineValue !== '') {
        const confidence = Number(item.confidence || 0)
        candidates.push({ value: inlineValue, confidence, evidence: evidence(definition.label, [item], confidence) })
        break
      }
      const maxNext = options.maxNext || 2
      for (let offset = 1; offset <= maxNext; offset += 1) {
        const next = items[index + offset]
        if (!next || next.pageIndex !== item.pageIndex || isBoundary(next.text)) break
        const nextValue = parseValue(stripValue(next.text))
        if (nextValue === '') continue
        const sourceItems = [item, next]
        const confidence = averageConfidence(sourceItems) * 0.95
        candidates.push({ value: nextValue, confidence, evidence: evidence(definition.label, sourceItems, confidence) })
        break
      }
      break
    }
  })
  if (!candidates.length && options.globalFallback) {
    items.forEach(item => {
      const value = options.globalFallback(item.text)
      if (value === '') return
      const confidence = Math.min(Number(item.confidence || 0), 0.6)
      candidates.push({ value, confidence, evidence: evidence('无标签回退', [item], confidence) })
    })
  }
  return chooseCandidate(candidates)
}

function exactName(value) {
  const name = stripValue(value)
  if (!/^[\u4e00-\u9fa5·]{2,6}$/.test(name)) return ''
  if (/^(?:甲方|乙方|出租人|承租人|租赁方)$/.test(name) || /合同|房屋|应当|应按|双方/.test(name)) return ''
  return name
}

function exactIdCard(value) {
  const match = compact(value).toUpperCase().match(/^\d{17}[\dX]$/)
  return match ? match[0] : ''
}

function exactPhone(value) {
  const phone = String(value || '').replace(/[\s-]/g, '').replace(/^\+?86/, '')
  return /^1[3-9]\d{9}$/.test(phone) ? phone : ''
}

function exactAddress(value) {
  const address = stripValue(value)
  if (!/^[\u4e00-\u9fa5A-Za-z0-9号室栋幢单元楼座弄巷路街村镇区县市省()-]{2,40}$/.test(address)) return ''
  if (/房屋租赁合同|租赁事宜|应合理使用|结构或用途|权利与义务/.test(address)) return ''
  return address
}

function exactMoney(value) {
  const match = compact(value).match(/^(\d+(?:\.\d{1,2})?)(?:元)?(?:[，,；;].*)?$/)
  return match ? Number(match[1]) : ''
}

function exactReading(value) {
  const match = compact(value).match(/^(\d+(?:\.\d+)?)(?:度|吨)?$/)
  return match ? Number(match[1]) : ''
}

function exactPaymentTerms(value) {
  const match = compact(value).match(/^(押[一二三四五六七八九十\d]+付[一二三四五六七八九十\d]+|月付|季付|季度付|半年付|年付)$/)
  return match ? match[1] : ''
}

function windowFromAnchor(items, anchorPattern, stopPattern, maxItems = 16) {
  const windows = []
  items.forEach((item, index) => {
    const match = item.text.match(anchorPattern)
    if (!match) return
    const values = [item]
    for (let offset = 1; offset <= maxItems; offset += 1) {
      const next = items[index + offset]
      if (!next || next.pageIndex !== item.pageIndex || (stopPattern && stopPattern.test(next.text))) break
      values.push(next)
    }
    windows.push({ label: match[0], items: values, text: compact(values.map(value => value.text).join('')) })
  })
  return windows
}

function dateCandidate(label, window, expression) {
  const match = window.text.match(expression)
  if (!match) return null
  const value = normalizeDate(match[1])
  if (!value) return null
  const matchedItems = window.items.filter(item => compact(item.text).includes(match[1]) || /20\d{2}|\d{1,2}日/.test(compact(item.text)))
  const sourceItems = matchedItems.length ? matchedItems : window.items
  const singleItem = window.items.some(item => compact(item.text).includes(match[1]))
  const factor = singleItem ? 1 : 0.85
  const confidence = averageConfidence(sourceItems) * factor
  return { value, confidence, evidence: evidence(label, sourceItems, confidence) }
}

function datesFromLeaseSection(items) {
  const windows = windowFromAnchor(items, /(?:租赁期限自|租期自|起租日期)/, /^第二条|^(?:月租金|押金|保证金)/, 24)
  return {
    startDate: chooseCandidate(windows.map(window => dateCandidate('租赁期限自', window, /(?:租赁期限自|租期自|起租日期)[：:]?((?:20\d{2})年\d{1,2}月\d{1,2}日)/)).filter(Boolean)),
    endDate: chooseCandidate(windows.map(window => dateCandidate('租赁期限至', window, /(?:日至|日?至|租赁期限至|租期至|合同结束日期)[：:]?((?:20\d{2})年\d{1,2}月\d{1,2}日)/)).filter(Boolean)),
    hasEndAnchor: windows.some(window => /至20\d{2}年|合同结束日期|租赁期限至|租期至/.test(window.text))
  }
}

function anchoredDate(items, label, anchorPattern, stopPattern) {
  const candidates = windowFromAnchor(items, anchorPattern, stopPattern, 12)
    .map(window => dateCandidate(label, window, new RegExp(`${anchorPattern.source}[：:]?((?:20\\d{2})年\\d{1,2}月\\d{1,2}日)`)))
    .filter(Boolean)
  return chooseCandidate(candidates)
}

function paymentCycleFromText(value) {
  if (/季|付三/.test(value)) return 'quarter'
  if (/半年|付六/.test(value)) return 'half_year'
  if (/年付|十二/.test(value)) return 'year'
  return 'month'
}

function extractionResult(value, key, fieldConfidence, fieldEvidence) {
  fieldConfidence[key] = rounded(value.confidence)
  if (value.evidence) fieldEvidence[key] = value.evidence
  return value.value
}

function extractHistoricalLease(lines = [], options = {}) {
  const items = normalizeItems(lines)
  const tenant = anchoredScalar(items, [
    { label: '承租人', pattern: /^(?:承租人(?:姓名)?|租客姓名|乙方姓名)\s*[：:]?/ }
  ], exactName, { reject: text => /签字|签章/.test(text) })
  const idCard = anchoredScalar(items, [
    { label: '身份证号', pattern: /^(?:身份证(?:号|号码)?|证件号)\s*[：:]?/ }
  ], exactIdCard, { globalFallback: exactIdCard })
  const phone = anchoredScalar(items, [
    { label: '联系电话', pattern: /^(?:联系电话|手机(?:号码|号)?|电话)\s*[：:]?/ }
  ], exactPhone, { globalFallback: value => exactPhone(value) })
  const house = anchoredScalar(items, [
    { label: '房屋地址', pattern: /^(?:房屋地址|房屋坐落|出租房屋)\s*[：:]?/ }
  ], exactAddress)
  const rent = anchoredScalar(items, [
    { label: '月租金', pattern: /^(?:月租金|每月租金|租金为)\s*[：:]?/ }
  ], exactMoney)
  const deposit = anchoredScalar(items, [
    { label: '押金', pattern: /^(?:押金|保证金)\s*[：:]?/ }
  ], exactMoney)
  const paymentTerms = anchoredScalar(items, [
    { label: '付款方式', pattern: /^(?:付款周期|付款方式|支付方式)\s*[：:]?/ }
  ], exactPaymentTerms)
  const electricity = anchoredScalar(items, [
    { label: '电表读数', pattern: /^电表读数\s*[：:]?/ }
  ], exactReading)
  const water = anchoredScalar(items, [
    { label: '水表读数', pattern: /^水表读数\s*[：:]?/ }
  ], exactReading)
  const leaseDates = datesFromLeaseSection(items)
  const rentCoveredUntil = anchoredDate(items, '租金已缴至', /租金已[交缴]至/, /^第三条|^(?:水电已结清至|电表读数|水表读数)/)
  const utilityDate = anchoredDate(items, '水电已结清至', /(?:水电已结清至|水电最后结清日期)/, /^第四条|^(?:电表读数|水表读数)/)

  const fieldConfidence = {}
  const fieldEvidence = {}
  const result = {
    tenantName: extractionResult(tenant, 'tenantName', fieldConfidence, fieldEvidence),
    idCard: extractionResult(idCard, 'idCard', fieldConfidence, fieldEvidence),
    phone: extractionResult(phone, 'phone', fieldConfidence, fieldEvidence),
    houseOriginalText: extractionResult(house, 'houseOriginalText', fieldConfidence, fieldEvidence),
    startDate: extractionResult(leaseDates.startDate, 'startDate', fieldConfidence, fieldEvidence),
    endDate: extractionResult(leaseDates.endDate, 'endDate', fieldConfidence, fieldEvidence),
    rent: extractionResult(rent, 'rent', fieldConfidence, fieldEvidence),
    deposit: extractionResult(deposit, 'deposit', fieldConfidence, fieldEvidence),
    paymentTermsText: extractionResult(paymentTerms, 'paymentTermsText', fieldConfidence, fieldEvidence),
    rentCoveredUntil: extractionResult(rentCoveredUntil, 'rentCoveredUntil', fieldConfidence, fieldEvidence),
    utilityDate: extractionResult(utilityDate, 'utilityDate', fieldConfidence, fieldEvidence),
    utilityElectricity: extractionResult(electricity, 'utilityElectricity', fieldConfidence, fieldEvidence),
    utilityWater: extractionResult(water, 'utilityWater', fieldConfidence, fieldEvidence)
  }
  result.paymentCycle = result.paymentTermsText ? paymentCycleFromText(result.paymentTermsText) : 'month'
  fieldConfidence.paymentCycle = fieldConfidence.paymentTermsText || 0
  if (fieldEvidence.paymentTermsText) fieldEvidence.paymentCycle = fieldEvidence.paymentTermsText

  const uncertain = new Set()
  const requireCertain = key => {
    if (result[key] === '' || result[key] === undefined || fieldConfidence[key] < 0.85) uncertain.add(key)
  }
  ;['tenantName', 'idCard', 'phone', 'houseOriginalText', 'startDate', 'rent', 'deposit', 'paymentTermsText', 'rentCoveredUntil'].forEach(requireCertain)
  if (result.idCard && !validIdCard(result.idCard)) uncertain.add('idCard')
  if (leaseDates.hasEndAnchor) requireCertain('endDate')
  if (result.startDate && result.endDate && result.endDate < result.startDate) {
    uncertain.add('startDate')
    uncertain.add('endDate')
  }
  const allText = compact(items.map(item => item.text).join(''))
  const hasUtilitySection = /第三条[^第]{0,20}水电|水电已结清至|电表读数|水表读数/.test(allText)
  if (hasUtilitySection) {
    ;['utilityDate', 'utilityElectricity', 'utilityWater'].forEach(requireCertain)
  }
  const candidateMap = { tenantName: tenant, idCard, phone, houseOriginalText: house, rent, deposit, paymentTermsText: paymentTerms, startDate: leaseDates.startDate, endDate: leaseDates.endDate, rentCoveredUntil, utilityDate, utilityElectricity: electricity, utilityWater: water }
  Object.entries(candidateMap).forEach(([key, value]) => {
    if (value.conflict) uncertain.add(key)
  })

  const pageIndexes = [...new Set(items.map(item => item.pageIndex))].sort((a, b) => a - b)
  const ocrText = pageIndexes.map(pageIndex => {
    const pageText = items.filter(item => item.pageIndex === pageIndex).map(item => item.text).join('\n')
    return pageIndexes.length > 1 ? `【第${pageIndex + 1}页】\n${pageText}` : pageText
  }).join('\n\n')

  return {
    ...result,
    fieldConfidence,
    fieldEvidence,
    uncertainFields: [...uncertain],
    ocrText,
    ocrItems: items,
    pageAngles: Array.isArray(options.pageAngles) ? options.pageAngles : []
  }
}

module.exports = { extractHistoricalLease, normalizeDate, validIdCard }
