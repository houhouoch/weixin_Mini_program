function writeUserFile(fileName, data) {
  return new Promise((resolve, reject) => {
    if (typeof wx === 'undefined' || !wx.env || !wx.env.USER_DATA_PATH) {
      reject(new Error('当前环境不支持写入小程序文件'));
      return;
    }
    const filePath = `${wx.env.USER_DATA_PATH}/${fileName}`;
    wx.getFileSystemManager().writeFile({
      filePath,
      data,
      success: () => resolve(filePath),
      fail: (error) => reject(new Error(error && error.errMsg
        ? error.errMsg
        : '导出文件写入失败'))
    });
  });
}

function fileSystem() {
  if (typeof wx === 'undefined' || typeof wx.getFileSystemManager !== 'function') {
    throw new Error('当前环境不支持读取小程序文件');
  }
  return wx.getFileSystemManager();
}

function readTextFile(filePath) {
  return new Promise((resolve, reject) => {
    let manager;
    try {
      manager = fileSystem();
    } catch (error) {
      reject(error);
      return;
    }
    manager.readFile({
      filePath,
      encoding: 'utf8',
      success: (result) => resolve(result.data),
      fail: (error) => reject(new Error(error && error.errMsg
        ? error.errMsg
        : '账单文件读取失败'))
    });
  });
}

function decodeUtf8Data(data) {
  if (typeof data === 'string') return data.replace(/^\uFEFF/, '');
  let bytes;
  if (data instanceof ArrayBuffer) {
    bytes = new Uint8Array(data);
  } else if (ArrayBuffer.isView && ArrayBuffer.isView(data)) {
    bytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  } else {
    return '';
  }
  let output = '';
  for (let index = 0; index < bytes.length;) {
    const first = bytes[index];
    let codePoint;
    let length;
    if (first < 0x80) {
      codePoint = first;
      length = 1;
    } else if ((first & 0xE0) === 0xC0 && index + 1 < bytes.length) {
      codePoint = ((first & 0x1F) << 6) | (bytes[index + 1] & 0x3F);
      length = 2;
    } else if ((first & 0xF0) === 0xE0 && index + 2 < bytes.length) {
      codePoint = ((first & 0x0F) << 12)
        | ((bytes[index + 1] & 0x3F) << 6)
        | (bytes[index + 2] & 0x3F);
      length = 3;
    } else if ((first & 0xF8) === 0xF0 && index + 3 < bytes.length) {
      codePoint = ((first & 0x07) << 18)
        | ((bytes[index + 1] & 0x3F) << 12)
        | ((bytes[index + 2] & 0x3F) << 6)
        | (bytes[index + 3] & 0x3F);
      length = 4;
    } else {
      codePoint = 0xFFFD;
      length = 1;
    }
    if (codePoint > 0xFFFF) {
      const offset = codePoint - 0x10000;
      output += String.fromCharCode(0xD800 + (offset >> 10), 0xDC00 + (offset & 0x3FF));
    } else {
      output += String.fromCharCode(codePoint);
    }
    index += length;
  }
  return output.replace(/^\uFEFF/, '');
}

function normalizeZipEntries(entries) {
  return Object.keys(entries || {}).reduce((normalized, path) => {
    const key = String(path).replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '');
    const item = entries[path] || {};
    normalized[key] = Object.assign({}, item, { data: decodeUtf8Data(item.data) });
    return normalized;
  }, {});
}

function readZipTextEntries(filePath) {
  return new Promise((resolve, reject) => {
    let manager;
    try {
      manager = fileSystem();
    } catch (error) {
      reject(error);
      return;
    }
    if (typeof manager.readZipEntry !== 'function') {
      reject(new Error('当前微信版本过低，暂不支持读取 Excel；请升级微信或改用 CSV'));
      return;
    }
    manager.readZipEntry({
      filePath,
      entries: [{
        path: 'xl/worksheets/sheet1.xml',
        encoding: 'utf-8'
      }, {
        path: 'xl/sharedStrings.xml',
        encoding: 'utf-8'
      }],
      success: (result) => resolve(normalizeZipEntries(result.entries || {})),
      fail: (error) => reject(new Error(error && error.errMsg
        ? error.errMsg
        : 'Excel 账单解析失败'))
    });
  });
}

module.exports = {
  decodeUtf8Data,
  normalizeZipEntries,
  readTextFile,
  readZipTextEntries,
  writeUserFile
};
