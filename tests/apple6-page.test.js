const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
const { setStorageAdapterForTests } = require('../infrastructure/storage');
const budgetStore = require('../services/budget-store');
const themeStore = require('../services/theme-store');
const { listTransactions } = require('../services/transactions');
const { parseQuickEntries } = require('../domain/quick-entry');

function instance(overrides) {
  let definition;
  const file = path.join(__dirname, '../pages/index/index.js');
  const realRequire = createRequire(file);
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
    require(name) { return overrides && overrides[name] || realRequire(name); },
    Page(value) { definition = value; },
    console: { info() {}, warn() {}, error() {}, log() {} },
    wx: { hideKeyboard() {}, pageScrollTo() {}, setNavigationBarColor() {}, setBackgroundColor() {}, nextTick(fn) { fn(); } }
  }, { filename: file });
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)) });
  page.setData = function (patch, done) {
    Object.entries(patch).forEach(([key, value]) => {
      const keys = key.replace(/\[(\d+)\]/g, '.$1').split('.');
      let object = this.data;
      keys.slice(0, -1).forEach((part) => { object = object[part]; });
      object[keys[keys.length - 1]] = value;
    });
    if (done) done();
  };
  return page;
}
function event(dataset, value) { return { currentTarget: { dataset }, detail: { value } }; }
function adapter() {
  const data = new Map();
  return {
    getStorage(o) { data.has(o.key) ? o.success({ data: data.get(o.key) }) : o.fail({ errMsg: 'data not found' }); },
    setStorage(o) { data.set(o.key, o.data); o.success(); },
    removeStorage(o) { data.delete(o.key); o.success(); }
  };
}
test.beforeEach(() => setStorageAdapterForTests(adapter()));
test.after(() => setStorageAdapterForTests(null));

test('Apple6 mixed review remains uncommitted; type, amount and selection affect separate totals', async () => {
  const page = instance();
  const parsed = parseQuickEntries('咖啡50，外快二十元');
  assert.equal(parsed.ok, true);
  page.showSmartDrafts(parsed.value, {}, 'local');
  assert.equal((await listTransactions({ all: true })).length, 0);
  assert.equal(page.data.smartExpenseTotalText, '50.00');
  assert.equal(page.data.smartIncomeTotalText, '20.00');
  page.handleSmartDraftDirection(event({ index: 0, direction: 'income' }));
  assert.equal(page.data.smartEntryDrafts[0].categoryId, 'income_side_job');
  assert.equal(page.data.smartIncomeTotalText, '70.00');
  page.handleSmartDraftAmount(event({ index: 0 }, '12.34'));
  assert.equal(page.data.smartIncomeTotalText, '32.34');
  page.toggleSmartDraft(event({ index: 1 }));
  assert.equal(page.data.smartSelectedCount, 1);
  assert.equal(page.data.smartIncomeTotalText, '12.34');
  page.handleSmartDraftAmount(event({ index: 0 }, 'bad'));
  assert.equal(page.data.smartIncomeTotalText, '待核对');
});

test('Apple6 confirmation writes edited directions and integer cents through existing transaction service', async () => {
  const now = new Date();
  await budgetStore.saveBudget({ incomeCents: 800000, fixedExpenseCents: 80000, savingGoalCents: 200000, historicalSpentBeforeTrackingCents: 0, cycleStartDay: 1 }, now);
  const page = instance();
  page.refreshAfterMutation = async () => {};
  page.showSmartDrafts(parseQuickEntries('咖啡50，外快二十元').value, {}, 'local');
  page.handleSmartDraftDirection(event({ index: 0, direction: 'income' }));
  page.handleSmartDraftAmount(event({ index: 0 }, '12.34'));
  await page.confirmSmartEntries();
  const rows = await listTransactions({ all: true });
  assert.equal(rows.length, 2);
  assert.ok(rows.every((row) => row.direction === 'income'));
  assert.deepEqual(rows.map((row) => row.amountCents).sort((a, b) => a - b), [1234, 2000]);
  assert.equal(page.data.smartReviewVisible, false);
});

test('Apple6 cancelling a pending AI request ignores its late result and preserves the original text', async () => {
  let finish;
  const page = instance({ '../../services/ai-entry': { parseEntriesWithAi: () => new Promise((resolve) => { finish = resolve; }) } });
  page.data.smartEntryInput = '咖啡50';
  const pending = page.handleSmartSubmit();
  assert.equal(page.data.isSmartParsing, true);
  page.cancelSmartParsing();
  finish(parseQuickEntries('咖啡50').value);
  await pending;
  assert.equal(page.data.smartEntryInput, '咖啡50');
  assert.equal(page.data.smartReviewVisible, false);
  assert.equal(page.data.isSmartParsing, false);
});

test('Apple6 motion setting survives reload and theme changes; failed persistence restores previous setting', async () => {
  const page = instance();
  await page.handleReducedMotion(event({}, true));
  assert.equal((await themeStore.loadTheme()).settings.reducedMotion, true);
  page.previewTheme = (settings) => { page.data.themeDraft = settings; };
  page.handleThemePreset(event({ id: 'graphite' }));
  assert.equal(page.data.themeDraft.reducedMotion, true);
  await themeStore.saveTheme(page.data.themeDraft);
  const loaded = await themeStore.loadTheme();
  assert.equal(loaded.settings.presetId, 'graphite');
  assert.equal(loaded.settings.reducedMotion, true);
  setStorageAdapterForTests({ setStorage(o) { o.fail({ errMsg: 'disk full' }); } });
  await page.handleReducedMotion(event({}, false));
  assert.equal(page.data.themeSettings.reducedMotion, true);
  assert.match(page.data.feedback, /保存失败/);
});

test('Apple6 income ledger has its own count and empty state; offline manual entry remains reachable', () => {
  const page = instance();
  page.data.detailsTransactions = [{ direction: 'expense', amountCents: 5000 }];
  page.handleDetailsDirection(event({ direction: 'income' }));
  assert.equal(page.data.detailsRecordCount, 0);
  assert.equal(page.data.detailsVisibleTransactions.length, 0);
  page.openManualEntry();
  assert.equal(page.data.activeTab, 'settings');
  assert.equal(page.data.sections.composer, true);
  assert.equal(page.data.isSmartParsing, false);
});

test('Apple6 canvas excludes future zeroes and uses theme ink, real daily points and labelled currency axis', () => {
  const page = instance();
  const now = new Date();
  const count = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  page.data.detailsMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  page.data.themeSettings.reducedMotion = true;
  const curves = []; const labels = [];
  const context = {
    scale() {}, clearRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {}, save() {}, rect() {}, clip() {}, arc() {}, fill() {}, restore() {},
    fillText(value) { labels.push(value); },
    bezierCurveTo(...values) { curves.push(values); }
  };
  const canvas = { getContext: () => context };
  page.createSelectorQuery = () => ({ select() { return this; }, fields() { return this; }, exec(fn) { fn([{ node: canvas, width: 300, height: 180 }]); } });
  page.drawMonthlyTrend({ dailyTrend: Array.from({ length: count }, (_, i) => ({ day: i + 1, amountCents: i < now.getDate() ? 100 : 999999 })) });
  assert.equal(curves.length, now.getDate() - 1);
  assert.equal(context.strokeStyle, page.data.themeResolved.primary);
  assert.deepEqual(labels, ['¥0', '¥0.5', '¥1']);
  if (curves.length && now.getDate() < count) assert.ok(curves.at(-1)[4] < 256);
});
