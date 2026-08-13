/*
 * Run after the official CLI has enabled automation, for example:
 *   cli.bat auto --project <absolute-project-path> --port 9420 --trust-project
 *   NODE_PATH=<Temp harness>\\node_modules node scripts/automator-smoke.js
 *
 * This smoke test intentionally touches only the two minimal-app storage keys
 * and restores their exact prior state before disconnecting.
 */
const assert = require('assert');
const os = require('os');
const path = require('path');
const util = require('util');
const automator = require('miniprogram-automator');
const MiniProgram = require('miniprogram-automator/out/MiniProgram').default;

// DevTools 2.02 omits the legacy SDKVersion property expected by Automator
// 0.12.x. The official CLI has already opened this exact project; skip only
// that stale client-side guard so the runtime API can be exercised.
MiniProgram.prototype.checkVersion = async function checkVersion() {};

const WS_ENDPOINT = process.env.WECHAT_AUTOMATOR_WS || 'ws://127.0.0.1:9420';
const TRACE_CONSOLE = process.env.WECHAT_AUTOMATOR_TRACE_CONSOLE === '1';
const STORAGE_KEYS = [
  'today-can-spend:minimal:v1',
  'today-can-spend:minimal:theme:v1'
];
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function requireElement(element, selector) {
  assert.ok(element, `找不到关键控件：${selector}`);
  return element;
}

async function waitFor(condition, label, timeout = 6000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeout) {
    if (await condition()) return;
    await sleep(150);
  }
  throw new Error(`等待超时：${label}`);
}

async function pageState(miniProgram) {
  return miniProgram.evaluate(() => {
    const page = getCurrentPages().slice(-1)[0];
    return page && {
      route: page.route,
      viewState: page.data.viewState,
      drawerVisible: page.data.drawerVisible,
      themeDrawerVisible: page.data.themeDrawerVisible,
      sections: page.data.sections,
      composerDetailsOpen: page.data.composerDetailsOpen,
      transactionCount: (page.data.transactions || []).length,
      quickTemplateCount: (page.data.quickTemplates || []).length,
      result: page.data.result,
      budget: page.data.budget,
      feedback: page.data.feedback,
      inputError: page.data.inputError,
      themeName: page.data.themeName
    };
  });
}

async function snapshotMinimalStorage(miniProgram) {
  const info = await miniProgram.callWxMethod('getStorageInfoSync');
  const keys = (info && info.keys) || [];
  const snapshot = {};
  for (const key of STORAGE_KEYS) {
    snapshot[key] = {
      present: keys.includes(key),
      value: keys.includes(key)
        ? await miniProgram.callWxMethod('getStorageSync', key)
        : undefined
    };
  }
  return snapshot;
}

async function restoreMinimalStorage(miniProgram, snapshot) {
  for (const key of STORAGE_KEYS) {
    const entry = snapshot[key];
    if (entry && entry.present) {
      await miniProgram.callWxMethod('setStorageSync', key, entry.value);
    } else {
      await miniProgram.callWxMethod('removeStorageSync', key);
    }
  }
}

async function input(page, selector, value) {
  const element = requireElement(await page.$(selector), selector);
  await element.input(value);
}

async function tap(page, selector) {
  const element = requireElement(await page.$(selector), selector);
  await element.tap();
}

async function run() {
  const report = {
    wsEndpoint: WS_ENDPOINT,
    tests: [],
    console: [],
    exceptions: [],
    storage: { keys: STORAGE_KEYS.slice(), restored: false },
    screenshots: []
  };
  // The product caps a purpose at 20 characters; keep the real-form fixture
  // inside that boundary so this is a successful-save smoke test.
  const note = `smoke-${String(Date.now()).slice(-8)}`;
  let miniProgram;
  let originalStorage;
  let phase = 'connect';

  const test = async (name, action) => {
    phase = name;
    try {
      const detail = await action();
      report.tests.push({ name, status: 'passed', detail });
    } catch (error) {
      report.tests.push({ name, status: 'failed', error: error.message });
    }
  };

  try {
    miniProgram = await automator.connect({ wsEndpoint: WS_ENDPOINT });
    miniProgram.on('console', (entry) => {
      const first = entry && entry.args && entry.args[0];
      const firstDetail = first && typeof first === 'object'
        ? first.message || first.stack || first.errMsg || first.value || first.text || first.description
        : '';
      const message = typeof first === 'string'
        ? first
        : firstDetail
          ? String(firstDetail)
          : JSON.stringify(first);
      report.console.push({
        type: (entry && entry.type) || 'unknown',
        phase,
        message: (message || '[empty console payload]').slice(0, 800),
        firstType: first && first.constructor && first.constructor.name,
        firstProperties: first && typeof first === 'object'
          ? Object.getOwnPropertyNames(first)
          : [],
        raw: entry && entry.type === 'error'
          ? util.inspect(entry, { depth: 5, breakLength: 160 }).slice(0, 1600)
          : undefined
      });
    });
    miniProgram.on('exception', (entry) => {
      report.exceptions.push(String(entry && (entry.message || entry)).slice(0, 1200));
    });

    if (TRACE_CONSOLE) {
      await miniProgram.evaluate(() => {
        if (!globalThis.__codexOriginalConsoleError) {
          globalThis.__codexOriginalConsoleError = console.error;
          console.error = function tracedConsoleError() {
            const args = Array.prototype.slice.call(arguments);
            globalThis.__codexOriginalConsoleError(
              '[Codex console.error trace]',
              new Error('console.error callsite').stack,
              ...args
            );
          };
        }
      });
    }

    originalStorage = await snapshotMinimalStorage(miniProgram);
    for (const key of STORAGE_KEYS) await miniProgram.callWxMethod('removeStorageSync', key);

    phase = '清理 minimal 独立存储并启动首页';
    let page = await miniProgram.reLaunch('/pages/index/index');
    await sleep(800);

    await test('独立 minimal 空存储进入首次设置', async () => {
      const state = await pageState(miniProgram);
      assert.strictEqual(state.route, 'pages/index/index');
      assert.strictEqual(state.viewState, 'empty');
      assert.strictEqual(state.drawerVisible, true);
      return { viewState: state.viewState, drawerVisible: state.drawerVisible };
    });

    await test('真实设置表单初始化预算并显示首页摘要', async () => {
      await input(page, 'input[data-field="income"]', '5000');
      await input(page, 'input[data-field="fixedExpense"]', '1200');
      await input(page, 'input[data-field="savingGoal"]', '800');
      await tap(page, 'button.drawer-save');
      await waitFor(async () => (await pageState(miniProgram)).viewState === 'ready', '预算设置保存完成');
      const state = await pageState(miniProgram);
      assert.strictEqual(state.drawerVisible, false);
      assert.ok(state.budget && state.result, '预算和计算结果应已就绪');
      assert.ok(await page.$('.budget-hero'), '预算摘要应渲染');
      assert.ok(await page.$('.quick-record'), '快速记账应常驻渲染');
      return { periodLabel: state.result.periodLabel, todayAmount: state.result.todayRemainingText };
    });

    await test('快速记账通过真实控件新增一笔', async () => {
      assert.strictEqual(await page.$('.composer-details'), null, '补充信息默认应收起');
      await tap(page, 'button.composer-details-toggle');
      await waitFor(async () => (await pageState(miniProgram)).composerDetailsOpen === true, '补充信息展开');
      assert.ok(await page.$('.composer-details'), '补充信息区应在点击后渲染');
      await input(page, 'input.composer-amount__input', '12.34');
      await input(page, 'input.purpose-field', note);
      await tap(page, 'button.composer-save');
      await waitFor(async () => {
        const state = await pageState(miniProgram);
        return state.transactionCount === 1 && Boolean(state.feedback);
      }, '新增交易写入并刷新首页');
      const state = await miniProgram.evaluate((expectedNote) => {
        const current = getCurrentPages().slice(-1)[0];
        const transaction = (current.data.transactions || []).find((item) => item.note === expectedNote);
        return {
          found: Boolean(transaction),
          amountCents: transaction && transaction.amountCents,
          direction: transaction && transaction.direction,
          amountInput: current.data.amountInput,
          noteInput: current.data.noteInput,
          feedback: current.data.feedback
        };
      }, note);
      assert.deepStrictEqual(
        { found: state.found, amountCents: state.amountCents, direction: state.direction },
        { found: true, amountCents: 1234, direction: 'expense' }
      );
      assert.strictEqual(state.amountInput, '');
      assert.strictEqual(state.noteInput, '');
      return { amountCents: state.amountCents, feedback: state.feedback, detailsExpanded: true };
    });

    await test('保存常用模板并一键记账', async () => {
      await input(page, 'input.composer-amount__input', '8.88');
      await input(page, 'input.purpose-field', '咖啡模板');
      await tap(page, 'button.template-save-button');
      await waitFor(async () => {
        const state = await pageState(miniProgram);
        return state.quickTemplateCount === 1 && /模板/.test(state.feedback || '');
      }, '常用模板保存完成');
      const useButton = requireElement(await page.$('button.quick-template__use'), 'button.quick-template__use');
      await useButton.tap();
      await waitFor(async () => {
        const state = await pageState(miniProgram);
        return state.transactionCount === 2 && /已用/.test(state.feedback || '');
      }, '常用模板一键记账完成');
      const state = await miniProgram.evaluate(() => {
        const current = getCurrentPages().slice(-1)[0];
        return {
          quickTemplateCount: (current.data.quickTemplates || []).length,
          transactionCount: (current.data.transactions || []).length,
          feedback: current.data.feedback,
          amountInput: current.data.amountInput,
          noteInput: current.data.noteInput
        };
      });
      assert.strictEqual(state.amountInput, '', '使用与当前草稿相同的模板后应清空金额，防止误记');
      assert.strictEqual(state.noteInput, '', '使用与当前草稿相同的模板后应清空用途，防止误记');
      return {
        quickTemplateCount: state.quickTemplateCount,
        transactionCount: state.transactionCount,
        feedback: state.feedback
      };
    });

    // Return the progressive details to their default collapsed state before
    // taking the visual evidence, then let the native success toast leave.
    if ((await pageState(miniProgram)).composerDetailsOpen) {
      await tap(page, 'button.composer-details-toggle');
      await waitFor(
        async () => (await pageState(miniProgram)).composerDetailsOpen === false,
        '补充信息重新收起'
      );
    }
    await sleep(1800);
    const mainScreenshot = path.join(os.tmpdir(), `today-can-spend-minimal-main-${Date.now()}.png`);
    await miniProgram.screenshot({ path: mainScreenshot });
    report.screenshots.push(mainScreenshot);

    await test('展开消费回看和账本', async () => {
      await tap(page, 'button[data-section="review"]');
      await waitFor(async () => (await pageState(miniProgram)).sections.review === true, '消费回看展开');
      assert.ok(await page.$('.review-tabs'), '回看范围控件应渲染');
      await tap(page, 'button[data-section="history"]');
      await waitFor(async () => (await pageState(miniProgram)).sections.history === true, '账本展开');
      assert.ok(await page.$('.history-toolbar'), '账本工具栏应渲染');
      return (await pageState(miniProgram)).sections;
    });

    await test('设置与外观抽屉可打开并应用主题', async () => {
      await tap(page, 'button.settings-button');
      await waitFor(async () => (await pageState(miniProgram)).drawerVisible === true, '设置抽屉打开');
      await tap(page, 'button.theme-entry');
      await waitFor(async () => (await pageState(miniProgram)).themeDrawerVisible === true, '主题抽屉打开');
      const presets = await page.$$('button.theme-preset');
      assert.ok(presets.length >= 2, '应提供至少两套主题预设');
      await presets[1].tap();
      await tap(page, 'button.theme-action--primary');
      await waitFor(async () => (await pageState(miniProgram)).themeDrawerVisible === false, '主题保存完成');
      const state = await pageState(miniProgram);
      assert.ok(state.themeName, '应用后应保留主题名称');
      return { themeName: state.themeName };
    });

    await sleep(1800);
    const settingsScreenshot = path.join(os.tmpdir(), `today-can-spend-minimal-settings-${Date.now()}.png`);
    await miniProgram.screenshot({ path: settingsScreenshot });
    report.screenshots.push(settingsScreenshot);
  } catch (error) {
    report.fatal = error && (error.stack || error.message || String(error));
  } finally {
    if (miniProgram && TRACE_CONSOLE) {
      try {
        await miniProgram.evaluate(() => {
          if (globalThis.__codexOriginalConsoleError) {
            console.error = globalThis.__codexOriginalConsoleError;
            delete globalThis.__codexOriginalConsoleError;
          }
        });
      } catch (error) {
        report.consoleTraceRestoreError = error.message;
      }
    }
    if (miniProgram && originalStorage) {
      try {
        await restoreMinimalStorage(miniProgram, originalStorage);
        report.storage.restored = true;
        await miniProgram.reLaunch('/pages/index/index');
      } catch (error) {
        report.storage.restoreError = error.message;
      }
    }
    if (miniProgram) miniProgram.disconnect();
  }

  report.console = report.console.filter((entry, index, all) =>
    index === all.findIndex((candidate) => candidate.type === entry.type && candidate.message === entry.message)
  );
  report.summary = {
    passed: report.tests.filter((item) => item.status === 'passed').length,
    failed: report.tests.filter((item) => item.status === 'failed').length,
    consoleErrors: report.console.filter((item) => item.type === 'error').length,
    exceptions: report.exceptions.length
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.fatal || report.summary.failed || report.summary.consoleErrors || report.summary.exceptions || !report.storage.restored) {
    process.exitCode = 1;
  }
}

run().catch((error) => {
  process.stderr.write(`${error.stack || error.message || error}\n`);
  process.exitCode = 1;
});
