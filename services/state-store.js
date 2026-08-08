const { BUDGET_FIELD_MAX_CENTS, TRANSACTION_MAX_CENTS } = require('../domain/money');
const { readRaw, removeRaw, writeRaw } = require('../infrastructure/storage');

const SCHEMA_VERSION = 1;

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
    && Number.isFinite(transaction.occurredAt)
  );
}

function isValidState(state) {
  return Boolean(
    state
    && state.schemaVersion === SCHEMA_VERSION
    && /^\d{4}-\d{2}$/.test(state.monthKey)
    && isValidBudget(state.budget)
    && Array.isArray(state.transactions)
    && state.transactions.every(isValidTransaction)
    && Array.isArray(state.processedCommandIds)
    && state.processedCommandIds.every((id) => typeof id === 'string')
  );
}

async function readState() {
  const raw = await readRaw();
  if (raw === undefined || raw === null) {
    return { issue: null, state: null };
  }
  if (!isValidState(raw)) {
    return { issue: 'corrupt', state: null };
  }
  return { issue: null, state: raw };
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
