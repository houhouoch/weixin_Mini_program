const { budgetCycleRange, toDateKey, toMonthKey } = require('../domain/date');
const { categoriesForDirection } = require('../domain/categories');
const { normalizeFixedExpenseMode, validateBudgetAmounts } = require('../domain/budget');
const {
  archiveCurrentState,
  createState,
  readState,
  saveState
} = require('./state-store');

function makeBudget(values, now) {
  const cycleStartDay = values.cycleStartDay || 1;
  const cycle = budgetCycleRange(cycleStartDay, now);
  return {
    incomeCents: values.incomeCents,
    fixedExpenseCents: values.fixedExpenseCents,
    savingGoalCents: values.savingGoalCents,
    historicalSpentBeforeTrackingCents: values.historicalSpentBeforeTrackingCents,
    trackingStartDate: values.trackingStartDate || toDateKey(now),
    cycleStartDay,
    activeCycleStartDate: cycle.startDateKey,
    fixedExpenseMode: normalizeFixedExpenseMode(values.fixedExpenseMode),
    fixedExpenseItems: (values.fixedExpenseItems || []).map((item) => ({
      id: item.id,
      name: item.name.trim(),
      amountCents: item.amountCents
    })),
    categoryBudgets: (values.categoryBudgets || []).map((item) => ({
      categoryId: item.categoryId,
      limitCents: item.limitCents
    }))
  };
}

function allTransactions(state) {
  return state.history.reduce(
    (all, entry) => all.concat(entry.transactions),
    state.transactions.slice()
  );
}

function transactionsInCycle(state, cycleStartDay, now) {
  const cycle = budgetCycleRange(cycleStartDay, now);
  return allTransactions(state).filter((item) => {
    const key = toDateKey(item.occurredAt);
    return key >= cycle.startDateKey && key <= cycle.endDateKey;
  });
}

function validateCategoryBudgets(values) {
  const items = values.categoryBudgets || [];
  const allowed = new Set(categoriesForDirection('expense').map((item) => item.id));
  if (!Array.isArray(items)
    || items.length > allowed.size
    || new Set(items.map((item) => item.categoryId)).size !== items.length
    || items.some((item) => !allowed.has(item.categoryId)
      || !Number.isInteger(item.limitCents)
      || item.limitCents <= 0)) {
    throw new Error('分类预算设置无效');
  }
}

function carryBudgetToCurrentCycle(budget, now) {
  return makeBudget(Object.assign({}, budget, {
    historicalSpentBeforeTrackingCents: 0,
    trackingStartDate: budget.trackingStartDate
  }), now);
}

async function loadBudgetContext(now) {
  const current = now || new Date();
  const monthKey = toMonthKey(current);
  const result = await readState();
  if (!result.state) {
    return { status: result.issue === 'corrupt' ? 'corrupt' : 'empty', budget: null };
  }
  let state = result.state;
  if (state.monthKey !== monthKey) {
    if (!state.budget) {
      await saveState(createState(
        monthKey,
        null,
        archiveCurrentState(state),
        state.quickTemplates
      ));
      return { status: 'empty', budget: null };
    }
    const history = archiveCurrentState(state);
    if (state.budget.cycleStartDay === 1) {
      return { status: 'monthChange', budget: state.budget };
    }
    state = createState(monthKey, state.budget, history, state.quickTemplates);
    await saveState(state);
  }
  if (!state.budget) return { status: 'empty', budget: null };
  const cycle = budgetCycleRange(state.budget.cycleStartDay, current);
  if (state.budget.activeCycleStartDate !== cycle.startDateKey) {
    const budget = carryBudgetToCurrentCycle(state.budget, current);
    state = Object.assign({}, state, { budget });
    await saveState(state);
  }
  return { status: 'ready', budget: state.budget };
}

async function saveBudget(values, now) {
  const current = now || new Date();
  const monthKey = toMonthKey(current);
  const result = await readState();
  validateCategoryBudgets(values);
  let baseState = result.state;
  if (baseState && baseState.monthKey !== monthKey) {
    baseState = createState(
      monthKey,
      baseState.budget,
      archiveCurrentState(baseState),
      baseState.quickTemplates
    );
  }
  const currentTransactions = baseState
    ? transactionsInCycle(baseState, values.cycleStartDay || 1, current)
    : [];
  const recordedSpentCents = currentTransactions
    .filter((item) => item.direction !== 'income')
    .reduce((sum, item) => sum + item.amountCents, 0);
  const recordedIncomeCents = currentTransactions
    .filter((item) => item.direction === 'income')
    .reduce((sum, item) => sum + item.amountCents, 0);
  const validation = validateBudgetAmounts(values, recordedSpentCents, recordedIncomeCents);
  if (!validation.valid) {
    const message = Object.values(validation.errors).find(Boolean);
    throw new Error(message || '预算设置无效');
  }
  const budget = makeBudget(values, current);
  let state;

  if (baseState) {
    state = Object.assign({}, baseState, { budget });
  } else {
    state = createState(monthKey, budget);
  }
  await saveState(state);
  return budget;
}

async function startNewMonth(mode, now) {
  const current = now || new Date();
  const monthKey = toMonthKey(current);
  const result = await readState();
  if (!result.state) {
    return { status: 'empty' };
  }

  const history = archiveCurrentState(result.state);
  if (mode === 'reset' || !result.state.budget) {
    await saveState(createState(monthKey, null, history, result.state.quickTemplates));
    return { status: 'empty' };
  }

  const previous = result.state.budget;
  const budget = makeBudget({
    incomeCents: previous.incomeCents,
    fixedExpenseCents: previous.fixedExpenseCents,
    savingGoalCents: previous.savingGoalCents,
    historicalSpentBeforeTrackingCents: 0,
    cycleStartDay: previous.cycleStartDay,
    fixedExpenseMode: previous.fixedExpenseMode,
    fixedExpenseItems: previous.fixedExpenseItems,
    categoryBudgets: previous.categoryBudgets,
    trackingStartDate: previous.trackingStartDate
  }, current);
  await saveState(createState(monthKey, budget, history, result.state.quickTemplates));
  return { status: 'ready', budget };
}

async function resetCurrentMonth(now) {
  const current = now || new Date();
  const result = await readState();
  const history = result.state ? result.state.history : [];
  await saveState(createState(
    toMonthKey(current),
    null,
    history,
    result.state ? result.state.quickTemplates : []
  ));
}

module.exports = {
  loadBudgetContext,
  resetCurrentMonth,
  saveBudget,
  startNewMonth
};
