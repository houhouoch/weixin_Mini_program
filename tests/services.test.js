const test = require('node:test');
const assert = require('node:assert/strict');

const { setStorageAdapterForTests } = require('../infrastructure/storage');
const budgetStore = require('../services/budget-store');
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
    occurredAt: now.getTime()
  };
  assert.equal((await addTransaction(command)).duplicate, false);
  assert.equal((await addTransaction(command)).duplicate, true);
  assert.equal((await listTransactions()).length, 1);

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
    occurredAt: april.getTime()
  });

  assert.equal((await budgetStore.loadBudgetContext(may)).status, 'monthChange');
  const carried = await budgetStore.startNewMonth('carry', may);
  assert.equal(carried.status, 'ready');
  assert.equal(carried.budget.historicalSpentBeforeTrackingCents, 0);
  assert.equal((await listTransactions()).length, 0);
});

test('corrupt storage safely degrades', async () => {
  const adapter = makeAdapter();
  adapter.data.set('today-can-spend:v1', { schemaVersion: 99 });
  setStorageAdapterForTests(adapter);
  const result = await budgetStore.loadBudgetContext(new Date(2026, 3, 20));
  assert.equal(result.status, 'corrupt');
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
