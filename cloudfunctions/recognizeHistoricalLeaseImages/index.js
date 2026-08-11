const cloud = require('@cloudbase/node-sdk')
const { extractHistoricalLease } = require('./parser')
const { isTransientOcrError, recognizeImage } = require('./ocr-client')

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV })
const SAFE_PATH_MARKER = '/historical-contract-ocr/'

function createOcrClient() {
  const OcrClient = require('tencentcloud-sdk-nodejs-ocr').ocr.v20181119.Client
  const legacySecretIdKey = Object.keys(process.env).find(key => /^AKID[A-Za-z0-9]+$/.test(key))
  // 永久密钥优先：TENCENTCLOUD_SECRET* 是云函数运行时自动注入的临时密钥，
  // 永不为空，必须放最后作 fallback，否则会覆盖显式配置的永久密钥。
  const secretId = process.env.TENCENT_SECRET_ID
    || process.env.SecretId
    || process.env.SECRET_ID
    || legacySecretIdKey
    || process.env.TENCENTCLOUD_SECRET_ID
    || process.env.TENCENTCLOUD_SECRETID
    || ''
  const secretKey = process.env.TENCENT_SECRET_KEY
    || process.env.SecretKey
    || process.env.SECRET_KEY
    || (legacySecretIdKey && process.env[legacySecretIdKey])
    || process.env.TENCENTCLOUD_SECRET_KEY
    || process.env.TENCENTCLOUD_SECRETKEY
    || ''
  // 仅临时密钥需要 session token，永久密钥带 token 会导致签名校验失败
  const isPermanent = Boolean(process.env.TENCENT_SECRET_ID || process.env.SecretId || process.env.SECRET_ID || legacySecretIdKey)
  const token = isPermanent ? '' : (process.env.TENCENTCLOUD_SESSION_TOKEN || process.env.TENCENTCLOUD_SESSIONTOKEN || process.env.Token || '')

  let credential = secretId && secretKey ? { secretId, secretKey, token } : null
  if (!credential) {
    try {
      const { DefaultCredentialProvider } = require('tencentcloud-sdk-nodejs-ocr/tencentcloud/common/credential')
      credential = new DefaultCredentialProvider()
    } catch (error) {
      const configError = new Error('OCR 云函数缺少腾讯云密钥，请配置 TENCENT_SECRET_ID / TENCENT_SECRET_KEY 或函数运行角色')
      configError.code = 'OCR_NOT_CONFIGURED'
      throw configError
    }
  }

  return new OcrClient({
    credential,
    region: process.env.TENCENTCLOUD_REGION || process.env.SCF_REGION || 'ap-shanghai',
    profile: {
      signMethod: 'TC3-HMAC-SHA256',
      httpProfile: {
        reqMethod: 'POST',
        reqTimeout: 30,
        endpoint: 'ocr.tencentcloudapi.com'
      }
    }
  })
}

function formatOcrErrorMessage(error) {
  const message = String(error && error.message || '')
  if (/not authorized|has no permission|UnauthorizedOperation/i.test(message)) {
    return 'OCR 服务未授权：请确认当前 SecretId 所属账号已开通 OCR，并已绑定 QcloudOCRFullAccess，或至少允许 ocr:GeneralAccurateOCR'
  }
  if (/SecretId is not found|secretId|secret id/i.test(message)) {
    return 'OCR 云函数缺少腾讯云临时密钥，请检查函数运行角色或环境变量'
  }
  if (isTransientOcrError(error)) {
    return 'OCR 服务网络暂时中断，请稍后重试'
  }
  return `合同识别失败：${message || 'OCR 服务调用失败'}`
}

async function cleanupFiles(fileIds) {
  const safeIds = fileIds.filter(fileId => typeof fileId === 'string' && fileId.includes(SAFE_PATH_MARKER))
  if (!safeIds.length) return
  try {
    await app.deleteFile({ fileList: safeIds })
  } catch (error) {
    console.warn('[historical-ocr] 临时图片清理失败', { count: safeIds.length, message: error.message })
  }
}

exports.main = async (event = {}) => {
  const fileIds = Array.isArray(event.fileIds) ? [...new Set(event.fileIds)].slice(0, 9) : []
  if (!fileIds.length || fileIds.some(fileId => typeof fileId !== 'string' || !fileId.includes(SAFE_PATH_MARKER))) {
    return { code: 400, message: '请上传 1 至 9 张历史合同照片' }
  }

  try {
    const client = createOcrClient()
    const pages = []
    for (let pageIndex = 0; pageIndex < fileIds.length; pageIndex += 1) {
      const fileId = fileIds[pageIndex]
      const downloaded = await app.downloadFile({ fileID: fileId })
      pages.push(await recognizeImage(client, downloaded.fileContent, pageIndex))
    }
    const items = pages.flatMap(page => page.items)
    return {
      code: 200,
      data: extractHistoricalLease(items, {
        pageAngles: pages.map(page => ({ pageIndex: page.pageIndex, angle: page.angle }))
      })
    }
  } catch (error) {
    console.error('[historical-ocr] 识别失败', { code: error.code || '', message: error.message })
    return { code: 500, message: formatOcrErrorMessage(error) }
  } finally {
    await cleanupFiles(fileIds)
  }
}
