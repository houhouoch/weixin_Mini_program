const { buildLedgerWorkbook } = require('../domain/ledger-workbook');
const { writeUserFile } = require('../infrastructure/file-system');
const { readState } = require('./state-store');

async function exportLedger(now) {
  const result = await readState();
  if (!result.state) throw new Error('暂无可导出的本地数据');
  const workbook = buildLedgerWorkbook(result.state, now || new Date());
  const filePath = await writeUserFile('今天还能花-流水.xlsx', workbook.buffer);
  return {
    fileName: workbook.fileName,
    filePath,
    recordCount: workbook.recordCount
  };
}

module.exports = { exportLedger };
