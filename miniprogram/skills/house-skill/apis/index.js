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
  console.info('[ai-mode] house-skill previewCreateHouse params=', JSON.stringify(params || {}))
  try {
    const data = await callRentalDomain('previewCreateHouse', params)
    return successResult('已生成新增房屋确认卡，请核对后确认。', data)
  } catch (err) {
    console.error('[ai-mode] house-skill previewCreateHouse error:', err.message)
    return errorResult('预览新增房屋失败：' + err.message)
  }
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

module.exports = { searchHouses, getHouseDetail, previewCreateHouse, confirmCreateHouse }
