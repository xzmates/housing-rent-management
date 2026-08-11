/**
 * 已停用的历史快照入口。
 * 历史合同必须通过 rentalDomain 的 previewHistoricalLeaseImport ->
 * confirmHistoricalLeaseImport 流程执行，避免绕过预览、幂等和字段白名单。
 */
exports.main = async () => ({
  code: 410,
  message: '该历史导入入口已停用，请使用历史合同建档页面重新预览并确认'
})
