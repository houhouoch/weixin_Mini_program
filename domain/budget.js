const {
  budgetCycleRange,
  toDateKey
} = require('./date');
const { formatCents } = require('./money');

const BUDGET_ERROR_FIELDS = Object.freeze([
  'income',
  'fixedExpense',
  'savingGoal',
  'historicalSpentBeforeTracking'
]);

const FIXED_EXPENSE_ITEM_LIMIT = 12;

function emptyBudgetErrors() {
  return BUDGET_ERROR_FIELDS.reduce((errors, field) => {
    errors[field] = '';
    return errors;
  }, {});
}

function validateBudgetAmounts(values, recordedSpentCents, recordedIncomeCents) {
  const errors = emptyBudgetErrors();
  const recorded = recordedSpentCents === undefined ? 0 : recordedSpentCents;
  const additionalIncome = recordedIncomeCents === undefined ? 0 : recordedIncomeCents;
  const fields = [
    values && values.incomeCents,
    values && values.fixedExpenseCents,
    values && values.savingGoalCents,
    values && values.historicalSpentBeforeTrackingCents,
    recorded,
    additionalIncome
  ];

  if (fields.some((value) => !Number.isInteger(value) || value < 0)) {
    errors.income = '预算数据无效，请重新填写';
    return { errors, valid: false };
  }

  const income = values.incomeCents;
  const fixed = values.fixedExpenseCents;
  const saving = values.savingGoalCents;
  const historical = values.historicalSpentBeforeTrackingCents;

  if (!Number.isInteger(values.cycleStartDay || 1)
    || (values.cycleStartDay || 1) < 1
    || (values.cycleStartDay || 1) > 28) {
    errors.income = '预算周期只能从每月 1 至 28 日开始';
  }
  const fixedExpenseItems = values.fixedExpenseItems || [];
  if (!Array.isArray(fixedExpenseItems)
    || fixedExpenseItems.length > FIXED_EXPENSE_ITEM_LIMIT
    || fixedExpenseItems.some((item) => !item
      || typeof item.name !== 'string'
      || item.name.trim().length < 1
      || item.name.trim().length > 12
      || !Number.isInteger(item.amountCents)
      || item.amountCents <= 0)) {
    errors.fixedExpense = '固定支出明细无效，请检查名称和金额';
  } else {
    const itemTotal = fixedExpenseItems.reduce((sum, item) => sum + item.amountCents, 0);
    if (itemTotal > fixed) {
      errors.fixedExpense = `固定支出明细合计不能超过 ¥${formatCents(fixed)}`;
    }
  }

  if (income <= 0) errors.income = '固定收入必须大于 0';
  if (fixed > income) errors.fixedExpense = '固定支出不能超过固定收入';

  const availableIncome = income + additionalIncome;
  const savingMaximum = Math.max(availableIncome - fixed, 0);
  if (saving > savingMaximum) {
    errors.savingGoal = `扣除固定支出后，最多还能存 ¥${formatCents(savingMaximum)}`;
  }

  const requiredByRecordedSpending = fixed + recorded;
  if (requiredByRecordedSpending > availableIncome) {
    errors.income = `固定收入与额外收入合计至少需要 ¥${formatCents(requiredByRecordedSpending)}，才能覆盖固定支出和已记录消费`;
  } else {
    const historicalMaximum = availableIncome - requiredByRecordedSpending;
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
  const todayKey = toDateKey(now);
  const cycle = budgetCycleRange(budget.cycleStartDay || 1, now);
  const records = (transactions || []).filter((item) =>
    toDateKey(item.occurredAt) >= cycle.startDateKey
      && toDateKey(item.occurredAt) <= cycle.endDateKey
  );
  const incomeRecords = records.filter((item) => item.direction === 'income');
  const expenseRecords = records.filter((item) => item.direction !== 'income');
  const todayRecords = expenseRecords.filter((item) => toDateKey(item.occurredAt) === todayKey);
  const beforeTodayRecords = expenseRecords.filter((item) => toDateKey(item.occurredAt) < todayKey);
  const recordedIncomeCents = sumAmounts(incomeRecords);

  const monthlyFlexibleBudgetCents = budget.incomeCents
    + recordedIncomeCents
    - budget.fixedExpenseCents
    - budget.savingGoalCents;
  const todaySpentCents = sumAmounts(todayRecords);
  const recordedSpentBeforeTodayCents = sumAmounts(beforeTodayRecords);
  const spentBeforeTodayCents = budget.historicalSpentBeforeTrackingCents
    + recordedSpentBeforeTodayCents;
  const remainingDays = cycle.daysRemainingIncludingToday;
  const distributableCents = Math.max(
    monthlyFlexibleBudgetCents - spentBeforeTodayCents,
    0
  );
  const todaySuggestedBudgetCents = Math.floor(distributableCents / remainingDays);
  const todayRemainingCents = Math.max(
    todaySuggestedBudgetCents - todaySpentCents,
    0
  );
  const totalSpentCents = budget.historicalSpentBeforeTrackingCents + sumAmounts(expenseRecords);
  const monthlyRemainingCents = monthlyFlexibleBudgetCents - totalSpentCents;
  const categorySpent = expenseRecords.reduce((totals, item) => {
    totals[item.categoryId] = (totals[item.categoryId] || 0) + item.amountCents;
    return totals;
  }, Object.create(null));
  const categoryBudgetAlerts = (budget.categoryBudgets || []).map((item) => {
    const spentCents = categorySpent[item.categoryId] || 0;
    const percent = item.limitCents > 0
      ? Math.floor(spentCents * 100 / item.limitCents)
      : 0;
    return {
      categoryId: item.categoryId,
      limitCents: item.limitCents,
      percent,
      spentCents,
      status: percent >= 100 ? 'over' : percent >= 80 ? 'near' : 'normal'
    };
  }).filter((item) => item.status !== 'normal')
    .sort((a, b) => b.percent - a.percent);

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
    categoryBudgetAlerts,
    cycleEndDateKey: cycle.endDateKey,
    cycleLabel: (budget.cycleStartDay || 1) === 1 ? '本月' : '本周期',
    cycleStartDateKey: cycle.startDateKey,
    daysRemainingIncludingToday: remainingDays,
    monthlyFlexibleBudgetCents,
    monthlyRemainingCents,
    recordedIncomeCents,
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
