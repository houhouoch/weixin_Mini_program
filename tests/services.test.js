const test = require('node:test');
const assert = require('node:assert/strict');

const { setStorageAdapterForTests } = require('../infrastructure/storage');
const { decodeBillText, readZipTextEntries } = require('../infrastructure/file-system');
const budgetStore = require('../services/budget-store');
const {
  createDataBackup,
  previewDataBackup,
  restoreDataBackup
} = require('../services/data-backup');
const { getSpendingSummary } = require('../services/spending-summary');
const themeStore = require('../services/theme-store');
const {
  deleteQuickTemplate,
  listQuickTemplates,
  saveQuickTemplate
} = require('../services/quick-templates');
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
  assert.equal(loaded.budget.fixedExpenseMode, 'manual');
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
  }, now), /收入合计至少需要 ¥8500\.00/);
  assert.equal((await budgetStore.loadBudgetContext(now)).budget.fixedExpenseCents, 400000);
});

test('fixed expense modes persist automatic details and keep manual totals independent', async () => {
  const now = new Date(2026, 7, 9, 10);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 330000,
    fixedExpenseMode: 'items',
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0,
    fixedExpenseItems: [
      { id: 'rent', name: '房租', amountCents: 300000 },
      { id: 'phone', name: '话费', amountCents: 30000 }
    ]
  }, now);
  let loaded = await budgetStore.loadBudgetContext(now);
  assert.equal(loaded.budget.fixedExpenseMode, 'items');
  assert.equal(loaded.budget.fixedExpenseCents, 330000);

  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 300000,
    fixedExpenseMode: 'manual',
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0,
    fixedExpenseItems: [
      { id: 'rent', name: '房租', amountCents: 300000 },
      { id: 'phone', name: '话费', amountCents: 30000 }
    ]
  }, now);
  loaded = await budgetStore.loadBudgetContext(now);
  assert.equal(loaded.budget.fixedExpenseMode, 'manual');
  assert.equal(loaded.budget.fixedExpenseCents, 300000);
  assert.deepEqual(loaded.budget.fixedExpenseItems, []);
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

test('income transaction persists, can be edited, and supports income categories only', async () => {
  const now = new Date(2026, 7, 9, 10);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0
  }, now);
  await addTransaction({
    action: 'create',
    commandId: 'income-create',
    transactionId: 'income-record',
    amountCents: 50000,
    categoryId: 'income_side_job',
    direction: 'income',
    note: '周末兼职',
    occurredAt: now.getTime()
  });

  let saved = (await listTransactions())[0];
  assert.equal(saved.direction, 'income');
  assert.equal(saved.categoryId, 'income_side_job');

  await addTransaction({
    action: 'update',
    commandId: 'income-update',
    transactionId: 'income-record',
    amountCents: 60000,
    categoryId: 'income_bonus',
    direction: 'income',
    note: '项目奖金',
    occurredAt: now.getTime()
  });
  saved = (await listTransactions())[0];
  assert.equal(saved.amountCents, 60000);
  assert.equal(saved.categoryId, 'income_bonus');

  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 450000,
    historicalSpentBeforeTrackingCents: 0
  }, now);
  assert.equal((await budgetStore.loadBudgetContext(now)).budget.savingGoalCents, 450000);

  await assert.rejects(addTransaction({
    action: 'create',
    commandId: 'bad-income-category',
    amountCents: 1000,
    categoryId: 'food',
    direction: 'income',
    note: '',
    occurredAt: now.getTime()
  }), /请选择收入分类/);
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

test('import batches can be filtered, survive edits and undo across current and archived months', async () => {
  const now = new Date(2026, 7, 9, 22);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0
  }, now);
  await addTransaction({
    action: 'create',
    commandId: 'manual-before-import',
    amountCents: 900,
    categoryId: 'food',
    note: '手工记录',
    occurredAt: new Date(2026, 7, 2, 8).getTime()
  });
  await addTransaction({
    action: 'import',
    commandId: 'wechat-import-batch-a',
    importedAt: new Date(2026, 7, 10, 9).getTime(),
    source: 'wechat',
    transactions: [{
      id: 'wechat-batch-current',
      amountCents: 1500,
      categoryId: 'food',
      note: '咖啡',
      occurredAt: new Date(2026, 7, 9, 8).getTime()
    }, {
      id: 'wechat-batch-history',
      amountCents: 400,
      categoryId: 'transport',
      note: '地铁',
      occurredAt: new Date(2026, 6, 31, 18).getTime()
    }]
  });

  let batches = await listTransactions({ importBatches: true });
  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0], {
    id: 'wechat-import-batch-a',
    importedAt: new Date(2026, 7, 10, 9).getTime(),
    source: 'wechat',
    sourceLabel: '微信支付',
    count: 2,
    dateFrom: '2026-07-31',
    dateTo: '2026-08-09'
  });

  const ranged = await listTransactions({
    startDateKey: '2026-07-31',
    endDateKey: '2026-08-09',
    direction: 'expense',
    categoryId: 'food'
  });
  assert.deepEqual(ranged.map((item) => item.id), ['wechat-batch-current', 'manual-before-import']);

  await addTransaction({
    action: 'update',
    commandId: 'edit-imported-record',
    transactionId: 'wechat-batch-current',
    amountCents: 1600,
    categoryId: 'food',
    direction: 'expense',
    note: '改过的咖啡',
    occurredAt: new Date(2026, 7, 9, 8).getTime()
  });
  assert.equal((await listTransactions({ importBatches: true }))[0].count, 2);

  const undone = await addTransaction({
    action: 'undoImport',
    commandId: 'undo-import-batch-a',
    importBatchId: 'wechat-import-batch-a'
  });
  assert.equal(undone.removedCount, 2);
  assert.deepEqual((await listTransactions({ all: true })).map((item) => item.id), ['manual-before-import']);
  batches = await listTransactions({ importBatches: true });
  assert.deepEqual(batches, []);
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

test('bill text decoder reads the GB18030 encoding used by official Alipay CSV exports', () => {
  const bytes = Buffer.from(
    'vbvS18qxvOQsvbvS17fWwOAsytUvuLa/7re9yr0szcu/7rPJuaYsu7m/7rPJuaY=',
    'base64'
  );
  assert.equal(
    decodeBillText(bytes),
    '交易时间,交易分类,收/付款方式,退款成功,还款成功'
  );
});

test('alipay bill import preserves expense and income directions', async () => {
  const now = new Date(2026, 7, 10, 12);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0
  }, now);
  const result = await addTransaction({
    action: 'import',
    commandId: 'alipay-import-1',
    source: 'alipay',
    transactions: [{
      id: 'alipay-expense-a',
      amountCents: 1500,
      categoryId: 'food',
      direction: 'expense',
      note: '咖啡',
      occurredAt: new Date(2026, 7, 9, 8).getTime()
    }, {
      id: 'alipay-income-a',
      amountCents: 500,
      categoryId: 'income_refund',
      direction: 'income',
      note: '部分退款',
      occurredAt: new Date(2026, 7, 9, 9).getTime()
    }]
  });
  assert.equal(result.importedCount, 2);
  const saved = await listTransactions({ dateKey: '2026-08-09' });
  assert.deepEqual(saved.map((item) => item.direction).sort(), ['expense', 'income']);
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
    direction: 'expense',
    note: '',
    occurredAt
  }]);
  assert.equal(adapter.data.get('today-can-spend:v1').schemaVersion, 5);
  assert.equal(adapter.data.get('today-can-spend:v1').budget.cycleStartDay, 1);
  assert.deepEqual(adapter.data.get('today-can-spend:v1').quickTemplates, []);
  assert.deepEqual(adapter.data.get('today-can-spend:v1').history, []);
});

test('schema 2 migrates to schema 5 and marks current records as expenses', async () => {
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
  assert.equal(transactions[0].direction, 'expense');
  const state = adapter.data.get('today-can-spend:v1');
  assert.equal(state.schemaVersion, 5);
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
  const migratedState = adapter.data.get('today-can-spend:v1');
  assert.equal(migratedState.schemaVersion, 5);
  assert.ok(migratedState.transactions.every((item) => item.direction === 'expense'));
  assert.ok(migratedState.history.every((month) =>
    month.transactions.every((item) => item.direction === 'expense')));

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

  const custom = await getSpendingSummary('custom', new Date(2026, 7, 9, 12), {
    startDateKey: '2026-07-31',
    endDateKey: '2026-08-09'
  });
  assert.deepEqual(custom.metrics.map((item) => item.value), ['¥87', '¥8.70', '3笔']);
  assert.equal(custom.chart.length, 7);
  assert.equal(custom.chart.reduce((sum, item) => sum + item.amountCents, 0), 8700);
  assert.doesNotMatch(custom.scopeText, /启用前汇总 ¥/);

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

test('complete JSON backup previews and restores state, import metadata and theme', async () => {
  const originalWx = global.wx;
  const files = new Map();
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://user' },
    getFileSystemManager() {
      return {
        writeFile(options) {
          files.set(options.filePath, options.data);
          options.success();
        },
        readFile(options) {
          if (!files.has(options.filePath)) {
            options.fail({ errMsg: 'readFile:fail not found' });
            return;
          }
          options.success({ data: files.get(options.filePath) });
        }
      };
    }
  };
  try {
    const now = new Date(2026, 7, 10, 9, 30);
    await budgetStore.saveBudget({
      incomeCents: 800000,
      fixedExpenseCents: 400000,
      savingGoalCents: 100000,
      historicalSpentBeforeTrackingCents: 0
    }, now);
    await addTransaction({
      action: 'import',
      commandId: 'alipay-backup-batch',
      importedAt: now.getTime(),
      source: 'alipay',
      transactions: [{
        id: 'alipay-backup-record',
        amountCents: 1888,
        categoryId: 'food',
        direction: 'expense',
        note: '午餐',
        occurredAt: now.getTime()
      }]
    });
    await themeStore.saveTheme({ presetId: 'midnight', hueShift: 2, warmth: 0, brightness: 0 });
    const backup = await createDataBackup(now);
    assert.match(backup.fileName, /完整备份-20260810-0930\.json$/);
    const backupText = files.get(backup.filePath);
    assert.doesNotMatch(backupText, /openid|unionid|nickname/i);

    const preview = await previewDataBackup({ name: backup.fileName, path: backup.filePath });
    assert.equal(preview.recordCount, 1);
    assert.equal(preview.monthFrom, '2026-08');
    assert.equal(preview.monthTo, '2026-08');

    await addTransaction({
      action: 'create',
      commandId: 'after-backup-record',
      amountCents: 999,
      categoryId: 'other',
      note: '备份后新增',
      occurredAt: now.getTime()
    });
    await themeStore.saveTheme({ presetId: 'coral', hueShift: 0, warmth: 0, brightness: 0 });
    await restoreDataBackup(backup.filePath);
    assert.deepEqual((await listTransactions({ all: true })).map((item) => item.id), ['alipay-backup-record']);
    assert.equal((await listTransactions({ importBatches: true }))[0].id, 'alipay-backup-batch');
    assert.equal((await themeStore.loadTheme()).settings.presetId, 'midnight');

    files.set('wxfile://user/not-backup.json', '{"fileType":"wrong"}');
    await assert.rejects(previewDataBackup({
      name: 'not-backup.json',
      path: 'wxfile://user/not-backup.json'
    }), /不是“今天还能花”/);
  } finally {
    global.wx = originalWx;
  }
});

test('backup restore keeps the previous state and theme when state persistence fails', async () => {
  const adapter = makeAdapter();
  let failStateWrites = false;
  const originalSetStorage = adapter.setStorage.bind(adapter);
  adapter.setStorage = (options) => {
    if (failStateWrites && options.key === 'today-can-spend:v1') {
      options.fail({ errMsg: 'setStorage:fail quota' });
      return;
    }
    originalSetStorage(options);
  };
  setStorageAdapterForTests(adapter);
  const originalWx = global.wx;
  const files = new Map();
  global.wx = {
    env: { USER_DATA_PATH: 'wxfile://user' },
    getFileSystemManager() {
      return {
        writeFile(options) {
          files.set(options.filePath, options.data);
          options.success();
        },
        readFile(options) {
          options.success({ data: files.get(options.filePath) });
        }
      };
    }
  };
  try {
    const now = new Date(2026, 7, 10, 11);
    await budgetStore.saveBudget({
      incomeCents: 800000,
      fixedExpenseCents: 400000,
      savingGoalCents: 100000,
      historicalSpentBeforeTrackingCents: 0
    }, now);
    await addTransaction({
      action: 'create',
      commandId: 'backup-original',
      amountCents: 100,
      categoryId: 'food',
      note: '备份内容',
      occurredAt: now.getTime()
    });
    await themeStore.saveTheme({ presetId: 'midnight', hueShift: 0, warmth: 0, brightness: 0 });
    const backup = await createDataBackup(now);
    await addTransaction({
      action: 'create',
      commandId: 'current-kept',
      amountCents: 200,
      categoryId: 'transport',
      note: '当前内容',
      occurredAt: now.getTime()
    });
    await themeStore.saveTheme({ presetId: 'coral', hueShift: 0, warmth: 0, brightness: 0 });
    failStateWrites = true;
    await assert.rejects(restoreDataBackup(backup.filePath), /quota/);
    failStateWrites = false;
    assert.deepEqual((await listTransactions({ all: true })).map((item) => item.id).sort(), [
      'backup-original',
      'current-kept'
    ]);
    assert.equal((await themeStore.loadTheme()).settings.presetId, 'coral');
  } finally {
    global.wx = originalWx;
  }
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
  }), /请选择收支分类/);

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

test('schema 4 migrates to schema 5 with safe budget-cycle defaults', async () => {
  const adapter = makeAdapter();
  adapter.data.set('today-can-spend:v1', {
    schemaVersion: 4,
    monthKey: '2026-08',
    budget: {
      incomeCents: 800000,
      fixedExpenseCents: 400000,
      savingGoalCents: 100000,
      historicalSpentBeforeTrackingCents: 0,
      trackingStartDate: '2026-08-09'
    },
    transactions: [],
    processedCommandIds: [],
    history: []
  });
  setStorageAdapterForTests(adapter);
  const context = await budgetStore.loadBudgetContext(new Date(2026, 7, 10));
  assert.equal(context.status, 'ready');
  assert.equal(context.budget.cycleStartDay, 1);
  assert.equal(context.budget.activeCycleStartDate, '2026-08-01');
  assert.equal(context.budget.fixedExpenseMode || 'manual', 'manual');
  assert.deepEqual(context.budget.fixedExpenseItems, []);
  assert.deepEqual(context.budget.categoryBudgets, []);
  assert.deepEqual((await readState()).state.quickTemplates, []);
});

test('custom budget cycle survives calendar-month archiving and rolls on payday', async () => {
  const august = new Date(2026, 7, 20, 10);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 5000,
    cycleStartDay: 15,
    fixedExpenseMode: 'items',
    fixedExpenseItems: [
      { id: 'rent', name: '房租', amountCents: 300000 },
      { id: 'utilities', name: '水电会员', amountCents: 100000 }
    ],
    categoryBudgets: [{ categoryId: 'food', limitCents: 150000 }]
  }, august);
  await addTransaction({
    action: 'create',
    commandId: 'cycle-aug-food',
    amountCents: 80000,
    categoryId: 'food',
    occurredAt: august.getTime()
  });

  const septemberFirst = new Date(2026, 8, 1, 10);
  const acrossMonth = await budgetStore.loadBudgetContext(septemberFirst);
  assert.equal(acrossMonth.status, 'ready');
  assert.equal(acrossMonth.budget.activeCycleStartDate, '2026-08-15');
  let state = (await readState()).state;
  assert.equal(state.monthKey, '2026-09');
  assert.equal(state.history[0].monthKey, '2026-08');
  assert.equal(state.history[0].historicalSpentBeforeTrackingCents, 0);

  await addTransaction({
    action: 'create',
    commandId: 'cycle-sep-food',
    amountCents: 43000,
    categoryId: 'food',
    occurredAt: new Date(2026, 8, 2, 10).getTime()
  });
  assert.equal((await listTransactions({
    startDateKey: '2026-08-15',
    endDateKey: '2026-09-14'
  })).length, 2);

  const nextCycle = await budgetStore.loadBudgetContext(new Date(2026, 8, 15, 10));
  assert.equal(nextCycle.status, 'ready');
  assert.equal(nextCycle.budget.activeCycleStartDate, '2026-09-15');
  assert.equal(nextCycle.budget.historicalSpentBeforeTrackingCents, 0);
  assert.equal(nextCycle.budget.fixedExpenseMode, 'items');
  assert.deepEqual(nextCycle.budget.fixedExpenseItems, [
    { id: 'rent', name: '房租', amountCents: 300000 },
    { id: 'utilities', name: '水电会员', amountCents: 100000 }
  ]);
  state = (await readState()).state;
  assert.equal(state.transactions.length, 1);
});

test('quick templates persist, enforce the eight-item limit and can be deleted', async () => {
  const now = new Date(2026, 7, 10, 10);
  await budgetStore.saveBudget({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 0
  }, now);
  for (let index = 0; index < 8; index += 1) {
    await saveQuickTemplate({
      id: `template-${index}`,
      direction: 'expense',
      categoryId: index % 2 ? 'transport' : 'food',
      note: index === 0 ? '咖啡' : '',
      amountCents: 100 + index
    });
  }
  assert.equal((await listQuickTemplates()).length, 8);
  await assert.rejects(saveQuickTemplate({
    id: 'template-8',
    direction: 'expense',
    categoryId: 'food',
    note: '第九个',
    amountCents: 900
  }), /最多保存 8 个/);
  assert.equal(await deleteQuickTemplate('template-0'), true);
  assert.equal((await listQuickTemplates()).length, 7);
  assert.equal(await deleteQuickTemplate('missing'), false);
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
