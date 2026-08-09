const { getCategoryLabel } = require('./categories');
const { toDateKey } = require('./date');

function pad2(value) {
  return String(value).padStart(2, '0');
}

function escapeXml(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function inlineCell(reference, value, styleId) {
  const style = styleId === undefined ? '' : ` s="${styleId}"`;
  return `<c r="${reference}" t="inlineStr"${style}><is><t xml:space="preserve">${escapeXml(value)}</t></is></c>`;
}

function numberCell(reference, value, styleId) {
  const style = styleId === undefined ? '' : ` s="${styleId}"`;
  return `<c r="${reference}"${style}><v>${value}</v></c>`;
}

function formatLocalTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`;
}

function allTransactions(state) {
  const archived = (state.history || []).reduce(
    (records, month) => records.concat(month.transactions || []),
    []
  );
  return archived.concat(state.transactions || [])
    .slice()
    .sort((a, b) => a.occurredAt - b.occurredAt);
}

function makeWorksheet(state, generatedAt) {
  const records = allTransactions(state);
  const totalCents = records.reduce((sum, item) => sum + item.amountCents, 0);
  const generatedText = `${toDateKey(generatedAt)} ${formatLocalTime(generatedAt)}`;
  const rows = [
    `<row r="1" ht="30" customHeight="1">${inlineCell('A1', '今天还能花 · 本地流水', 1)}</row>`,
    `<row r="2">${inlineCell('A2', '导出时间', 2)}${inlineCell('B2', generatedText)}</row>`,
    `<row r="3">${inlineCell('A3', '记录笔数', 2)}${numberCell('B3', records.length)}</row>`,
    `<row r="4">${inlineCell('A4', '逐笔合计', 2)}${numberCell('B4', (totalCents / 100).toFixed(2), 5)}</row>`,
    `<row r="5" ht="34" customHeight="1">${inlineCell('A5', '说明', 2)}${inlineCell('B5', '仅包含有真实日期的逐笔记录；启用前汇总没有明细日期，不伪造成流水。', 6)}</row>`,
    '<row r="6"></row>',
    `<row r="7" ht="24" customHeight="1">${[
      ['A7', '日期'], ['B7', '时间'], ['C7', '分类'], ['D7', '用途'], ['E7', '金额（元）'], ['F7', '数据来源']
    ].map(([ref, label]) => inlineCell(ref, label, 3)).join('')}</row>`
  ];

  records.forEach((item, index) => {
    const rowNumber = index + 8;
    rows.push(`<row r="${rowNumber}">`
      + inlineCell(`A${rowNumber}`, toDateKey(item.occurredAt), 4)
      + inlineCell(`B${rowNumber}`, formatLocalTime(item.occurredAt), 4)
      + inlineCell(`C${rowNumber}`, getCategoryLabel(item.categoryId))
      + inlineCell(`D${rowNumber}`, item.note || '')
      + numberCell(`E${rowNumber}`, (item.amountCents / 100).toFixed(2), 5)
      + inlineCell(`F${rowNumber}`, item.id.indexOf('wechat-') === 0
        ? '微信支付导入'
        : '本机手动记录')
      + '</row>');
  });

  const totalRow = records.length + 8;
  rows.push(`<row r="${totalRow}" ht="24" customHeight="1">`
    + inlineCell(`A${totalRow}`, '合计', 7)
    + numberCell(`E${totalRow}`, (totalCents / 100).toFixed(2), 8)
    + '</row>');

  return {
    records,
    totalCents,
    xml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="7" topLeftCell="A8" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="20"/>
  <cols><col min="1" max="1" width="13" customWidth="1"/><col min="2" max="2" width="11" customWidth="1"/><col min="3" max="3" width="11" customWidth="1"/><col min="4" max="4" width="26" customWidth="1"/><col min="5" max="5" width="15" customWidth="1"/><col min="6" max="6" width="18" customWidth="1"/></cols>
  <sheetData>${rows.join('')}</sheetData>
  <autoFilter ref="A7:F${Math.max(totalRow - 1, 7)}"/>
  <mergeCells count="2"><mergeCell ref="A1:F1"/><mergeCell ref="B5:F5"/></mergeCells>
  <pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.2" footer="0.2"/>
</worksheet>`
  };
}

function utf8Bytes(value) {
  const encoded = unescape(encodeURIComponent(value));
  const bytes = new Uint8Array(encoded.length);
  for (let index = 0; index < encoded.length; index += 1) {
    bytes[index] = encoded.charCodeAt(index);
  }
  return bytes;
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) ? (0xEDB88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xFFFFFFFF;
  for (let index = 0; index < bytes.length; index += 1) {
    crc = CRC_TABLE[(crc ^ bytes[index]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function write16(target, offset, value) {
  target[offset] = value & 0xFF;
  target[offset + 1] = (value >>> 8) & 0xFF;
}

function write32(target, offset, value) {
  target[offset] = value & 0xFF;
  target[offset + 1] = (value >>> 8) & 0xFF;
  target[offset + 2] = (value >>> 16) & 0xFF;
  target[offset + 3] = (value >>> 24) & 0xFF;
}

function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  parts.forEach((part) => {
    output.set(part, offset);
    offset += part.length;
  });
  return output;
}

function dosDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  const year = Math.max(date.getFullYear(), 1980);
  return {
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2)
  };
}

function createZip(files, generatedAt) {
  const localParts = [];
  const centralParts = [];
  const stamp = dosDateTime(generatedAt);
  let localOffset = 0;

  files.forEach((file) => {
    const name = utf8Bytes(file.name);
    const data = utf8Bytes(file.content);
    const checksum = crc32(data);
    const localHeader = new Uint8Array(30 + name.length);
    write32(localHeader, 0, 0x04034B50);
    write16(localHeader, 4, 20);
    write16(localHeader, 6, 0x0800);
    write16(localHeader, 8, 0);
    write16(localHeader, 10, stamp.time);
    write16(localHeader, 12, stamp.date);
    write32(localHeader, 14, checksum);
    write32(localHeader, 18, data.length);
    write32(localHeader, 22, data.length);
    write16(localHeader, 26, name.length);
    write16(localHeader, 28, 0);
    localHeader.set(name, 30);
    localParts.push(localHeader, data);

    const centralHeader = new Uint8Array(46 + name.length);
    write32(centralHeader, 0, 0x02014B50);
    write16(centralHeader, 4, 20);
    write16(centralHeader, 6, 20);
    write16(centralHeader, 8, 0x0800);
    write16(centralHeader, 10, 0);
    write16(centralHeader, 12, stamp.time);
    write16(centralHeader, 14, stamp.date);
    write32(centralHeader, 16, checksum);
    write32(centralHeader, 20, data.length);
    write32(centralHeader, 24, data.length);
    write16(centralHeader, 28, name.length);
    write16(centralHeader, 30, 0);
    write16(centralHeader, 32, 0);
    write16(centralHeader, 34, 0);
    write16(centralHeader, 36, 0);
    write32(centralHeader, 38, 0);
    write32(centralHeader, 42, localOffset);
    centralHeader.set(name, 46);
    centralParts.push(centralHeader);
    localOffset += localHeader.length + data.length;
  });

  const central = concatBytes(centralParts);
  const end = new Uint8Array(22);
  write32(end, 0, 0x06054B50);
  write16(end, 4, 0);
  write16(end, 6, 0);
  write16(end, 8, files.length);
  write16(end, 10, files.length);
  write32(end, 12, central.length);
  write32(end, 16, localOffset);
  write16(end, 20, 0);
  return concatBytes(localParts.concat([central, end])).buffer;
}

function buildLedgerWorkbook(state, value) {
  if (!state) throw new Error('暂无可导出的本地数据');
  const generatedAt = value instanceof Date ? value : new Date(value || Date.now());
  const worksheet = makeWorksheet(state, generatedAt);
  if (!worksheet.records.length) throw new Error('还没有可导出的逐笔记录');

  const files = [
    {
      name: '[Content_Types].xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
    },
    {
      name: '_rels/.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
    },
    {
      name: 'xl/workbook.xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="流水" sheetId="1" r:id="rId1"/></sheets></workbook>'
    },
    {
      name: 'xl/_rels/workbook.xml.rels',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
    },
    {
      name: 'xl/styles.xml',
      content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="¥#,##0.00"/></numFmts><fonts count="3"><font><sz val="11"/><color rgb="FF183B32"/><name val="Microsoft YaHei"/></font><font><b/><sz val="18"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Microsoft YaHei"/></font></fonts><fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF123F35"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF4C247"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FFE6DBC0"/></left><right style="thin"><color rgb="FFE6DBC0"/></right><top style="thin"><color rgb="FFE6DBC0"/></top><bottom style="thin"><color rgb="FFE6DBC0"/></bottom><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="9"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyFont="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="164" fontId="0" fillId="3" borderId="1" xfId="0" applyNumberFormat="1" applyFill="1" applyBorder="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'
    },
    { name: 'xl/worksheets/sheet1.xml', content: worksheet.xml }
  ];
  const stamp = `${generatedAt.getFullYear()}${pad2(generatedAt.getMonth() + 1)}${pad2(generatedAt.getDate())}-${pad2(generatedAt.getHours())}${pad2(generatedAt.getMinutes())}`;
  return {
    buffer: createZip(files, generatedAt),
    fileName: `今天还能花-流水-${stamp}.xlsx`,
    recordCount: worksheet.records.length,
    totalCents: worksheet.totalCents
  };
}

module.exports = { buildLedgerWorkbook };
