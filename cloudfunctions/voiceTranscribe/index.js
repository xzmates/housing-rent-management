const cloud = require('@cloudbase/node-sdk');
const https = require('https');

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

const BUILTIN_ALIASES = [
  ['东楼被', '东楼北'],
  ['东楼倍', '东楼北'],
  ['东楼北边', '东楼北'],
  ['东楼南边', '东楼南'],
  ['里招', '里召'],
  ['里照', '里召'],
  ['现钱', '现金'],
  ['转帐', '转账'],
  ['微信上', '微信'],
  ['交房租', '交租'],
  ['收房租', '收租']
];

function toHalfWidth(text) {
  return String(text || '').replace(/[\uFF01-\uFF5E]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 65248)).replace(/\u3000/g, ' ');
}

function normalizeText(text, aliases) {
  let value = toHalfWidth(text)
    .replace(/[;；]/g, '，')
    .replace(/\s+/g, ' ')
    .trim();

  const allAliases = BUILTIN_ALIASES.concat(aliases || []);
  allAliases.forEach(([source, target]) => {
    if (!source || source === target) return;
    value = value.split(source).join(target);
  });

  return value.replace(/，{2,}/g, '，').trim();
}

function splitSegments(text) {
  return String(text || '')
    .split(/[。；;\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

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
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        let parsed = data;
        try {
          parsed = JSON.parse(data);
        } catch (error) {
          // 火山接口异常时可能返回纯文本错误，保留原文便于排查
        }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error(`ASR HTTP ${res.statusCode}: ${typeof parsed === 'string' ? parsed : JSON.stringify(parsed)}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function loadAliases() {
  try {
    const res = await db.collection('voice_aliases').limit(200).get();
    return (res.data || [])
      .filter((item) => item && item.enabled !== false && item.source && item.target)
      .map((item) => [String(item.source), String(item.target)]);
  } catch (error) {
    return [];
  }
}

async function getTempUrl(fileID) {
  if (!fileID) return '';
  const res = await app.getTempFileURL({ fileList: [fileID] });
  const item = res.fileList && res.fileList[0];
  return item && (item.tempFileURL || item.download_url || item.url || '');
}

function extractAsrText(response) {
  if (!response) return '';
  if (typeof response === 'string') return response;
  const candidates = [
    response.result && response.result.text,
    response.text,
    response.result && response.result.utterances && response.result.utterances.map((item) => item.text).join(''),
    response.data && response.data.text,
    response.data && response.data.result && response.data.result.text,
    response.data && response.data.utterances && response.data.utterances.map((item) => item.text).join('')
  ];
  return candidates.find((item) => typeof item === 'string' && item.trim()) || '';
}

function hasVolcAsrConfig() {
  return Boolean(process.env.VOLC_ASR_TOKEN);
}

async function callVolcAsr({ audioUrl }) {
  if (!hasVolcAsrConfig()) {
    throw new Error('未配置火山 ASR 环境变量');
  }

  const endpoint = process.env.VOLC_ASR_ENDPOINT || 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash';
  const apiKey = process.env.VOLC_ASR_TOKEN;
  const resourceId = process.env.VOLC_ASR_CLUSTER || 'volc.bigasr.auc_turbo';

  const requestId = `asr_${Date.now()}_${Math.random().toString(16).slice(2)}`;

  return postJson(endpoint, {
    user: {
      uid: apiKey
    },
    audio: {
      url: audioUrl
    },
    request: {
      model_name: 'bigmodel'
    }
  }, {
    'X-Api-Key': apiKey,
    'X-Api-Resource-Id': resourceId,
    'X-Api-Request-Id': requestId,
    'X-Api-Sequence': '-1'
  });
}

async function safeLog(payload) {
  try {
    await db.collection('voice_command_logs').add({
      type: 'transcribe',
      ...payload,
      createdAt: new Date()
    });
  } catch (error) {
    // 忽略日志集合不存在的情况
  }
}

exports.main = async (event = {}) => {
  const inputText = String(event.text || event.transcriptText || '').trim();
  const fileID = event.fileID || event.audioFileID || '';
  const audioUrl = event.audioUrl || (fileID ? await getTempUrl(fileID) : '');
  const provider = audioUrl && hasVolcAsrConfig() ? 'volc_asr' : (event.provider || 'manual');

  let text = inputText;
  let asrRaw = null;
  if (!text && audioUrl) {
    try {
      asrRaw = await callVolcAsr({
        audioUrl,
        audioFormat: event.audioFormat || 'mp3',
        duration: event.duration
      });
      text = extractAsrText(asrRaw);
    } catch (error) {
      await safeLog({
        scene: event.scene || '',
        mode: event.mode || '',
        provider: 'volc_asr',
        fileID,
        audioUrl,
        error: error.message
      });
      throw error;
    }
  }

  if (!text) {
    return { code: 400, message: '缺少转写文本或可识别音频' };
  }

  const aliases = await loadAliases();
  const normalizedText = normalizeText(text, aliases);
  const data = {
    text,
    normalizedText,
    segments: Array.isArray(event.segments) && event.segments.length > 0
      ? event.segments
      : splitSegments(normalizedText),
    confidence: Number(event.confidence || 0.85),
    provider,
    fileID,
    audioUrl,
    raw: asrRaw
  };

  await safeLog({
    scene: event.scene || '',
    mode: event.mode || '',
    provider: data.provider,
    fileID,
    text,
    normalizedText,
    confidence: data.confidence
  });

  return {
    code: 200,
    message: '转写完成',
    data
  };
};
