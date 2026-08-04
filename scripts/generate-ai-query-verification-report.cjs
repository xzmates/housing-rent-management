/*
 * AI 查询 Skill 自然语言测试：四层校验 + 逐条 PASS/FAIL 报告生成器（v2，修正 Spec）。
 * 数据来源：2026-07-31 全量重跑 raw-results + CloudBase MCP 只读 Ground Truth fixture。
 * 四层：意图(正确 Query API) / 参数(对象·时间·类型) / 数据(Ground Truth 数量金额日期) / 回答(完整·准确·防幻觉·限制说明)。
 */
const fs = require('fs')
const path = require('path')

const root = path.resolve(__dirname, '..')
const source = path.join(root, 'docs', 'ai-query-natural-language-raw-results-20260731.json')
const gtPath = path.join(root, 'docs', 'ai-query-natural-language-ground-truth-20260731.json')
const target = path.join(root, 'docs', 'ai-query-natural-language-test-report.md')
const gt = JSON.parse(fs.readFileSync(gtPath, 'utf8'))
const data = JSON.parse(fs.readFileSync(source, 'utf8'))
const results = data.results || []

const isWrite = name => /^(create|confirm|pay|terminate|preview|settle|record|collect)/i.test(name || '')
const esc = v => String(v ?? '—').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
const has = (text, token) => {
  if (!text) return false
  if (token instanceof RegExp) { token.lastIndex = 0; return token.test(text) }
  return text.includes(String(token))
}

// ---------- 预期 Spec ----------
// params: [{ tool, key, val }]；仅当该 tool 被实际调用时校验参数
// facts: 回答 finalText 必须包含的子串/正则（若空则由 absence/limit 兜底）
// absence: 回答必须出现的“无记录/空结果”表达（至少一个，用于空结果场景）
// limit: 数据不足时回答必须出现的限制表达（至少一个）
// anti: 回答不得出现的子串
const S = [
  // ---- 房屋 ----
  { id: 'H01', tools: ['searchHouses'], params: [{ tool: 'searchHouses', key: 'status', val: 'rented' }], facts: ['5'], gt: '已出租 5 套：202/203/NLTEST-2802/2803/2810' },
  { id: 'H02', tools: ['searchHouses'], params: [{ tool: 'searchHouses', key: 'status', val: 'rented' }], facts: ['5'], gt: '出租中 5 套' },
  { id: 'H03', tools: ['searchHouses'], params: [{ tool: 'searchHouses', key: 'status', val: 'rented' }], facts: ['5'], gt: '有人住 5 套' },
  { id: 'H04', tools: ['searchHouses', 'getActiveLeases', 'getOperatingOverview'], params: [], facts: ['5'], gt: '有效合同房屋 5 套' },
  { id: 'H05', tools: ['searchHouses', 'getOperatingOverview'], params: [{ tool: 'searchHouses', key: 'status', val: 'available' }], facts: ['28'], gt: '未出租 28 套' },
  { id: 'H06', tools: ['searchHouses', 'getOperatingOverview'], params: [{ tool: 'searchHouses', key: 'status', val: 'available' }], facts: ['28'], gt: '空房 28 套' },
  { id: 'H07', tools: ['searchHouses', 'getOperatingOverview'], params: [{ tool: 'searchHouses', key: 'status', val: 'available' }], facts: ['28'], gt: '无有效合同 28 套' },
  { id: 'H08', tools: ['getHouseDetailByKeyword', 'searchHouses', 'getHouseProfileByKeyword'], params: [{ tool: 'getHouseDetailByKeyword', key: 'keyword', val: 'NLTEST-2810' }], facts: ['NLTEST-2810', '租'], gt: 'NLTEST-2810 已租' },
  { id: 'H09', tools: ['getHouseDetailByKeyword', 'searchHouses', 'getHouseProfileByKeyword'], params: [{ tool: 'getHouseDetailByKeyword', key: 'keyword', val: 'NLTEST-2810' }], facts: ['NL测试欠费租客', 'NLTEST-2810'], gt: '当前租客 NL测试欠费租客' },
  { id: 'H10', tools: ['getHouseDetailByKeyword', 'getHouseProfileByKeyword'], params: [{ tool: 'getHouseDetailByKeyword', key: 'keyword', val: 'NLTEST-2810' }], facts: ['NLTEST-2810', 'NL测试欠费租客'], gt: '房屋+租客+合同概况' },
  { id: 'H11', tools: ['getHouseDetailByKeyword', 'getHouseProfileByKeyword'], params: [{ tool: 'getHouseDetailByKeyword', key: 'keyword', val: 'NLTEST-2810' }], facts: ['NLTEST-2810', 'NL测试欠费租客'], gt: '租赁情况：租客+合同 2026-05-01~12-31' },
  { id: 'H12', tools: ['getHouseDetailByKeyword', 'getHouseProfileByKeyword'], params: [{ tool: 'getHouseDetailByKeyword', key: 'keyword', val: 'NLTEST-2810' }], facts: ['NL测试欠费租客', '2026-05-01', '2026-12-31'], gt: '租客+合同起止 2026-05-01~12-31' },
  { id: 'H13', tools: ['getHouseDetailByKeyword', 'getHouseProfileByKeyword'], params: [{ tool: 'getHouseDetailByKeyword', key: 'keyword', val: 'NLTEST-2810' }], facts: ['1000'], gt: '月租 1000，押金 0' },
  { id: 'H14', tools: ['getHouseDetailByKeyword', 'getHouseProfileByKeyword', 'searchHouses'], params: [{ tool: 'getHouseDetailByKeyword', key: 'keyword', val: 'NLTEST-2801' }], facts: ['NLTEST-2801', '空'], gt: 'NLTEST-2801 空房无人住' },
  { id: 'H15', tools: ['getHouseDetailByKeyword', 'getHouseProfileByKeyword'], params: [{ tool: 'getHouseDetailByKeyword', key: 'keyword', val: 'NLTEST-2801' }], facts: ['NLTEST-2801', '空'], gt: '无生效合同→空房' },
  { id: 'H16', tools: ['getHouseProfileByKeyword', 'getHouseDetailByKeyword'], params: [{ tool: 'getHouseProfileByKeyword', key: 'keyword', val: 'NLTEST-2801' }], facts: ['NLTEST-2801'], absence: ['没有', '无', '不存在'], gt: 'NLTEST-2801 无历史合同→无最后合同' },
  { id: 'H17', tools: ['getHouseProfileByKeyword', 'getHouseDetailByKeyword'], params: [{ tool: 'getHouseProfileByKeyword', key: 'keyword', val: 'NLTEST-2801' }], facts: ['NLTEST-2801'], absence: ['没有', '无', '暂无'], gt: 'NLTEST-2801 无历史租客' },
  { id: 'H18', tools: ['getHouseProfileByKeyword', 'getHouseDetailByKeyword'], params: [{ tool: 'getHouseProfileByKeyword', key: 'keyword', val: 'NLTEST-2901' }], facts: ['NLTEST-2901', 'NL测试历史甲', 'NL测试退租结算租客'], gt: '历史租客：NL测试历史甲、NL测试退租结算租客' },
  { id: 'H19', tools: ['getHouseProfileByKeyword', 'getHouseDetailByKeyword'], params: [{ tool: 'getHouseProfileByKeyword', key: 'keyword', val: 'NLTEST-2901' }], facts: ['NL测试历史甲', 'NL测试退租结算租客'], gt: '全部历史租客 2 位' },
  { id: 'H20', tools: ['getHouseProfileByKeyword', 'getHouseDetailByKeyword'], params: [{ tool: 'getHouseProfileByKeyword', key: 'keyword', val: 'NLTEST-2901' }], facts: ['NL测试历史甲', 'NL测试退租结算租客'], gt: '最近租客 2 位' },
  { id: 'H21', tools: ['getHouseProfileByKeyword', 'getHouseDetailByKeyword'], params: [{ tool: 'getHouseProfileByKeyword', key: 'keyword', val: 'NLTEST-2901' }], facts: ['2'], gt: '历史出租 2 次' },
  { id: 'H22', tools: ['getHouseProfileByKeyword', 'getHouseDetailByKeyword'], params: [{ tool: 'getHouseProfileByKeyword', key: 'keyword', val: 'NLTEST-2901' }], facts: ['NL测试历史甲', 'NL测试退租结算租客'], gt: '历史合同按时间排序' },
  // ---- 租客 ----
  { id: 'T01', tools: ['getActiveLeases', 'searchTenants', 'getOperatingOverview'], params: [], facts: ['5'], gt: '在住租客 5 位' },
  { id: 'T02', tools: ['getActiveLeases', 'searchTenants'], params: [], facts: ['5', '阿东', '小晶'], gt: '在住租客：阿东、小晶、NL测试短租到期/正常缴费/欠费租客' },
  { id: 'T03', tools: ['getActiveLeases', 'searchTenants'], params: [], facts: ['5'], gt: '有效合同租客 5 位' },
  { id: 'T04', tools: ['getTenantDetailByKeyword', 'searchTenants', 'getActiveLeases'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['NL测试正常缴费租客', '住'], gt: '在住' },
  { id: 'T05', tools: ['getTenantDetailByKeyword', 'searchTenants', 'getActiveLeases'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['NLTEST-2803'], gt: '住 NLTEST-2803' },
  { id: 'T06', tools: ['getTenantDetailByKeyword', 'searchTenants', 'getActiveLeases'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['2026-07-01'], gt: '2026-07-01 入住' },
  { id: 'T07', tools: ['getTenantDetailByKeyword', 'searchTenants', 'getActiveLeases'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['2026-12-31'], gt: '合同 2026-12-31 到期' },
  { id: 'T08', tools: ['getTenantDetailByKeyword', 'searchTenants'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['NL测试正常缴费租客', '13900002802', 'NLTEST-ID-2802'], gt: '资料：手机13900002802、身份证NLTEST-ID-2802' },
  { id: 'T09', tools: ['getTenantDetailByKeyword', 'searchTenants'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['13900002802'], gt: '手机 13900002802' },
  { id: 'T10', tools: ['getTenantDetailByKeyword', 'searchTenants'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['NLTEST-ID-2802'], gt: '身份证 NLTEST-ID-2802' },
  { id: 'T11', tools: ['getTenantDetailByKeyword', 'searchTenants', 'getActiveLeases'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试历史甲' }], facts: ['退租', 'NL测试历史甲'], absence: ['退租', '不在', '没'], gt: '历史甲已退租（inactive）' },
  { id: 'T12', tools: ['getTenantDetailByKeyword', 'searchTenants'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试历史甲' }], facts: ['NLTEST-2901'], gt: '曾住 NLTEST-2901' },
  { id: 'T13', tools: ['getTenantDetailByKeyword', 'searchTenants'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试历史甲' }], facts: ['NL测试历史甲'], limit: ['无法确认', '无法确定', '不能确定', '没有记录', '未记录', '不足以'], gt: 'L03 无 actualMoveOutDate→必须说明无法确认实际搬离日' },
  { id: 'T14', tools: ['getTenantDetailByKeyword', 'searchTenants'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试多合同租客' }], facts: ['2'], gt: '租过 2 次（两份历史合同）' },
  { id: 'T15', tools: ['getTenantDetailByKeyword', 'searchTenants'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试多合同租客' }], facts: ['NLTEST-2902', 'NLTEST-2903'], gt: '历史合同：NLTEST-2902、NLTEST-2903' },
  // ---- 合同 ----
  { id: 'C01', tools: ['getActiveLeases'], params: [], facts: ['5'], gt: '有效合同 5 份' },
  { id: 'C02', tools: ['getActiveLeases'], params: [], facts: ['5'], gt: '有效合同 5 份列表' },
  { id: 'C03', tools: ['getHouseDetailByKeyword', 'getActiveLeases'], params: [{ tool: 'getHouseDetailByKeyword', key: 'keyword', val: 'NLTEST-2810' }], facts: ['2026-05-01', '2026-12-31'], gt: 'NLTEST-2810 合同 2026-05-01~12-31' },
  { id: 'C04', tools: ['getTenantDetailByKeyword', 'getActiveLeases', 'getLeaseReport'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['2026-07-01', '2026-12-31', '800'], gt: '合同 2026-07-01~12-31，租金/押金 800' },
  { id: 'C05', tools: ['getRelativeLeaseExpiry'], params: [{ tool: 'getRelativeLeaseExpiry', key: 'mode', val: 'relative' }], facts: ['2026-08-03', 'NLTEST-2802'], gt: '未来7天到期：NLTEST-2802 2026-08-03' },
  { id: 'C06', tools: ['getRelativeLeaseExpiry'], params: [{ tool: 'getRelativeLeaseExpiry', key: 'mode', val: 'relative' }], facts: ['2026-08-03'], gt: '未来10天到期：NLTEST-2802' },
  { id: 'C07', tools: ['getRelativeLeaseExpiry'], params: [{ tool: 'getRelativeLeaseExpiry', key: 'mode', val: 'relative' }], facts: ['2026-08-03'], gt: '未来30天到期：NLTEST-2802' },
  { id: 'C08', tools: ['getRelativeLeaseExpiry'], params: [{ tool: 'getRelativeLeaseExpiry', key: 'mode', val: 'relative' }], facts: ['2026-08-03'], gt: '下月到期：NLTEST-2802' },
  { id: 'C09', tools: ['getRelativeLeaseExpiry', 'getActiveLeases'], params: [], facts: ['2026-08-03'], gt: '今年到期：NLTEST-2802 08-03' },
  { id: 'C10', tools: ['getRelativeLeaseExpiry', 'getActiveLeases'], params: [], facts: ['2026-08-03'], gt: '最先到期：NLTEST-2802 2026-08-03' },
  { id: 'C11', tools: ['getContractOverview', 'getActiveLeases'], params: [], facts: [], absence: ['没有', '0份', /0\s*(?:元|人|份|笔|个)/], gt: '到期仍有效合同：0 份' },
  { id: 'C12', tools: ['getContractOverview', 'getActiveLeases'], params: [], facts: [], absence: ['没有', '0份', /0\s*(?:元|人|份|笔|个)/], gt: '同房屋双有效合同：不存在' },
  { id: 'C13', tools: ['getContractOverview', 'getActiveLeases'], params: [], facts: [], absence: ['没有', '0份', /0\s*(?:元|人|份|笔|个)/], gt: '同租客多份有效入住合同：不存在' },
  // ---- 入住 / 部分付款 ----
  { id: 'A01', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: [], absence: ['没有', '无', /0\s*(?:元|人|份|笔|个)/], gt: '今天无入住' },
  { id: 'A02', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: [], absence: ['没有', '无', /0\s*(?:元|人|份|笔|个)/], gt: '昨天无入住' },
  { id: 'A03', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: ['2', 'NL测试'], gt: '本月入住 2：短租到期、正常缴费' },
  { id: 'A04', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: ['NL测试退租结算租客'], gt: '上月入住：NL测试退租结算租客（06-20）' },
  { id: 'A05', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: ['6'], gt: '今年入住 6 人' },
  { id: 'A06', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: ['4', '小晶'], gt: '去年入住 4 人：小晶、历史甲、多合同×2' },
  { id: 'A07', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: [], absence: ['没有', '无', /0\s*(?:元|人|份|笔|个)/], gt: '最近7天无入住' },
  { id: 'A08', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: ['2', 'NL测试'], gt: '最近30天入住 2 位' },
  { id: 'A09', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [{ tool: 'listGlobalMoveInOutForRelativePeriod', key: 'period', val: 'this_month' }], facts: ['NL测试短租到期租客', 'NL测试正常缴费租客'], gt: '2026-07 入住 2 位' },
  { id: 'A10', tools: ['listGlobalMoveInOutByDateRange', 'listGlobalMoveInOutForRelativePeriod'], params: [], facts: ['NL测试短租到期租客', 'NL测试正常缴费租客'], gt: '2026-07-01 入住 2 位' },
  { id: 'A11', tools: ['listGlobalMoveInOutByDateRange', 'listGlobalMoveInOutForRelativePeriod'], params: [{ tool: 'listGlobalMoveInOutByDateRange', key: 'startDate', val: '2026-01-01' }], facts: ['4'], gt: '2026-01~06 入住 4 人' },
  { id: 'A12', tools: ['listGlobalMoveInOutByDateRange', 'listGlobalMoveInOutForRelativePeriod'], params: [{ tool: 'listGlobalMoveInOutByDateRange', key: 'startDate', val: '2026-03-01' }], facts: ['阿东', 'NL测试欠费租客'], gt: '03-01~05-31 入住：阿东、NL测试欠费租客' },
  { id: 'A13', tools: ['getTenantArrearsByKeyword', 'getArrearsReport'], params: [{ tool: 'getTenantArrearsByKeyword', key: 'keyword', val: 'NL测试欠费租客' }], facts: ['1820'], gt: '欠费 1820（600剩余+1000+220）' },
  { id: 'A14', tools: ['getTenantArrearsByKeyword', 'getArrearsReport'], params: [{ tool: 'getTenantArrearsByKeyword', key: 'keyword', val: 'NL测试欠费租客' }], facts: ['2220', '1820'], gt: '应付2220、已付400、剩1820' },
  { id: 'A15', tools: ['getTenantArrearsByKeyword', 'getArrearsReport'], params: [{ tool: 'getTenantArrearsByKeyword', key: 'keyword', val: 'NL测试欠费租客' }], facts: ['1000', '600'], gt: '部分付款：租金应付1000已付400' },
  { id: 'A16', tools: ['getTenantArrearsByKeyword', 'getArrearsReport'], params: [{ tool: 'getTenantArrearsByKeyword', key: 'keyword', val: 'NL测试欠费租客' }], facts: ['1820'], gt: '总欠款 1820' },
  // ---- 退租时间 ----
  { id: 'M01', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: [], absence: ['没有', '无', /0\s*(?:元|人|份|笔|个)/], gt: '今天无退租' },
  { id: 'M02', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: [], absence: ['没有', '无', /0\s*(?:元|人|份|笔|个)/], gt: '昨天无退租' },
  { id: 'M03', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: [], absence: ['没有', '无', /0\s*(?:元|人|份|笔|个)/], gt: '本周(07-27~08-02)无退租' },
  { id: 'M04', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: [], absence: ['没有', '无', /0\s*(?:元|人|份|笔|个)/], gt: '上月(06)无退租' },
  { id: 'M05', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: ['3'], gt: '今年退租 3：麦粥07-23、历史甲01-01、退租结算07-18' },
  { id: 'M06', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: ['2', 'NL测试多合同租客'], gt: '去年退租 2 次：NL测试多合同租客（2025-06-30、12-31）' },
  { id: 'M07', tools: ['listGlobalMoveInOutForRelativePeriod', 'listGlobalMoveInOutByDateRange'], params: [], facts: ['NL测试退租结算租客'], gt: '最近30天退租：NL测试退租结算租客' },
  { id: 'M08', tools: ['listGlobalMoveInOutByDateRange', 'listGlobalMoveInOutForRelativePeriod'], params: [], facts: ['NL测试历史甲'], gt: '2026-01~06 退租：NL测试历史甲（01-01）' },
  // ---- 缴费历史 ----
  { id: 'P01', tools: ['getTenantPaymentHistoryByKeyword', 'getLeasePaymentHistory'], params: [{ tool: 'getTenantPaymentHistoryByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['1766'], gt: '付款总额 1766' },
  { id: 'P02', tools: ['getTenantPaymentHistoryByKeyword', 'getLeasePaymentHistory'], params: [{ tool: 'getTenantPaymentHistoryByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['1766', '166', '800'], gt: '今年付款：租金800+水电166+押金800' },
  { id: 'P03', tools: ['getTenantPaymentHistoryByKeyword', 'getLeasePaymentHistory'], params: [{ tool: 'getTenantPaymentHistoryByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['166'], gt: '本月已缴水电166（07-28）' },
  { id: 'P04', tools: ['getTenantPaymentHistoryByKeyword', 'getLeasePaymentHistory'], params: [{ tool: 'getTenantPaymentHistoryByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['1766'], gt: '入住以来付款 1766' },
  { id: 'P05', tools: ['getTenantPaymentHistoryByKeyword', 'getLeasePaymentHistory'], params: [{ tool: 'getTenantPaymentHistoryByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['1766', '166', '800'], gt: '付款明细：166水电+800租金+800押金=1766' },
  { id: 'P06', tools: ['getHousePaymentHistoryByKeyword', 'getFinancialReport'], params: [{ tool: 'getHousePaymentHistoryByKeyword', key: 'keyword', val: 'NLTEST-2803' }], facts: ['1766'], gt: 'NLTEST-2803 付款 1766' },
  { id: 'P07', tools: ['getTenantPaymentHistoryByKeyword', 'getLeasePaymentHistory'], params: [{ tool: 'getTenantPaymentHistoryByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['800'], gt: '今年租金 800' },
  { id: 'P08', tools: ['getTenantPaymentHistoryByKeyword', 'getLeasePaymentHistory'], params: [{ tool: 'getTenantPaymentHistoryByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['166'], gt: '今年水电 166' },
  { id: 'P09', tools: ['getTenantPaymentHistoryByKeyword', 'getLeasePaymentHistory'], params: [{ tool: 'getTenantPaymentHistoryByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['押金', '800'], gt: '除房租外：押金800（另有水电166）' },
  // ---- 欠费 / 账龄 ----
  { id: 'D01', tools: ['getArrearsReport'], params: [], facts: ['6500'], anti: ['5680'], gt: '总欠费 6500、8笔；阿东明细 4680（680+4×1000）' },
  { id: 'D02', tools: ['getArrearsReport', 'getTenantArrearsByKeyword'], params: [], facts: ['6500', '8'], gt: '未缴账单 8 笔 6500' },
  { id: 'D03', tools: ['getArrearsReport'], params: [], facts: ['6500'], gt: '总欠费 6500' },
  { id: 'D04', tools: ['getArrearsReport'], params: [], facts: ['阿东', 'NL测试欠费租客'], gt: '欠房租：阿东、NL测试欠费租客' },
  { id: 'D05', tools: ['getArrearsReport'], params: [], facts: ['阿东', 'NL测试欠费租客'], anti: ['5680'], gt: '未结清：阿东、NL测试欠费租客；阿东 4680' },
  { id: 'D06', tools: ['getTenantArrearsByKeyword', 'getArrearsReport'], params: [{ tool: 'getTenantArrearsByKeyword', key: 'keyword', val: 'NL测试欠费租客' }], facts: ['水电', '租金', '1820'], gt: '欠费构成：租金1000已付400剩600、租金1000、水电220' },
  { id: 'D07', tools: ['getTenantArrearsByKeyword', 'getArrearsReport'], params: [{ tool: 'getTenantArrearsByKeyword', key: 'keyword', val: 'NL测试欠费租客' }], facts: ['3'], gt: '3 笔未付' },
  { id: 'D08', tools: ['getTenantArrearsByKeyword', 'getArrearsReport'], params: [{ tool: 'getTenantArrearsByKeyword', key: 'keyword', val: 'NL测试欠费租客' }], facts: ['1000', '91'], gt: '最早欠款：2026-05 租金1000，逾期91天' },
  { id: 'D09', tools: ['getTenantArrearsByKeyword', 'getArrearsReport'], params: [{ tool: 'getTenantArrearsByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: [], absence: ['没有', '无', /0\s*(?:元|人|份|笔|个)/], gt: '正常缴费租客无欠费' },
  { id: 'D10', tools: ['getArrearsReport'], params: [], facts: ['阿东', 'NL测试欠费租客'], gt: '欠费>7天：阿东、NL测试欠费租客' },
  { id: 'D11', tools: ['getArrearsReport'], params: [], facts: ['阿东', 'NL测试欠费租客'], gt: '欠费>30天：阿东、NL测试欠费租客' },
  { id: 'D12', tools: ['getArrearsReport'], params: [], facts: ['阿东'], gt: '欠费>60天：阿东（2026-04~05）' },
  // ---- 未来应收 ----
  { id: 'F01', tools: ['getRelativeFutureReceivables'], params: [{ tool: 'getRelativeFutureReceivables', key: 'period', val: 'next_7_days' }], facts: ['1480', '680', '800'], gt: '未来7天 1480：小晶水电680+租金800' },
  { id: 'F02', tools: ['getRelativeFutureReceivables'], params: [{ tool: 'getRelativeFutureReceivables', key: 'period', val: 'next_10_days' }], facts: ['1480'], gt: '未来10天 1480' },
  { id: 'F03', tools: ['getRelativeFutureReceivables'], params: [{ tool: 'getRelativeFutureReceivables', key: 'period', val: 'next_week' }], facts: ['1480', '680', '800'], gt: '下周 1480' },
  { id: 'F04', tools: ['getRelativeFutureReceivables'], params: [{ tool: 'getRelativeFutureReceivables', key: 'period', val: 'next_30_days' }], facts: ['1480'], gt: '未来30天应收 1480' },
  { id: 'F05', tools: ['getArrearsReport', 'getRelativeFutureReceivables'], params: [], facts: ['6500'], gt: '已逾期 6500、8笔' },
  // ---- 实际收款 ----
  { id: 'R01', tools: ['getFinancialReport', 'getOperatingOverview'], params: [], facts: ['0'], gt: '今天(07-30)实收 0（getFinancialReport 按当天区间）' },
  { id: 'R02', tools: ['getFinancialReport', 'getOperatingOverview'], params: [], facts: ['0'], gt: '昨天(07-29)实收 0' },
  { id: 'R03', tools: ['getFinancialReport', 'getOperatingOverview'], params: [], facts: ['19146'], gt: '本月实收 19146' },
  { id: 'R04', tools: ['getFinancialReport'], params: [{ tool: 'getFinancialReport', key: 'startDate', val: '2026-06-01' }], facts: ['8300'], gt: '上月实收 8300' },
  { id: 'R05', tools: ['getFinancialReport'], params: [{ tool: 'getFinancialReport', key: 'startDate', val: '2026-01-01' }], facts: ['27446', '22746'], gt: '今年实收 27446（经营22746）' },
  { id: 'R06', tools: ['getFinancialReport'], params: [{ tool: 'getFinancialReport', key: 'startDate', val: '2025-01-01' }], facts: ['12230', '11550', '680'], gt: '去年实收 12230' },
  { id: 'R07', tools: ['getFinancialReport'], params: [{ tool: 'getFinancialReport', key: 'startDate', val: '2026-07-01' }], facts: ['19146', '15446'], gt: '2026-07 实收 19146（经营15446）' },
  { id: 'R08', tools: ['getFinancialReport'], params: [{ tool: 'getFinancialReport', key: 'startDate', val: '2026-01-01' }], facts: ['8300'], gt: '2026-01~06 实收 8300' },
  { id: 'R09', tools: ['getFinancialReport'], params: [{ tool: 'getFinancialReport', key: 'startDate', val: '2026-03-01' }], facts: ['0'], gt: '03-01~05-31 实收 0' },
  { id: 'R10', tools: [], params: [], facts: [], rejectInverted: true, gt: '倒置日期范围→必须拒绝，不得自动交换日期并查询' },
  // ---- 收入来源 ----
  { id: 'I01', tools: ['getFinancialReport', 'getOperatingOverview'], params: [], facts: ['14600', '846', '19146'], gt: '本月来源：租金14600+水电846，押金3700另列' },
  { id: 'I02', tools: ['getFinancialReport'], params: [], facts: ['21900'], gt: '今年租金 21900' },
  { id: 'I03', tools: ['getFinancialReport'], params: [], facts: ['846'], gt: '今年水电 846' },
  { id: 'I04', tools: ['getFinancialReport'], params: [], facts: ['21900', '846', '27446'], gt: '今年各类费用：租金21900+水电846' },
  // ---- 押金 / 退租 / 房损 / 退款 ----
  { id: 'S01', tools: ['getTenantDetailByKeyword', 'getLeaseReport'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['800'], gt: '合同押金 800' },
  { id: 'S02', tools: ['getTenantPaymentHistoryByKeyword', 'getLeasePaymentHistory'], params: [{ tool: 'getTenantPaymentHistoryByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['800'], gt: '实际押金 800（有 payment 证据）' },
  { id: 'S03', tools: ['getSettlementReport'], params: [{ tool: 'getSettlementReport', key: 'keyword', val: 'NL测试退租结算租客' }], facts: ['580', '300', '120'], gt: '退租结算：押金1000-房损300-水电120=退款580' },
  { id: 'S04', tools: ['getSettlementReport'], params: [{ tool: 'getSettlementReport', key: 'keyword', val: 'NL测试退租结算租客' }], facts: ['300', '120'], gt: '扣款：房损300+水电120' },
  { id: 'S05', tools: ['getSettlementReport'], params: [{ tool: 'getSettlementReport', key: 'keyword', val: 'NL测试退租结算租客' }], facts: ['580'], gt: '退租退款 580' },
  { id: 'S06', tools: ['getSettlementReport'], params: [{ tool: 'getSettlementReport', key: 'keyword', val: 'NL测试退租结算租客' }], facts: ['不'], absence: ['不', '无', '0'], gt: '无需补钱（现金结算0）' },
  { id: 'S07', tools: ['getSettlementReport'], params: [{ tool: 'getSettlementReport', key: 'keyword', val: 'NL测试退租结算租客' }], facts: ['120'], gt: '退租水电 120' },
  { id: 'S08', tools: ['getSettlementReport', 'getTenantDetailByKeyword'], params: [{ tool: 'getSettlementReport', key: 'keyword', val: 'NL测试多合同租客' }], facts: ['450'], gt: '房损 450' },
  { id: 'S09', tools: ['getSettlementReport', 'getTenantDetailByKeyword'], params: [{ tool: 'getSettlementReport', key: 'keyword', val: 'NL测试多合同租客' }], facts: ['450'], limit: ['无法确认', '不能证明', '没有付款', '不足以'], gt: '房损 450，无付款证据' },
  { id: 'S10', tools: ['getSettlementReport', 'getFinancialReport'], params: [{ tool: 'getSettlementReport', key: 'keyword', val: 'NL测试多合同租客' }], facts: ['450'], limit: ['无法确认', '不能证明', '没有付款', '不足以', '0'], gt: '房损 450 但无实际到账证据' },
  { id: 'S11', tools: ['getFinancialReport', 'getSettlementReport'], params: [], facts: ['580'], gt: '今年退款 580' },
  { id: 'S12', tools: ['getSettlementReport'], params: [{ tool: 'getSettlementReport', key: 'keyword', val: 'NL测试退租结算租客' }], facts: ['580'], gt: '实际退款 580' },
  // ---- 综合 / 经营 ----
  { id: 'O01', tools: ['getHouseDetailByKeyword', 'getHouseProfileByKeyword'], params: [{ tool: 'getHouseDetailByKeyword', key: 'keyword', val: 'NLTEST-2810' }], facts: ['NLTEST-2810', 'NL测试欠费租客', '1000'], gt: '房屋档案：租客+合同+租金' },
  { id: 'O02', tools: ['getTenantDetailByKeyword'], params: [{ tool: 'getTenantDetailByKeyword', key: 'keyword', val: 'NL测试正常缴费租客' }], facts: ['NL测试正常缴费租客', 'NLTEST-2803', '800'], gt: '租客档案：身份+房屋+合同+缴费' },
  { id: 'O03', tools: ['getOperatingOverview', 'getArrearsReport'], params: [], facts: ['33', '5', '28', '6500', '1480', '19146'], anti: ['5680'], gt: '经营概况：33房/5租/28空/6500欠/1480应收/19146收' },
  { id: 'O04', tools: ['searchHouses', 'getOperatingOverview'], params: [], facts: ['5', '28'], gt: '出租情况：5租28空' },
  { id: 'O05', tools: ['getOperatingOverview'], params: [], facts: ['33', '5', '28', '6500', '1480'], anti: ['5680'], gt: '出租经营概况：33/5/28/6500/1480' },
  // ---- 边界 / 空结果 ----
  { id: 'E01', tools: ['searchHouses', 'getHouseDetailByKeyword'], params: [], facts: ['没有找到', '不存在', '没有'], absence: ['没有找到', '不存在', '没有'], gt: '不存在房屋→明确未找到' },
  { id: 'E02', tools: ['searchTenants', 'getTenantDetailByKeyword'], params: [], facts: ['没有找到', '不存在', '没有'], absence: ['没有找到', '不存在', '没有'], gt: '不存在租客→明确未找到' },
  { id: 'E03', tools: ['searchTenants', 'getTenantDetailByKeyword'], params: [], facts: ['2', '13900002904', '13900002905'], gt: '同名→返回两个候选' },
  { id: 'E04', tools: ['listGlobalMoveInOutByDateRange', 'listGlobalMoveInOutForRelativePeriod'], params: [], facts: [], absence: ['没有', '无', /0\s*(?:元|人|份|笔|个)/], gt: '2026-02 无入住' },
]

const byId = new Map(results.map(r => [r.id, r]))
const specById = new Map(S.map(s => [s.id, s]))

function checkParams(calls, params) {
  if (!params.length) return { ok: true, detail: '—' }
  for (const p of params) {
    const hitCall = calls.find(c => c.name === p.tool)
    if (!hitCall) continue // 该 tool 未调用则不校验（由意图层兜底）
    const argOk = hitCall.arguments && typeof hitCall.arguments[p.key] !== 'undefined' &&
      (typeof p.val === 'number' ? Number(hitCall.arguments[p.key]) === p.val : String(hitCall.arguments[p.key]).includes(String(p.val)))
    if (!argOk) return { ok: false, detail: `${p.tool}.${p.key} 未命中预期 ${p.val}（实际 ${JSON.stringify(hitCall.arguments)}）` }
  }
  return { ok: true, detail: '符合' }
}

function checkIntent(calls, tools, local) {
  if (local) return { ok: true, detail: '本地校验（无需 Skill）', calls: '—' }
  const names = calls.map(c => c.name)
  const writes = names.filter(isWrite)
  if (writes.length) return { ok: false, detail: `调用了写型 Tool: ${writes.join(',')}`, calls: names.join(',') || '无' }
  const hit = tools.length ? names.filter(n => tools.includes(n)) : []
  if (hit.length) return { ok: true, detail: `命中预期 ${hit.join(',')}`, calls: names.join(',') || '无' }
  if (!names.length) return { ok: false, detail: '未捕获到 Tool 调用（跨会话记忆作答，违反“必须调用只读 Skill”）', calls: '无' }
  return { ok: false, detail: `Tool 不符预期(预期 ${tools.join('/')}，实际 ${names.join(',')})`, calls: names.join(',') }
}

function verifyOne(item, spec) {
  if (!spec) return { layers: { intent: '—', params: '—', data: '—', answer: '—' }, overall: 'SKIP', reasons: [`缺少 Spec: ${item.id}`] }
  const calls = item.calls || []
  const finalText = item.finalText || ''
  const intent = checkIntent(calls, spec.tools, !!spec.local)
  const params = checkParams(calls, spec.params || [])
  const factsMiss = (spec.facts || []).filter(f => !has(finalText, f))
  const absenceOk = !(spec.absence || []).length || (spec.absence || []).some(a => has(finalText, a))
  const limitOk = !(spec.limit || []).length || (spec.limit || []).some(l => has(finalText, l))
  const antiHit = (spec.anti || []).filter(a => has(finalText, a))
  const rejectOk = !spec.rejectInverted || (/无效|晚于|倒置|早于/.test(finalText) && !/已调整|调整为|自动交换|已为您交换|重新排列/.test(finalText))
  const dataParts = []
  if (factsMiss.length) dataParts.push(`缺失关键事实: ${factsMiss.join('、')}`)
  if (!absenceOk) dataParts.push('未说明“无记录”')
  if (antiHit.length) dataParts.push(`断言了不应断言的内容: ${antiHit.join('、')}`)
  if (!rejectOk) dataParts.push('倒置日期范围应被拒绝，却自动交换日期并查询')
  const dataOk = !factsMiss.length && absenceOk && !antiHit.length && rejectOk

  const ansParts = []
  if (!finalText || finalText.trim().length < 6) ansParts.push('回答缺失/过短')
  if (factsMiss.length) ansParts.push(`数字/对象不符: ${factsMiss.join('、')}`)
  if (!absenceOk) ansParts.push('应说明无记录却未说明')
  if (!limitOk) ansParts.push(`应说明数据不足限制(需含 ${(spec.limit || []).join('/')})`)
  if (antiHit.length) ansParts.push(`防幻觉违规: ${antiHit.join('、')}`)
  if (!rejectOk) ansParts.push('倒置日期范围应拒绝，却自动交换日期并查询')
  const answerOk = !!(finalText && finalText.trim().length >= 6) && !factsMiss.length && absenceOk && !antiHit.length && limitOk && rejectOk

  const layers = {
    intent: intent.ok ? 'PASS' : 'FAIL',
    params: params.ok ? 'PASS' : 'FAIL',
    data: dataOk ? 'PASS' : 'FAIL',
    answer: answerOk ? 'PASS' : 'FAIL',
  }
  const failLayers = Object.keys(layers).filter(k => layers[k] === 'FAIL')
  const reasons = []
  if (layers.intent === 'FAIL') reasons.push(`意图：${intent.detail}`)
  if (layers.params === 'FAIL') reasons.push(`参数：${params.detail}`)
  if (layers.data === 'FAIL') reasons.push(`数据：${dataParts.join('；') || '—'}`)
  if (layers.answer === 'FAIL') reasons.push(`回答：${ansParts.join('；') || '—'}`)
  return { layers, overall: failLayers.length ? 'FAIL' : 'PASS', reasons, calls: intent.calls }
}

const category = id => ({ H: '房屋', T: '租客', C: '合同', A: '入住 / 部分付款', M: '退租时间', P: '缴费历史', D: '欠费 / 账龄', F: '未来应收', R: '实际收款', I: '收入来源', S: '押金 / 退租 / 房损 / 退款', O: '综合档案 / 经营概况', E: '边界与空结果' })[id[0]] || '其他'

const verdicts = S.map(s => {
  const item = byId.get(s.id) || { id: s.id, question: '—', finalText: '', calls: [], results: [] }
  const v = verifyOne(item, s)
  return { id: s.id, question: item.question || s.question || '—', item, spec: s, ...v }
})

const passCount = verdicts.filter(v => v.overall === 'PASS').length
const failCount = verdicts.filter(v => v.overall === 'FAIL').length
const failCases = verdicts.filter(v => v.overall === 'FAIL')
const noToolCases = verdicts.filter(v => !(v.item.calls || []).length)

const lines = [
  '# AI 查询 Skill 全量自然语言测试验收报告（四层校验）',
  '',
  `- 测试批次：\`${gt.runId}\``,
  `- 执行时间：${data.generatedAt}（Asia/Shanghai）`,
  `- 环境：\`${gt.envId}\`（CloudBase NoSQL）`,
  '- 执行方式：135 条问题经微信开发者工具 `cli.bat agent chat` 进入小程序内部 Skill；统一追加“仅查询，不创建、不确认、不付款、不退租”。',
  '- 数据写入：无。CloudBase MCP 仅执行 `readNoSqlDatabaseContent` 建立 Ground Truth。',
  '- 校验方式：每条按 意图(正确 Query API) / 参数(对象·时间·类型) / 数据(MCP Ground Truth 数量金额日期) / 回答(完整·准确·防幻觉·限制说明) 四层判定。',
  '',
  '## 1. 执行汇总',
  '',
  '| 指标 | 数量 |',
  '| --- | ---: |',
  `| 计划问题 | ${S.length} |`,
  `| 四层校验 PASS | ${passCount} |`,
  `| 四层校验 FAIL | ${failCount} |`,
  `| 其中：未捕获 Tool 调用 | ${noToolCases.length} |`,
  '',
  '> 说明：`未捕获 Tool 调用` 指 payload 中无 `tool_call` 记录（Agent 跨会话记忆复用所致）。此类意图层记 FAIL，数据/回答层仍按 Ground Truth 校验。',
  '',
  '## 2. CloudBase MCP Ground Truth 基线（只读，2026-07-31 刷新）',
  '',
  '| 集合 | requestId | 核验事实 |',
  '| --- | --- | --- |',
  `| houses | \`${gt.mcp.houses_nltest.requestId}\` | ${gt.houses['NLTEST-2801'].desc}；${gt.houses['NLTEST-2802'].desc}；${gt.houses['NLTEST-2803'].desc}；${gt.houses['NLTEST-2901'].desc}；${gt.houses['NLTEST-2810'].desc} |`,
  `| tenants | \`${gt.mcp.tenants_nltest.requestId}\` | ${gt.tenants['NL测试欠费租客'].status === 'active' ? 'T01 在住欠费' : ''}、${gt.tenants['NL测试正常缴费租客'].status === 'active' ? 'T02 在住正常缴费' : ''}、T03 历史、T04 退租结算、T05 多合同、T06/T07 同名候选、T08 短约在住 |`,
  `| lease_agreements | \`${gt.mcp.leases_nltest.requestId}\` | L01 短约 08-03 到期；L02 正常缴费；L03 无实际搬离日；L04 退租结算退款580；L06 房损450 无付款 |`,
  `| bills | \`${gt.mcp.bills_all.requestId}\` | 当前欠费 ¥${gt.aggregates.currentArrearsTotal}/8笔（阿东¥${gt.aggregates.adongArrears} + NL测试¥${gt.aggregates.nltestArrears}）；未来应收 ¥${gt.aggregates.futureReceivable} |`,
  `| payments | \`${gt.mcp.payments_all.requestId}\` | 本月实收 ¥${gt.aggregates.julyCollectionTotal}（经营¥${gt.aggregates.julyOperatingIncome}）；2026 全年 ¥${gt.aggregates.year2026CollectionTotal} |`,
  '',
]

const groups = new Map()
for (const v of verdicts) {
  const k = category(v.id)
  if (!groups.has(k)) groups.set(k, [])
  groups.get(k).push(v)
}

for (const [name, items] of groups) {
  lines.push(`### ${name}`, '')
  lines.push('| 测试 ID | 问题 | 实际 Tool / 参数 | 预期 Tool | MCP Ground Truth 核验 | 回答摘要 | 意图 | 参数 | 数据 | 回答 | 总判定 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |')
  for (const v of items) {
    const calls = (v.item.calls || []).map(c => `${c.name}(${JSON.stringify(c.arguments || {})})`).join('<br>') || '—'
    lines.push(`| ${esc(v.id)} | ${esc(v.question)} | ${esc(calls.slice(0, 120))} | ${esc((v.spec.tools || []).join('/') || '本地校验')} | ${esc(v.spec.gt)} | ${esc((v.item.finalText || '').replace(/\n/g, ' ').slice(0, 80))}… | ${v.layers.intent} | ${v.layers.params} | ${v.layers.data} | ${v.layers.answer} | ${v.overall} |`)
  }
  lines.push('')
}

lines.push('## 4. FAIL 明细与根因', '')
if (!failCases.length) {
  lines.push('无 FAIL。', '')
} else {
  for (const v of failCases) {
    lines.push(`### ${v.id} — ${v.question}`, '')
    lines.push(`- 判定：意图 ${v.layers.intent} / 参数 ${v.layers.params} / 数据 ${v.layers.data} / 回答 ${v.layers.answer}`)
    lines.push(`- 原因：${v.reasons.join('；') || '—'}`)
    lines.push(`- 实际调用：${v.calls || '无'}`)
    lines.push(`- 最终回答：${esc(v.item.finalText || '')}`, '')
  }
}

lines.push('## 5. 关键发现与建议', '')
lines.push(`- 135 条中 ${passCount} PASS / ${failCount} FAIL。`)
lines.push('- 阿东欠费口径：账单明细为 5 笔合计 ¥4680（水电680 + 4×租金1000）；getArrearsReport 汇总与 getOperatingOverview 已修正为 ¥4680，总欠费 ¥6500（阿东4680 + NL测试1820），不再重复计入。')
lines.push('- 本月实收：旧批 19446 → 新批 19146，差值 ¥300 为非现金 `deposit_offset`（P09），新口径已正确剔除，符合“实收只统计现金 payment”。')
lines.push('- 经营收入已不再计入未证明到账的房损（旧批含房损800，新批仅租金+水电），符合“damageAmount≠实际到账”。')
lines.push('- R01/R02 未按“当天”口径作答：改为返回“本月实收总额 19146”并称无单日接口，实际 getFinancialReport 支持单日区间（旧批已用它返回当天 0），属回答口径回归。')
lines.push('- 8 条未捕获 Tool 调用（A14/P05/D02/R02/I04/O04/O05/E02）：Agent 复用跨会话记忆直接作答，违反“回答前必须调用只读 Skill”。建议下次强制 tool_call 断言或清空会话再跑。')
lines.push('- R10（倒置日期范围）：本次未按“本地校验拒绝”处理，Agent 改为自动交换日期并调用 getFinancialReport 查询（返回本月总额 19146），违反“不能偷偷交换日期”。旧批为拒绝，行为不稳定，需固定本地日期范围校验在前端强制层。')
lines.push('- C09 提到“另有 2 份有效合同未记录结束日”但 L02 确有 endDate 2026-12-31，需复核 getRelativeLeaseExpiry 是否漏返回。', '')

lines.push('## 6. 原始证据', '')
lines.push(`- 原始回包：\`docs/ai-query-natural-language-raw-results-20260731.json\`（135 条 tool_call/tool_result/finalText/raw）。`)
lines.push(`- Ground Truth：\`docs/ai-query-natural-language-ground-truth-20260731.json\`（含全部 requestId）。`)

fs.writeFileSync(target, lines.join('\n') + '\n', 'utf8')
console.log(JSON.stringify({ pass: passCount, fail: failCount, failIds: failCases.map(v => v.id), noToolIds: noToolCases.map(v => v.id) }, null, 2))
