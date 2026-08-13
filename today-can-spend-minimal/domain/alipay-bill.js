const { TRANSACTION_MAX_CENTS, parseYuanToCents } = require('./money');
const { toDateKey, toMonthKey } = require('./date');
const { parseDelimitedRows, parseLocalTimestamp } = require('./wechat-bill');

const HEADER_ALIASES = Object.freeze({
  time: ['交易时间'],
  category: ['交易分类'],
  counterparty: ['交易对方'],
  product: ['商品说明'],
  direction: ['收/支', '收支'],
  amount: ['金额'],
  payment: ['收/付款方式'],
  status: ['交易状态'],
  orderNo: ['交易订单号'],
  merchantNo: ['商家订单号'],
  remark: ['备注']
});

function normalizeHeader(value) {
  return String(value == null ? '' : value)
    .replace(/^\uFEFF/, '')
    .replace(/[`\s]/g, '')
    .toLowerCase();
}

function findHeader(rows) {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
    const normalized = rows[rowIndex].map(normalizeHeader);
    const columns = {};
    Object.keys(HEADER_ALIASES).forEach((field) => {
      columns[field] = normalized.findIndex((value) => HEADER_ALIASES[field]
        .map(normalizeHeader).indexOf(value) >= 0);
    });
    if (columns.time >= 0 && columns.category >= 0 && columns.direction >= 0
      && columns.amount >= 0 && columns.status >= 0) return { columns, rowIndex };
  }
  throw new Error('没有识别到支付宝账单表头，请选择支付宝导出的官方 CSV 文件');
}

function cell(row, index) {
  return index >= 0 ? String(row[index] == null ? '' : row[index]).replace(/^`/, '').trim() : '';
}

function rowValues(row, columns) {
  const values = {};
  Object.keys(columns).forEach((field) => {
    values[field] = cell(row, columns[field]);
  });
  return values;
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

function stableAlipayId(values) {
  const identity = [
    values.orderNo, values.merchantNo, values.time, values.amount,
    values.status, values.direction, values.category
  ].join('|');
  return `alipay-${hashText(identity, 2166136261)}-${hashText(identity, 3335557771)}`;
}

function shortNote(product, counterparty) {
  const unusable = /^(\/|-|--|无)?$/;
  const preferred = unusable.test(String(product || '').trim()) ? counterparty : product;
  return String(preferred || '').replace(/\s+/g, ' ').trim().slice(0, 20);
}

function expenseCategory(values) {
  const source = [values.category, values.product, values.counterparty].join(' ');
  if (/医疗|药房|医院|健康/.test(source)) return 'medical';
  if (/交通|出行|地铁|公交|打车|停车|加油/.test(source)) return 'transport';
  if (/餐饮|美食|咖啡|奶茶|食品|外卖|超市/.test(source)) return 'food';
  if (/数码|电器|购物|服饰|商城/.test(source)) return 'shopping';
  if (/日用|百货|家居|家装|美容|美发|生活缴费/.test(source)) return 'daily';
  if (/文化|休闲|电影|游戏|会员|娱乐/.test(source)) return 'entertainment';
  if (/转账|红包|礼金|礼物|人情/.test(source)) return 'social';
  return 'other';
}

function incomeCategory(values, isRefund) {
  if (isRefund) return 'income_refund';
  const source = [values.category, values.product, values.counterparty, values.remark].join(' ');
  if (/工资|薪资/.test(source)) return 'income_salary';
  if (/奖金/.test(source)) return 'income_bonus';
  if (/报销/.test(source)) return 'income_reimbursement';
  if (/红包|礼金/.test(source)) return 'income_gift';
  if (/转账|收款/.test(source)) return 'income_transfer';
  if (/兼职|外快|稿费/.test(source)) return 'income_side_job';
  return 'income_other';
}

function monthDistance(current, occurredAt) {
  const date = new Date(occurredAt);
  return (current.getFullYear() - date.getFullYear()) * 12
    + current.getMonth() - date.getMonth();
}

function amountResult(value) {
  return parseYuanToCents(String(value || '').replace(/[¥￥,\s]/g, ''), {
    allowZero: false,
    maxCents: TRANSACTION_MAX_CENTS
  });
}

function isRepayment(values) {
  if (/还款/.test(values.status) || /信用借还/.test(values.category)) return true;
  if (values.direction.indexOf('收入') >= 0) return false;
  return /还款/.test([values.product, values.counterparty, values.remark].join(' '));
}

function matchingKeys(values) {
  return [values.orderNo, values.merchantNo].filter(Boolean);
}

function isNeutralizedFullRefund(values, closedRows, cents) {
  const keys = matchingKeys(values);
  if (!keys.length) return false;
  return closedRows.some((closed) => {
    const closedAmount = amountResult(closed.amount);
    if (!closedAmount.ok || closedAmount.value !== cents) return false;
    const closedKeys = matchingKeys(closed);
    return keys.some((key) => closedKeys.indexOf(key) >= 0);
  });
}

function parseAlipayBillRows(rows, value) {
  const now = value instanceof Date ? value : new Date(value || Date.now());
  const header = findHeader(rows);
  const sourceRows = rows.slice(header.rowIndex + 1)
    .map((row) => rowValues(row, header.columns))
    .filter((values) => Object.values(values).some(Boolean));
  const closedRows = sourceRows.filter((values) => /交易关闭/.test(values.status));
  const records = [];
  const counts = {
    sourceRowCount: sourceRows.length,
    skippedIncomeCount: 0,
    skippedStatusCount: 0,
    skippedInvalidCount: 0,
    skippedOutOfRangeCount: 0,
    skippedRepaymentCount: 0,
    skippedNonCashCount: 0,
    skippedNeutralizedRefundCount: 0,
    refundIncomeCount: 0,
    expenseCount: 0,
    incomeCount: 0
  };

  sourceRows.forEach((values) => {
    if (isRepayment(values)) {
      counts.skippedRepaymentCount += 1;
      return;
    }
    const isRefund = /退款成功/.test(values.status) && /退款/.test(values.category);
    const isExpense = values.direction.indexOf('支出') >= 0
      && /交易成功|等待确认收货|交易完成/.test(values.status);
    const isIncome = values.direction.indexOf('收入') >= 0
      && /交易成功|收款成功|已收款/.test(values.status);
    if (!isRefund && !isExpense && !isIncome) {
      if (values.direction.indexOf('不计收支') >= 0) counts.skippedNonCashCount += 1;
      else counts.skippedStatusCount += 1;
      return;
    }
    const occurredAt = parseLocalTimestamp(values.time);
    const amount = amountResult(values.amount);
    if (!occurredAt || !amount.ok) {
      counts.skippedInvalidCount += 1;
      return;
    }
    const distance = monthDistance(now, occurredAt);
    if (occurredAt > now.getTime() + 5 * 60 * 1000 || distance < 0 || distance > 36) {
      counts.skippedOutOfRangeCount += 1;
      return;
    }
    if (isRefund && isNeutralizedFullRefund(values, closedRows, amount.value)) {
      counts.skippedNeutralizedRefundCount += 1;
      return;
    }
    const direction = isExpense ? 'expense' : 'income';
    records.push({
      id: stableAlipayId(values),
      amountCents: amount.value,
      categoryId: direction === 'expense'
        ? expenseCategory(values)
        : incomeCategory(values, isRefund),
      direction,
      note: shortNote(values.product, values.counterparty),
      occurredAt
    });
    if (direction === 'expense') counts.expenseCount += 1;
    else counts.incomeCount += 1;
    if (isRefund) counts.refundIncomeCount += 1;
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
  const totalExpenseCents = sorted
    .filter((record) => record.direction === 'expense')
    .reduce((sum, record) => sum + record.amountCents, 0);
  const totalIncomeCents = sorted
    .filter((record) => record.direction === 'income')
    .reduce((sum, record) => sum + record.amountCents, 0);
  return Object.assign(counts, {
    source: 'alipay',
    sourceLabel: '支付宝',
    duplicateInFileCount,
    records: sorted,
    dateFrom: sorted.length ? toDateKey(sorted[0].occurredAt) : '',
    dateTo: sorted.length ? toDateKey(sorted[sorted.length - 1].occurredAt) : '',
    monthFrom: sorted.length ? toMonthKey(sorted[0].occurredAt) : '',
    monthTo: sorted.length ? toMonthKey(sorted[sorted.length - 1].occurredAt) : '',
    totalCents: totalExpenseCents,
    totalExpenseCents,
    totalIncomeCents
  });
}

function parseAlipayBillCsv(text, now) {
  return parseAlipayBillRows(parseDelimitedRows(text), now);
}

function looksLikeAlipayBill(text) {
  const sample = String(text || '').slice(0, 12000);
  return sample.indexOf('交易分类') >= 0
    && sample.indexOf('收/付款方式') >= 0
    && sample.indexOf('交易状态') >= 0;
}

module.exports = { looksLikeAlipayBill, parseAlipayBillCsv, parseAlipayBillRows };
