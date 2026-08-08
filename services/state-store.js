const { BUDGET_FIELD_MAX_CENTS, TRANSACTION_MAX_CENTS } = require('../domain/money');
const { isValidCategoryId } = require('../domain/categories');
const { readRaw, removeRaw, writeRaw } = require('../infrastructure/storage');

const SCHEMA_VERSION = 2;
const LEGACY_SCHEMA_VERSION = 1;
const NOTE_MAX_LENGTH = 20;

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

function hasValidStateShell(state, transactionValidator) {
  return Boolean(
    state
    && /^\d{4}-\d{2}$/.test(state.monthKey)
    && isValidBudget(state.budget)
    && Array.isArray(state.transactions)
    && state.transactions.every(transactionValidator)
    && Array.isArray(state.processedCommandIds)
    && state.processedCommandIds.every((id) => typeof id === 'string')
  );
}

function isValidState(state) {
  return Boolean(state && state.schemaVersion === SCHEMA_VERSION)
    && hasValidStateShell(state, isValidTransaction);
}

function migrateLegacyState(state) {
  if (!state
    || state.schemaVersion !== LEGACY_SCHEMA_VERSION
    || !hasValidStateShell(state, isValidLegacyTransaction)) {
    return null;
  }
  return Object.assign({}, state, {
    schemaVersion: SCHEMA_VERSION,
    transactions: state.transactions.map((transaction) => Object.assign({}, transaction, {
      categoryId: 'other',
      note: ''
    }))
  });
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

function createState(monthKey, budget) {
  return {
    schemaVersion: SCHEMA_VERSION,
    monthKey,
    budget,
    transactions: [],
    processedCommandIds: []
  };
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
  SCHEMA_VERSION,
  clearState,
  createState,
  readState,
  saveState
};
