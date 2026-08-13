const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveBudget, validateBudgetAmounts } = require('../domain/budget');
const {
  budgetCycleRange,
  daysInMonth,
  daysRemainingIncludingToday,
  daysSince,
  toDateKey
} = require('../domain/date');
const { formatCents, parseYuanToCents } = require('../domain/money');
const { deriveSpendingSummary } = require('../domain/spending-summary');
const { buildLedgerWorkbook } = require('../domain/ledger-workbook');
const { parseAlipayBillCsv } = require('../domain/alipay-bill');
const {
  parseExcelSerialTimestamp,
  parseWechatBillCsv,
  parseWechatBillXlsx
} = require('../domain/wechat-bill');
const {
  contrastRatio,
  getThemePresets,
  normalizeThemeSettings,
  resolveTheme
} = require('../domain/theme');

function budget(overrides) {
  return Object.assign({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 150000,
    trackingStartDate: '2026-04-20'
  }, overrides || {});
}

test('amount parsing is strict and uses cents', () => {
  assert.deepEqual(parseYuanToCents('36.36', { allowZero: false }), { ok: true, value: 3636 });
  assert.equal(parseYuanToCents('0', { allowZero: false }).ok, false);
  assert.equal(parseYuanToCents('-1').ok, false);
  assert.equal(parseYuanToCents('1.234').ok, false);
  assert.equal(parseYuanToCents('1..2').ok, false);
  assert.equal(parseYuanToCents('abc').ok, false);
  assert.equal(formatCents(-30000), '-300.00');
});

test('budget relations reject impossible saving and spending combinations', () => {
  const impossibleSaving = validateBudgetAmounts({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 10000000,
    historicalSpentBeforeTrackingCents: 0
  });
  assert.equal(impossibleSaving.valid, false);
  assert.match(impossibleSaving.errors.savingGoal, /最多还能存 ¥4000\.00/);

  const fixedTooHigh = validateBudgetAmounts({
    incomeCents: 800000,
    fixedExpenseCents: 900000,
    savingGoalCents: 0,
    historicalSpentBeforeTrackingCents: 0
  });
  assert.match(fixedTooHigh.errors.fixedExpense, /不能超过固定收入/);

  const historicalTooHigh = validateBudgetAmounts({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 350000
  }, 100000);
  assert.match(historicalTooHigh.errors.historicalSpentBeforeTracking, /最多可填 ¥3000\.00/);

  const valid = validateBudgetAmounts({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 250000
  }, 100000);
  assert.equal(valid.valid, true);

  const manualIgnoresDetails = validateBudgetAmounts({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0,
    cycleStartDay: 15,
    fixedExpenseItems: [
      { id: 'rent', name: '房租', amountCents: 390000 },
      { id: 'phone', name: '话费', amountCents: 20000 }
    ]
  });
  assert.equal(manualIgnoresDetails.valid, true);

  const automaticDetails = validateBudgetAmounts({
    incomeCents: 800000,
    fixedExpenseCents: 410000,
    fixedExpenseMode: 'items',
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0,
    fixedExpenseItems: [
      { id: 'rent', name: '房租', amountCents: 390000 },
      { id: 'phone', name: '话费', amountCents: 20000 }
    ]
  });
  assert.equal(automaticDetails.valid, true);

  const mismatchedAutomaticDetails = validateBudgetAmounts({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    fixedExpenseMode: 'items',
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0,
    fixedExpenseItems: [
      { id: 'rent', name: '房租', amountCents: 390000 },
      { id: 'phone', name: '话费', amountCents: 20000 }
    ]
  });
  assert.match(mismatchedAutomaticDetails.errors.fixedExpense, /应等于明细合计 ¥4100\.00/);
});

test('ledger export creates a real xlsx zip with readable local transaction fields', () => {
  const generatedAt = new Date(2026, 7, 9, 22, 16, 0);
  const workbook = buildLedgerWorkbook({
    monthKey: '2026-08',
    budget: budget({ trackingStartDate: '2026-08-01' }),
    transactions: [{
      id: 'current',
      amountCents: 1500,
      categoryId: 'food',
      direction: 'expense',
      note: '咖啡',
      occurredAt: new Date(2026, 7, 9, 8, 30).getTime()
    }, {
      id: 'alipay-income',
      amountCents: 50000,
      categoryId: 'income_side_job',
      direction: 'income',
      note: '周末兼职',
      occurredAt: new Date(2026, 7, 9, 20, 30).getTime()
    }],
    history: [{
      monthKey: '2026-07',
      historicalSpentBeforeTrackingCents: 5000,
      transactions: [{
        id: 'wechat-archived',
        amountCents: 400,
        categoryId: 'transport',
        note: '地铁',
        occurredAt: new Date(2026, 6, 31, 18, 5).getTime()
      }]
    }]
  }, generatedAt);
  const bytes = Buffer.from(workbook.buffer);
  assert.equal(bytes.readUInt32LE(0), 0x04034B50);
  assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054B50);
  assert.equal(workbook.fileName, '今天还能花-流水-20260809-2216.xlsx');
  assert.equal(workbook.recordCount, 3);
  assert.equal(workbook.totalCents, 1900);
  assert.equal(workbook.incomeTotalCents, 50000);
  assert.ok(bytes.includes(Buffer.from('咖啡')));
  assert.ok(bytes.includes(Buffer.from('地铁')));
  assert.ok(bytes.includes(Buffer.from('收入')));
  assert.ok(bytes.includes(Buffer.from('周末兼职')));
  assert.ok(bytes.includes(Buffer.from('2026-08-09')));
  assert.ok(bytes.includes(Buffer.from('微信支付导入')));
  assert.ok(bytes.includes(Buffer.from('支付宝导入')));
  assert.ok(bytes.includes(Buffer.from('本机手动记录')));
  assert.ok(!bytes.includes(Buffer.from('5000.00')));
});

test('wechat CSV bill discovers the header, imports only valid outgoing records and deduplicates', () => {
  const csv = [
    '微信支付账单明细',
    '微信昵称：[已隐藏]',
    '交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号,备注',
    '2026-08-09 08:30:01,商户消费,咖啡店,"拿铁,大杯",支出,¥15.00,零钱,支付成功,420001,1001,',
    '2026-08-08 12:10:00,商户消费,地铁,乘车码,支出,4.00,零钱,支付成功,420002,1002,',
    '2026-08-08 12:10:00,商户消费,地铁,乘车码,支出,4.00,零钱,支付成功,420002,1002,',
    '2026-08-07 09:00:00,转账,朋友,转账,收入,20.00,零钱,已收钱,420003,1003,',
    '2026-08-06 18:00:00,商户消费,餐厅,晚餐,支出,30.00,零钱,已全额退款,420004,1004,',
    '坏日期,商户消费,商店,商品,支出,abc,零钱,支付成功,420005,1005,'
  ].join('\n');
  const parsed = parseWechatBillCsv(csv, new Date(2026, 7, 9, 22));
  assert.equal(parsed.records.length, 2);
  assert.equal(parsed.duplicateInFileCount, 1);
  assert.equal(parsed.skippedIncomeCount, 1);
  assert.equal(parsed.skippedStatusCount, 1);
  assert.equal(parsed.skippedInvalidCount, 1);
  assert.equal(parsed.totalCents, 1900);
  assert.equal(parsed.dateFrom, '2026-08-08');
  assert.equal(parsed.dateTo, '2026-08-09');
  assert.equal(parsed.records[0].categoryId, 'transport');
  assert.equal(parsed.records[1].note, '拿铁,大杯');
  assert.match(parsed.records[1].id, /^wechat-[a-z0-9]+-[a-z0-9]+$/);
});

test('alipay CSV imports cash-flow records without double-counting repayments or full refunds', () => {
  const csv = [
    '支付宝交易明细',
    '交易时间,交易分类,交易对方,对方账号,商品说明,收/支,金额,收/付款方式,交易状态,交易订单号,商家订单号,备注',
    '2026-08-09 08:00:00,餐饮美食,咖啡店,,拿铁,支出,15.00,余额,交易成功,E1,M1,',
    '2026-08-09 09:00:00,数码电器,商店,,耳机,支出,20.00,花呗,等待确认收货,E2,M2,',
    '2026-08-09 10:00:00,收入,客户,,项目款,收入,100.00,余额,交易成功,I1,MI1,',
    '2026-08-08 10:00:00,餐饮美食,餐厅,,正餐,支出,30.00,余额,交易关闭,F1,MF1,',
    '2026-08-08 11:00:00,退款,餐厅,,正餐退款,不计收支,30.00,余额,退款成功,F1,MF1,',
    '2026-08-07 10:00:00,日用百货,商场,,生活用品,支出,30.00,余额,交易成功,P1,MP1,',
    '2026-08-07 11:00:00,退款,商场,,部分退款,不计收支,5.00,余额,退款成功,P1,MP1,',
    '2026-08-06 10:00:00,信用借还,花呗,,花呗还款,不计收支,50.00,余额,还款成功,R1,MR1,',
    '2026-08-05 10:00:00,转账红包,银行,,信用卡还款,支出,60.00,余额,交易成功,R2,MR2,',
    '2026-08-04 10:00:00,投资理财,基金,,基金申购,不计收支,80.00,余额,交易成功,N1,MN1,'
  ].join('\n');
  const parsed = parseAlipayBillCsv(csv, new Date(2026, 7, 10, 12));

  assert.equal(parsed.records.length, 5);
  assert.equal(parsed.expenseCount, 3);
  assert.equal(parsed.incomeCount, 2);
  assert.equal(parsed.refundIncomeCount, 1);
  assert.equal(parsed.skippedRepaymentCount, 2);
  assert.equal(parsed.skippedNeutralizedRefundCount, 1);
  assert.equal(parsed.skippedNonCashCount, 1);
  assert.equal(parsed.totalExpenseCents, 6500);
  assert.equal(parsed.totalIncomeCents, 10500);
  assert.equal(parsed.records.find((item) => item.note === '部分退款').categoryId, 'income_refund');
  assert.match(parsed.records[0].id, /^alipay-[a-z0-9]+-[a-z0-9]+$/);
});

test('wechat XLSX sheet supports shared strings and rejects future or over-range records', () => {
  const shared = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<si><t>交易时间</t></si><si><t>收/支</t></si><si><t>金额（元）</t></si>'
    + '<si><t>商品</t></si><si><t>交易单号</t></si><si><t>支出</t></si>'
    + '<si><t>午餐</t></si><si><t>420010</t></si><si><t>支付成功</t></si>'
    + '<si><t>当前状态</t></si></sst>';
  const sheet = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="C1" t="s"><v>2</v></c><c r="D1" t="s"><v>3</v></c><c r="E1" t="s"><v>4</v></c><c r="F1" t="s"><v>9</v></c></row>'
    + '<row r="2"><c r="A2" t="inlineStr"><is><t>2026-08-09 12:00:00</t></is></c><c r="B2" t="s"><v>5</v></c><c r="C2"><v>28.50</v></c><c r="D2" t="s"><v>6</v></c><c r="E2" t="s"><v>7</v></c><c r="F2" t="s"><v>8</v></c></row>'
    + '<row r="3"><c r="A3" t="inlineStr"><is><t>2026-08-10 12:00:00</t></is></c><c r="B3" t="s"><v>5</v></c><c r="C3"><v>9.00</v></c><c r="D3" t="s"><v>6</v></c><c r="E3" t="inlineStr"><is><t>420011</t></is></c><c r="F3" t="s"><v>8</v></c></row>'
    + '</sheetData></worksheet>';
  const parsed = parseWechatBillXlsx(sheet, shared, new Date(2026, 7, 9, 22));
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].amountCents, 2850);
  assert.equal(parsed.records[0].categoryId, 'food');
  assert.equal(parsed.skippedOutOfRangeCount, 1);
});

test('wechat XLSX converts the numeric Excel date format used by official personal bills', () => {
  assert.equal(
    parseExcelSerialTimestamp('46243.76736111111'),
    new Date(2026, 7, 9, 18, 25, 0).getTime()
  );
  const shared = '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
    + '<si><t>交易时间</t></si><si><t>收/支</t></si><si><t>金额(元)</t></si>'
    + '<si><t>商品</t></si><si><t>交易单号</t></si><si><t>当前状态</t></si>'
    + '<si><t>支出</t></si><si><t>午餐订单</t></si>'
    + '<si><t>4500000000202608090000000001</t></si><si><t>支付成功</t></si></sst>';
  const sheet = '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>'
    + '<row r="18"><c r="A18" t="s"><v>0</v></c><c r="B18" t="s"><v>1</v></c><c r="C18" t="s"><v>2</v></c><c r="D18" t="s"><v>3</v></c><c r="E18" t="s"><v>4</v></c><c r="F18" t="s"><v>5</v></c></row>'
    + '<row r="19"><c r="A19" s="1"><v>46243.76736111111</v></c><c r="B19" t="s"><v>6</v></c><c r="C19"><v>15.8</v></c><c r="D19" t="s"><v>7</v></c><c r="E19" t="s"><v>8</v></c><c r="F19" t="s"><v>9</v></c></row>'
    + '</sheetData></worksheet>';
  const parsed = parseWechatBillXlsx(sheet, shared, new Date(2026, 7, 9, 23, 12, 2));
  assert.equal(parsed.records.length, 1);
  assert.equal(parsed.records[0].occurredAt, new Date(2026, 7, 9, 18, 25).getTime());
  assert.equal(parsed.records[0].amountCents, 1580);
  assert.equal(parsed.records[0].note, '午餐订单');
});

test('acceptance A01 normal calculation', () => {
  const result = deriveBudget(budget(), [], new Date(2026, 3, 20, 12));
  assert.equal(result.daysRemainingIncludingToday, 11);
  assert.equal(result.monthlyFlexibleBudgetCents, 300000);
  assert.equal(result.todaySuggestedBudgetCents, 13636);
  assert.equal(result.todayRemainingCents, 13636);
  assert.equal(result.monthlyRemainingCents, 150000);
});

test('acceptance A02 and A03 additions update the result', () => {
  const now = new Date(2026, 3, 20, 12);
  const first = { id: 'a', amountCents: 3636, occurredAt: now.getTime() };
  const a02 = deriveBudget(budget(), [first], now);
  assert.equal(a02.todaySpentCents, 3636);
  assert.equal(a02.todayRemainingCents, 10000);
  assert.equal(a02.monthlyRemainingCents, 146364);

  const second = { id: 'b', amountCents: 12000, occurredAt: now.getTime() + 1 };
  const a03 = deriveBudget(budget(), [first, second], now);
  assert.equal(a03.todaySpentCents, 15636);
  assert.equal(a03.todayRemainingCents, 0);
  assert.equal(a03.status, 'todayOverspent');
  assert.equal(a03.statusAmountCents, 2000);
});

test('extra income increases the available budget without becoming spending', () => {
  const now = new Date(2026, 3, 20, 12);
  const result = deriveBudget(budget(), [{
    id: 'side-job',
    amountCents: 50000,
    categoryId: 'income_side_job',
    direction: 'income',
    note: '周末兼职',
    occurredAt: now.getTime()
  }, {
    id: 'coffee',
    amountCents: 1500,
    categoryId: 'food',
    direction: 'expense',
    note: '咖啡',
    occurredAt: now.getTime()
  }], now);

  assert.equal(result.recordedIncomeCents, 50000);
  assert.equal(result.monthlyFlexibleBudgetCents, 350000);
  assert.equal(result.todaySpentCents, 1500);
  assert.equal(result.totalSpentCents, 151500);
  assert.equal(result.monthlyRemainingCents, 198500);
});

test('budget unavailable and month overspend have priority', () => {
  const now = new Date(2026, 3, 20, 12);
  const unavailable = deriveBudget(budget({
    incomeCents: 500000,
    fixedExpenseCents: 400000,
    savingGoalCents: 150000,
    historicalSpentBeforeTrackingCents: 0
  }), [], now);
  assert.equal(unavailable.status, 'budgetUnavailable');
  assert.equal(unavailable.todayRemainingCents, 0);

  const overspent = deriveBudget(budget({
    incomeCents: 500000,
    fixedExpenseCents: 200000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 230000
  }), [], now);
  assert.equal(overspent.status, 'monthOverspent');
  assert.equal(overspent.statusAmountCents, 30000);
  assert.equal(overspent.monthlyRemainingCents, -30000);
});

test('cross-day records become spent-before-today without disappearing', () => {
  const yesterday = new Date(2026, 3, 20, 20);
  const today = new Date(2026, 3, 21, 8);
  const result = deriveBudget(budget(), [
    { id: 'a', amountCents: 3636, occurredAt: yesterday.getTime() }
  ], today);
  assert.equal(result.todaySpentCents, 0);
  assert.equal(result.recordedSpentBeforeTodayCents, 3636);
});

test('date rules handle leap years, month end and usage days', () => {
  assert.equal(daysInMonth(new Date(2028, 1, 1)), 29);
  assert.equal(daysInMonth(new Date(2027, 1, 1)), 28);
  assert.equal(daysRemainingIncludingToday(new Date(2026, 3, 30)), 1);
  assert.equal(toDateKey(new Date(2026, 0, 2)), '2026-01-02');
  assert.equal(daysSince('2026-04-20', new Date(2026, 3, 22)), 3);

  const beforePayday = budgetCycleRange(15, new Date(2026, 7, 10, 12));
  assert.equal(beforePayday.startDateKey, '2026-07-15');
  assert.equal(beforePayday.endDateKey, '2026-08-14');
  assert.equal(beforePayday.daysRemainingIncludingToday, 5);
  const afterPayday = budgetCycleRange(15, new Date(2026, 7, 20, 12));
  assert.equal(afterPayday.startDateKey, '2026-08-15');
  assert.equal(afterPayday.endDateKey, '2026-09-14');
});

test('custom cycle aggregates across calendar months and raises category budget alerts once', () => {
  const now = new Date(2026, 8, 10, 12);
  const result = deriveBudget(budget({
    historicalSpentBeforeTrackingCents: 0,
    cycleStartDay: 15,
    activeCycleStartDate: '2026-08-15',
    fixedExpenseItems: [],
    categoryBudgets: [{ categoryId: 'food', limitCents: 150000 }]
  }), [
    { id: 'aug', amountCents: 80000, categoryId: 'food', direction: 'expense', occurredAt: new Date(2026, 7, 20).getTime() },
    { id: 'sep', amountCents: 43000, categoryId: 'food', direction: 'expense', occurredAt: new Date(2026, 8, 2).getTime() },
    { id: 'old', amountCents: 99999, categoryId: 'food', direction: 'expense', occurredAt: new Date(2026, 7, 14).getTime() }
  ], now);
  assert.equal(result.cycleStartDateKey, '2026-08-15');
  assert.equal(result.cycleEndDateKey, '2026-09-14');
  assert.equal(result.totalSpentCents, 123000);
  assert.equal(result.monthlyRemainingCents, 177000);
  assert.deepEqual(result.categoryBudgetAlerts, [{
    categoryId: 'food',
    limitCents: 150000,
    percent: 82,
    spentCents: 123000,
    status: 'near'
  }]);
});

test('day and month summaries use only real dated records for trends', () => {
  const now = new Date(2026, 7, 9, 12);
  const state = {
    monthKey: '2026-08',
    budget: budget({
      historicalSpentBeforeTrackingCents: 5000,
      trackingStartDate: '2026-08-01'
    }),
    transactions: [
      { id: 'today', amountCents: 1500, categoryId: 'food', note: '咖啡', occurredAt: now.getTime() },
      { id: 'yesterday', amountCents: 400, categoryId: 'transport', note: '地铁', occurredAt: new Date(2026, 7, 8, 8).getTime() },
      { id: 'income', amountCents: 50000, categoryId: 'income_side_job', direction: 'income', note: '外快', occurredAt: now.getTime() }
    ],
    history: []
  };

  const day = deriveSpendingSummary(state, 'day', now);
  assert.deepEqual(day.metrics.map((item) => item.value), ['¥15', '¥4', '¥0']);
  assert.match(day.insightText, /餐饮 ¥15/);
  assert.match(day.scopeText, /趋势不含启用前汇总 ¥50/);
  assert.equal(day.weeklySummary.currentText, '¥19');
  assert.match(day.weeklySummary.scopeText, /8\/3–8\/9/);

  const month = deriveSpendingSummary(state, 'month', now);
  assert.equal(month.metrics[0].value, '¥69');
  assert.equal(month.chart.reduce((sum, item) => sum + item.amountCents, 0), 1900);
  assert.match(month.scopeText, /趋势不含该汇总/);
});

test('custom spending summary includes both boundary dates and excludes income and baselines', () => {
  const now = new Date(2026, 7, 9, 12);
  const state = {
    monthKey: '2026-08',
    budget: budget({ historicalSpentBeforeTrackingCents: 5000 }),
    transactions: [
      { id: 'aug-01-food', amountCents: 1500, categoryId: 'food', occurredAt: new Date(2026, 7, 1, 8).getTime() },
      { id: 'aug-09-food', amountCents: 500, categoryId: 'food', occurredAt: new Date(2026, 7, 9, 18).getTime() },
      { id: 'aug-income', amountCents: 50000, categoryId: 'income_side_job', direction: 'income', occurredAt: new Date(2026, 7, 5, 12).getTime() }
    ],
    history: [{
      monthKey: '2026-07',
      historicalSpentBeforeTrackingCents: 3000,
      transactions: [
        { id: 'jul-31-train', amountCents: 400, categoryId: 'transport', occurredAt: new Date(2026, 6, 31, 23).getTime() },
        { id: 'jul-30-outside', amountCents: 9999, categoryId: 'shopping', occurredAt: new Date(2026, 6, 30, 23).getTime() }
      ]
    }]
  };

  const custom = deriveSpendingSummary(state, 'custom', now, {
    startDateKey: '2026-07-31',
    endDateKey: '2026-08-09'
  });
  assert.equal(custom.period, 'custom');
  assert.deepEqual(custom.metrics.map((item) => item.value), ['¥24', '¥2.40', '3笔']);
  assert.equal(custom.chart.length, 7);
  assert.equal(custom.chart.reduce((sum, item) => sum + item.amountCents, 0), 2400);
  assert.deepEqual(custom.categoryBreakdown.map((item) => ({
    amountCents: item.amountCents,
    categoryId: item.categoryId,
    count: item.count,
    percent: item.percent
  })), [{ amountCents: 2000, categoryId: 'food', count: 2, percent: 83 }, {
    amountCents: 400,
    categoryId: 'transport',
    count: 1,
    percent: 17
  }]);
  assert.equal(custom.recordCount, 3);
  assert.match(custom.insightText, /餐饮 ¥20/);
  assert.match(custom.scopeText, /共10天/);
  assert.match(custom.scopeText, /不含收入和启用前汇总/);

  const empty = deriveSpendingSummary(state, 'custom', now, {
    startDateKey: '2026-08-02',
    endDateKey: '2026-08-02'
  });
  assert.deepEqual(empty.metrics.map((item) => item.value), ['¥0', '¥0', '0笔']);
  assert.deepEqual(empty.categoryBreakdown, []);
  assert.match(empty.insightText, /没有支出记录/);
});

test('custom spending summary rejects reversed or future date ranges', () => {
  const state = { monthKey: '2026-08', budget: budget(), transactions: [], history: [] };
  const now = new Date(2026, 7, 9, 12);
  assert.throws(() => deriveSpendingSummary(state, 'custom', now, {
    startDateKey: '2026-08-09',
    endDateKey: '2026-08-01'
  }), /统计时间段无效/);
  assert.throws(() => deriveSpendingSummary(state, 'custom', now, {
    startDateKey: '2026-08-01',
    endDateKey: '2026-08-10'
  }), /统计时间段无效/);
});

test('all theme presets keep readable contrast across the full safe tuning range', () => {
  getThemePresets('systemBlue').forEach((preset) => {
    for (let hueShift = -30; hueShift <= 30; hueShift += 1) {
      for (let warmth = -10; warmth <= 10; warmth += 1) {
        for (let brightness = -10; brightness <= 10; brightness += 1) {
          const resolved = resolveTheme({
            presetId: preset.id,
            hueShift,
            warmth,
            brightness
          });
          assert.ok(contrastRatio(resolved.primary, resolved.onPrimary) >= 4.5);
          assert.ok(contrastRatio(resolved.accent, resolved.onAccent) >= 4.5);
          assert.ok(contrastRatio(resolved.page, resolved.text) >= 4.5);
          assert.ok(contrastRatio(resolved.surface, resolved.text) >= 4.5);
          assert.ok(contrastRatio(resolved.page, resolved.muted) >= 3);
          assert.ok(contrastRatio(resolved.surface, resolved.muted) >= 3);
        }
      }
    }
  });
});

test('legacy colorful theme ids map to restrained minimalist presets', () => {
  assert.equal(normalizeThemeSettings({
    presetId: 'forest',
    hueShift: 0,
    warmth: 0,
    brightness: 0
  }).presetId, 'sage');
  assert.equal(normalizeThemeSettings({
    presetId: 'midnight',
    hueShift: 0,
    warmth: 0,
    brightness: 0
  }).presetId, 'graphite');
});
