const { callRentalDomain, successResult, errorResult } = require('../../_shared/domain-client')

async function searchHouses(params = {}) {
  console.info('[ai-mode] house-skill searchHouses params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('searchHouses', {
      keyword: params.keyword || '',
      status: params.status || ''
    })
    const houses = (data && data.houses) || []
    const text = houses.length > 0
      ? `找到 ${houses.length} 套房：${houses.map(h => `${h.label || ''}（¥${h.rent || 0}）`).join('、')}`
      : '没有找到匹配的房屋。'
    return successResult(text, data)
  } catch (err) {
    console.error('[ai-mode] house-skill searchHouses error:', err.message)
    return errorResult('查询房屋列表失败：' + err.message)
  }
}

async function getHouseAvailability(params = {}) {
  try {
    const mode = params.mode === 'rented' ? 'rented' : 'available'
    const data = await callRentalDomain('getHouseAvailability', { mode })
    const houses = data.houses || []
    return successResult(`${mode === 'rented' ? '已出租' : '未出租'}房屋共 ${houses.length} 套。`, { title: mode === 'rented' ? '已出租房屋' : '未出租房屋', fields: houses.map(item => ({ label: item.label, value: mode === 'rented' ? `租客：${item.tenantName || '—'}` : `¥${item.rent}/月` })) })
  } catch (err) { return errorResult('查询房屋状态失败：' + err.message) }
}

async function getHouseDetail(params = {}) {
  console.info('[ai-mode] house-skill getHouseDetail params=', JSON.stringify(params || {}))
  try {
    const { houseId } = params
    if (!houseId) return errorResult('缺少房屋 ID。')
    const data = await callRentalDomain('getHouseDetail', { houseId })
    const house = data && data.house
    if (!house) return errorResult('未找到该房屋。')
    const fields = [
      { label: '编号', value: house.code || '—' },
      { label: '地址', value: house.address || '—' },
      { label: '月租', value: `¥${house.rent || 0}` },
      { label: '状态', value: house.statusText || house.status || '—' }
    ]
    const text = `${house.address || ''}${house.code || ''}，月租 ¥${house.rent || 0}，${house.statusText || house.status || ''}`
    return successResult(text, { title: '房屋详情', subtitle: house.label || '', fields })
  } catch (err) {
    console.error('[ai-mode] house-skill getHouseDetail error:', err.message)
    return errorResult('查询房屋详情失败：' + err.message)
  }
}

async function previewCreateHouse(params = {}) {
  let code = String(params.code || '').trim()
  let address = String(params.address || '').trim()
  // 普通页面地址是固定楼栋枚举，AI 常将“东楼211”整体误填到两个字段。
  // 仅对当前页面已支持的楼栋做确定性拆分，未知地址不猜测。
  const buildingAliases = {
    东楼: '东楼', 都楼: '东楼', 东lou: '东楼', 东路: '东楼',
    里召: '里召', 李召: '里召', 里照: '里召'
  }
  const knownBuilding = /^(东楼|都楼|东lou|东路|里召|李召|里照)\s*([A-Za-z]?\d+)$/i
  const compound = knownBuilding.exec(code) || knownBuilding.exec(address)
  if (compound) {
    address = buildingAliases[compound[1]] || compound[1]
    code = compound[2]
  }
  const rent = params.rent === '' || params.rent === undefined ? '' : Number(params.rent)
  if (!code) return errorResult('请先提供房屋编号。')
  if (!address) return errorResult('请先提供房屋地址。')
  if (!Number.isFinite(rent) || rent <= 0) return errorResult('请提供大于 0 的月租金。')
  const fields = { code, address, rent, status: params.status || 'available' }
  return { isError: false, content: [{ type: 'text', text: '已整理房屋信息，请点击下方小程序卡片核对并创建。' }], structuredContent: { mode: 'create_house', fields, missingFields: [] }, handoff: { query: 'mode=create_house', payload: { mode: 'create_house', fields } } }
}

async function confirmCreateHouse(params = {}) {
  console.info('[ai-mode] house-skill confirmCreateHouse params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('confirmCreateHouse', params)
    return successResult('房屋新增成功。', data)
  } catch (err) {
    console.error('[ai-mode] house-skill confirmCreateHouse error:', err.message)
    return errorResult('新增房屋失败：' + err.message)
  }
}

module.exports = { searchHouses, getHouseAvailability, getHouseDetail, previewCreateHouse, confirmCreateHouse }
