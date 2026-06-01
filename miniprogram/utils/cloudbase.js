const app = getApp();

/**
 * 获取数据库实例
 */
function db() {
  return wx.cloud.database();
}

/**
 * 获取数据库命令
 */
function cmd() {
  return wx.cloud.database().command;
}

/**
 * 获取当前环境ID
 */
function envId() {
  return app.globalData.envId;
}

module.exports = {
  db,
  cmd,
  envId
};
