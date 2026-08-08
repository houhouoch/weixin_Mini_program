const STORAGE_KEY = 'today-can-spend:v1';

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

function readRaw() {
  return new Promise((resolve, reject) => {
    let adapter;
    try {
      adapter = getAdapter();
    } catch (error) {
      reject(error);
      return;
    }
    adapter.getStorage({
      key: STORAGE_KEY,
      success: (result) => resolve(result.data),
      fail: (error) => {
        if (isMissingKeyError(error)) resolve(undefined);
        else reject(asError(error, '读取本地数据失败'));
      }
    });
  });
}

function writeRaw(data) {
  return new Promise((resolve, reject) => {
    let adapter;
    try {
      adapter = getAdapter();
    } catch (error) {
      reject(error);
      return;
    }
    adapter.setStorage({
      key: STORAGE_KEY,
      data,
      success: () => resolve(),
      fail: (error) => reject(asError(error, '保存本地数据失败'))
    });
  });
}

function removeRaw() {
  return new Promise((resolve, reject) => {
    let adapter;
    try {
      adapter = getAdapter();
    } catch (error) {
      reject(error);
      return;
    }
    adapter.removeStorage({
      key: STORAGE_KEY,
      success: () => resolve(),
      fail: (error) => {
        if (isMissingKeyError(error)) resolve();
        else reject(asError(error, '删除本地数据失败'));
      }
    });
  });
}

function setStorageAdapterForTests(adapter) {
  storageAdapter = adapter || null;
}

module.exports = {
  readRaw,
  removeRaw,
  setStorageAdapterForTests,
  writeRaw
};
