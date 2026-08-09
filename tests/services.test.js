const test = require('node:test');
const assert = require('node:assert/strict');

const { setStorageAdapterForTests } = require('../infrastructure/storage');
const { readZipTextEntries } = require('../infrastructure/file-system');
const budgetStore = require('../services/budget-store');
const { getSpendingSummary } = require('../services/spending-summary');
const themeStore = require('../services/theme-store');
const { readState } = require('../services/state-store');
const { addTransaction, listTransactions } = require('../services/transactions');

function makeAdapter() {
  const data = new Map();
  return {
    data,
    getStorage(options) {
      if (!data.has(options.key)) {
        options.fail({ errMsg: 'getStorage:fail data not found' });
        return;
      }
      options.success({ data: data.get(options.key) });
    },
    setStorage(options) {
      data.set(options.key, options.data);
      options.success();
    },
    removeStorage(options) {
      data.delete(options.key);
      options.success();
    }
  };
}

test.beforeEach(() => setStorageAdapterForTests(makeAdapter()));
test.after(() => setStorageAdapterForTests(null));

test('empty, save and persisted load lifecycle', async () => {
  const now = new Date(2026, 3, 20, 10);
  assert.equal((await budgetStore.loadBudgetContext(now)).status, 'empty');
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 150000
  }, now);
  const loaded = await budgetStore.loadBudgetContext(now);
  assert.equal(loaded.status, 'ready');
  assert.equal(loaded.budget.incomeCents, 800000);
});

test('budget store rejects impossible relations and keeps the last valid state', async () => {
  const now = new Date(2026, 7, 9, 10);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0
  }, now);

  await assert.rejects(budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 10000000,
    historicalSpentBeforeTrackingCents: 0
  }, now), /最多还能存 ¥4000\.00/);
  assert.equal((await budgetStore.loadBudgetContext(now)).budget.savingGoalCents, 100000);

  await addTransaction({
    action: 'create',
    commandId: 'budget-relation-record',
    amountCents: 100000,
    categoryId: 'other',
    note: '已花',
    occurredAt: now.getTime()
  });
  await assert.rejects(budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 750000,
    savingGoalCents: 0,
    historicalSpentBeforeTrackingCents: 0
  }, now), /收入至少需要 ¥8500\.00/);
  assert.equal((await budgetStore.loadBudgetContext(now)).budget.fixedExpenseCents, 400000);
});

test('transaction commands are idempotent and delete through addTransaction', async () => {
  const now = new Date(2026, 3, 20, 10);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0
  }, now);
  const command = {
    action: 'create',
    commandId: 'create-1',
    transactionId: 'transaction-1',
    amountCents: 3636,
    categoryId: 'food',
    note: '  咖啡  ',
    occurredAt: now.getTime()
  };
  assert.equal((await addTransaction(command)).duplicate, false);
  assert.equal((await addTransaction(command)).duplicate, true);
  const savedTransactions = await listTransactions();
  assert.equal(savedTransactions.length, 1);
  assert.equal(savedTransactions[0].categoryId, 'food');
  assert.equal(savedTransactions[0].note, '咖啡');

  await addTransaction({
    action: 'delete',
    commandId: 'delete-1',
    transactionId: 'transaction-1'
  });
  assert.equal((await listTransactions()).length, 0);
});

test('wechat bill import writes current and archived months and remains idempotent', async () => {
  const now = new Date(2026, 7, 9, 22);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0
  }, now);
  const records = [{
    id: 'wechat-current-a',
    amountCents: 1500,
    categoryId: 'food',
    note: '咖啡',
    occurredAt: new Date(2026, 7, 9, 8, 30).getTime()
  }, {
    id: 'wechat-history-b',
    amountCents: 400,
    categoryId: 'transport',
    note: '地铁',
    occurredAt: new Date(2026, 6, 31, 18, 5).getTime()
  }];

  const first = await addTransaction({
    action: 'import',
    commandId: 'wechat-import-1',
    source: 'wechat',
    transactions: records
  });
  assert.equal(first.importedCount, 2);
  assert.equal(first.duplicateCount, 0);
  assert.equal((await listTransactions()).length, 1);
  assert.equal((await listTransactions({ dateKey: '2026-07-31' }))[0].note, '地铁');
  assert.equal((await listTransactions({ all: true })).length, 2);

  const second = await addTransaction({
    action: 'import',
    commandId: 'wechat-import-2',
    source: 'wechat',
    transactions: records
  });
  assert.equal(second.importedCount, 0);
  assert.equal(second.duplicateCount, 2);
  assert.equal((await listTransactions({ all: true })).length, 2);
});

test('wechat bill import skips future and records older than 36 months', async () => {
  const now = new Date(2026, 7, 9, 22);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0
  }, now);
  const result = await addTransaction({
    action: 'import',
    commandId: 'wechat-import-range',
    source: 'wechat',
    transactions: [{
      id: 'wechat-future',
      amountCents: 100,
      categoryId: 'other',
      note: '',
      occurredAt: new Date(2026, 8, 1).getTime()
    }, {
      id: 'wechat-too-old',
      amountCents: 100,
      categoryId: 'other',
      note: '',
      occurredAt: new Date(2023, 6, 31).getTime()
    }]
  });
  assert.equal(result.importedCount, 0);
  assert.equal(result.skippedCount, 2);
  assert.equal((await listTransactions({ all: true })).length, 0);
});

test('wechat XLSX file boundary requests text entries and decodes ArrayBuffer results', async () => {
  const originalWx = global.wx;
  const sheetXml = '<?xml version="1.0"?><worksheet><sheetData></sheetData></worksheet>';
  const sharedXml = '<?xml version="1.0"?><sst><si><t>交易时间</t></si></sst>';
  global.wx = {
    getFileSystemManager() {
      return {
        readZipEntry(options) {
          assert.deepEqual(options.entries, [{
            path: 'xl/worksheets/sheet1.xml',
            encoding: 'utf-8'
          }, {
            path: 'xl/sharedStrings.xml',
            encoding: 'utf-8'
          }]);
          options.success({
            entries: {
              '/xl/worksheets/sheet1.xml': {
                data: new TextEncoder().encode(sheetXml).buffer,
                errMsg: 'readZipEntry:ok'
              },
              'xl\\sharedStrings.xml': {
                data: new TextEncoder().encode(sharedXml).buffer,
                errMsg: 'readZipEntry:ok'
              }
            }
          });
        }
      };
    }
  };
  try {
    const entries = await readZipTextEntries('wxfile://bill.xlsx');
    assert.equal(entries['xl/worksheets/sheet1.xml'].data, sheetXml);
    assert.equal(entries['xl/sharedStrings.xml'].data, sharedXml);
  } finally {
    global.wx = originalWx;
  }
});

test('current transaction can be corrected and changes the daily detail', async () => {
  const now = new Date(2026, 7, 9, 10, 20);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0
  }, now);
  await addTransaction({
    action: 'create',
    commandId: 'today-create',
    transactionId: 'today-record',
    amountCents: 1500,
    categoryId: 'food',
    note: '咖啡',
    occurredAt: now.getTime()
  });

  const correctedTime = new Date(2026, 7, 8, 10, 20).getTime();
  await addTransaction({
    action: 'update',
    commandId: 'today-update',
    transactionId: 'today-record',
    amountCents: 1200,
    categoryId: 'transport',
    note: '打车',
    occurredAt: correctedTime
  });

  assert.equal((await listTransactions({ dateKey: '2026-08-09' })).length, 0);
  const detail = await listTransactions({ dateKey: '2026-08-08' });
  assert.equal(detail.length, 1);
  assert.equal(detail[0].amountCents, 1200);
  assert.equal(detail[0].categoryId, 'transport');
  assert.equal(detail[0].note, '打车');
});

test('month change can carry settings without transactions', async () => {
  const april = new Date(2026, 3, 20, 10);
  const may = new Date(2026, 4, 1, 10);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 150000
  }, april);
  await addTransaction({
    action: 'create',
    commandId: 'april-record',
    amountCents: 1000,
    categoryId: 'transport',
    note: '地铁',
    occurredAt: april.getTime()
  });

  assert.equal((await budgetStore.loadBudgetContext(may)).status, 'monthChange');
  const carried = await budgetStore.startNewMonth('carry', may);
  assert.equal(carried.status, 'ready');
  assert.equal(carried.budget.historicalSpentBeforeTrackingCents, 0);
  assert.equal((await listTransactions()).length, 0);
  const archived = (await readState()).state.history;
  assert.equal(archived.length, 1);
  assert.equal(archived[0].monthKey, '2026-04');
  assert.equal(archived[0].transactions[0].note, '地铁');
});

test('archived daily detail can be corrected or deleted without changing current records', async () => {
  const april = new Date(2026, 3, 20, 10);
  const may = new Date(2026, 4, 2, 10);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0
  }, april);
  await addTransaction({
    action: 'create',
    commandId: 'archive-create',
    transactionId: 'archive-record',
    amountCents: 1500,
    categoryId: 'food',
    note: '咖啡',
    occurredAt: april.getTime()
  });
  await budgetStore.startNewMonth('carry', may);
  await addTransaction({
    action: 'create',
    commandId: 'current-create',
    transactionId: 'current-record',
    amountCents: 400,
    categoryId: 'transport',
    note: '地铁',
    occurredAt: may.getTime()
  });

  await addTransaction({
    action: 'update',
    commandId: 'archive-update',
    transactionId: 'archive-record',
    amountCents: 1800,
    categoryId: 'food',
    note: '晚餐',
    occurredAt: new Date(2026, 3, 21, 10).getTime()
  });
  assert.equal((await listTransactions({ dateKey: '2026-04-20' })).length, 0);
  const movedDetail = await listTransactions({ dateKey: '2026-04-21' });
  assert.equal(movedDetail[0].amountCents, 1800);
  assert.equal((await listTransactions()).length, 1);

  await assert.rejects(addTransaction({
    action: 'update',
    commandId: 'archive-cross-month',
    transactionId: 'archive-record',
    amountCents: 1800,
    categoryId: 'food',
    note: '晚餐',
    occurredAt: new Date(2026, 4, 1, 10).getTime()
  }), /只能在原月份内修改/);

  await addTransaction({
    action: 'delete',
    commandId: 'archive-delete',
    transactionId: 'archive-record'
  });
  assert.equal((await listTransactions({ dateKey: '2026-04-21' })).length, 0);
  assert.equal((await listTransactions())[0].id, 'current-record');
});

test('corrupt storage safely degrades', async () => {
  const adapter = makeAdapter();
  adapter.data.set('today-can-spend:v1', { schemaVersion: 99 });
  setStorageAdapterForTests(adapter);
  const result = await budgetStore.loadBudgetContext(new Date(2026, 3, 20));
  assert.equal(result.status, 'corrupt');
});

test('legacy schema migrates transactions to other without losing amount or time', async () => {
  const adapter = makeAdapter();
  const occurredAt = new Date(2026, 3, 20, 9, 30).getTime();
  adapter.data.set('today-can-spend:v1', {
    schemaVersion: 1,
    monthKey: '2026-04',
    budget: {
      incomeCents: 800000,
      fixedExpenseCents: 400000,
      savingGoalCents: 100000,
      historicalSpentBeforeTrackingCents: 0,
      trackingStartDate: '2026-04-01'
    },
    transactions: [{ id: 'legacy-1', amountCents: 1500, occurredAt }],
    processedCommandIds: []
  });
  setStorageAdapterForTests(adapter);

  const transactions = await listTransactions();
  assert.deepEqual(transactions, [{
    id: 'legacy-1',
    amountCents: 1500,
    categoryId: 'other',
    note: '',
    occurredAt
  }]);
  assert.equal(adapter.data.get('today-can-spend:v1').schemaVersion, 3);
  assert.deepEqual(adapter.data.get('today-can-spend:v1').history, []);
});

test('schema 2 migrates to schema 3 without changing current records', async () => {
  const adapter = makeAdapter();
  const occurredAt = new Date(2026, 7, 9, 9, 30).getTime();
  adapter.data.set('today-can-spend:v1', {
    schemaVersion: 2,
    monthKey: '2026-08',
    budget: {
      incomeCents: 800000,
      fixedExpenseCents: 400000,
      savingGoalCents: 100000,
      historicalSpentBeforeTrackingCents: 5000,
      trackingStartDate: '2026-08-01'
    },
    transactions: [{
      id: 'v2-1',
      amountCents: 1500,
      categoryId: 'food',
      note: '咖啡',
      occurredAt
    }],
    processedCommandIds: []
  });
  setStorageAdapterForTests(adapter);

  const transactions = await listTransactions();
  assert.equal(transactions.length, 1);
  assert.equal(transactions[0].note, '咖啡');
  const state = adapter.data.get('today-can-spend:v1');
  assert.equal(state.schemaVersion, 3);
  assert.deepEqual(state.history, []);
});

test('annual review uses archived real records and keeps baseline separate', async () => {
  const april = new Date(2026, 3, 20, 10);
  const may = new Date(2026, 4, 2, 10);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 5000
  }, april);
  await addTransaction({
    action: 'create',
    commandId: 'april-food',
    amountCents: 1500,
    categoryId: 'food',
    note: '咖啡',
    occurredAt: april.getTime()
  });
  await budgetStore.startNewMonth('carry', may);
  await addTransaction({
    action: 'create',
    commandId: 'may-transport',
    amountCents: 400,
    categoryId: 'transport',
    note: '地铁',
    occurredAt: may.getTime()
  });

  const annual = await getSpendingSummary('year', may);
  assert.equal(annual.metrics[0].value, '¥69');
  assert.match(annual.scopeText, /2026年4月开始/);
  assert.match(annual.scopeText, /启用前汇总仅计入总额/);
  assert.equal(annual.chart[3].amountCents, 1500);
  assert.equal(annual.chart[4].amountCents, 400);

  await budgetStore.resetCurrentMonth(may);
  const state = (await readState()).state;
  assert.equal(state.budget, null);
  assert.equal(state.history.length, 1);
  assert.equal(state.history[0].monthKey, '2026-04');
  await assert.rejects(addTransaction({
    action: 'create',
    commandId: 'after-reset',
    amountCents: 100,
    categoryId: 'other',
    occurredAt: may.getTime()
  }), /请先完成本月设置/);
});

test('imported cross-day, cross-month and cross-year data stays in the correct review period', async () => {
  const adapter = makeAdapter();
  adapter.data.set('today-can-spend:v1', {
    schemaVersion: 3,
    monthKey: '2026-08',
    budget: {
      incomeCents: 800000,
      fixedExpenseCents: 400000,
      savingGoalCents: 100000,
      historicalSpentBeforeTrackingCents: 500,
      trackingStartDate: '2026-08-01'
    },
    transactions: [
      {
        id: 'aug-08-coffee',
        amountCents: 1500,
        categoryId: 'food',
        note: '咖啡',
        occurredAt: new Date(2026, 7, 8, 9, 30).getTime()
      },
      {
        id: 'aug-09-market',
        amountCents: 3000,
        categoryId: 'daily',
        note: '日用品',
        occurredAt: new Date(2026, 7, 9, 10, 0).getTime()
      }
    ],
    processedCommandIds: [],
    history: [
      {
        monthKey: '2025-12',
        historicalSpentBeforeTrackingCents: 0,
        transactions: [{
          id: 'dec-31-dinner',
          amountCents: 8800,
          categoryId: 'food',
          note: '跨年晚餐',
          occurredAt: new Date(2025, 11, 31, 19, 0).getTime()
        }]
      },
      {
        monthKey: '2026-07',
        historicalSpentBeforeTrackingCents: 1000,
        transactions: [{
          id: 'jul-31-train',
          amountCents: 4200,
          categoryId: 'transport',
          note: '高铁',
          occurredAt: new Date(2026, 6, 31, 8, 0).getTime()
        }]
      }
    ]
  });
  setStorageAdapterForTests(adapter);

  const day = await getSpendingSummary('day', new Date(2026, 7, 9, 12));
  assert.deepEqual(day.metrics.map((item) => item.value), ['¥30', '¥15', '¥0']);

  const july = await getSpendingSummary('month', new Date(2026, 6, 31, 12));
  assert.equal(july.metrics[0].value, '¥52');
  assert.equal(july.chart.reduce((sum, item) => sum + item.amountCents, 0), 4200);

  const year2026 = await getSpendingSummary('year', new Date(2026, 7, 9, 12));
  assert.equal(year2026.metrics[0].value, '¥102');
  assert.equal(year2026.chart[6].amountCents, 4200);
  assert.equal(year2026.chart[7].amountCents, 4500);

  const year2025 = await getSpendingSummary('year', new Date(2025, 11, 31, 12));
  assert.equal(year2025.metrics[0].value, '¥88');
  assert.equal(year2025.chart[11].amountCents, 8800);

  const oldYearDetail = await listTransactions({ dateKey: '2025-12-31' });
  assert.equal(oldYearDetail.length, 1);
  assert.equal(oldYearDetail[0].note, '跨年晚餐');
  const currentMonthDetail = await listTransactions({ dateKey: '2026-08-08' });
  assert.equal(currentMonthDetail.length, 1);
  assert.equal(currentMonthDetail[0].note, '咖啡');
});

test('theme preference persists independently and resolves safe contrast', async () => {
  const saved = await themeStore.saveTheme({
    presetId: 'midnight',
    hueShift: 12,
    warmth: -3,
    brightness: 4
  });
  assert.equal(saved.settings.presetId, 'midnight');
  assert.match(saved.resolved.styleText, /--theme-primary:/);

  const loaded = await themeStore.loadTheme();
  assert.deepEqual(loaded.settings, saved.settings);
  assert.equal(loaded.presets.filter((item) => item.selected).length, 1);

  const reset = await themeStore.resetTheme();
  assert.equal(reset.settings.presetId, 'forest');
  assert.equal(reset.settings.hueShift, 0);
});

test('transaction rejects unknown category and overlong purpose', async () => {
  const now = new Date(2026, 3, 20, 10);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0
  }, now);

  await assert.rejects(addTransaction({
    action: 'create',
    amountCents: 1500,
    categoryId: 'coffee',
    commandId: 'bad-category',
    note: '咖啡',
    occurredAt: now.getTime()
  }), /请选择消费分类/);

  await assert.rejects(addTransaction({
    action: 'create',
    amountCents: 1500,
    categoryId: 'food',
    commandId: 'long-note',
    note: '这是一条超过二十个字符并且不应写入本地存储的用途说明',
    occurredAt: now.getTime()
  }), /不能超过 20 个字/);
});

test('transaction allows an empty purpose and keeps the selected category', async () => {
  const now = new Date(2026, 3, 20, 10);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0
  }, now);

  await addTransaction({
    action: 'create',
    amountCents: 400,
    categoryId: 'transport',
    commandId: 'empty-purpose',
    occurredAt: now.getTime()
  });
  const transactions = await listTransactions();
  assert.equal(transactions[0].categoryId, 'transport');
  assert.equal(transactions[0].note, '');
});

test('read and write failures are surfaced instead of pretending success', async () => {
  setStorageAdapterForTests({
    getStorage(options) {
      options.fail({ errMsg: 'getStorage:fail permission denied' });
    },
    setStorage() {},
    removeStorage() {}
  });
  await assert.rejects(
    budgetStore.loadBudgetContext(new Date(2026, 3, 20)),
    /permission denied/
  );

  const adapter = makeAdapter();
  adapter.setStorage = (options) => options.fail({ errMsg: 'setStorage:fail disk full' });
  setStorageAdapterForTests(adapter);
  await assert.rejects(
    budgetStore.saveBudget({
      incomeCents: 800000,
      fixedExpenseCents: 400000,
      savingGoalCents: 100000,
      historicalSpentBeforeTrackingCents: 0
    }, new Date(2026, 3, 20)),
    /disk full/
  );
});
