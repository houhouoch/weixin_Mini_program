const { toDateKey, toMonthKey } = require('../domain/date');
const {
  archiveCurrentState,
  createState,
  readState,
  saveState
} = require('./state-store');

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
  const monthKey = toMonthKey(current);
  const result = await readState();
  if (!result.state) {
    return { status: result.issue === 'corrupt' ? 'corrupt' : 'empty', budget: null };
  }
  if (result.state.monthKey !== monthKey) {
    if (!result.state.budget) {
      await saveState(createState(monthKey, null, result.state.history));
      return { status: 'empty', budget: null };
    }
    return { status: 'monthChange', budget: result.state.budget };
  }
  if (!result.state.budget) return { status: 'empty', budget: null };
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
  } else if (result.state) {
    state = createState(monthKey, budget, archiveCurrentState(result.state));
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
    await saveState(createState(monthKey, null, history));
    return { status: 'empty' };
  }

  const previous = result.state.budget;
  const budget = makeBudget({
    incomeCents: previous.incomeCents,
    fixedExpenseCents: previous.fixedExpenseCents,
    savingGoalCents: previous.savingGoalCents,
    historicalSpentBeforeTrackingCents: 0
  }, current);
  await saveState(createState(monthKey, budget, history));
  return { status: 'ready', budget };
}

async function resetCurrentMonth(now) {
  const current = now || new Date();
  const result = await readState();
  const history = result.state ? result.state.history : [];
  await saveState(createState(toMonthKey(current), null, history));
}

module.exports = {
  loadBudgetContext,
  resetCurrentMonth,
  saveBudget,
  startNewMonth
};
