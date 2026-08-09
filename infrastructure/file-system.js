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
      entries: 'all',
      encoding: 'utf8',
      success: (result) => resolve(result.entries || {}),
      fail: (error) => reject(new Error(error && error.errMsg
        ? error.errMsg
        : 'Excel 账单解析失败'))
    });
  });
}

module.exports = { readTextFile, readZipTextEntries, writeUserFile };
