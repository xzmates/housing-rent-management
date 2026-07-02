const cloud = require('@cloudbase/node-sdk');
const https = require('https');

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

function postJson(url, payload, headers = {}) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: target.hostname,
      port: target.port || 443,
      path: `${target.pathname}${target.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...headers
      }
    }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => { chunks.push(chunk); });
      res.on('end', () => {
        const buffer = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || '';
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`TTS HTTP ${res.statusCode}: ${buffer.toString('utf8')}`));
          return;
        }
        if (contentType.includes('application/json')) {
          try {
            resolve(JSON.parse(buffer.toString('utf8')));
          } catch (error) {
            reject(new Error(`TTS JSON 解析失败：${error.message}`));
          }
          return;
        }
        resolve(buffer);
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// 新版：大模型TTS无需appid，仅校验接口地址和API密钥
function hasVolcTtsConfig() {
  return Boolean(process.env.VOLC_TTS_ENDPOINT && process.env.VOLC_TTS_TOKEN);
}

function extractAudioBuffer(response) {
  if (Buffer.isBuffer(response)) return response;
  if (!response || typeof response !== 'object') return null;
  const base64 = response.data
    || response.audio
    || (response.result && response.result.data)
    || (response.result && response.result.audio)
    || (response.data && response.data.audio);
  if (!base64 || typeof base64 !== 'string') return null;
  return Buffer.from(base64, 'base64');
}

async function getTempUrl(fileID) {
  const res = await app.getTempFileURL({ fileList: [fileID] });
  const item = res.fileList && res.fileList[0];
  return item && (item.tempFileURL || item.download_url || item.url || '');
}

async function uploadAudio(buffer) {
  const cloudPath = `voice-assistant/tts/${Date.now()}_${Math.random().toString(16).slice(2)}.mp3`;
  const res = await app.uploadFile({ cloudPath, fileContent: buffer });
  const fileID = res.fileID || res.fileId || res.fileid;
  return {
    fileID,
    cloudPath,
    tempUrl: fileID ? await getTempUrl(fileID) : ''
  };
}

async function safeLog(payload) {
  try {
    await db.collection('voice_command_logs').add({
      type: 'tts',
      ...payload,
      createdAt: new Date()
    });
  } catch (error) {
    // 日志集合缺失不影响主流程
  }
}

async function callVolcTts(text) {
  if (!hasVolcTtsConfig()) {
    throw new Error('未配置火山 TTS 环境变量');
  }

  const payload = {
    text: text,
    voice_name: process.env.VOLC_TTS_VOICE_TYPE || 'zh_female_warmchat',
    speed: Number(process.env.VOLC_TTS_SPEED_RATIO || 0.9),
    volume: 1.0,
    format: 'mp3',
    sample_rate: Number(process.env.VOLC_TTS_RATE || 24000)
  };

  // 新版大模型TTS使用 X-Api-Key 鉴权，直接返回音频二进制流
  return postJson(process.env.VOLC_TTS_ENDPOINT, payload, {
    'X-Api-Key': process.env.VOLC_TTS_TOKEN,
    'Content-Type': 'application/json'
  });
}

exports.main = async (event = {}) => {
  const text = String(event.text || '').trim();
  if (!text) return { code: 400, message: '缺少需要合成的文本' };

  if (!hasVolcTtsConfig()) {
    await safeLog({ text, provider: 'disabled', skipped: true });
    return {
      code: 200,
      message: '未配置 TTS，已跳过语音合成',
      data: {
        text,
        provider: 'disabled',
        fileID: '',
        tempUrl: ''
      }
    };
  }

  try {
    const response = await callVolcTts(text);
    const buffer = extractAudioBuffer(response);
    if (!buffer) throw new Error('TTS 响应中未找到音频内容');
    const uploaded = await uploadAudio(buffer);
    await safeLog({ text, provider: 'volc_tts', fileID: uploaded.fileID });
    return {
      code: 200,
      message: '语音合成成功',
      data: {
        text,
        provider: 'volc_tts',
        ...uploaded
      }
    };
  } catch (error) {
    await safeLog({ text, provider: 'volc_tts', error: error.message });
    return { code: 500, message: error.message };
  }
};
