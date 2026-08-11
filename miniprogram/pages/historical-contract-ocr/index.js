const api = require('../../services/api');

const MAX_OCR_IMAGE_BYTES = 7 * 1024 * 1024;
const COMPRESS_QUALITIES = [90, 80, 70];

function getFileSize(path, fallback = 0) {
  return new Promise(resolve => {
    wx.getFileInfo({
      filePath: path,
      success: res => resolve(Number(res.size || fallback || 0)),
      fail: () => resolve(Number(fallback || 0))
    });
  });
}

function compressImage(path, quality) {
  return new Promise((resolve, reject) => {
    wx.compressImage({
      src: path,
      quality,
      success: res => resolve(res.tempFilePath),
      fail: reject
    });
  });
}

async function preparePhoto(item) {
  let path = item.tempFilePath;
  let size = Number(item.size || 0) || await getFileSize(path);
  if (size <= MAX_OCR_IMAGE_BYTES) return { path, size };
  for (const quality of COMPRESS_QUALITIES) {
    path = await compressImage(path, quality);
    size = await getFileSize(path);
    if (size <= MAX_OCR_IMAGE_BYTES) return { path, size };
  }
  throw new Error('单张照片过大，请裁剪合同边缘后重试');
}

function uploadFile(path, index) {
  const suffix = String(path || '').split('.').pop().toLowerCase();
  const extension = /^[a-z0-9]{2,5}$/.test(suffix) ? suffix : 'jpg';
  const cloudPath = `historical-contract-ocr/${Date.now()}_${index}_${Math.random().toString(16).slice(2)}.${extension}`;
  return wx.cloud.uploadFile({ cloudPath, filePath: path }).then(res => res.fileID);
}

Page({
  data: {
    photos: [],
    recognizing: false,
    statusText: ''
  },

  choosePhotos() {
    if (this.data.recognizing) return;
    wx.chooseMedia({
      count: 9,
      mediaType: ['image'],
      sourceType: ['camera', 'album'],
      sizeType: ['original'],
      success: async res => {
        this.setData({ statusText: '正在检查照片清晰度…' });
        try {
          const photos = [];
          for (const item of (res.tempFiles || [])) photos.push(await preparePhoto(item));
          this.setData({ photos, statusText: '' });
        } catch (error) {
          console.error('合同照片处理失败', error);
          this.setData({ photos: [], statusText: error.message || '照片处理失败' });
          wx.showToast({ title: error.message || '照片处理失败', icon: 'none' });
        }
      }
    });
  },

  removePhoto(e) {
    const index = Number(e.currentTarget.dataset.index);
    this.setData({ photos: this.data.photos.filter((_, itemIndex) => itemIndex !== index) });
  },

  async recognize() {
    if (this.data.recognizing) return;
    if (!this.data.photos.length) {
      wx.showToast({ title: '请先拍摄合同', icon: 'none' });
      return;
    }
    this.setData({ recognizing: true, statusText: '正在上传合同照片…' });
    let fileIds = [];
    try {
      for (let index = 0; index < this.data.photos.length; index += 1) {
        fileIds.push(await uploadFile(this.data.photos[index].path, index));
      }
      this.setData({ statusText: '正在识别印刷和手写内容…' });
      const draft = await api.recognizeHistoricalLeaseImages(fileIds);
      fileIds = [];
      this.openCreatePage(draft || {});
    } catch (error) {
      console.error('历史合同识别失败', error);
      if (fileIds.length) {
        wx.cloud.deleteFile({ fileList: fileIds }).catch(() => {});
      }
      this.setData({ statusText: error.message || '识别失败，可重新拍摄或手工建档' });
      wx.showToast({ title: error.message || '识别失败', icon: 'none' });
    } finally {
      this.setData({ recognizing: false });
    }
  },

  startManual() {
    if (this.data.recognizing) return;
    this.openCreatePage({ uncertainFields: [] });
  },

  openCreatePage(draft) {
    wx.navigateTo({
      url: '/pages/create-lease/index?mode=history',
      success: res => {
        res.eventChannel.emit('historicalLeaseDraft', draft || {});
      }
    });
  }
});
