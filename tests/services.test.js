const test = require('node:test');
const assert = require('node:assert/strict');

const { setStorageAdapterForTests } = require('../infrastructure/storage');
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
