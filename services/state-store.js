const { BUDGET_FIELD_MAX_CENTS, TRANSACTION_MAX_CENTS } = require('../domain/money');
const { isValidCategoryId } = require('../domain/categories');
const { readRaw, removeRaw, writeRaw } = require('../infrastructure/storage');

const SCHEMA_VERSION = 3;
const LEGACY_SCHEMA_VERSION = 1;
const PREVIOUS_SCHEMA_VERSION = 2;
const NOTE_MAX_LENGTH = 20;
const HISTORY_MONTH_LIMIT = 36;

function isIntegerBetween(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function isValidBudget(budget) {
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

function isValidTransaction(transaction) {
  return Boolean(
    transaction
    && typeof transaction.id === 'string'
    && transaction.id.length > 0
    && isIntegerBetween(transaction.amountCents, 1, TRANSACTION_MAX_CENTS)
    && isValidCategoryId(transaction.categoryId)
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

function hasValidStateShell(state, transactionValidator, allowNullBudget) {
  const validBudget = allowNullBudget
    ? state && (state.budget === null || isValidBudget(state.budget))
    : state && isValidBudget(state.budget);
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
    && Array.isArray(state.history)
    && state.history.length <= HISTORY_MONTH_LIMIT
    && state.history.every(isValidArchiveEntry)
  );
}

function migrateSchemaOne(state) {
  if (!state
    || state.schemaVersion !== LEGACY_SCHEMA_VERSION
    || !hasValidStateShell(state, isValidLegacyTransaction, false)) {
    return null;
  }
  return {
    schemaVersion: SCHEMA_VERSION,
    monthKey: state.monthKey,
    budget: state.budget,
    transactions: state.transactions.map((transaction) => Object.assign({}, transaction, {
      categoryId: 'other',
      note: ''
    })),
    processedCommandIds: state.processedCommandIds,
    history: []
  };
}

function migrateSchemaTwo(state) {
  if (!state
    || state.schemaVersion !== PREVIOUS_SCHEMA_VERSION
    || !hasValidStateShell(state, isValidTransaction, false)) {
    return null;
  }
  return Object.assign({}, state, {
    schemaVersion: SCHEMA_VERSION,
    history: []
  });
}

function migrateLegacyState(state) {
  return migrateSchemaTwo(state) || migrateSchemaOne(state);
}

async function readState() {
  const raw = await readRaw();
  if (raw === undefined || raw === null) {
    return { issue: null, state: null };
  }
  if (isValidState(raw)) {
    return { issue: null, state: raw };
  }
  const migrated = migrateLegacyState(raw);
  if (!migrated) return { issue: 'corrupt', state: null };
  await writeRaw(migrated);
  return { issue: null, state: migrated };
}

function createState(monthKey, budget, history) {
  return {
    schemaVersion: SCHEMA_VERSION,
    monthKey,
    budget: budget || null,
    transactions: [],
    processedCommandIds: [],
    history: Array.isArray(history) ? history.slice(-HISTORY_MONTH_LIMIT) : []
  };
}

function archiveCurrentState(state) {
  if (!state || !state.budget) return state && Array.isArray(state.history) ? state.history : [];
  const entry = {
    monthKey: state.monthKey,
    historicalSpentBeforeTrackingCents:
      state.budget.historicalSpentBeforeTrackingCents,
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
  readState,
  saveState
};
