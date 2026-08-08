const { toDateKey, toMonthKey } = require('../domain/date');
const { clearState, createState, readState, saveState } = require('./state-store');

function makeBudget(values, now) {
  return {
    incomeCents: values.incomeCents,
    fixedExpenseCents: values.fixedExpenseCents,
    savingGoalCents: values.savingGoalCents,
    historicalSpentBeforeTrackingCents: values.historicalSpentBeforeTrackingCents,
    trackingStartDate: values.trackingStartDate || toDateKey(now)
  };
}

async function loadBudgetContext(now) {
  const current = now || new Date();
  const result = await readState();
  if (!result.state) {
    return { status: result.issue === 'corrupt' ? 'corrupt' : 'empty', budget: null };
  }
  if (result.state.monthKey !== toMonthKey(current)) {
    return { status: 'monthChange', budget: result.state.budget };
  }
  return { status: 'ready', budget: result.state.budget };
}

async function saveBudget(values, now) {
  const current = now || new Date();
  const monthKey = toMonthKey(current);
  const result = await readState();
  const budget = makeBudget(values, current);
  let state;

  if (result.state && result.state.monthKey === monthKey) {
    state = Object.assign({}, result.state, { budget });
  } else {
    state = createState(monthKey, budget);
  }
  await saveState(state);
  return budget;
}

async function startNewMonth(mode, now) {
  const current = now || new Date();
  const result = await readState();
  if (mode === 'reset' || !result.state) {
    await clearState();
    return { status: 'empty' };
  }

  const previous = result.state.budget;
  const budget = makeBudget({
    incomeCents: previous.incomeCents,
    fixedExpenseCents: previous.fixedExpenseCents,
    savingGoalCents: previous.savingGoalCents,
    historicalSpentBeforeTrackingCents: 0
  }, current);
  await saveState(createState(toMonthKey(current), budget));
  return { status: 'ready', budget };
}

async function resetCurrentMonth() {
  await clearState();
}

module.exports = {
  loadBudgetContext,
  resetCurrentMonth,
  saveBudget,
  startNewMonth
};
