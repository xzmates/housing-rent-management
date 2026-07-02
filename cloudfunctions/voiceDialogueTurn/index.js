const cloud = require('@cloudbase/node-sdk');

const app = cloud.init({ env: cloud.SYMBOL_CURRENT_ENV });
const db = app.database();

function ok(data) {
  return { code: 200, message: '对话处理完成', data };
}

async function callFunction(name, data) {
  const res = await app.callFunction({ name, data });
  const result = res.result || {};
  if (result.code && result.code !== 200 && result.code !== 0) {
    throw new Error(result.message || `${name} 调用失败`);
  }
  return Object.prototype.hasOwnProperty.call(result, 'data') ? result.data : result;
}

async function safeLog(payload) {
  try {
    await db.collection('voice_command_logs').add({
      type: 'dialogue_turn',
      ...payload,
      createdAt: new Date()
    });
  } catch (error) {
    // 日志缺失不阻断主流程
  }
}

function firstMissingLabel(intent) {
  const missing = intent && Array.isArray(intent.missingSlots) ? intent.missingSlots : [];
  return missing.length > 0 ? missing[0].label : '';
}

function buildReplyText(intent, transcriptText) {
  if (!intent) return '我没有听清楚，请您再说一遍。';
  if (intent.scene === 'unsupported') {
    return '这个操作暂不支持语音办理，请您到对应页面手动操作。';
  }
  if (!intent.canExecute) {
    const label = firstMissingLabel(intent);
    if (label) return `我听到了：${transcriptText}。还需要补充${label}，请您再说一句。`;
    if (intent.candidates && intent.candidates.length > 0) return '我找到了多个可能的记录，请您补充更准确的房屋位置或租客姓名。';
    return '我还需要您补充一点信息，请再说一句。';
  }
  return `我整理好了，是${intent.sceneLabel}。请您先看确认卡，确认无误后再办理。`;
}

exports.main = async (event = {}) => {
  try {
    const sessionId = event.sessionId || `voice_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const mode = event.mode || 'chat_voice';
    const currentDraft = event.currentDraft || {};
    const inputText = String(event.text || event.transcriptText || '').trim();

    const transcribed = inputText
      ? {
        text: inputText,
        normalizedText: inputText,
        segments: [inputText],
        confidence: Number(event.confidence || 0.85),
        provider: event.provider || 'manual'
      }
      : await callFunction('voiceTranscribe', {
        fileID: event.fileID || event.audioFileID,
        audioUrl: event.audioUrl,
        audioFormat: event.audioFormat || 'mp3',
        scene: event.scene || 'auto',
        mode,
        duration: event.duration
      });

    const planned = await callFunction('voicePlanCommand', {
      text: transcribed.normalizedText,
      scene: event.scene || currentDraft.scene || 'auto',
      mode,
      currentDraft,
      history: event.history || [],
      sessionId,
      useLLM: event.useLLM === true
    });

    const replyText = planned.replyText || buildReplyText(planned, transcribed.normalizedText);
    const speech = { fileID: '', tempUrl: '', provider: 'deferred' };

    const nextAction = planned.scene === 'unsupported'
      ? 'unsupported'
      : planned.canExecute
        ? 'show_confirm'
        : 'ask_more';

    safeLog({
      sessionId,
      mode,
      transcriptText: transcribed.normalizedText,
      scene: planned.scene,
      canExecute: planned.canExecute,
      nextAction
    });

    return ok({
      sessionId,
      transcriptText: transcribed.normalizedText,
      transcribed,
      replyText,
      replyAudio: speech,
      shouldSynthesize: true,
      intent: planned,
      currentDraft: {
        scene: planned.scene,
        slots: planned.slots
      },
      nextAction
    });
  } catch (error) {
    await safeLog({
      sessionId: event.sessionId || '',
      error: error.message
    });
    return { code: 500, message: error.message };
  }
};
