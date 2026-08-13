const STORAGE_KEY = 'today-can-spend:minimal:v1';
const THEME_STORAGE_KEY = 'today-can-spend:minimal:theme:v1';

let storageAdapter = null;

function getAdapter() {
  if (storageAdapter) return storageAdapter;
  if (typeof wx === 'undefined') {
    throw new Error('微信存储接口不可用');
  }
  return wx;
}

function isMissingKeyError(error) {
  return /not\s*found|data\s*not\s*found|不存在/i.test((error && error.errMsg) || '');
}

function asError(error, fallbackMessage) {
  if (error instanceof Error) return error;
  return new Error((error && error.errMsg) || fallbackMessage);
}

function readKey(key) {
  return new Promise((resolve, reject) => {
    let adapter;
    try {
      adapter = getAdapter();
    } catch (error) {
      reject(error);
      return;
    }
    adapter.getStorage({
      key,
      success: (result) => resolve(result.data),
      fail: (error) => {
        if (isMissingKeyError(error)) resolve(undefined);
        else reject(asError(error, '读取本地数据失败'));
      }
    });
  });
}

function writeKey(key, data) {
  return new Promise((resolve, reject) => {
    let adapter;
    try {
      adapter = getAdapter();
    } catch (error) {
      reject(error);
      return;
    }
    adapter.setStorage({
      key,
      data,
      success: () => resolve(),
      fail: (error) => reject(asError(error, '保存本地数据失败'))
    });
  });
}

function removeKey(key) {
  return new Promise((resolve, reject) => {
    let adapter;
    try {
      adapter = getAdapter();
    } catch (error) {
      reject(error);
      return;
    }
    adapter.removeStorage({
      key,
      success: () => resolve(),
      fail: (error) => {
        if (isMissingKeyError(error)) resolve();
        else reject(asError(error, '删除本地数据失败'));
      }
    });
  });
}

function readRaw() {
  return readKey(STORAGE_KEY);
}

function writeRaw(data) {
  return writeKey(STORAGE_KEY, data);
}

function removeRaw() {
  return removeKey(STORAGE_KEY);
}

function readThemeRaw() {
  return readKey(THEME_STORAGE_KEY);
}

function writeThemeRaw(data) {
  return writeKey(THEME_STORAGE_KEY, data);
}

function removeThemeRaw() {
  return removeKey(THEME_STORAGE_KEY);
}

function setStorageAdapterForTests(adapter) {
  storageAdapter = adapter || null;
}

module.exports = {
  readRaw,
  readThemeRaw,
  removeRaw,
  removeThemeRaw,
  setStorageAdapterForTests,
  writeRaw,
  writeThemeRaw
};
