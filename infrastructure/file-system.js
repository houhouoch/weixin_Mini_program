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

module.exports = { writeUserFile };
