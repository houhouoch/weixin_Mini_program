const { normalizeAiEntries } = require('../domain/ai-entry');
const aiConfig = require('../config/ai');

function aiErrorMessage(code) {
  if (code === 'AI_NOT_CONFIGURED') return '智能整理还未配置，请修改文字后重试';
  if (code === 'AI_RATE_LIMITED') return '智能整理请求较多，请稍后再试';
  return '智能整理暂时不可用，请修改文字后重试';
}

async function parseEntriesWithAi(text) {
  if (typeof wx === 'undefined' || typeof wx.login !== 'function' || typeof wx.request !== 'function') {
    throw new Error('智能整理还未配置，请修改文字后重试');
  }
  if (!/^https:\/\//.test(aiConfig.endpoint)) {
    throw new Error('智能整理还未配置，请修改文字后重试');
  }
  const code = await new Promise((resolve, reject) => {
    wx.login({
      timeout: 10000,
      success(result) {
        if (result && result.code) resolve(result.code);
        else reject(new Error('WECHAT_LOGIN_FAILED'));
      },
      fail() {
        reject(new Error('WECHAT_LOGIN_FAILED'));
      }
    });
  }).catch(() => {
    throw new Error('微信身份校验失败，请稍后再试');
  });
  const response = await new Promise((resolve, reject) => {
    wx.request({
      url: aiConfig.endpoint,
      method: 'POST',
      timeout: 15000,
      header: { 'content-type': 'application/json' },
      data: {
        code,
        text: String(text || '').slice(0, 500)
      },
      success: resolve,
      fail: reject
    });
  }).catch(() => {
    throw new Error('智能整理暂时不可用，请修改文字后重试');
  });
  const result = response && response.data;
  if (!result || !result.ok) {
    throw new Error(aiErrorMessage(result && result.code));
  }
  const normalized = normalizeAiEntries(result.entries);
  if (!normalized.ok) throw new Error(normalized.error);
  return normalized.value;
}

module.exports = {
  parseEntriesWithAi
};
