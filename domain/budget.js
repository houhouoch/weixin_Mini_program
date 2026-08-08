const {
  daysRemainingIncludingToday,
  toDateKey,
  toMonthKey
} = require('./date');

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

module.exports = { deriveBudget };
