const { BUDGET_FIELD_MAX_CENTS, TRANSACTION_MAX_CENTS } = require('../domain/money');
const { categoriesForDirection, isValidCategoryId } = require('../domain/categories');
const { readRaw, removeRaw, writeRaw } = require('../infrastructure/storage');

const SCHEMA_VERSION = 5;
const LEGACY_SCHEMA_VERSION = 1;
const SCHEMA_TWO_VERSION = 2;
const SCHEMA_THREE_VERSION = 3;
const PREVIOUS_SCHEMA_VERSION = 4;
const NOTE_MAX_LENGTH = 20;
const HISTORY_MONTH_LIMIT = 36;

function isIntegerBetween(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isValidLegacyBudget(budget) {
  return Boolean(
    budget
    && isIntegerBetween(budget.incomeCents, 0, BUDGET_FIELD_MAX_CENTS)
    && isIntegerBetween(budget.fixedExpenseCents, 0, BUDGET_FIELD_MAX_CENTS)
    && isIntegerBetween(budget.savingGoalCents, 0, BUDGET_FIELD_MAX_CENTS)
    && isIntegerBetween(
      budget.historicalSpentBeforeTrackingCents,
      0,
      BUDGET_FIELD_MAX_CENTS
    )
    && /^\d{4}-\d{2}-\d{2}$/.test(budget.trackingStartDate)
  );
}

function isValidFixedExpenseItem(item) {
  return Boolean(
    item
    && typeof item.id === 'string'
    && /^[a-z0-9-]{1,100}$/.test(item.id)
    && typeof item.name === 'string'
    && item.name.trim().length >= 1
    && item.name.trim().length <= 12
    && isIntegerBetween(item.amountCents, 1, BUDGET_FIELD_MAX_CENTS)
  );
}

function isValidCategoryBudget(item) {
  return Boolean(
    item
    && categoriesForDirection('expense').some((category) => category.id === item.categoryId)
    && isIntegerBetween(item.limitCents, 1, BUDGET_FIELD_MAX_CENTS)
  );
}

function isValidBudget(budget) {
  const fixedItems = budget && budget.fixedExpenseItems;
  const categoryBudgets = budget && budget.categoryBudgets;
  return Boolean(
    isValidLegacyBudget(budget)
    && isIntegerBetween(budget.cycleStartDay, 1, 28)
    && /^\d{4}-\d{2}-\d{2}$/.test(budget.activeCycleStartDate)
    && Array.isArray(fixedItems)
    && fixedItems.length <= 12
    && fixedItems.every(isValidFixedExpenseItem)
    && new Set(fixedItems.map((item) => item.id)).size === fixedItems.length
    && fixedItems.reduce((sum, item) => sum + item.amountCents, 0)
      <= budget.fixedExpenseCents
    && Array.isArray(categoryBudgets)
    && categoryBudgets.length <= categoriesForDirection('expense').length
    && categoryBudgets.every(isValidCategoryBudget)
    && new Set(categoryBudgets.map((item) => item.categoryId)).size === categoryBudgets.length
  );
}

function isValidQuickTemplate(template) {
  return Boolean(
    template
    && typeof template.id === 'string'
    && /^[a-z0-9-]{1,100}$/.test(template.id)
    && (template.direction === 'expense' || template.direction === 'income')
    && isIntegerBetween(template.amountCents, 1, TRANSACTION_MAX_CENTS)
    && categoriesForDirection(template.direction)
      .some((category) => category.id === template.categoryId)
    && typeof template.note === 'string'
    && template.note.length <= NOTE_MAX_LENGTH
  );
}

function isValidTransaction(transaction) {
  const hasImportBatchId = transaction
    && Object.prototype.hasOwnProperty.call(transaction, 'importBatchId');
  const hasImportedAt = transaction
    && Object.prototype.hasOwnProperty.call(transaction, 'importedAt');
  const validImportMetadata = !hasImportBatchId && !hasImportedAt
    || (hasImportBatchId
      && hasImportedAt
      && typeof transaction.importBatchId === 'string'
      && /^[a-z0-9-]{1,100}$/.test(transaction.importBatchId)
      && Number.isFinite(transaction.importedAt));
  return Boolean(
    transaction
    && typeof transaction.id === 'string'
    && transaction.id.length > 0
    && (transaction.direction === 'expense' || transaction.direction === 'income')
    && isIntegerBetween(transaction.amountCents, 1, TRANSACTION_MAX_CENTS)
    && isValidCategoryId(transaction.categoryId)
    && categoriesForDirection(transaction.direction)
      .some((category) => category.id === transaction.categoryId)
    && typeof transaction.note === 'string'
    && transaction.note.length <= NOTE_MAX_LENGTH
    && Number.isFinite(transaction.occurredAt)
    && validImportMetadata
  );
}

function isValidPreviousTransaction(transaction) {
  return Boolean(
    transaction
    && typeof transaction.id === 'string'
    && transaction.id.length > 0
    && isIntegerBetween(transaction.amountCents, 1, TRANSACTION_MAX_CENTS)
    && isValidCategoryId(transaction.categoryId)
    && categoriesForDirection('expense')
      .some((category) => category.id === transaction.categoryId)
    && typeof transaction.note === 'string'
    && transaction.note.length <= NOTE_MAX_LENGTH
    && Number.isFinite(transaction.occurredAt)
  );
}

function isValidLegacyTransaction(transaction) {
  return Boolean(
    transaction
    && typeof transaction.id === 'string'
    && transaction.id.length > 0
    && isIntegerBetween(transaction.amountCents, 1, TRANSACTION_MAX_CENTS)
    && Number.isFinite(transaction.occurredAt)
  );
}

function isValidArchiveEntry(entry) {
  return Boolean(
    entry
    && /^\d{4}-\d{2}$/.test(entry.monthKey)
    && isIntegerBetween(
      entry.historicalSpentBeforeTrackingCents,
      0,
      BUDGET_FIELD_MAX_CENTS
    )
    && Array.isArray(entry.transactions)
    && entry.transactions.every(isValidTransaction)
  );
}

function isValidPreviousArchiveEntry(entry) {
  return Boolean(
    entry
    && /^\d{4}-\d{2}$/.test(entry.monthKey)
    && isIntegerBetween(
      entry.historicalSpentBeforeTrackingCents,
      0,
      BUDGET_FIELD_MAX_CENTS
    )
    && Array.isArray(entry.transactions)
    && entry.transactions.every(isValidPreviousTransaction)
  );
}

function asExpense(transaction) {
  return Object.assign({}, transaction, { direction: 'expense' });
}

function hasValidStateShell(state, transactionValidator, allowNullBudget, budgetValidator) {
  const validateBudget = budgetValidator || isValidBudget;
  const validBudget = allowNullBudget
    ? state && (state.budget === null || validateBudget(state.budget))
    : state && validateBudget(state.budget);
  return Boolean(
    state
    && /^\d{4}-\d{2}$/.test(state.monthKey)
    && validBudget
    && Array.isArray(state.transactions)
    && state.transactions.every(transactionValidator)
    && (state.budget !== null || state.transactions.length === 0)
    && Array.isArray(state.processedCommandIds)
    && state.processedCommandIds.every((id) => typeof id === 'string')
  );
}

function isValidState(state) {
  return Boolean(
    state
    && state.schemaVersion === SCHEMA_VERSION
    && hasValidStateShell(state, isValidTransaction, true)
    && Array.isArray(state.quickTemplates)
    && state.quickTemplates.length <= 8
    && state.quickTemplates.every(isValidQuickTemplate)
    && new Set(state.quickTemplates.map((item) => item.id)).size === state.quickTemplates.length
    && Array.isArray(state.history)
    && state.history.length <= HISTORY_MONTH_LIMIT
    && state.history.every(isValidArchiveEntry)
  );
}

function schemaFiveBudget(budget, monthKey) {
  if (!budget) return null;
  return Object.assign({}, budget, {
    cycleStartDay: 1,
    activeCycleStartDate: `${monthKey || budget.trackingStartDate.slice(0, 7)}-01`,
    fixedExpenseItems: [],
    categoryBudgets: []
  });
}

function migrateSchemaOne(state) {
  if (!state
    || state.schemaVersion !== LEGACY_SCHEMA_VERSION
    || !hasValidStateShell(state, isValidLegacyTransaction, false, isValidLegacyBudget)) {
    return null;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    monthKey: state.monthKey,
    budget: schemaFiveBudget(state.budget, state.monthKey),
    transactions: state.transactions.map((transaction) => Object.assign({}, transaction, {
      categoryId: 'other',
      direction: 'expense',
      note: ''
    })),
    processedCommandIds: state.processedCommandIds,
    quickTemplates: [],
    history: []
  };
}

function migrateSchemaTwo(state) {
  if (!state
    || state.schemaVersion !== SCHEMA_TWO_VERSION
    || !hasValidStateShell(state, isValidPreviousTransaction, false, isValidLegacyBudget)) {
    return null;
  }
  return Object.assign({}, state, {
    schemaVersion: SCHEMA_VERSION,
    budget: schemaFiveBudget(state.budget, state.monthKey),
    transactions: state.transactions.map(asExpense),
    quickTemplates: [],
    history: []
  });
}

function migrateSchemaThree(state) {
  if (!state
    || state.schemaVersion !== SCHEMA_THREE_VERSION
    || !hasValidStateShell(state, isValidPreviousTransaction, true, isValidLegacyBudget)
    || !Array.isArray(state.history)
    || state.history.length > HISTORY_MONTH_LIMIT
    || !state.history.every(isValidPreviousArchiveEntry)) {
    return null;
  }
  return Object.assign({}, state, {
    schemaVersion: SCHEMA_VERSION,
    budget: schemaFiveBudget(state.budget, state.monthKey),
    transactions: state.transactions.map(asExpense),
    quickTemplates: [],
    history: state.history.map((entry) => Object.assign({}, entry, {
      transactions: entry.transactions.map(asExpense)
    }))
  });
}

function migrateSchemaFour(state) {
  if (!state
    || state.schemaVersion !== PREVIOUS_SCHEMA_VERSION
    || !hasValidStateShell(state, isValidTransaction, true, isValidLegacyBudget)
    || !Array.isArray(state.history)
    || state.history.length > HISTORY_MONTH_LIMIT
    || !state.history.every(isValidArchiveEntry)) {
    return null;
  }
  return Object.assign({}, state, {
    schemaVersion: SCHEMA_VERSION,
    budget: schemaFiveBudget(state.budget, state.monthKey),
    quickTemplates: []
  });
}

function migrateLegacyState(state) {
  return migrateSchemaFour(state)
    || migrateSchemaThree(state)
    || migrateSchemaTwo(state)
    || migrateSchemaOne(state);
}

function normalizeState(state) {
  if (isValidState(state)) return state;
  return migrateLegacyState(state);
}

async function readState() {
  const raw = await readRaw();
  if (raw === undefined || raw === null) {
    return { issue: null, state: null };
  }
  const migrated = normalizeState(raw);
  if (!migrated) return { issue: 'corrupt', state: null };
  if (migrated === raw) return { issue: null, state: raw };
  await writeRaw(migrated);
  return { issue: null, state: migrated };
}

function createState(monthKey, budget, history, quickTemplates) {
  return {
    schemaVersion: SCHEMA_VERSION,
    monthKey,
    budget: budget || null,
    transactions: [],
    processedCommandIds: [],
    quickTemplates: Array.isArray(quickTemplates) ? quickTemplates.slice(0, 8) : [],
    history: Array.isArray(history) ? history.slice(-HISTORY_MONTH_LIMIT) : []
  };
}

function archiveCurrentState(state) {
  if (!state || !state.budget) return state && Array.isArray(state.history) ? state.history : [];
  const entry = {
    monthKey: state.monthKey,
    historicalSpentBeforeTrackingCents: state.budget.cycleStartDay === 1
      ? state.budget.historicalSpentBeforeTrackingCents
      : 0,
    transactions: state.transactions.slice()
  };
  return state.history
    .filter((item) => item.monthKey !== state.monthKey)
    .concat(entry)
    .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
    .slice(-HISTORY_MONTH_LIMIT);
}

async function saveState(state) {
  if (!isValidState(state)) {
    throw new Error('拒绝保存无效的本地数据');
  }
  await writeRaw(state);
  return state;
}

async function clearState() {
  await removeRaw();
}

module.exports = {
  HISTORY_MONTH_LIMIT,
  SCHEMA_VERSION,
  archiveCurrentState,
  clearState,
  createState,
  isValidState,
  normalizeState,
  readState,
  saveState
};
