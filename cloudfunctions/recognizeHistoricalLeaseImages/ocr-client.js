function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isTransientOcrError(error) {
  const code = String(error && error.code || '')
  const message = String(error && error.message || '')
  return ['ECONNRESET', 'ETIMEDOUT', 'ECONNABORTED', 'EAI_AGAIN'].includes(code) ||
    /socket hang up|timeout|timed out|ECONNRESET/i.test(message)
}

async function callOcrWithRetry(operation, request) {
  let lastError
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await operation(request)
    } catch (error) {
      lastError = error
      if (!isTransientOcrError(error) || attempt === 2) break
      await delay(300 * (attempt + 1))
    }
  }
  throw lastError
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function normalizedPolygon(value) {
  return Array.isArray(value)
    ? value.map(point => ({ X: finiteNumber(point && point.X), Y: finiteNumber(point && point.Y) }))
    : []
}

function normalizedItemPolygon(value) {
  if (!value) return null
  return {
    X: finiteNumber(value.X),
    Y: finiteNumber(value.Y),
    Width: finiteNumber(value.Width),
    Height: finiteNumber(value.Height)
  }
}

function itemBox(item) {
  if (item.itemPolygon) {
    return {
      x: item.itemPolygon.X,
      y: item.itemPolygon.Y,
      width: item.itemPolygon.Width,
      height: item.itemPolygon.Height
    }
  }
  const polygon = item.polygon || []
  if (!polygon.length) return null
  const xs = polygon.map(point => point.X)
  const ys = polygon.map(point => point.Y)
  return {
    x: Math.min(...xs),
    y: Math.min(...ys),
    width: Math.max(...xs) - Math.min(...xs),
    height: Math.max(...ys) - Math.min(...ys)
  }
}

function sortPageItems(items) {
  if (!items.some(item => itemBox(item))) return items.slice().sort((a, b) => a.order - b.order)
  const positioned = items.map(item => ({ item, box: itemBox(item) }))
  const missing = positioned.filter(entry => !entry.box).map(entry => entry.item)
  const ordered = positioned.filter(entry => entry.box).sort((a, b) => {
    const ay = a.box.y + a.box.height / 2
    const by = b.box.y + b.box.height / 2
    return ay - by || a.box.x - b.box.x || a.item.order - b.item.order
  })
  const lines = []
  ordered.forEach(entry => {
    const centerY = entry.box.y + entry.box.height / 2
    const last = lines[lines.length - 1]
    const tolerance = Math.max(8, entry.box.height * 0.6, last ? last.averageHeight * 0.6 : 0)
    if (!last || Math.abs(centerY - last.centerY) > tolerance) {
      lines.push({ entries: [entry], centerY, averageHeight: Math.max(entry.box.height, 1) })
      return
    }
    last.entries.push(entry)
    last.centerY = last.entries.reduce((sum, value) => sum + value.box.y + value.box.height / 2, 0) / last.entries.length
    last.averageHeight = last.entries.reduce((sum, value) => sum + Math.max(value.box.height, 1), 0) / last.entries.length
  })
  const result = lines.flatMap(line => line.entries.sort((a, b) => a.box.x - b.box.x || a.item.order - b.item.order).map(entry => entry.item))
  return result.concat(missing.sort((a, b) => a.order - b.order))
}

function detections(response, pageIndex) {
  const items = (response && response.TextDetections || []).map((item, order) => ({
    pageIndex,
    order,
    text: String(item.DetectedText || '').trim(),
    confidence: finiteNumber(item.Confidence === undefined ? 80 : item.Confidence) / 100,
    polygon: normalizedPolygon(item.Polygon),
    itemPolygon: normalizedItemPolygon(item.ItemPolygon)
  })).filter(item => item.text)
  return sortPageItems(items)
}

async function recognizeImage(client, buffer, pageIndex = 0) {
  const request = { ImageBase64: buffer.toString('base64') }
  const response = await callOcrWithRetry(client.GeneralAccurateOCR.bind(client), request)
  return {
    pageIndex,
    angle: finiteNumber(response && response.Angle),
    items: detections(response, pageIndex)
  }
}

module.exports = {
  callOcrWithRetry,
  detections,
  isTransientOcrError,
  recognizeImage,
  sortPageItems
}
