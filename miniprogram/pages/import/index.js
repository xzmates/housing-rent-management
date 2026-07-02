const api = require('../../services/api');

const EXAMPLES = [
  '东楼北一零一，月租一千二，王阿姨住，押一付三，去年三月入住',
  '101 今天收两个月租，微信收的',
  '101 电表420 水表108',
  '张三今天退租，电表500，水表150，墙皮扣200'
];

let recorder = null;
let audio = null;

function nowTime() {
  const date = new Date();
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function safeText(value) {
  return value === undefined || value === null ? '' : String(value).trim();
}

Page({
  data: {
    examples: EXAMPLES,
    messages: [
      {
        id: 'welcome',
        role: 'assistant',
        text: '您好，我是语音助手。您可以按住下面的大按钮说话，我会先整理成确认卡，确认后才办理。',
        time: nowTime()
      }
    ],
    inputText: '',
    sessionId: '',
    currentDraft: { slots: {} },
    intent: null,
    reviewVisible: false,
    showReviewSheet: false,
    showReviewFab: false,
    transcriptText: '',
    result: null,
    recording: false,
    loading: false,
    executing: false,
    unsupportedNotice: '删除、导出、系统设置修改暂不支持语音办理，请到对应页面手动操作。'
  },

  onLoad() {
    recorder = wx.getRecorderManager();
    recorder.onStop(this.handleRecordStop.bind(this));
    recorder.onError((error) => {
      this.setData({ recording: false, loading: false });
      wx.showToast({ title: error.errMsg || '录音失败', icon: 'none' });
    });

    audio = wx.createInnerAudioContext();
    audio.obeyMuteSwitch = false;
    audio.onError((error) => {
      console.warn('音频播放失败', error);
      wx.showToast({ title: '播放失败，请调大音量或重试', icon: 'none' });
    });
  },

  onUnload() {
    if (audio) {
      audio.stop();
      audio.destroy();
      audio = null;
    }
  },

  onTextInput(e) {
    this.setData({ inputText: e.detail.value });
  },

  useExample(e) {
    const text = e.currentTarget.dataset.text || '';
    this.setData({ inputText: text });
  },

  appendMessage(message) {
    const item = {
      id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
      time: nowTime(),
      ...message
    };
    this.setData({
      messages: this.data.messages.concat(item)
    });
    return item;
  },

  updateMessage(messageId, patch) {
    const messages = this.data.messages.map((item) => (
      item.id === messageId ? { ...item, ...patch } : item
    ));
    this.setData({ messages });
  },

  buildHistory() {
    return this.data.messages.slice(-6).map((item) => ({
      role: item.role,
      text: item.text
    }));
  },

  async startRecord() {
    if (this.data.loading || this.data.recording) return;
    try {
      recorder.start({
        duration: 60000,
        sampleRate: 16000,
        numberOfChannels: 1,
        encodeBitRate: 48000,
        format: 'mp3'
      });
      this.setData({ recording: true, result: null });
    } catch (error) {
      wx.showToast({ title: error.message || '无法开始录音', icon: 'none' });
    }
  },

  stopRecord() {
    if (!this.data.recording || !recorder) return;
    recorder.stop();
    this.setData({ recording: false, loading: true });
  },

  cancelRecord() {
    if (!this.data.recording || !recorder) return;
    recorder.stop();
    this.setData({ recording: false, loading: false });
  },

  async handleRecordStop(res) {
    const tempFilePath = res.tempFilePath;
    if (!tempFilePath) {
      this.setData({ loading: false });
      wx.showToast({ title: '没有录到声音，请再试一次', icon: 'none' });
      return;
    }
    const userMessage = this.appendMessage({ role: 'user', text: '正在识别语音...', audioPath: tempFilePath });
    try {
      const fileID = await this.uploadVoiceFile(tempFilePath);
      const transcribed = await api.voiceTranscribe({
        fileID,
        audioFormat: 'mp3',
        duration: res.duration,
        scene: 'auto',
        mode: 'chat_voice'
      });
      const text = safeText(transcribed.normalizedText || transcribed.text);
      if (!text) throw new Error('缺少转写文本');
      this.updateMessage(userMessage.id, { text, transcriptText: text });
      await this.sendDialogueTurn({ text, provider: transcribed.provider || 'volc_asr' });
    } catch (error) {
      this.updateMessage(userMessage.id, { text: '语音识别失败，请重说或手动输入' });
      this.appendMessage({ role: 'assistant', text: error.message || '语音处理失败，请稍后再试' });
      wx.showToast({ title: error.message || '语音处理失败', icon: 'none' });
    } finally {
      this.setData({ loading: false, recording: false });
    }
  },

  uploadVoiceFile(filePath) {
    const cloudPath = `voice-assistant/asr/${Date.now()}_${Math.random().toString(16).slice(2)}.mp3`;
    return new Promise((resolve, reject) => {
      wx.cloud.uploadFile({
        cloudPath,
        filePath,
        success: (res) => resolve(res.fileID),
        fail: reject
      });
    });
  },

  async sendText() {
    const text = safeText(this.data.inputText);
    if (!text || this.data.loading) return;
    this.appendMessage({ role: 'user', text });
    this.setData({ inputText: '', loading: true, result: null });
    try {
      await this.sendDialogueTurn({ text });
    } catch (error) {
      this.appendMessage({ role: 'assistant', text: error.message || '处理失败，请再说一遍' });
      wx.showToast({ title: error.message || '处理失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async sendDialogueTurn(payload) {
    const data = await api.voiceDialogueTurn({
      ...payload,
      sessionId: this.data.sessionId,
      currentDraft: this.data.currentDraft,
      history: this.buildHistory(),
      mode: 'chat_voice',
      scene: 'auto',
      useLLM: false
    });

    const intent = data.intent || null;
    const assistantMessage = this.appendMessage({
      role: 'assistant',
      text: data.replyText || '我整理好了，请看确认卡。',
      audioUrl: data.replyAudio && data.replyAudio.tempUrl,
      nextAction: data.nextAction
    });

    this.setData({
      sessionId: data.sessionId || this.data.sessionId,
      currentDraft: data.currentDraft || this.data.currentDraft,
      intent,
      reviewVisible: !!intent,
      showReviewSheet: !!intent,
      showReviewFab: false,
      transcriptText: data.transcriptText || this.data.transcriptText,
      result: null
    });

    if (data.replyAudio && data.replyAudio.tempUrl) {
      this.playAudioUrl(data.replyAudio.tempUrl);
    } else if (data.shouldSynthesize && assistantMessage.text) {
      this.synthesizeAssistantReply(assistantMessage.id, assistantMessage.text, data.sessionId);
    }
  },

  async synthesizeAssistantReply(messageId, text, sessionId) {
    try {
      const speech = await api.voiceSynthesize({ text, sessionId });
      if (!speech || !speech.tempUrl) return;
      const messages = this.data.messages.map((item) => (
        item.id === messageId ? { ...item, audioUrl: speech.tempUrl } : item
      ));
      this.setData({ messages });
      this.playAudioUrl(speech.tempUrl);
    } catch (error) {
      console.warn('语音合成失败，已保留文字回复', error);
    }
  },

  playAudio(e) {
    const url = e.currentTarget.dataset.url;
    if (url) this.playAudioUrl(url);
  },

  playUserAudio(e) {
    const path = e.currentTarget.dataset.path;
    if (path) this.playAudioUrl(path);
  },

  playAudioUrl(url) {
    if (!audio || !url) return;
    audio.stop();
    audio.src = url;
    audio.play();
  },

  closeReviewSheet() {
    this.setData({
      reviewVisible: false,
      showReviewSheet: false,
      showReviewFab: !!this.data.intent
    });
  },

  openReviewSheet() {
    if (this.data.intent) {
      this.setData({
        reviewVisible: true,
        showReviewSheet: true,
        showReviewFab: false
      });
    }
  },

  stopPropagation() {},

  onReviewInput(e) {
    const { cardIndex, fieldIndex, field } = e.currentTarget.dataset;
    const value = e.detail.value;
    const intent = this.data.intent;
    if (!intent) return;
    intent.slots[field] = value;
    const cardPath = `intent.reviewCards[${cardIndex}].fields[${fieldIndex}].value`;
    this.setData({
      [`intent.slots.${field}`]: value,
      [cardPath]: value,
      currentDraft: { scene: intent.scene, slots: intent.slots }
    });
  },

  async refreshPlan() {
    const intent = this.data.intent;
    if (!intent) return;
    this.setData({ loading: true });
    try {
      const planned = await api.voicePlanCommand({
        text: '',
        scene: intent.scene,
        mode: 'chat_voice',
        currentDraft: { scene: intent.scene, slots: intent.slots },
        useLLM: false
      });
      this.setData({
        intent: planned,
        currentDraft: { scene: planned.scene, slots: planned.slots }
      });
    } catch (error) {
      wx.showToast({ title: error.message || '重新生成失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  async confirmExecute() {
    const intent = this.data.intent;
    if (!intent) return;
    if (!intent.canExecute) {
      wx.showToast({ title: '请先补齐或重新确认信息', icon: 'none' });
      return;
    }

    wx.showModal({
      title: '确认执行',
      content: `将执行：${intent.sceneLabel}。请确认信息无误。`,
      confirmText: '确认执行',
      success: async (res) => {
        if (!res.confirm) return;
        this.setData({ executing: true });
        try {
          const result = await api.executeVoiceScenario(intent);
          this.setData({
            result,
            intent: null,
            reviewVisible: false,
            showReviewSheet: false,
            showReviewFab: false,
            currentDraft: { slots: {} }
          });
          this.appendMessage({ role: 'assistant', text: result.summary || '办理完成' });
          wx.showToast({ title: '办理完成', icon: 'success' });
        } catch (error) {
          const result = {
            success: 0,
            failed: 1,
            summary: error.message || '执行失败',
            details: [{ title: '执行失败', status: 'failed', message: error.message || '执行失败' }]
          };
          this.setData({ result });
          this.appendMessage({ role: 'assistant', text: result.summary });
          wx.showToast({ title: error.message || '执行失败', icon: 'none' });
        } finally {
          this.setData({ executing: false });
        }
      }
    });
  },

  resetConversation() {
    this.setData({
      messages: [
        {
          id: 'welcome',
          role: 'assistant',
          text: '我们重新开始。请按住下面的大按钮，说出您要办理的事情。',
          time: nowTime()
        }
      ],
      inputText: '',
      sessionId: '',
      currentDraft: { slots: {} },
      intent: null,
      reviewVisible: false,
      showReviewSheet: false,
      showReviewFab: false,
      transcriptText: '',
      result: null,
      loading: false,
      executing: false,
      recording: false
    });
  }
});
