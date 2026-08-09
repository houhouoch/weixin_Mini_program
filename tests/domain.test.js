const test = require('node:test');
const assert = require('node:assert/strict');

const { deriveBudget } = require('../domain/budget');
const {
  daysInMonth,
  daysRemainingIncludingToday,
  daysSince,
  toDateKey
} = require('../domain/date');
const { formatCents, parseYuanToCents } = require('../domain/money');
const { deriveSpendingSummary } = require('../domain/spending-summary');
const {
  contrastRatio,
  getThemePresets,
  resolveTheme
} = require('../domain/theme');

function budget(overrides) {
  return Object.assign({
    incomeCents: 800000,
    fixedExpenseCents: 400000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 150000,
    trackingStartDate: '2026-04-20'
  }, overrides || {});
}

test('amount parsing is strict and uses cents', () => {
  assert.deepEqual(parseYuanToCents('36.36', { allowZero: false }), { ok: true, value: 3636 });
  assert.equal(parseYuanToCents('0', { allowZero: false }).ok, false);
  assert.equal(parseYuanToCents('-1').ok, false);
  assert.equal(parseYuanToCents('1.234').ok, false);
  assert.equal(parseYuanToCents('1..2').ok, false);
  assert.equal(parseYuanToCents('abc').ok, false);
  assert.equal(formatCents(-30000), '-300.00');
});

test('acceptance A01 normal calculation', () => {
  const result = deriveBudget(budget(), [], new Date(2026, 3, 20, 12));
  assert.equal(result.daysRemainingIncludingToday, 11);
  assert.equal(result.monthlyFlexibleBudgetCents, 300000);
  assert.equal(result.todaySuggestedBudgetCents, 13636);
  assert.equal(result.todayRemainingCents, 13636);
  assert.equal(result.monthlyRemainingCents, 150000);
});

test('acceptance A02 and A03 additions update the result', () => {
  const now = new Date(2026, 3, 20, 12);
  const first = { id: 'a', amountCents: 3636, occurredAt: now.getTime() };
  const a02 = deriveBudget(budget(), [first], now);
  assert.equal(a02.todaySpentCents, 3636);
  assert.equal(a02.todayRemainingCents, 10000);
  assert.equal(a02.monthlyRemainingCents, 146364);

  const second = { id: 'b', amountCents: 12000, occurredAt: now.getTime() + 1 };
  const a03 = deriveBudget(budget(), [first, second], now);
  assert.equal(a03.todaySpentCents, 15636);
  assert.equal(a03.todayRemainingCents, 0);
  assert.equal(a03.status, 'todayOverspent');
  assert.equal(a03.statusAmountCents, 2000);
});

test('budget unavailable and month overspend have priority', () => {
  const now = new Date(2026, 3, 20, 12);
  const unavailable = deriveBudget(budget({
    incomeCents: 500000,
    fixedExpenseCents: 400000,
    savingGoalCents: 150000,
    historicalSpentBeforeTrackingCents: 0
  }), [], now);
  assert.equal(unavailable.status, 'budgetUnavailable');
  assert.equal(unavailable.todayRemainingCents, 0);

  const overspent = deriveBudget(budget({
    incomeCents: 500000,
    fixedExpenseCents: 200000,
    savingGoalCents: 100000,
    historicalSpentBeforeTrackingCents: 230000
  }), [], now);
  assert.equal(overspent.status, 'monthOverspent');
  assert.equal(overspent.statusAmountCents, 30000);
  assert.equal(overspent.monthlyRemainingCents, -30000);
});

test('cross-day records become spent-before-today without disappearing', () => {
  const yesterday = new Date(2026, 3, 20, 20);
  const today = new Date(2026, 3, 21, 8);
  const result = deriveBudget(budget(), [
    { id: 'a', amountCents: 3636, occurredAt: yesterday.getTime() }
  ], today);
  assert.equal(result.todaySpentCents, 0);
  assert.equal(result.recordedSpentBeforeTodayCents, 3636);
});

test('date rules handle leap years, month end and usage days', () => {
  assert.equal(daysInMonth(new Date(2028, 1, 1)), 29);
  assert.equal(daysInMonth(new Date(2027, 1, 1)), 28);
  assert.equal(daysRemainingIncludingToday(new Date(2026, 3, 30)), 1);
  assert.equal(toDateKey(new Date(2026, 0, 2)), '2026-01-02');
  assert.equal(daysSince('2026-04-20', new Date(2026, 3, 22)), 3);
});

test('day and month summaries use only real dated records for trends', () => {
  const now = new Date(2026, 7, 9, 12);
  const state = {
    monthKey: '2026-08',
    budget: budget({
      historicalSpentBeforeTrackingCents: 5000,
      trackingStartDate: '2026-08-01'
    }),
    transactions: [
      { id: 'today', amountCents: 1500, categoryId: 'food', note: '咖啡', occurredAt: now.getTime() },
      { id: 'yesterday', amountCents: 400, categoryId: 'transport', note: '地铁', occurredAt: new Date(2026, 7, 8, 8).getTime() }
    ],
    history: []
  };

  const day = deriveSpendingSummary(state, 'day', now);
  assert.deepEqual(day.metrics.map((item) => item.value), ['¥15', '¥4', '¥0']);
  assert.match(day.insightText, /餐饮 ¥15/);
  assert.match(day.scopeText, /趋势不含启用前汇总 ¥50/);

  const month = deriveSpendingSummary(state, 'month', now);
  assert.equal(month.metrics[0].value, '¥69');
  assert.equal(month.chart.reduce((sum, item) => sum + item.amountCents, 0), 1900);
  assert.match(month.scopeText, /趋势不含该汇总/);
});

test('all theme presets keep readable contrast across the full safe tuning range', () => {
  getThemePresets('forest').forEach((preset) => {
    for (let hueShift = -30; hueShift <= 30; hueShift += 1) {
      for (let warmth = -10; warmth <= 10; warmth += 1) {
        for (let brightness = -10; brightness <= 10; brightness += 1) {
          const resolved = resolveTheme({
            presetId: preset.id,
            hueShift,
            warmth,
            brightness
          });
          assert.ok(contrastRatio(resolved.primary, resolved.onPrimary) >= 4.5);
          assert.ok(contrastRatio(resolved.accent, resolved.onAccent) >= 4.5);
          assert.ok(contrastRatio(resolved.page, resolved.text) >= 4.5);
          assert.ok(contrastRatio(resolved.surface, resolved.text) >= 4.5);
          assert.ok(contrastRatio(resolved.page, resolved.muted) >= 3);
          assert.ok(contrastRatio(resolved.surface, resolved.muted) >= 3);
        }
      }
    }
  });
});
