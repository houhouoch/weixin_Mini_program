const { TRANSACTION_MAX_CENTS, parseYuanToCents } = require('./money');
const { toDateKey, toMonthKey } = require('./date');

const HEADER_ALIASES = Object.freeze({
  time: ['交易时间'],
  type: ['交易类型'],
  counterparty: ['交易对方'],
  product: ['商品'],
  direction: ['收/支', '收支'],
  amount: ['金额(元)', '金额（元）', '金额'],
  payment: ['支付方式'],
  status: ['当前状态', '交易状态'],
  orderNo: ['交易单号'],
  remark: ['备注']
});

const CATEGORY_RULES = Object.freeze([
  ['medical', /医院|药房|药店|医疗|门诊|挂号|体检/],
  ['transport', /地铁|公交|打车|出租|滴滴|高铁|火车|机票|航空|加油|停车|充电桩|出行/],
  ['food', /餐|饭|咖啡|奶茶|饮品|美团|饿了么|外卖|餐饮|食品|面包|水果|超市/],
  ['shopping', /淘宝|天猫|京东|拼多多|商城|购物|服饰|鞋|数码|电器/],
  ['daily', /日用|生活缴费|水费|电费|燃气|话费|物业|房租|快递|洗衣/],
  ['entertainment', /电影|游戏|视频|音乐|会员|娱乐|景区|门票|演出/],
  ['social', /红包|转账|礼金|礼物|人情/]
]);

function decodeXml(value) {
  return String(value || '')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&');
}

function normalizeHeader(value) {
  return String(value == null ? '' : value)
    .replace(/^\uFEFF/, '')
    .replace(/[`\s]/g, '')
    .replace(/：/g, ':')
    .toLowerCase();
}

function detectDelimiter(text) {
  const lines = String(text || '').split(/\r?\n/).slice(0, 20);
  const candidate = lines.find((line) => line.indexOf('交易时间') >= 0) || '';
  return candidate.split('\t').length > candidate.split(',').length ? '\t' : ',';
}

function parseDelimitedRows(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let cell = '';
  let quoted = false;
  const source = String(text == null ? '' : text).replace(/^\uFEFF/, '');

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (char === '"') {
      if (quoted && source[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === delimiter && !quoted) {
      row.push(cell);
      cell = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      row.push(cell);
      if (row.some((value) => String(value).trim())) rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }
  row.push(cell);
  if (row.some((value) => String(value).trim())) rows.push(row);
  return rows;
}

function parseSharedStrings(xml) {
  const strings = [];
  const source = String(xml || '');
  const itemPattern = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let itemMatch;
  while ((itemMatch = itemPattern.exec(source))) {
    const parts = [];
    const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let textMatch;
    while ((textMatch = textPattern.exec(itemMatch[1]))) parts.push(decodeXml(textMatch[1]));
    strings.push(parts.join(''));
  }
  return strings;
}

function columnIndex(reference) {
  const letters = /^([A-Z]+)/i.exec(reference || '');
  if (!letters) return -1;
  return letters[1].toUpperCase().split('').reduce(
    (value, letter) => value * 26 + letter.charCodeAt(0) - 64,
    0
  ) - 1;
}

function parseWorksheetRows(sheetXml, sharedStringsXml) {
  const sharedStrings = parseSharedStrings(sharedStringsXml);
  const rows = [];
  const rowPattern = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;
  while ((rowMatch = rowPattern.exec(String(sheetXml || '')))) {
    const row = [];
    const cellPattern = /<c\b([^>]*)>([\s\S]*?)<\/c>/g;
    let cellMatch;
    while ((cellMatch = cellPattern.exec(rowMatch[1]))) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const reference = /\br="([^"]+)"/.exec(attrs);
      const type = /\bt="([^"]+)"/.exec(attrs);
      const valueMatch = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body);
      const inlineMatch = /<is\b[^>]*>([\s\S]*?)<\/is>/.exec(body);
      let value = valueMatch ? decodeXml(valueMatch[1]) : '';
      if (type && type[1] === 's') value = sharedStrings[Number(value)] || '';
      if (type && type[1] === 'inlineStr' && inlineMatch) {
        const parts = [];
        const textPattern = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let textMatch;
        while ((textMatch = textPattern.exec(inlineMatch[1]))) parts.push(decodeXml(textMatch[1]));
        value = parts.join('');
      }
      const index = reference ? columnIndex(reference[1]) : row.length;
      if (index >= 0) row[index] = value;
    }
    if (row.some((value) => String(value || '').trim())) rows.push(row);
  }
  return rows;
}

function findHeader(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const normalized = rows[rowIndex].map(normalizeHeader);
    const columns = {};
    Object.keys(HEADER_ALIASES).forEach((field) => {
      columns[field] = normalized.findIndex((value) => HEADER_ALIASES[field]
        .map(normalizeHeader).indexOf(value) >= 0);
    });
    if (columns.time >= 0 && columns.direction >= 0 && columns.amount >= 0) {
      return { columns, rowIndex };
    }
  }
  throw new Error('没有识别到微信账单表头，请选择解压后的官方账单文件');
}

function parseExcelSerialTimestamp(value) {
  const text = String(value || '').trim();
  if (!/^\d{1,7}(?:\.\d+)?$/.test(text)) return null;
  const serial = Number(text);
  if (!Number.isFinite(serial) || serial < 1 || serial >= 2958466) return null;
  const wholeDays = Math.floor(serial);
  const adjustedDays = wholeDays >= 60 ? wholeDays - 1 : wholeDays;
  const fractionMs = Math.round((serial - wholeDays) * 86400000);
  const utcDate = new Date(
    Date.UTC(1899, 11, 31) + adjustedDays * 86400000 + fractionMs
  );
  return new Date(
    utcDate.getUTCFullYear(),
    utcDate.getUTCMonth(),
    utcDate.getUTCDate(),
    utcDate.getUTCHours(),
    utcDate.getUTCMinutes(),
    utcDate.getUTCSeconds()
  ).getTime();
}

function parseLocalTimestamp(value) {
  const excelTimestamp = parseExcelSerialTimestamp(value);
  if (excelTimestamp) return excelTimestamp;
  const match = /(\d{4})[-\/]?(\d{1,2})[-\/]?(\d{1,2})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/.exec(
    String(value || '').replace(/`/g, '').trim()
  );
  if (!match) return null;
  const date = new Date(
    Number(match[1]), Number(match[2]) - 1, Number(match[3]),
    Number(match[4]), Number(match[5]), Number(match[6] || 0)
  );
  if (date.getFullYear() !== Number(match[1])
    || date.getMonth() !== Number(match[2]) - 1
    || date.getDate() !== Number(match[3])) return null;
  return date.getTime();
}

function cell(row, index) {
  return index >= 0 ? String(row[index] == null ? '' : row[index]).replace(/^`/, '').trim() : '';
}

function inferCategory(text) {
  const source = String(text || '');
  const matched = CATEGORY_RULES.find((rule) => rule[1].test(source));
  return matched ? matched[0] : 'other';
}

function shortNote(product, counterparty) {
  const unusable = /^(\/|-|--|无)?$/;
  const preferred = unusable.test(String(product || '').trim()) ? counterparty : product;
  return String(preferred || '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function hashText(value, seed) {
  let hash = seed >>> 0;
  const source = String(value || '');
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash.toString(36);
}

function stableWechatId(values) {
  const identity = values.orderNo || [
    values.time, values.amount, values.counterparty, values.product,
    values.payment, values.type
  ].join('|');
  return `wechat-${hashText(identity, 2166136261)}-${hashText(identity, 3335557771)}`;
}

function monthDistance(current, occurredAt) {
  const date = new Date(occurredAt);
  return (current.getFullYear() - date.getFullYear()) * 12
    + current.getMonth() - date.getMonth();
}

function parseWechatBillRows(rows, value) {
  const now = value instanceof Date ? value : new Date(value || Date.now());
  const header = findHeader(rows);
  const records = [];
  const counts = {
    sourceRowCount: Math.max(0, rows.length - header.rowIndex - 1),
    skippedIncomeCount: 0,
    skippedStatusCount: 0,
    skippedInvalidCount: 0,
    skippedOutOfRangeCount: 0
  };

  rows.slice(header.rowIndex + 1).forEach((row) => {
    const values = {};
    Object.keys(header.columns).forEach((field) => {
      values[field] = cell(row, header.columns[field]);
    });
    if (!Object.values(values).some(Boolean)) return;
    if (values.direction.indexOf('支出') < 0) {
      counts.skippedIncomeCount += 1;
      return;
    }
    if (/退款|撤销|关闭/.test(values.status)) {
      counts.skippedStatusCount += 1;
      return;
    }
    const occurredAt = parseLocalTimestamp(values.time);
    const amount = parseYuanToCents(values.amount.replace(/[¥￥,\s]/g, ''), {
      allowZero: false,
      maxCents: TRANSACTION_MAX_CENTS
    });
    if (!occurredAt || !amount.ok) {
      counts.skippedInvalidCount += 1;
      return;
    }
    const distance = monthDistance(now, occurredAt);
    if (occurredAt > now.getTime() + 5 * 60 * 1000 || distance < 0 || distance > 36) {
      counts.skippedOutOfRangeCount += 1;
      return;
    }
    const categoryText = [
      values.type, values.counterparty, values.product, values.remark
    ].join(' ');
    records.push({
      id: stableWechatId(values),
      amountCents: amount.value,
      categoryId: inferCategory(categoryText),
      note: shortNote(values.product, values.counterparty),
      occurredAt
    });
  });

  const unique = [];
  const ids = new Set();
  let duplicateInFileCount = 0;
  records.forEach((record) => {
    if (ids.has(record.id)) {
      duplicateInFileCount += 1;
      return;
    }
    ids.add(record.id);
    unique.push(record);
  });
  const sorted = unique.sort((a, b) => a.occurredAt - b.occurredAt);
  return Object.assign(counts, {
    duplicateInFileCount,
    records: sorted,
    dateFrom: sorted.length ? toDateKey(sorted[0].occurredAt) : '',
    dateTo: sorted.length ? toDateKey(sorted[sorted.length - 1].occurredAt) : '',
    monthFrom: sorted.length ? toMonthKey(sorted[0].occurredAt) : '',
    monthTo: sorted.length ? toMonthKey(sorted[sorted.length - 1].occurredAt) : '',
    totalCents: sorted.reduce((sum, record) => sum + record.amountCents, 0)
  });
}

function parseWechatBillCsv(text, now) {
  return parseWechatBillRows(parseDelimitedRows(text), now);
}

function parseWechatBillXlsx(sheetXml, sharedStringsXml, now) {
  return parseWechatBillRows(parseWorksheetRows(sheetXml, sharedStringsXml), now);
}

module.exports = {
  parseDelimitedRows,
  parseExcelSerialTimestamp,
  parseWechatBillCsv,
  parseWechatBillRows,
  parseWechatBillXlsx,
  parseWorksheetRows
};
