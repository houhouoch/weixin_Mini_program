const { formatCents } = require('../domain/money');
const { parseWechatBillCsv, parseWechatBillXlsx } = require('../domain/wechat-bill');
const { readTextFile, readZipTextEntries } = require('../infrastructure/file-system');
const { listTransactions } = require('./transactions');

const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

function extensionOf(name) {
  const match = /\.([^.]+)$/.exec(String(name || '').toLowerCase());
  return match ? match[1] : '';
}

function entryData(entries, path) {
  const normalizedPath = String(path).replace(/^\/+/, '').toLowerCase();
  const matchedPath = Object.keys(entries || {}).find((entryPath) => String(entryPath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .toLowerCase() === normalizedPath);
  const item = matchedPath ? entries[matchedPath] : null;
  if (!item || item.errMsg && !/ok$/i.test(item.errMsg)) return '';
  return typeof item.data === 'string' ? item.data : '';
}

function parseXlsxEntries(entries, now) {
  const paths = Object.keys(entries || {});
  const worksheetPath = paths
    .filter((path) => /^\/?xl[\\/]worksheets[\\/]sheet\d+\.xml$/i.test(path))
    .sort()[0];
  if (!worksheetPath) throw new Error('Excel 中没有找到可读取的账单工作表');
  const sheetXml = entryData(entries, worksheetPath);
  if (!sheetXml) throw new Error('没有读取到 Excel 工作表内容，请升级微信后重试');
  const sharedStringsXml = entryData(entries, 'xl/sharedStrings.xml');
  if (/\bt="s"/.test(sheetXml) && !sharedStringsXml) {
    throw new Error('没有读取到 Excel 文本索引，请升级微信后重试');
  }
  return parseWechatBillXlsx(
    sheetXml,
    sharedStringsXml,
    now
  );
}

async function parseSelectedFile(file, now) {
  if (!file || !file.path || !file.name) throw new Error('没有选择账单文件');
  if (Number(file.size) > MAX_IMPORT_FILE_BYTES) {
    throw new Error('账单文件超过 10 MB，请缩小日期范围后重新导出');
  }
  const extension = extensionOf(file.name);
  if (extension === 'xlsx') {
    return parseXlsxEntries(await readZipTextEntries(file.path), now);
  }
  if (extension === 'csv' || extension === 'txt') {
    return parseWechatBillCsv(await readTextFile(file.path), now);
  }
  throw new Error('请选择解压后的 .xlsx 或 .csv 微信账单文件');
}

async function previewWechatBill(file, now) {
  const parsed = await parseSelectedFile(file, now || new Date());
  if (!parsed.records.length) {
    throw new Error('文件中没有可导入的支出；请检查账单范围和交易状态');
  }
  const existing = await listTransactions({ all: true });
  const existingIds = new Set(existing.map((item) => item.id));
  const records = parsed.records.filter((item) => !existingIds.has(item.id));
  const existingDuplicateCount = parsed.records.length - records.length;
  return Object.assign({}, parsed, {
    existingDuplicateCount,
    fileName: String(file.name).slice(0, 80),
    importCount: records.length,
    records,
    totalText: formatCents(records.reduce((sum, item) => sum + item.amountCents, 0))
  });
}

module.exports = { MAX_IMPORT_FILE_BYTES, parseXlsxEntries, previewWechatBill };
