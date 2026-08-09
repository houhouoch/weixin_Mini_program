const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveBudget, validateBudgetAmounts } = require('../domain/budget');
const {
  daysInMonth,
  daysRemainingIncludingToday,
  daysSince,
  toDateKey
} = require('../domain/date');
const { formatCents, parseYuanToCents } = require('../domain/money');
const { deriveSpendingSummary } = require('../domain/spending-summary');
const { buildLedgerWorkbook } = require('../domain/ledger-workbook');
const {
  parseExcelSerialTimestamp,
  parseWechatBillCsv,
  parseWechatBillXlsx
} = require('../domain/wechat-bill');
const {
  contrastRatio,
  getThemePresets,
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
  assert.match(fixedTooHigh.errors.fixedExpense, /不能超过本月收入/);

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
      note: '咖啡',
      occurredAt: new Date(2026, 7, 9, 8, 30).getTime()
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
  assert.equal(workbook.recordCount, 2);
  assert.equal(workbook.totalCents, 1900);
  assert.ok(bytes.includes(Buffer.from('咖啡')));
  assert.ok(bytes.includes(Buffer.from('地铁')));
  assert.ok(bytes.includes(Buffer.from('2026-08-09')));
  assert.ok(bytes.includes(Buffer.from('微信支付导入')));
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
      { id: 'yesterday', amountCents: 400, categoryId: 'transport', note: '地铁', occurredAt: new Date(2026, 7, 8, 8).getTime() }
    ],
    history: []
  };

  const day = deriveSpendingSummary(state, 'day', now);
  assert.deepEqual(day.metrics.map((item) => item.value), ['¥15', '¥4', '¥0']);
  assert.match(day.insightText, /餐饮 ¥15/);
  assert.match(day.scopeText, /趋势不含启用前汇总 ¥50/);

  const month = deriveSpendingSummary(state, 'month', now);
  assert.equal(month.metrics[0].value, '¥69');
  assert.equal(month.chart.reduce((sum, item) => sum + item.amountCents, 0), 1900);
  assert.match(month.scopeText, /趋势不含该汇总/);
});

test('all theme presets keep readable contrast across the full safe tuning range', () => {
  getThemePresets('forest').forEach((preset) => {
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
