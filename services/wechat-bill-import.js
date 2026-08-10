const { formatCents } = require('../domain/money');
const { looksLikeAlipayBill, parseAlipayBillCsv } = require('../domain/alipay-bill');
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
  return Object.assign(parseWechatBillXlsx(
    sheetXml,
    sharedStringsXml,
    now
  ), { source: 'wechat', sourceLabel: '微信支付' });
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
    const text = await readTextFile(file.path);
    if (looksLikeAlipayBill(text)) return parseAlipayBillCsv(text, now);
    return Object.assign(parseWechatBillCsv(text, now), {
      source: 'wechat',
      sourceLabel: '微信支付'
    });
  }
  throw new Error('请选择微信解压后的 .xlsx/.csv，或支付宝导出的 .csv 账单文件');
}

function skippedSummary(parsed) {
  const parts = [];
  if (parsed.skippedRepaymentCount) parts.push(`还款 ${parsed.skippedRepaymentCount} 笔`);
  if (parsed.skippedNeutralizedRefundCount) {
    parts.push(`全额退款抵消 ${parsed.skippedNeutralizedRefundCount} 笔`);
  }
  if (parsed.skippedNonCashCount) parts.push(`不计收支 ${parsed.skippedNonCashCount} 笔`);
  if (parsed.skippedIncomeCount) parts.push(`收入/不计收支 ${parsed.skippedIncomeCount} 笔`);
  if (parsed.skippedStatusCount) parts.push(`关闭/无效状态 ${parsed.skippedStatusCount} 笔`);
  const invalid = (parsed.skippedInvalidCount || 0) + (parsed.skippedOutOfRangeCount || 0);
  if (invalid) parts.push(`无效或超期 ${invalid} 笔`);
  return parts.length ? `另跳过：${parts.join('、')}。` : '没有其他需要跳过的记录。';
}

async function previewBill(file, now) {
  const parsed = await parseSelectedFile(file, now || new Date());
  if (!parsed.records.length) {
    throw new Error('文件中没有可导入的收支；还款、不计收支和已抵消的全额退款不会重复计入');
  }
  const existing = await listTransactions({ all: true });
  const existingIds = new Set(existing.map((item) => item.id));
  const records = parsed.records.filter((item) => !existingIds.has(item.id));
  const existingDuplicateCount = parsed.records.length - records.length;
  const expenseTotalCents = records
    .filter((item) => item.direction !== 'income')
    .reduce((sum, item) => sum + item.amountCents, 0);
  const incomeTotalCents = records
    .filter((item) => item.direction === 'income')
    .reduce((sum, item) => sum + item.amountCents, 0);
  return Object.assign({}, parsed, {
    existingDuplicateCount,
    fileName: String(file.name).slice(0, 80),
    importCount: records.length,
    records,
    expenseCount: records.filter((item) => item.direction !== 'income').length,
    incomeCount: records.filter((item) => item.direction === 'income').length,
    expenseTotalText: formatCents(expenseTotalCents),
    incomeTotalText: formatCents(incomeTotalCents),
    skippedSummary: skippedSummary(parsed),
    ruleSummary: parsed.source === 'alipay'
      ? '还款只是在结清已有欠款，不重复算消费；部分退款按收入冲减，全额退款与已关闭原交易一起抵消。'
      : '微信账单当前只导入有效支出，退款、撤销和关闭记录会跳过。',
    totalText: formatCents(expenseTotalCents)
  });
}

module.exports = {
  MAX_IMPORT_FILE_BYTES,
  parseXlsxEntries,
  previewBill,
  previewWechatBill: previewBill
};
