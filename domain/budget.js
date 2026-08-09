const {
  daysRemainingIncludingToday,
  toDateKey,
  toMonthKey
} = require('./date');
const { formatCents } = require('./money');

const BUDGET_ERROR_FIELDS = Object.freeze([
  'income',
  'fixedExpense',
  'savingGoal',
  'historicalSpentBeforeTracking'
]);

function emptyBudgetErrors() {
  return BUDGET_ERROR_FIELDS.reduce((errors, field) => {
    errors[field] = '';
    return errors;
  }, {});
}

function validateBudgetAmounts(values, recordedSpentCents) {
  const errors = emptyBudgetErrors();
  const recorded = recordedSpentCents === undefined ? 0 : recordedSpentCents;
  const fields = [
    values && values.incomeCents,
    values && values.fixedExpenseCents,
    values && values.savingGoalCents,
    values && values.historicalSpentBeforeTrackingCents,
    recorded
  ];

  if (fields.some((value) => !Number.isInteger(value) || value < 0)) {
    errors.income = '预算数据无效，请重新填写';
    return { errors, valid: false };
  }

  const income = values.incomeCents;
  const fixed = values.fixedExpenseCents;
  const saving = values.savingGoalCents;
  const historical = values.historicalSpentBeforeTrackingCents;

  if (income <= 0) errors.income = '本月收入必须大于 0';
  if (fixed > income) errors.fixedExpense = '固定支出不能超过本月收入';

  const savingMaximum = Math.max(income - fixed, 0);
  if (saving > savingMaximum) {
    errors.savingGoal = `扣除固定支出后，最多还能存 ¥${formatCents(savingMaximum)}`;
  }

  const requiredByRecordedSpending = fixed + recorded;
  if (requiredByRecordedSpending > income) {
    errors.income = `本月收入至少需要 ¥${formatCents(requiredByRecordedSpending)}，才能覆盖固定支出和已记录消费`;
  } else {
    const historicalMaximum = income - requiredByRecordedSpending;
    if (historical > historicalMaximum) {
      errors.historicalSpentBeforeTracking = `扣除固定支出和已记录消费后，最多可填 ¥${formatCents(historicalMaximum)}`;
    }
  }

  return {
    errors,
    valid: BUDGET_ERROR_FIELDS.every((field) => !errors[field])
  };
}

function sumAmounts(records) {
  return records.reduce((total, item) => total + item.amountCents, 0);
}

function deriveBudget(budget, transactions, value) {
  const now = value instanceof Date ? value : new Date(value || Date.now());
  const monthKey = toMonthKey(now);
  const todayKey = toDateKey(now);
  const records = (transactions || []).filter((item) =>
    toMonthKey(item.occurredAt) === monthKey
  );
  const todayRecords = records.filter((item) => toDateKey(item.occurredAt) === todayKey);
  const beforeTodayRecords = records.filter((item) => toDateKey(item.occurredAt) < todayKey);

  const monthlyFlexibleBudgetCents = budget.incomeCents
    - budget.fixedExpenseCents
    - budget.savingGoalCents;
  const todaySpentCents = sumAmounts(todayRecords);
  const recordedSpentBeforeTodayCents = sumAmounts(beforeTodayRecords);
  const spentBeforeTodayCents = budget.historicalSpentBeforeTrackingCents
    + recordedSpentBeforeTodayCents;
  const remainingDays = daysRemainingIncludingToday(now);
  const distributableCents = Math.max(
    monthlyFlexibleBudgetCents - spentBeforeTodayCents,
    0
  );
  const todaySuggestedBudgetCents = Math.floor(distributableCents / remainingDays);
  const todayRemainingCents = Math.max(
    todaySuggestedBudgetCents - todaySpentCents,
    0
  );
  const totalSpentCents = budget.historicalSpentBeforeTrackingCents + sumAmounts(records);
  const monthlyRemainingCents = monthlyFlexibleBudgetCents - totalSpentCents;

  let status = 'normal';
  let statusAmountCents = 0;
  if (monthlyFlexibleBudgetCents <= 0) {
    status = 'budgetUnavailable';
  } else if (monthlyRemainingCents < 0) {
    status = 'monthOverspent';
    statusAmountCents = Math.abs(monthlyRemainingCents);
  } else if (todaySpentCents > todaySuggestedBudgetCents) {
    status = 'todayOverspent';
    statusAmountCents = todaySpentCents - todaySuggestedBudgetCents;
  } else if (
    todayRemainingCents > 0
    && todayRemainingCents * 100 <= todaySuggestedBudgetCents * 30
  ) {
    status = 'runningLow';
  }

  return {
    daysRemainingIncludingToday: remainingDays,
    monthlyFlexibleBudgetCents,
    monthlyRemainingCents,
    recordedSpentBeforeTodayCents,
    spentBeforeTodayCents,
    status,
    statusAmountCents,
    todayRemainingCents,
    todaySpentCents,
    todaySuggestedBudgetCents,
    totalSpentCents
  };
}

module.exports = { deriveBudget, validateBudgetAmounts };
