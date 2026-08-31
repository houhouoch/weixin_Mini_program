const { isSupportedThemeSettings, normalizeThemeSettings } = require('../domain/theme');
const { readTextFile, writeUserFile } = require('../infrastructure/file-system');
const themeStore = require('./theme-store');
const { normalizeState, readState, saveState } = require('./state-store');

const BACKUP_FILE_TYPE = 'today-can-spend-backup';
const BACKUP_FORMAT_VERSION = 1;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatLocalTimestamp(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function isValidThemeSettings(settings) {
  return isSupportedThemeSettings(settings);
}

function parseBackupText(text) {
  let document;
  try {
    document = JSON.parse(text);
  } catch (error) {
    throw new Error('备份文件不是有效的 JSON');
  }
  if (!document
    || document.fileType !== BACKUP_FILE_TYPE
    || document.formatVersion !== BACKUP_FORMAT_VERSION) {
    throw new Error('这不是“今天还能花”的完整备份文件');
  }
  const normalizedState = normalizeState(document.state);
  if (!Number.isFinite(Date.parse(document.exportedAt))
    || !normalizedState
    || !isValidThemeSettings(document.themeSettings)) {
    throw new Error('备份内容已损坏或版本不受支持');
  }
  document.state = normalizedState;
  document.themeSettings = normalizeThemeSettings(document.themeSettings);
  return document;
}

function summarizeDocument(document, file) {
  const months = document.state.history.map((item) => item.monthKey)
    .concat(document.state.monthKey)
    .sort();
  const recordCount = document.state.history.reduce(
    (count, item) => count + item.transactions.length,
    document.state.transactions.length
  );
  return {
    exportedAt: document.exportedAt,
    exportedAtText: formatLocalTimestamp(document.exportedAt),
    fileName: file && file.name ? file.name : '完整备份.json',
    filePath: file && (file.path || file.tempFilePath) ? file.path || file.tempFilePath : '',
    monthFrom: months[0],
    monthTo: months[months.length - 1],
    recordCount
  };
}

async function createDataBackup(now) {
  const exportedAt = now || new Date();
  const result = await readState();
  if (!result.state) throw new Error('暂无可备份的本地数据');
  const theme = await themeStore.loadTheme();
  const document = {
    fileType: BACKUP_FILE_TYPE,
    formatVersion: BACKUP_FORMAT_VERSION,
    exportedAt: exportedAt.toISOString(),
    state: result.state,
    themeSettings: theme.settings
  };
  const stamp = `${exportedAt.getFullYear()}${pad2(exportedAt.getMonth() + 1)}${pad2(exportedAt.getDate())}-${pad2(exportedAt.getHours())}${pad2(exportedAt.getMinutes())}`;
  const fileName = `今天还能花-完整备份-${stamp}.json`;
  const filePath = await writeUserFile(fileName, JSON.stringify(document, null, 2));
  return Object.assign(summarizeDocument(document, { name: fileName, path: filePath }), {
    fileName,
    filePath
  });
}

async function previewDataBackup(file) {
  if (!file || !/\.json$/i.test(file.name || '') || !(file.path || file.tempFilePath)) {
    throw new Error('请选择“今天还能花”导出的 .json 完整备份');
  }
  const filePath = file.path || file.tempFilePath;
  const document = parseBackupText(await readTextFile(filePath));
  return summarizeDocument(document, { name: file.name, path: filePath });
}

async function restoreDataBackup(filePath) {
  if (typeof filePath !== 'string' || !filePath) throw new Error('备份文件路径无效');
  const document = parseBackupText(await readTextFile(filePath));
  const previousTheme = await themeStore.loadTheme();
  await themeStore.saveTheme(document.themeSettings);
  try {
    await saveState(document.state);
  } catch (error) {
    try {
      await themeStore.saveTheme(previousTheme.settings);
    } catch (rollbackError) {
      console.error('恢复失败后的本地回滚也失败', rollbackError);
    }
    throw error;
  }
  return summarizeDocument(document, { path: filePath });
}

module.exports = {
  BACKUP_FILE_TYPE,
  BACKUP_FORMAT_VERSION,
  createDataBackup,
  previewDataBackup,
  restoreDataBackup
};
