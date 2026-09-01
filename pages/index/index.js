const { deriveBudget, validateBudgetAmounts } = require('../../domain/budget');
const {
  CATEGORIES,
  categoriesForDirection,
  getCategoryLabel
} = require('../../domain/categories');
const {
  budgetCycleRange,
  daysInMonth,
  daysSince,
  formatChineseDate,
  formatRecordTime,
  parseLocalDateKey,
  toMonthKey,
  toDateKey
} = require('../../domain/date');
const {
  BUDGET_FIELD_MAX_CENTS,
  TRANSACTION_MAX_CENTS,
  centsToInput,
  formatCents,
  parseYuanToCents
} = require('../../domain/money');
const { parseQuickEntries } = require('../../domain/quick-entry');
const budgetStore = require('../../services/budget-store');
const {
  createDataBackup,
  previewDataBackup,
  restoreDataBackup
} = require('../../services/data-backup');
const { trackEvent } = require('../../services/analytics');
const { exportLedger } = require('../../services/ledger-export');
const { getSpendingSummary } = require('../../services/spending-summary');
const { previewBill } = require('../../services/wechat-bill-import');
const themeStore = require('../../services/theme-store');
const { addTransaction, listTransactions } = require('../../services/transactions');
const {
  deleteQuickTemplate,
  listQuickTemplates,
  saveQuickTemplate
} = require('../../services/quick-templates');
const {
  DEFAULT_THEME_SETTINGS,
  getThemePresets,
  resolveTheme
} = require('../../domain/theme');

const EMPTY_ERRORS = {
  income: '',
  fixedExpense: '',
  savingGoal: ''
};

const CYCLE_START_DAYS = Object.freeze(Array.from({ length: 28 }, (_, index) => ({
  label: `每月 ${index + 1} 日`,
  value: index + 1
})));

const FIELD_CONFIG = {
  income: 'incomeCents',
  fixedExpense: 'fixedExpenseCents',
  savingGoal: 'savingGoalCents'
};

const FIXED_EXPENSE_MODES = Object.freeze(['manual', 'items']);
const VOICE_RECORDING_DURATION_MS = 30000;

function voiceErrorMessage(error) {
  const code = error && (error.retcode || error.errCode);
  if (code === -30011 || code === 10001) {
    return '请允许使用麦克风，或直接输入“咖啡 20”。';
  }
  return '语音暂时没连上，也可以直接输入“咖啡 20”。';
}

function commandId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function statusPresentation(result, spentProgressPercent) {
  const periodLabel = result.cycleLabel || '本月';
  if (result.status === 'budgetUnavailable') {
    return {
      eyebrow: `${periodLabel}暂无可用额度`,
      amountText: '¥0.00',
      statusLine1: '固定支出和储蓄目标',
      statusLine2: `已用完${periodLabel}收入`,
      badge: '调整设置',
      railText: `${periodLabel}没有可分配额度`
    };
  }
  if (result.status === 'monthOverspent') {
    return {
      eyebrow: `${periodLabel}已超出`,
      amountText: `已超 ¥${formatCents(result.statusAmountCents)}`,
      statusLine1: `${periodLabel}预算已经用完`,
      statusLine2: '先暂停非必要消费',
      badge: `${periodLabel}预警`,
      railText: `${periodLabel}已超 ¥${formatCents(result.statusAmountCents)}`
    };
  }
  if (result.status === 'todayOverspent') {
    return {
      eyebrow: '今天已超出',
      amountText: `已超 ¥${formatCents(result.statusAmountCents)}`,
      statusLine1: '超过今日建议额度',
      statusLine2: '明天会重新计算',
      badge: '先稳住',
      railText: `已超 ¥${formatCents(result.statusAmountCents)}`
    };
  }
  if (result.status === 'runningLow') {
    return {
      eyebrow: '额度快用完了',
      amountText: `¥${formatCents(result.todayRemainingCents)}`,
      statusLine1: '今天只剩一点空间',
      statusLine2: '下一笔先想一想',
      badge: `还剩 ${Math.max(0, 100 - spentProgressPercent)}%`,
      railText: `还剩 ¥${formatCents(result.todayRemainingCents)}`
    };
  }
  return {
    eyebrow: '今天还能花',
    amountText: `¥${formatCents(result.todayRemainingCents)}`,
    statusLine1: '可以从容花',
    statusLine2: '也知道花去了哪里',
    badge: '稳稳生活',
    railText: `还剩 ¥${formatCents(result.todayRemainingCents)}`
  };
}

function personaForStatus(status) {
  if (status === 'monthOverspent' || status === 'budgetUnavailable') return '先稳住派';
  if (status === 'todayOverspent') return '明天再来派';
  if (status === 'runningLow') return '精打细算派';
  return '稳稳生活派';
}

function emptyForm() {
  return {
    income: '',
    fixedExpense: '',
    fixedExpenseMode: 'manual',
    manualFixedExpense: '',
    savingGoal: '',
    cycleStartDay: 1,
    fixedExpenseItems: []
  };
}

function parseFixedExpenseDraftAmount(value) {
  const text = String(value == null ? '' : value).trim();
  const normalized = /^\d+\.$/.test(text) ? text.slice(0, -1) : text;
  return parseYuanToCents(normalized, {
    allowZero: false,
    maxCents: BUDGET_FIELD_MAX_CENTS
  });
}

function fixedExpenseDraftState(sourceForm) {
  const form = Object.assign({}, sourceForm);
  const items = Array.isArray(form.fixedExpenseItems) ? form.fixedExpenseItems : [];
  const mode = FIXED_EXPENSE_MODES.includes(form.fixedExpenseMode)
    ? form.fixedExpenseMode
    : 'manual';
  const manualFixedExpense = form.manualFixedExpense === undefined
    ? form.fixedExpense
    : form.manualFixedExpense;
  const totalCents = items.reduce((sum, item) => {
    const parsed = parseFixedExpenseDraftAmount(item && item.amount);
    return parsed.ok ? sum + parsed.value : sum;
  }, 0);
  const totalText = formatCents(totalCents);

  form.fixedExpenseMode = mode;
  form.manualFixedExpense = manualFixedExpense;
  if (mode === 'items') form.fixedExpense = totalText;

  return {
    fixedExpenseItemTotalText: totalText,
    form
  };
}

function cycleRangeText(startKey, endKey) {
  const compact = (key) => {
    const date = parseLocalDateKey(key);
    return date ? `${date.getMonth() + 1}月${date.getDate()}日` : key;
  };
  return `${compact(startKey)}–${compact(endKey)}`;
}

function toQuickTemplateView(item) {
  return Object.assign({}, item, {
    amountText: formatCents(item.amountCents),
    categoryLabel: getCategoryLabel(item.categoryId),
    title: item.note || getCategoryLabel(item.categoryId)
  });
}

async function loadCycleTransactions(budget, now) {
  const cycle = budgetCycleRange(budget.cycleStartDay || 1, now);
  return listTransactions({
    startDateKey: cycle.startDateKey,
    endDateKey: cycle.endDateKey
  });
}

function formatHistoryDate(dateKey) {
  const date = parseLocalDateKey(dateKey);
  return date ? `${date.getMonth() + 1}月${date.getDate()}日` : dateKey;
}

function formatImportTime(timestamp) {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function toTransactionView(item, now) {
  const direction = item.direction === 'income' ? 'income' : 'expense';
  return {
    id: item.id,
    amountCents: item.amountCents,
    amountText: formatCents(item.amountCents),
    categoryId: item.categoryId,
    categoryLabel: getCategoryLabel(item.categoryId),
    categoryInitial: getCategoryLabel(item.categoryId).slice(0, 1),
    direction,
    directionLabel: direction === 'income' ? '收入' : '支出',
    amountPrefix: direction === 'income' ? '+' : '-',
    note: item.note,
    purposeText: item.note || getCategoryLabel(item.categoryId),
    occurredAt: item.occurredAt,
    occurredAtText: formatRecordTime(item.occurredAt, now)
  };
}

function toSmartDraft(item, index) {
  const categoryOptions = categoriesForDirection(item.direction);
  const categoryIndex = Math.max(0, categoryOptions.findIndex((category) => category.id === item.categoryId));
  return Object.assign({}, item, {
    amountInput: item.amountText,
    categoryIndex,
    categoryOptions,
    id: `smart-draft-${index}`,
    selected: true,
    timeText: item.timeText || formatRecordTime(Date.now(), new Date()).slice(-5)
  });
}

function occurredAtForTime(timeText, now) {
  const match = String(timeText || '').match(/^(\d{2}):(\d{2})$/);
  if (!match) return now.getTime();
  return new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    Number(match[1]),
    Number(match[2])
  ).getTime();
}

const INITIAL_THEME = resolveTheme(DEFAULT_THEME_SETTINGS);
const INITIAL_NOW = new Date();
const INITIAL_DATE_KEY = toDateKey(INITIAL_NOW);
const INITIAL_MONTH_KEY = toMonthKey(INITIAL_NOW);
const INITIAL_REVIEW_START_KEY = toDateKey(new Date(
  INITIAL_NOW.getFullYear(),
  INITIAL_NOW.getMonth(),
  1
));
const REVIEW_MIN_DATE_KEY = toDateKey(new Date(
  INITIAL_NOW.getFullYear(),
  INITIAL_NOW.getMonth() - 36,
  1
));
const REVIEW_MIN_MONTH_KEY = REVIEW_MIN_DATE_KEY.slice(0, 7);

function monthDateFromKey(monthKey) {
  return parseLocalDateKey(`${monthKey}-01`);
}

function shiftMonthKey(monthKey, offset) {
  const current = monthDateFromKey(monthKey);
  if (!current) return '';
  return toMonthKey(new Date(current.getFullYear(), current.getMonth() + offset, 1));
}

function detailsMonthState(monthKey, now) {
  const current = new Date(now);
  const currentKey = toMonthKey(current);
  const candidate = monthDateFromKey(monthKey);
  const selected = candidate && toMonthKey(candidate) <= currentKey ? candidate : current;
  const selectedKey = toMonthKey(selected);
  return {
    detailsMonthCanNext: selectedKey < currentKey,
    detailsMonthCanPrevious: selectedKey > REVIEW_MIN_MONTH_KEY,
    detailsMonthContext: selectedKey === currentKey ? '本月' : '往期账单',
    detailsMonthKey: selectedKey,
    detailsMonthLabel: `${selected.getFullYear()}年${selected.getMonth() + 1}月`
  };
}

const INITIAL_DETAILS_MONTH = detailsMonthState(INITIAL_MONTH_KEY, INITIAL_NOW);
const REVIEW_PERIODS = Object.freeze([
  Object.freeze({ id: 'day', label: '日' }),
  Object.freeze({ id: 'month', label: '月' }),
  Object.freeze({ id: 'year', label: '年' }),
  Object.freeze({ id: 'custom', label: '自定义' })
]);

Page({
  data: {
    activeTab: 'home',
    amountInput: '',
    amountSizeClass: 'amount-normal',
    budget: null,
    billImportError: '',
    billImportLoading: false,
    billImportPreview: null,
    importBatches: [],
    isImportBatchUndoing: false,
    backupError: '',
    backupFileName: '',
    backupFilePath: '',
    backupPreview: null,
    canSaveToDisk: false,
    categories: CATEGORIES,
    cycleStartDays: CYCLE_START_DAYS,
    cycleStartDayIndex: 0,
    dateLabel: '',
    detailsAnalysisVisible: true,
    detailsAnalysisError: '',
    detailsAnalysisLoading: false,
    detailsAnalysisSummary: null,
    detailsDayDateKey: '',
    detailsDayDateLabel: '',
    detailsDayError: '',
    detailsDayExpenseText: '0.00',
    detailsDayLoading: false,
    detailsDayTransactions: [],
    detailsDayVisible: false,
    detailsError: '',
    detailsExpenseText: '0.00',
    detailsIncomeText: '0.00',
    detailsLoading: false,
    detailsPeriod: 'month',
    detailsRecordCount: 0,
    detailsScopeLabel: '本月支出',
    detailsTransactions: [],
    detailsMonthCanNext: INITIAL_DETAILS_MONTH.detailsMonthCanNext,
    detailsMonthCanPrevious: INITIAL_DETAILS_MONTH.detailsMonthCanPrevious,
    detailsMonthContext: INITIAL_DETAILS_MONTH.detailsMonthContext,
    detailsMonthKey: INITIAL_DETAILS_MONTH.detailsMonthKey,
    detailsMonthLabel: INITIAL_DETAILS_MONTH.detailsMonthLabel,
    drawerMode: 'first',
    drawerVisible: false,
    feedback: '',
    form: emptyForm(),
    formErrors: EMPTY_ERRORS,
    fixedExpenseItemTotalText: '0.00',
    fromShare: false,
    inputError: '',
    editDrawerVisible: false,
    editError: '',
    editForm: null,
    editCategories: CATEGORIES,
    historyDateKey: INITIAL_DATE_KEY,
    historyDateLabel: formatHistoryDate(INITIAL_DATE_KEY),
    historyError: '',
    historyLoading: false,
    historyMaxDateKey: INITIAL_DATE_KEY,
    historyExpenseText: '0.00',
    historyIncomeText: '0.00',
    historyTransactions: [],
    exportError: '',
    exportFileName: '',
    exportFilePath: '',
    isEditSaving: false,
    isBudgetSaving: false,
    isBillImportSaving: false,
    isBackingUp: false,
    isExporting: false,
    isSaving: false,
    isTemplateSaving: false,
    isVoiceRecording: false,
    calendarWeekdays: ['一', '二', '三', '四', '五', '六', '日'],
    legacyHistoricalSpentText: '',
    quickTemplates: [],
    recentTransactions: [],
    isRestoringBackup: false,
    noteInput: '',
    recordDirection: 'expense',
    readMessage: '',
    reviewError: '',
    reviewLoading: false,
    reviewDetailCategoryId: '',
    reviewDetailCategoryLabel: '全部支出',
    reviewDetailError: '',
    reviewDetailLoading: false,
    reviewDetailVisible: false,
    reviewPeriod: 'month',
    reviewPeriods: REVIEW_PERIODS,
    reviewRangeEndKey: INITIAL_DATE_KEY,
    reviewRangeMaxKey: INITIAL_DATE_KEY,
    reviewRangeMinKey: REVIEW_MIN_DATE_KEY,
    reviewRangeStartKey: INITIAL_REVIEW_START_KEY,
    reviewSummary: null,
    reviewTransactions: [],
    result: null,
    shareTitle: '今天还能花｜开始我的收支记录',
    selectedCategoryId: 'food',
    smartEntryError: '',
    smartEntryInput: '',
    smartEntryParsed: null,
    smartEntryDrafts: [],
    smartEntrySource: 'text',
    smartReviewVisible: false,
    smartSelectedCount: 0,
    smartExamples: [
      { id: 'coffee', label: '咖啡 20' },
      { id: 'metro', label: '地铁 4' },
      { id: 'lunch', label: '午餐 32' }
    ],
    voiceHint: '',
    voiceAvailable: false,
    photoAmountInput: '',
    photoCategoryId: 'food',
    photoCategoryIndex: 0,
    photoCategoryOptions: categoriesForDirection('expense'),
    photoError: '',
    photoNoteInput: '',
    photoPath: '',
    photoReviewVisible: false,
    photoTimeText: formatRecordTime(Date.now(), new Date()).slice(-5),
    sections: {
      composer: false,
      history: false,
      review: false
    },
    statusTone: 'normal',
    budgetFixedExpenseText: '0.00',
    budgetIncomeText: '0.00',
    budgetSavingGoalText: '0.00',
    themeDraft: Object.assign({}, DEFAULT_THEME_SETTINGS),
    themeDrawerVisible: false,
    themeName: INITIAL_THEME.name,
    themePresets: getThemePresets(DEFAULT_THEME_SETTINGS.presetId),
    themeResolved: INITIAL_THEME,
    themeSettings: Object.assign({}, DEFAULT_THEME_SETTINGS),
    themeStyle: INITIAL_THEME.styleText,
    transactions: [],
    viewState: 'loading'
  },

  onLoad(options) {
    const fromShare = Boolean(options && options.from === 'share');
    let platform = '';
    try {
      platform = typeof wx.getDeviceInfo === 'function'
        ? wx.getDeviceInfo().platform
        : wx.getSystemInfoSync().platform;
    } catch (error) {
      console.warn('无法读取当前平台', error);
    }
    this.setData({
      canSaveToDisk: typeof wx.saveFileToDisk === 'function'
        && (platform === 'windows' || platform === 'mac'),
      fromShare,
      dateLabel: formatChineseDate(new Date())
    });
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline']
    });
    this.setupVoiceRecognition();
    trackEvent('app_open', { entry: fromShare ? 'share' : 'direct' });
    if (fromShare) trackEvent('share_entry_open', { entry: 'share' });
  },

  onHide() {
    this.stopVoiceRecognition();
  },

  onUnload() {
    this.stopVoiceRecognition();
    if (!this._voiceManager) return;
    this._voiceManager.onStart = null;
    this._voiceManager.onRecognize = null;
    this._voiceManager.onStop = null;
    this._voiceManager.onError = null;
    this._voiceManager = null;
  },

  setupVoiceRecognition() {
    try {
      if (typeof requirePlugin !== 'function') throw new Error('plugin api unavailable');
      const plugin = requirePlugin('WechatSI');
      const manager = plugin && plugin.getRecordRecognitionManager
        ? plugin.getRecordRecognitionManager()
        : null;
      if (!manager) throw new Error('recognition manager unavailable');
      this._voiceManager = manager;
      manager.onStart = () => {
        this._voiceStarting = false;
        this.setData({
          isVoiceRecording: true,
          smartEntryError: '',
          smartEntryParsed: null,
          smartEntryDrafts: [],
          smartReviewVisible: false,
          voiceHint: '正在听…说完后再点一次麦克风。'
        });
        trackEvent('voice_entry_started');
      };
      manager.onRecognize = (result) => {
        const text = String(result && result.result || '').trim();
        if (!text) return;
        this.setData({
          smartEntryError: '',
          smartEntryInput: text,
          smartEntryParsed: null,
          smartEntryDrafts: []
        });
      };
      manager.onStop = (result) => {
        this._voiceStarting = false;
        const text = String(result && result.result || '').trim();
        if (!text) {
          this.setData({
            isVoiceRecording: false,
            voiceHint: '没有听清，请重试或直接输入“咖啡 20”。'
          });
          trackEvent('voice_entry_empty', { fallback: 'text' });
          return;
        }
        this.setData({
          isVoiceRecording: false,
          smartEntryError: '',
          smartEntryInput: text,
          smartEntryParsed: null,
          smartEntryDrafts: [],
          smartEntrySource: 'voice',
          voiceHint: `已识别“${text}”，请确认账单。`
        }, () => this.handleSmartSubmit({ keepVoiceHint: true, source: 'voice' }));
        trackEvent('voice_entry_recognized');
      };
      manager.onError = (error) => {
        this._voiceStarting = false;
        this.setData({
          isVoiceRecording: false,
          voiceHint: voiceErrorMessage(error)
        });
        trackEvent('voice_entry_error', {
          code: String(error && (error.retcode || error.errCode) || 'unknown'),
          fallback: 'text'
        });
      };
      this.setData({ voiceAvailable: true, voiceHint: '' });
    } catch (error) {
      this._voiceSetupError = error;
      this.setData({ voiceAvailable: false });
    }
  },

  stopVoiceRecognition() {
    if (!this._voiceManager || !this.data.isVoiceRecording) return;
    try {
      this._voiceManager.stop();
    } catch (error) {
      this._voiceStarting = false;
      this.setData({ isVoiceRecording: false });
    }
  },

  onShow() {
    this.refreshPage();
  },

  async refreshPage() {
    if (this._isReading) return;
    this._isReading = true;
    const now = new Date();
    const todayKey = toDateKey(now);
    const historyDateKey = this._historyDateTouched
      ? (this.data.historyDateKey > todayKey ? todayKey : this.data.historyDateKey)
      : todayKey;
    if (!this.data.budget) this.setData({ viewState: 'loading' });
    this.setData({
      dateLabel: formatChineseDate(now),
      historyDateKey,
      historyDateLabel: formatHistoryDate(historyDateKey),
      historyMaxDateKey: todayKey
    });

    try {
      const initial = await Promise.all([
        budgetStore.loadBudgetContext(now),
        themeStore.loadTheme()
      ]);
      let context = initial[0];
      this.applyThemeModel(initial[1]);
      if (context.status === 'monthChange') {
        context = await this.resolveMonthChange(now);
      }

      if (context.status === 'empty' || context.status === 'corrupt') {
        this.setData(Object.assign({
          budget: null,
          drawerMode: 'first',
          drawerVisible: true,
          cycleStartDayIndex: 0,
          formErrors: Object.assign({}, EMPTY_ERRORS),
          legacyHistoricalSpentText: '',
          readMessage: context.status === 'corrupt'
            ? '本地数据无法识别，已安全回到首次设置。'
            : '',
          result: null,
          historyTransactions: [],
          transactions: [],
          viewState: 'empty'
        }, fixedExpenseDraftState(emptyForm())));
        return;
      }

      const readyData = await Promise.all([
        loadCycleTransactions(context.budget, now),
        listQuickTemplates()
      ]);
      await this.renderReady(context.budget, readyData[0], now, readyData[1]);
    } catch (error) {
      console.error('读取本地数据失败', error);
      this.setData({
        readMessage: '读取失败，请重试。你的页面没有写入任何新数据。',
        viewState: 'readError'
      });
    } finally {
      this._isReading = false;
    }
  },

  resolveMonthChange(now) {
    return new Promise((resolve, reject) => {
      wx.showModal({
        title: '新的月份开始了',
        content: '上月记录会归档到消费回看。要沿用预算设置，还是重新设置本月预算？',
        confirmText: '沿用设置',
        cancelText: '重新设置',
        success: async (result) => {
          try {
            const next = await budgetStore.startNewMonth(
              result.confirm ? 'carry' : 'reset',
              now
            );
            resolve(next);
          } catch (error) {
            reject(error);
          }
        },
        fail: reject
      });
    });
  },

  async renderReady(budget, transactions, now, quickTemplates) {
    const result = deriveBudget(budget, transactions, now);
    const persona = personaForStatus(result.status);
    const useDays = daysSince(budget.trackingStartDate, now);
    const shareTitle = `${persona}｜打卡${useDays}天｜${transactions.length}笔｜${result.cycleLabel}已花¥${formatCents(result.totalSpentCents)}`;
    const spentProgressPercent = result.todaySuggestedBudgetCents > 0
      ? Math.min(100, Math.round(
        result.todaySpentCents * 100 / result.todaySuggestedBudgetCents
      ))
      : result.todaySpentCents > 0 ? 100 : 0;
    const presentation = statusPresentation(result, spentProgressPercent);
    const amountText = presentation.amountText;
    const selectedMonthState = detailsMonthState(this.data.detailsMonthKey, now);

    this.setData({
      amountSizeClass: amountText.length > 9
        ? 'amount-small'
        : amountText.length > 7 ? 'amount-medium' : 'amount-normal',
      budget,
      budgetFixedExpenseText: formatCents(budget.fixedExpenseCents),
      budgetIncomeText: formatCents(budget.incomeCents),
      budgetSavingGoalText: formatCents(budget.savingGoalCents),
      detailsMonthCanNext: selectedMonthState.detailsMonthCanNext,
      detailsMonthCanPrevious: selectedMonthState.detailsMonthCanPrevious,
      detailsMonthContext: selectedMonthState.detailsMonthContext,
      detailsMonthKey: selectedMonthState.detailsMonthKey,
      detailsMonthLabel: selectedMonthState.detailsMonthLabel,
      quickTemplates: (quickTemplates || this.data.quickTemplates).map(toQuickTemplateView),
      recentTransactions: transactions.slice(0, 3).map((item) => toTransactionView(item, now)),
      readMessage: '',
      result: {
        monthlyRemainingNegative: result.monthlyRemainingCents < 0,
        monthlyRemainingText: formatCents(result.monthlyRemainingCents),
        monthlyOverspentText: formatCents(Math.abs(result.monthlyRemainingCents)),
        periodSavingAmountText: formatCents(Math.abs(result.monthlyRemainingCents)),
        periodSavingLabel: result.monthlyRemainingCents < 0
          ? `${result.cycleLabel}还差`
          : `${result.cycleLabel}省下`,
        periodSavingNegative: result.monthlyRemainingCents < 0,
        periodLabel: result.cycleLabel,
        cycleRangeText: cycleRangeText(result.cycleStartDateKey, result.cycleEndDateKey),
        recordedIncomeText: formatCents(result.recordedIncomeCents),
        persona,
        heroAmountText: presentation.amountText,
        heroBadge: presentation.badge,
        heroEyebrow: presentation.eyebrow,
        heroStatusLine1: presentation.statusLine1,
        heroStatusLine2: presentation.statusLine2,
        spentProgressPercent,
        status: result.status,
        statusText: presentation.railText,
        todayRemainingText: formatCents(result.todayRemainingCents),
        todaySpentText: formatCents(result.todaySpentCents),
        todaySuggestedBudgetText: formatCents(result.todaySuggestedBudgetCents)
      },
      shareTitle,
      statusTone: result.status,
      transactions,
      viewState: 'ready'
    });
    const secondaryRefreshes = [];
    if (this.data.activeTab === 'details') {
      const detailsMonth = monthDateFromKey(selectedMonthState.detailsMonthKey) || now;
      secondaryRefreshes.push(this.refreshDetails(
        this.data.detailsPeriod === 'month' ? detailsMonth : now
      ));
      if (this.data.detailsAnalysisVisible) {
        secondaryRefreshes.push(this.refreshDetailsAnalysis(detailsMonth));
        if (this.data.detailsDayVisible && this.data.detailsDayDateKey) {
          secondaryRefreshes.push(this.refreshDetailsCalendarDay(this.data.detailsDayDateKey));
        }
      }
    }
    if (this.data.sections.review) secondaryRefreshes.push(this.refreshReview(now));
    if (this.data.sections.review && this.data.reviewDetailVisible) {
      secondaryRefreshes.push(this.refreshReviewDetails());
    }
    if (this.data.sections.history) secondaryRefreshes.push(this.refreshHistoryDetail());
    await Promise.all(secondaryRefreshes);
    trackEvent('result_viewed', { status: result.status, entry: this.data.fromShare ? 'share' : 'direct' });
  },

  async toggleSection(event) {
    const section = event.currentTarget.dataset.section;
    if (!Object.prototype.hasOwnProperty.call(this.data.sections, section)) return;
    const expanded = !this.data.sections[section];
    this.setData({ [`sections.${section}`]: expanded });
    if (!expanded) return;
    if (section === 'review') await this.refreshReview(new Date());
    if (section === 'history') await this.refreshHistoryDetail();
  },

  switchTab(event) {
    const activeTab = event.currentTarget.dataset.tab;
    if (!['home', 'details', 'settings'].includes(activeTab)) return;
    this.setData({ activeTab }, () => {
      if (activeTab === 'details') {
        const selectedMonth = this.getDetailsMonthDate() || new Date();
        this.refreshDetails(this.data.detailsPeriod === 'month' ? selectedMonth : new Date());
        if (this.data.detailsAnalysisVisible) {
          this.refreshDetailsAnalysis(selectedMonth);
          if (this.data.detailsDayVisible && this.data.detailsDayDateKey) {
            this.refreshDetailsCalendarDay(this.data.detailsDayDateKey);
          }
        }
      }
      if (typeof wx.pageScrollTo === 'function') {
        wx.pageScrollTo({ scrollTop: 0, duration: 180 });
      }
    });
  },

  showAllTransactions() {
    this.setData({ activeTab: 'details' }, () => {
      const selectedMonth = this.getDetailsMonthDate() || new Date();
      this.refreshDetails(this.data.detailsPeriod === 'month' ? selectedMonth : new Date());
      if (this.data.detailsAnalysisVisible) {
        this.refreshDetailsAnalysis(selectedMonth);
        if (this.data.detailsDayVisible && this.data.detailsDayDateKey) {
          this.refreshDetailsCalendarDay(this.data.detailsDayDateKey);
        }
      }
      if (typeof wx.pageScrollTo === 'function') {
        wx.pageScrollTo({ scrollTop: 0, duration: 180 });
      }
    });
  },

  handleDetailsPeriod(event) {
    const detailsPeriod = event.currentTarget.dataset.period;
    if (detailsPeriod !== 'month' && detailsPeriod !== 'all') return;
    if (detailsPeriod === this.data.detailsPeriod) return;
    this.setData({ detailsPeriod }, () => {
      const selectedMonth = this.getDetailsMonthDate() || new Date();
      this.refreshDetails(detailsPeriod === 'month' ? selectedMonth : new Date());
    });
  },

  getDetailsMonthDate() {
    return monthDateFromKey(this.data.detailsMonthKey);
  },

  handleDetailsMonthChange(event) {
    const offset = Number(event.currentTarget.dataset.offset);
    if (offset !== -1 && offset !== 1) return;
    const nextKey = shiftMonthKey(this.data.detailsMonthKey, offset);
    const currentKey = toMonthKey(new Date());
    if (!nextKey || nextKey < REVIEW_MIN_MONTH_KEY || nextKey > currentKey) return;
    const selectedMonth = monthDateFromKey(nextKey);
    this._detailsDayReadId = (this._detailsDayReadId || 0) + 1;
    this.setData(Object.assign(detailsMonthState(nextKey, new Date()), {
      detailsDayDateKey: '',
      detailsDayDateLabel: '',
      detailsDayError: '',
      detailsDayExpenseText: '0.00',
      detailsDayLoading: false,
      detailsDayTransactions: [],
      detailsDayVisible: false
    }), () => {
      if (this.data.detailsPeriod === 'month') this.refreshDetails(selectedMonth);
      if (this.data.detailsAnalysisVisible) this.refreshDetailsAnalysis(selectedMonth);
    });
    trackEvent('details_month_changed', {
      direction: offset < 0 ? 'previous' : 'next',
      isCurrent: nextKey === currentKey
    });
  },

  handleDetailsCalendarDay(event) {
    const dateKey = event.currentTarget.dataset.dateKey;
    const date = parseLocalDateKey(dateKey);
    if (!date
      || dateKey.slice(0, 7) !== this.data.detailsMonthKey
      || dateKey > toDateKey(new Date())) return;
    this.setData({
      detailsDayDateKey: dateKey,
      detailsDayDateLabel: formatChineseDate(date),
      detailsDayVisible: true
    }, () => this.refreshDetailsCalendarDay(dateKey));
  },

  async refreshDetailsCalendarDay(dateKey) {
    if (!parseLocalDateKey(dateKey)) return;
    const requestId = (this._detailsDayReadId || 0) + 1;
    this._detailsDayReadId = requestId;
    this.setData({
      detailsDayError: '',
      detailsDayExpenseText: '0.00',
      detailsDayLoading: true,
      detailsDayTransactions: []
    });
    try {
      const transactions = await listTransactions({ dateKey });
      if (requestId !== this._detailsDayReadId) return;
      const expenses = transactions.filter((item) => item.direction !== 'income');
      const expenseCents = expenses.reduce((sum, item) => sum + item.amountCents, 0);
      this.setData({
        detailsDayExpenseText: formatCents(expenseCents),
        detailsDayTransactions: expenses.map((item) => toTransactionView(item, new Date()))
      });
      trackEvent('details_calendar_day_viewed', {
        outcome: expenses.length ? 'records' : 'empty'
      });
    } catch (error) {
      if (requestId !== this._detailsDayReadId) return;
      console.error('读取日历日期明细失败', error);
      this.setData({ detailsDayError: '这一天的支出暂时没读到，请重试。' });
    } finally {
      if (requestId === this._detailsDayReadId) {
        this.setData({ detailsDayLoading: false });
      }
    }
  },

  async refreshDetails(now) {
    const requestId = (this._detailsReadId || 0) + 1;
    this._detailsReadId = requestId;
    this.setData({ detailsLoading: true, detailsError: '' });
    const current = now || new Date();
    const options = this.data.detailsPeriod === 'all'
      ? { all: true }
      : {
        startDateKey: toDateKey(new Date(current.getFullYear(), current.getMonth(), 1)),
        endDateKey: toDateKey(new Date(current.getFullYear(), current.getMonth() + 1, 0))
      };
    try {
      const results = await Promise.all([
        listTransactions(options),
        listTransactions({ importBatches: true })
      ]);
      if (requestId !== this._detailsReadId) return;
      const transactions = results[0];
      const expenseCents = transactions
        .filter((item) => item.direction !== 'income')
        .reduce((sum, item) => sum + item.amountCents, 0);
      const incomeCents = transactions
        .filter((item) => item.direction === 'income')
        .reduce((sum, item) => sum + item.amountCents, 0);
      this.setData({
        detailsExpenseText: formatCents(expenseCents),
        detailsIncomeText: formatCents(incomeCents),
        detailsRecordCount: transactions.length,
        detailsScopeLabel: this.data.detailsPeriod === 'all'
          ? '全部支出'
          : `${current.getMonth() + 1}月支出`,
        detailsTransactions: transactions.map((item) => toTransactionView(item, current)),
        importBatches: results[1].map((item) => Object.assign({}, item, {
          importedAtText: formatImportTime(item.importedAt)
        }))
      });
    } catch (error) {
      if (requestId !== this._detailsReadId) return;
      console.error('读取明细失败', error);
      this.setData({ detailsError: '明细暂时没读到，请稍后重试。' });
    } finally {
      if (requestId === this._detailsReadId) this.setData({ detailsLoading: false });
    }
  },

  toggleDetailsAnalysis() {
    const detailsAnalysisVisible = !this.data.detailsAnalysisVisible;
    this.setData({ detailsAnalysisVisible }, () => {
      if (detailsAnalysisVisible) {
        this.refreshDetailsAnalysis(this.getDetailsMonthDate() || new Date());
      }
    });
  },

  async refreshDetailsAnalysis(now) {
    const requestId = (this._detailsAnalysisReadId || 0) + 1;
    this._detailsAnalysisReadId = requestId;
    this.setData({ detailsAnalysisLoading: true, detailsAnalysisError: '' });
    try {
      const selectedMonth = now || this.getDetailsMonthDate() || new Date();
      const detailsAnalysisSummary = await getSpendingSummary('month', new Date(), {
        monthKey: toMonthKey(selectedMonth)
      });
      if (requestId !== this._detailsAnalysisReadId) return;
      this.setData({ detailsAnalysisSummary }, () => {
        if (this.data.activeTab === 'details') this.drawMonthlyTrend(detailsAnalysisSummary);
      });
    } catch (error) {
      if (requestId !== this._detailsAnalysisReadId) return;
      console.error('读取月度支出分析失败', error);
      this.setData({ detailsAnalysisError: '这个月的支出分析暂时没读到，请稍后重试。' });
    } finally {
      if (requestId === this._detailsAnalysisReadId) {
        this.setData({ detailsAnalysisLoading: false });
      }
    }
  },

  async refreshReview(now) {
    const requestId = (this._reviewReadId || 0) + 1;
    this._reviewReadId = requestId;
    this.setData({ reviewLoading: true, reviewError: '' });
    try {
      const reviewSummary = await getSpendingSummary(
        this.data.reviewPeriod,
        now || new Date(),
        this.data.reviewPeriod === 'custom' ? {
          startDateKey: this.data.reviewRangeStartKey,
          endDateKey: this.data.reviewRangeEndKey
        } : null
      );
      if (requestId !== this._reviewReadId) return;
      const nextReviewData = { reviewSummary };
      if (reviewSummary.period === 'custom'
        && reviewSummary.recordCount === 0
        && this.data.reviewDetailVisible) {
        Object.assign(nextReviewData, {
          reviewDetailCategoryId: '',
          reviewDetailCategoryLabel: '全部支出',
          reviewDetailVisible: false,
          reviewTransactions: []
        });
      }
      this.setData(nextReviewData);
    } catch (error) {
      if (requestId !== this._reviewReadId) return;
      console.error('读取消费回看失败', error);
      this.setData({ reviewError: '消费回看暂时没读到，请稍后重试。' });
    } finally {
      if (requestId === this._reviewReadId) this.setData({ reviewLoading: false });
    }
  },

  drawMonthlyTrend(summary) {
    const points = summary && summary.dailyTrend || [];
    if (!points.length || typeof this.createSelectorQuery !== 'function') return;
    wx.nextTick(() => {
      this.createSelectorQuery()
        .select('#monthlyTrendCanvas')
        .fields({ node: true, size: true })
        .exec((result) => {
          const target = result && result[0];
          if (!target || !target.node || !target.width || !target.height) return;
          const canvas = target.node;
          const context = canvas.getContext('2d');
          const pixelRatio = typeof wx.getWindowInfo === 'function'
            ? wx.getWindowInfo().pixelRatio
            : 2;
          canvas.width = target.width * pixelRatio;
          canvas.height = target.height * pixelRatio;
          context.scale(pixelRatio, pixelRatio);
          const width = target.width;
          const height = target.height;
          const padX = 8;
          const padTop = 18;
          const padBottom = 18;
          const max = Math.max(1, ...points.map((item) => item.amountCents));
          const coordinates = points.map((item, index) => ({
            x: padX + index * (width - padX * 2) / Math.max(points.length - 1, 1),
            y: padTop + (1 - item.amountCents / max) * (height - padTop - padBottom)
          }));
          context.clearRect(0, 0, width, height);
          context.beginPath();
          context.moveTo(coordinates[0].x, coordinates[0].y);
          for (let index = 1; index < coordinates.length - 1; index += 1) {
            const current = coordinates[index];
            const next = coordinates[index + 1];
            context.quadraticCurveTo(
              current.x,
              current.y,
              (current.x + next.x) / 2,
              (current.y + next.y) / 2
            );
          }
          const last = coordinates[coordinates.length - 1];
          context.lineTo(last.x, last.y);
          const gradient = context.createLinearGradient(0, padTop, 0, height);
          gradient.addColorStop(0, 'rgba(10,132,255,0.24)');
          gradient.addColorStop(1, 'rgba(10,132,255,0)');
          context.lineTo(last.x, height);
          context.lineTo(coordinates[0].x, height);
          context.closePath();
          context.fillStyle = gradient;
          context.fill();

          context.beginPath();
          context.moveTo(coordinates[0].x, coordinates[0].y);
          for (let index = 1; index < coordinates.length - 1; index += 1) {
            const current = coordinates[index];
            const next = coordinates[index + 1];
            context.quadraticCurveTo(
              current.x,
              current.y,
              (current.x + next.x) / 2,
              (current.y + next.y) / 2
            );
          }
          context.lineTo(last.x, last.y);
          context.strokeStyle = '#0A84FF';
          context.lineWidth = 2.5;
          context.lineCap = 'round';
          context.lineJoin = 'round';
          context.stroke();
        });
    });
  },

  handleReviewPeriod(event) {
    const reviewPeriod = event.currentTarget.dataset.period;
    if (reviewPeriod === this.data.reviewPeriod) return;
    this.setData({
      reviewPeriod,
      reviewDetailCategoryId: '',
      reviewDetailCategoryLabel: '全部支出',
      reviewDetailError: '',
      reviewDetailVisible: false,
      reviewTransactions: []
    });
    this.refreshReview(new Date());
  },

  handleReviewRangeStartChange(event) {
    const reviewRangeStartKey = event.detail.value;
    if (!parseLocalDateKey(reviewRangeStartKey)) return;
    const reviewRangeEndKey = reviewRangeStartKey > this.data.reviewRangeEndKey
      ? reviewRangeStartKey
      : this.data.reviewRangeEndKey;
    this.setData({
      reviewRangeStartKey,
      reviewRangeEndKey,
      reviewDetailCategoryId: '',
      reviewDetailCategoryLabel: '全部支出',
      reviewDetailVisible: false,
      reviewTransactions: []
    }, () => {
      if (this.data.reviewPeriod === 'custom') this.refreshReview(new Date());
    });
  },

  handleReviewRangeEndChange(event) {
    const reviewRangeEndKey = event.detail.value;
    if (!parseLocalDateKey(reviewRangeEndKey)) return;
    const reviewRangeStartKey = reviewRangeEndKey < this.data.reviewRangeStartKey
      ? reviewRangeEndKey
      : this.data.reviewRangeStartKey;
    this.setData({
      reviewRangeStartKey,
      reviewRangeEndKey,
      reviewDetailCategoryId: '',
      reviewDetailCategoryLabel: '全部支出',
      reviewDetailVisible: false,
      reviewTransactions: []
    }, () => {
      if (this.data.reviewPeriod === 'custom') this.refreshReview(new Date());
    });
  },

  async refreshReviewDetails() {
    if (this.data.reviewPeriod !== 'custom' || !this.data.reviewDetailVisible) return;
    const requestId = (this._reviewDetailReadId || 0) + 1;
    this._reviewDetailReadId = requestId;
    this.setData({ reviewDetailLoading: true, reviewDetailError: '' });
    try {
      const options = {
        startDateKey: this.data.reviewRangeStartKey,
        endDateKey: this.data.reviewRangeEndKey,
        direction: 'expense'
      };
      if (this.data.reviewDetailCategoryId) {
        options.categoryId = this.data.reviewDetailCategoryId;
      }
      const transactions = await listTransactions(options);
      if (requestId !== this._reviewDetailReadId) return;
      this.setData({
        reviewTransactions: transactions.map((item) => toTransactionView(item, new Date()))
      });
    } catch (error) {
      if (requestId !== this._reviewDetailReadId) return;
      console.error('读取区间支出明细失败', error);
      this.setData({ reviewDetailError: '区间明细暂时没读到，请重试。' });
    } finally {
      if (requestId === this._reviewDetailReadId) {
        this.setData({ reviewDetailLoading: false });
      }
    }
  },

  toggleReviewDetails() {
    if (this.data.reviewDetailVisible) {
      this.setData({
        reviewDetailCategoryId: '',
        reviewDetailCategoryLabel: '全部支出',
        reviewDetailVisible: false,
        reviewTransactions: []
      });
      return;
    }
    this.setData({
      reviewDetailCategoryId: '',
      reviewDetailCategoryLabel: '全部支出',
      reviewDetailVisible: true
    }, () => this.refreshReviewDetails());
  },

  handleReviewCategoryDetail(event) {
    const categoryId = event.currentTarget.dataset.category;
    const categoryLabel = event.currentTarget.dataset.label;
    this.setData({
      reviewDetailCategoryId: categoryId,
      reviewDetailCategoryLabel: categoryLabel,
      reviewDetailVisible: true
    }, () => this.refreshReviewDetails());
  },

  clearReviewCategoryDetail() {
    this.setData({
      reviewDetailCategoryId: '',
      reviewDetailCategoryLabel: '全部支出'
    }, () => this.refreshReviewDetails());
  },

  async refreshHistoryDetail() {
    const requestId = (this._historyReadId || 0) + 1;
    this._historyReadId = requestId;
    this.setData({ historyLoading: true, historyError: '' });
    try {
      const results = await Promise.all([
        listTransactions({ dateKey: this.data.historyDateKey }),
        listTransactions({ importBatches: true })
      ]);
      const transactions = results[0];
      if (requestId !== this._historyReadId) return;
      const historyTransactions = transactions.map((item) => toTransactionView(item, new Date()));
      const historyExpenseCents = transactions
        .filter((item) => item.direction !== 'income')
        .reduce((sum, item) => sum + item.amountCents, 0);
      const historyIncomeCents = transactions
        .filter((item) => item.direction === 'income')
        .reduce((sum, item) => sum + item.amountCents, 0);
      this.setData({
        historyDateLabel: formatHistoryDate(this.data.historyDateKey),
        historyExpenseText: formatCents(historyExpenseCents),
        historyIncomeText: formatCents(historyIncomeCents),
        historyTransactions,
        importBatches: results[1].map((item) => Object.assign({}, item, {
          importedAtText: formatImportTime(item.importedAt)
        }))
      });
    } catch (error) {
      if (requestId !== this._historyReadId) return;
      console.error('读取日期明细失败', error);
      this.setData({ historyError: '这一天的明细暂时没读到，请重试。' });
    } finally {
      if (requestId === this._historyReadId) this.setData({ historyLoading: false });
    }
  },

  handleHistoryDateChange(event) {
    const historyDateKey = event.detail.value;
    if (!parseLocalDateKey(historyDateKey)) return;
    this._historyDateTouched = true;
    this.setData({ historyDateKey }, () => this.refreshHistoryDetail());
  },

  handleSmartInput(event) {
    this.setData({
      smartEntryError: '',
      smartEntryInput: event.detail.value,
      smartEntryParsed: null,
      smartEntryDrafts: [],
      smartReviewVisible: false,
      voiceHint: ''
    });
  },

  handleSmartSubmit(options) {
    const parsed = parseQuickEntries(this.data.smartEntryInput);
    if (!parsed.ok) {
      this.setData({
        smartEntryError: parsed.error,
        smartEntryParsed: null,
        smartEntryDrafts: [],
        smartReviewVisible: false
      });
      return;
    }
    const smartEntryDrafts = parsed.value.map(toSmartDraft);
    this.setData({
      smartEntryError: '',
      smartEntryDrafts,
      smartEntryParsed: smartEntryDrafts[0],
      smartEntrySource: options && options.source === 'voice' ? 'voice' : 'text',
      smartReviewVisible: true,
      smartSelectedCount: smartEntryDrafts.length,
      voiceHint: options && options.keepVoiceHint ? this.data.voiceHint : ''
    });
    wx.hideKeyboard();
  },

  handleSmartExample(event) {
    const value = event.currentTarget.dataset.value;
    this.setData({ smartEntryInput: value }, () => this.handleSmartSubmit());
  },

  retrySmartEntry() {
    this.setData({
      smartEntryError: '',
      smartEntryDrafts: [],
      smartEntryParsed: null,
      smartReviewVisible: false,
      smartSelectedCount: 0,
      voiceHint: ''
    });
  },

  handleSmartTranscriptInput(event) {
    this.setData({ smartEntryInput: event.detail.value, smartEntryError: '' });
  },

  reparseSmartTranscript() {
    this.handleSmartSubmit({
      keepVoiceHint: this.data.smartEntrySource === 'voice',
      source: this.data.smartEntrySource
    });
  },

  toggleSmartDraft(event) {
    const index = Number(event.currentTarget.dataset.index);
    const drafts = this.data.smartEntryDrafts.map((item, itemIndex) => itemIndex === index
      ? Object.assign({}, item, { selected: !item.selected })
      : item);
    this.setData({
      smartEntryDrafts: drafts,
      smartSelectedCount: drafts.filter((item) => item.selected).length
    });
  },

  handleSmartDraftNote(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`smartEntryDrafts[${index}].note`]: event.detail.value.slice(0, 20) });
  },

  handleSmartDraftAmount(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({
      [`smartEntryDrafts[${index}].amountInput`]: event.detail.value,
      smartEntryError: ''
    });
  },

  handleSmartDraftCategory(event) {
    const index = Number(event.currentTarget.dataset.index);
    const categoryIndex = Number(event.detail.value);
    const draft = this.data.smartEntryDrafts[index];
    const category = draft && draft.categoryOptions[categoryIndex];
    if (!category) return;
    this.setData({
      [`smartEntryDrafts[${index}].categoryId`]: category.id,
      [`smartEntryDrafts[${index}].categoryLabel`]: category.label,
      [`smartEntryDrafts[${index}].categoryIndex`]: categoryIndex
    });
  },

  handleSmartDraftTime(event) {
    const index = Number(event.currentTarget.dataset.index);
    this.setData({ [`smartEntryDrafts[${index}].timeText`]: event.detail.value });
  },

  async confirmSmartEntries() {
    const selected = this.data.smartEntryDrafts.filter((item) => item.selected);
    if (!selected.length) {
      this.setData({ smartEntryError: '请至少选择一笔账单。' });
      return;
    }
    const now = new Date();
    const drafts = [];
    for (const item of selected) {
      const parsed = parseYuanToCents(item.amountInput, {
        allowZero: false,
        maxCents: TRANSACTION_MAX_CENTS
      });
      if (!parsed.ok) {
        this.setData({ smartEntryError: `${item.note || item.categoryLabel}：${parsed.error}` });
        return;
      }
      drafts.push(Object.assign({}, item, {
        amountCents: parsed.value,
        occurredAt: occurredAtForTime(item.timeText, now)
      }));
    }
    const saved = await this.saveTransactionDrafts(drafts, `smart_${this.data.smartEntrySource}`);
    if (!saved.ok) {
      this.setData({ smartEntryError: saved.error });
      return;
    }
    this.setData({
      smartEntryDrafts: [],
      smartEntryError: '',
      smartEntryInput: '',
      smartEntryParsed: null,
      smartReviewVisible: false,
      smartSelectedCount: 0,
      voiceHint: ''
    });
  },

  handleVoiceEntry() {
    if (!this._voiceManager) this.setupVoiceRecognition();
    if (!this._voiceManager) {
      const voiceHint = '语音服务暂不可用，也可以直接输入“咖啡 20”。';
      this.setData({ voiceHint });
      wx.showToast({ icon: 'none', title: '可直接输入账单' });
      trackEvent('voice_entry_unavailable', { fallback: 'text' });
      return;
    }
    if (this.data.isVoiceRecording) {
      this.setData({ voiceHint: '正在识别…' });
      this._voiceManager.stop();
      return;
    }
    if (this._voiceStarting) return;
    this._voiceStarting = true;
    this.setData({
      isVoiceRecording: true,
      smartEntryError: '',
      smartEntryParsed: null,
      voiceHint: '正在启动麦克风…'
    });
    try {
      this._voiceManager.start({
        duration: VOICE_RECORDING_DURATION_MS,
        lang: 'zh_CN'
      });
    } catch (error) {
      this._voiceStarting = false;
      this.setData({
        isVoiceRecording: false,
        voiceHint: voiceErrorMessage(error)
      });
      trackEvent('voice_entry_error', { code: 'start_failed', fallback: 'text' });
    }
  },

  handlePhotoEntry() {
    wx.showActionSheet({
      itemList: ['拍照', '从相册选择'],
      success: (result) => this.chooseExpensePhoto(result.tapIndex === 0 ? 'camera' : 'album')
    });
  },

  async chooseExpensePhoto(sourceType) {
    if (typeof wx.chooseMedia !== 'function') {
      this.setData({ photoError: '当前微信版本不支持选择图片，请直接文字记账。' });
      return;
    }
    try {
      const result = await new Promise((resolve, reject) => {
        wx.chooseMedia({
          count: 1,
          mediaType: ['image'],
          sizeType: ['compressed'],
          sourceType: [sourceType],
          success: resolve,
          fail: reject
        });
      });
      const file = result.tempFiles && result.tempFiles[0];
      if (!file || !file.tempFilePath) return;
      this.setData({
        photoAmountInput: '',
        photoCategoryId: 'food',
        photoCategoryIndex: 0,
        photoError: '',
        photoNoteInput: '',
        photoPath: file.tempFilePath,
        photoReviewVisible: true,
        photoTimeText: formatRecordTime(Date.now(), new Date()).slice(-5)
      });
      trackEvent('photo_entry_selected', { source: sourceType });
    } catch (error) {
      if (error && /cancel/i.test(error.errMsg || '')) return;
      console.error('选择账单图片失败', error);
      this.setData({ photoError: '图片没有选好，可以重试或直接文字记账。' });
    }
  },

  closePhotoReview() {
    this.setData({
      photoAmountInput: '',
      photoError: '',
      photoNoteInput: '',
      photoPath: '',
      photoReviewVisible: false
    });
  },

  handlePhotoAmountInput(event) {
    this.setData({ photoAmountInput: event.detail.value, photoError: '' });
  },

  handlePhotoNoteInput(event) {
    this.setData({ photoNoteInput: event.detail.value.slice(0, 20), photoError: '' });
  },

  handlePhotoCategory(event) {
    const photoCategoryIndex = Number(event.detail.value);
    const category = this.data.photoCategoryOptions[photoCategoryIndex];
    if (!category) return;
    this.setData({ photoCategoryId: category.id, photoCategoryIndex });
  },

  handlePhotoTime(event) {
    this.setData({ photoTimeText: event.detail.value });
  },

  async confirmPhotoEntry() {
    const parsed = parseYuanToCents(this.data.photoAmountInput, {
      allowZero: false,
      maxCents: TRANSACTION_MAX_CENTS
    });
    if (!parsed.ok) {
      this.setData({ photoError: parsed.error });
      return;
    }
    const saved = await this.saveTransactionDraft({
      amountCents: parsed.value,
      categoryId: this.data.photoCategoryId,
      direction: 'expense',
      note: this.data.photoNoteInput,
      occurredAt: occurredAtForTime(this.data.photoTimeText, new Date())
    }, 'photo_manual_review');
    if (!saved.ok) {
      this.setData({ photoError: saved.error });
      return;
    }
    this.closePhotoReview();
  },

  async confirmSmartEntry() {
    if (!this.data.smartEntryDrafts.length) {
      this.handleSmartSubmit();
      return;
    }
    await this.confirmSmartEntries();
  },

  handleAmountInput(event) {
    this.setData({ amountInput: event.detail.value, inputError: '', feedback: '' });
  },

  handleCategorySelect(event) {
    this.setData({
      selectedCategoryId: event.currentTarget.dataset.id,
      feedback: ''
    });
  },

  handleRecordDirection(event) {
    const recordDirection = event.currentTarget.dataset.direction;
    if (recordDirection === this.data.recordDirection
      || (recordDirection !== 'expense' && recordDirection !== 'income')) return;
    const categories = categoriesForDirection(recordDirection);
    this.setData({
      categories,
      feedback: '',
      inputError: '',
      recordDirection,
      selectedCategoryId: categories[0].id
    });
  },

  handleNoteInput(event) {
    this.setData({ noteInput: event.detail.value, feedback: '' });
  },

  async saveTransactionDrafts(drafts, entry) {
    if (this._transactionInFlight || this.data.isSaving) {
      return { ok: false, error: '正在保存，请稍候。' };
    }
    this._transactionInFlight = true;
    this.setData({ isSaving: true, inputError: '', feedback: '' });
    try {
      let duplicateCount = 0;
      for (const draft of drafts) {
        const result = await addTransaction({
          action: 'create',
          amountCents: draft.amountCents,
          categoryId: draft.categoryId,
          commandId: commandId('create'),
          direction: draft.direction,
          note: draft.note,
          occurredAt: draft.occurredAt || Date.now()
        });
        if (result.duplicate) duplicateCount += 1;
      }
      await this.refreshAfterMutation();
      this.setData({
        feedback: duplicateCount === drafts.length
          ? '这些记录已经保存过了。'
          : `已记下 ${drafts.length - duplicateCount} 笔，今日额度已更新。`
      });
      trackEvent('transaction_batch_saved', {
        count: drafts.length,
        entry: entry || 'smart_text',
        result: duplicateCount ? 'partial_duplicate' : 'success'
      });
      return { ok: true, duplicateCount };
    } catch (error) {
      console.error('批量保存交易失败', error);
      return { ok: false, error: '保存失败，请重试' };
    } finally {
      this._transactionInFlight = false;
      this.setData({ isSaving: false });
    }
  },

  async saveTransactionDraft(draft, entry) {
    if (this._transactionInFlight || this.data.isSaving) {
      return { ok: false, error: '正在保存，请稍候。' };
    }

    const now = new Date();
    const direction = draft.direction;
    this._transactionInFlight = true;
    this.setData({ isSaving: true, inputError: '', feedback: '' });
    try {
      const result = await addTransaction({
        action: 'create',
        amountCents: draft.amountCents,
        categoryId: draft.categoryId,
        commandId: commandId('create'),
        direction,
        note: draft.note,
        occurredAt: draft.occurredAt || now.getTime()
      });
      await this.refreshAfterMutation();
      this.setData({
        feedback: result.duplicate
          ? '这笔记录已经保存过了。'
          : direction === 'income'
            ? `已记下，额外收入已加入${this.data.result.periodLabel}可用额度。`
            : '已记下，今日额度已更新。'
      });
      trackEvent('transaction_saved', {
        direction,
        entry: entry || 'manual_form',
        result: result.duplicate ? 'duplicate' : 'success'
      });
      return { ok: true, duplicate: result.duplicate };
    } catch (error) {
      console.error('保存交易失败', error);
      return { ok: false, error: '保存失败，请重试' };
    } finally {
      this._transactionInFlight = false;
      this.setData({ isSaving: false });
    }
  },

  async handleAddTransaction() {
    const parsed = parseYuanToCents(this.data.amountInput, {
      allowZero: false,
      maxCents: TRANSACTION_MAX_CENTS
    });
    if (!parsed.ok) {
      this.setData({ inputError: parsed.error, feedback: '' });
      return;
    }
    const saved = await this.saveTransactionDraft({
      amountCents: parsed.value,
      categoryId: this.data.selectedCategoryId,
      direction: this.data.recordDirection,
      note: this.data.noteInput
    }, 'manual_form');
    if (!saved.ok) {
      this.setData({ feedback: '', inputError: saved.error });
      return;
    }
    this.setData({ amountInput: '', noteInput: '' });
    wx.hideKeyboard();
  },

  async saveCurrentAsTemplate() {
    if (this.data.isTemplateSaving) return;
    const parsed = parseYuanToCents(this.data.amountInput, {
      allowZero: false,
      maxCents: TRANSACTION_MAX_CENTS
    });
    if (!parsed.ok) {
      this.setData({ inputError: parsed.error, feedback: '' });
      return;
    }
    this.setData({ isTemplateSaving: true, inputError: '', feedback: '' });
    try {
      await saveQuickTemplate({
        id: commandId('template'),
        amountCents: parsed.value,
        categoryId: this.data.selectedCategoryId,
        direction: this.data.recordDirection,
        note: this.data.noteInput
      });
      const quickTemplates = await listQuickTemplates();
      this.setData({
        quickTemplates: quickTemplates.map(toQuickTemplateView),
        feedback: '已保存为常用模板。'
      });
    } catch (error) {
      this.setData({ inputError: error.message || '模板保存失败，请重试', feedback: '' });
    } finally {
      this.setData({ isTemplateSaving: false });
    }
  },

  async useQuickTemplate(event) {
    if (this._transactionInFlight || this.data.isSaving) return;
    const template = this.data.quickTemplates
      .find((item) => item.id === event.currentTarget.dataset.id);
    if (!template) return;
    this._transactionInFlight = true;
    this.setData({ isSaving: true, inputError: '', feedback: '' });
    try {
      const result = await addTransaction({
        action: 'create',
        amountCents: template.amountCents,
        categoryId: template.categoryId,
        commandId: commandId('template-create'),
        direction: template.direction,
        note: template.note,
        occurredAt: Date.now()
      });
      this.setData({
        feedback: result.duplicate ? '这笔记录已经保存过了。' : `已用“${template.title}”记一笔。`
      });
      await this.refreshAfterMutation();
      trackEvent('transaction_saved', {
        direction: template.direction,
        entry: 'quick_template',
        result: result.duplicate ? 'duplicate' : 'success'
      });
    } catch (error) {
      this.setData({ inputError: '模板记账失败，请重试', feedback: '' });
    } finally {
      this._transactionInFlight = false;
      this.setData({ isSaving: false });
    }
  },

  deleteQuickTemplate(event) {
    const template = this.data.quickTemplates
      .find((item) => item.id === event.currentTarget.dataset.id);
    if (!template) return;
    wx.showModal({
      title: '删除常用模板',
      content: `删除“${template.title} ¥${template.amountText}”模板？已有流水不会受影响。`,
      confirmText: '删除',
      confirmColor: '#C84F4A',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          await deleteQuickTemplate(template.id);
          const quickTemplates = await listQuickTemplates();
          this.setData({
            quickTemplates: quickTemplates.map(toQuickTemplateView),
            feedback: '常用模板已删除。'
          });
        } catch (error) {
          this.setData({ inputError: '模板删除失败，请重试', feedback: '' });
        }
      }
    });
  },

  openEditTransaction(event) {
    const transactionId = event.currentTarget.dataset.id;
    const transaction = this.data.historyTransactions
      .concat(this.data.reviewTransactions, this.data.detailsTransactions)
      .find((item) => item.id === transactionId);
    if (!transaction) return;
    const originalDate = new Date(transaction.occurredAt);
    const monthKey = toMonthKey(originalDate);
    const monthEnd = `${monthKey}-${String(daysInMonth(originalDate)).padStart(2, '0')}`;
    this.setData({
      editDrawerVisible: true,
      editCategories: categoriesForDirection(transaction.direction),
      editError: '',
      editForm: {
        amount: centsToInput(transaction.amountCents),
        categoryId: transaction.categoryId,
        direction: transaction.direction,
        dateKey: toDateKey(originalDate),
        id: transaction.id,
        maxDateKey: monthEnd < this.data.historyMaxDateKey
          ? monthEnd
          : this.data.historyMaxDateKey,
        minDateKey: `${monthKey}-01`,
        note: transaction.note,
        originalOccurredAt: transaction.occurredAt
      }
    });
  },

  closeEditDrawer() {
    if (this.data.isEditSaving) return;
    this.setData({ editDrawerVisible: false, editError: '', editForm: null });
  },

  handleEditFormInput(event) {
    const field = event.currentTarget.dataset.field;
    this.setData({ [`editForm.${field}`]: event.detail.value, editError: '' });
  },

  handleEditCategorySelect(event) {
    this.setData({
      'editForm.categoryId': event.currentTarget.dataset.id,
      editError: ''
    });
  },

  handleEditDirection(event) {
    const direction = event.currentTarget.dataset.direction;
    if (!this.data.editForm || direction === this.data.editForm.direction
      || (direction !== 'expense' && direction !== 'income')) return;
    const editCategories = categoriesForDirection(direction);
    this.setData({
      editCategories,
      'editForm.categoryId': editCategories[0].id,
      'editForm.direction': direction,
      editError: ''
    });
  },

  handleEditDateChange(event) {
    this.setData({ 'editForm.dateKey': event.detail.value, editError: '' });
  },

  async saveEditedTransaction() {
    if (this._editSaveInFlight || this.data.isEditSaving || !this.data.editForm) return;
    const parsed = parseYuanToCents(this.data.editForm.amount, {
      allowZero: false,
      maxCents: TRANSACTION_MAX_CENTS
    });
    if (!parsed.ok) {
      this.setData({ editError: parsed.error });
      return;
    }
    const selectedDate = parseLocalDateKey(this.data.editForm.dateKey);
    if (!selectedDate) {
      this.setData({ editError: '请选择有效日期' });
      return;
    }
    const original = new Date(this.data.editForm.originalOccurredAt);
    selectedDate.setHours(
      original.getHours(),
      original.getMinutes(),
      original.getSeconds(),
      original.getMilliseconds()
    );
    this._editSaveInFlight = true;
    this.setData({ isEditSaving: true, editError: '' });
    try {
      const targetDateKey = this.data.editForm.dateKey;
      await addTransaction({
        action: 'update',
        amountCents: parsed.value,
        categoryId: this.data.editForm.categoryId,
        commandId: commandId('update'),
        direction: this.data.editForm.direction,
        note: this.data.editForm.note,
        occurredAt: selectedDate.getTime(),
        transactionId: this.data.editForm.id
      });
      this.setData({
        editDrawerVisible: false,
        editForm: null,
        historyDateKey: targetDateKey
      });
      this._historyDateTouched = true;
      await this.refreshAfterMutation();
      wx.showToast({ title: '记录已修改', icon: 'success' });
    } catch (error) {
      console.error('修改交易失败', error);
      this.setData({ editError: error.message || '修改失败，请重试' });
    } finally {
      this._editSaveInFlight = false;
      this.setData({ isEditSaving: false });
    }
  },

  handleDeleteTransaction(event) {
    const transactionId = event.currentTarget.dataset.id;
    const transaction = this.data.historyTransactions
      .concat(this.data.reviewTransactions, this.data.detailsTransactions)
      .find((item) => item.id === transactionId);
    if (!transaction) return;
    const amountText = transaction.amountText;
    const categoryLabel = transaction.categoryLabel;
    const purpose = transaction.note ? ` · ${transaction.note}` : '';
    const cycle = this.data.budget
      ? budgetCycleRange(this.data.budget.cycleStartDay || 1, new Date())
      : null;
    const transactionDateKey = toDateKey(transaction.occurredAt);
    const isCurrentBudgetCycle = cycle
      && transactionDateKey >= cycle.startDateKey
      && transactionDateKey <= cycle.endDateKey;
    const periodLabel = this.data.result ? this.data.result.periodLabel : '本月';
    const impactText = transaction.direction === 'income'
      ? (isCurrentBudgetCycle ? `${periodLabel}可用额度会重新计算。` : '对应历史明细会更新。')
      : (isCurrentBudgetCycle ? '今日额度会重新计算。' : '对应历史回看会更新。');
    wx.showModal({
      title: '删除记录',
      content: `删除“${categoryLabel}${purpose}”的 ¥${amountText} ${transaction.directionLabel}记录？${impactText}`,
      confirmText: '删除',
      confirmColor: '#C84F4A',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          await addTransaction({
            action: 'delete',
            commandId: commandId('delete'),
            transactionId
          });
          await this.refreshAfterMutation();
          wx.showToast({ title: '已删除', icon: 'success' });
        } catch (error) {
          console.error('删除交易失败', error);
          wx.showToast({ title: '删除失败，请重试', icon: 'none' });
        }
      }
    });
  },

  async refreshAfterMutation() {
    const now = new Date();
    const context = await budgetStore.loadBudgetContext(now);
    const readyData = context.status === 'ready' ? await Promise.all([
      loadCycleTransactions(context.budget, now),
      listQuickTemplates()
    ]) : [[], []];
    if (context.status === 'ready') {
      await this.renderReady(context.budget, readyData[0], now, readyData[1]);
    }
    this.setData({ exportError: '', exportFileName: '', exportFilePath: '' });
  },

  applyThemeModel(model) {
    this.applyThemeChrome(model.resolved);
    this.setData({
      themeDraft: Object.assign({}, model.settings),
      themeName: model.resolved.name,
      themePresets: model.presets,
      themeResolved: model.resolved,
      themeSettings: Object.assign({}, model.settings),
      themeStyle: model.resolved.styleText
    });
  },

  applyThemeChrome(resolved) {
    if (!resolved || typeof wx === 'undefined') return;
    wx.setNavigationBarColor({
      frontColor: resolved.scheme === 'dark' ? '#ffffff' : '#000000',
      backgroundColor: resolved.page
    });
    if (typeof wx.setBackgroundColor === 'function') {
      wx.setBackgroundColor({
        backgroundColor: resolved.page,
        backgroundColorTop: resolved.page,
        backgroundColorBottom: resolved.page
      });
    }
  },

  openSettings() {
    if (!this.data.budget) return;
    const budget = this.data.budget;
    const fixedExpense = centsToInput(budget.fixedExpenseCents);
    const form = {
      income: centsToInput(budget.incomeCents),
      fixedExpense,
      fixedExpenseMode: budget.fixedExpenseMode === 'items' ? 'items' : 'manual',
      manualFixedExpense: fixedExpense,
      savingGoal: centsToInput(budget.savingGoalCents),
      cycleStartDay: budget.cycleStartDay || 1,
      fixedExpenseItems: (budget.fixedExpenseItems || []).map((item) => ({
        id: item.id,
        name: item.name,
        amount: centsToInput(item.amountCents)
      }))
    };
    this.setData(Object.assign({
      drawerMode: 'edit',
      drawerVisible: true,
      cycleStartDayIndex: Math.max(0, (budget.cycleStartDay || 1) - 1),
      formErrors: Object.assign({}, EMPTY_ERRORS),
      legacyHistoricalSpentText: budget.historicalSpentBeforeTrackingCents > 0
        ? formatCents(budget.historicalSpentBeforeTrackingCents)
        : ''
    }, fixedExpenseDraftState(form)));
  },

  closeDrawer() {
    if (this.data.drawerMode === 'first') return;
    this.setData({ drawerVisible: false, formErrors: Object.assign({}, EMPTY_ERRORS) });
  },

  useDefaultBudget() {
    if (this._budgetSaveInFlight || this.data.isBudgetSaving) return;
    const defaults = {
      income: '8000',
      fixedExpense: '800',
      fixedExpenseMode: 'manual',
      manualFixedExpense: '800',
      savingGoal: '2000',
      cycleStartDay: 1,
      fixedExpenseItems: []
    };
    this.setData(Object.assign({
      cycleStartDayIndex: 0,
      formErrors: Object.assign({}, EMPTY_ERRORS)
    }, fixedExpenseDraftState(defaults)), () => {
      trackEvent('default_budget_selected', { entry: 'first_setup' });
      this.saveBudgetForm();
    });
  },

  openThemeDrawer() {
    const settings = Object.assign({}, this.data.themeSettings);
    this.setData({
      themeDraft: settings,
      themeDrawerVisible: true,
      themePresets: getThemePresets(settings.presetId)
    });
  },

  closeThemeDrawer() {
    const resolved = resolveTheme(this.data.themeSettings);
    this.applyThemeChrome(resolved);
    this.setData({
      themeDraft: Object.assign({}, this.data.themeSettings),
      themeDrawerVisible: false,
      themePresets: getThemePresets(this.data.themeSettings.presetId),
      themeResolved: resolved,
      themeStyle: resolved.styleText
    });
  },

  previewTheme(settings) {
    const resolved = resolveTheme(settings);
    this.applyThemeChrome(resolved);
    this.setData({
      themeDraft: settings,
      themePresets: getThemePresets(settings.presetId),
      themeResolved: resolved,
      themeStyle: resolved.styleText
    });
  },

  handleThemePreset(event) {
    this.previewTheme({ presetId: event.currentTarget.dataset.id });
  },

  resetThemeDraft() {
    this.previewTheme(Object.assign({}, DEFAULT_THEME_SETTINGS));
  },

  async saveThemeSettings() {
    if (this._themeSaveInFlight) return;
    this._themeSaveInFlight = true;
    try {
      const model = await themeStore.saveTheme(this.data.themeDraft);
      this.applyThemeModel(model);
      this.setData({ themeDrawerVisible: false });
      wx.showToast({ title: '主题已应用', icon: 'success' });
    } catch (error) {
      console.error('保存主题失败', error);
      wx.showToast({ title: '主题保存失败', icon: 'none' });
    } finally {
      this._themeSaveInFlight = false;
    }
  },

  noop() {},

  handleFormInput(event) {
    const field = event.currentTarget.dataset.field;
    const errors = Object.assign({}, this.data.formErrors);
    const dependentFields = field === 'income' || field === 'fixedExpense'
      ? Object.keys(FIELD_CONFIG)
      : [field];
    dependentFields.forEach((name) => { errors[name] = ''; });
    if (field === 'fixedExpense') {
      const form = Object.assign({}, this.data.form, {
        fixedExpense: event.detail.value,
        manualFixedExpense: event.detail.value
      });
      this.setData(Object.assign({ formErrors: errors }, fixedExpenseDraftState(form)));
      return;
    }
    this.setData({ [`form.${field}`]: event.detail.value, formErrors: errors });
  },

  handleFixedExpenseModeChange(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!FIXED_EXPENSE_MODES.includes(mode) || mode === this.data.form.fixedExpenseMode) return;
    const form = Object.assign({}, this.data.form, { fixedExpenseMode: mode });
    if (mode === 'manual') form.fixedExpense = form.manualFixedExpense;
    const errors = Object.assign({}, this.data.formErrors, { fixedExpense: '' });
    this.setData(Object.assign({ formErrors: errors }, fixedExpenseDraftState(form)));
  },

  handleCycleStartDayChange(event) {
    const index = Number(event.detail.value);
    const option = CYCLE_START_DAYS[index];
    if (!option) return;
    this.setData({
      cycleStartDayIndex: index,
      'form.cycleStartDay': option.value
    });
  },

  addFixedExpenseItem() {
    if (this.data.form.fixedExpenseItems.length >= 12) {
      this.setData({ 'formErrors.fixedExpense': '最多添加 12 项固定支出明细' });
      return;
    }
    const fixedExpenseItems = this.data.form.fixedExpenseItems.concat({
      id: commandId('fixed'),
      name: '',
      amount: ''
    });
    const form = Object.assign({}, this.data.form, { fixedExpenseItems });
    this.setData(Object.assign({
      formErrors: Object.assign({}, this.data.formErrors, { fixedExpense: '' })
    }, fixedExpenseDraftState(form)));
  },

  handleFixedExpenseItemInput(event) {
    const index = Number(event.currentTarget.dataset.index);
    const field = event.currentTarget.dataset.field;
    if (!Number.isInteger(index) || (field !== 'name' && field !== 'amount')) return;
    const fixedExpenseItems = this.data.form.fixedExpenseItems.map((item, itemIndex) =>
      itemIndex === index ? Object.assign({}, item, { [field]: event.detail.value }) : item
    );
    const form = Object.assign({}, this.data.form, { fixedExpenseItems });
    this.setData(Object.assign({
      formErrors: Object.assign({}, this.data.formErrors, { fixedExpense: '' })
    }, fixedExpenseDraftState(form)));
  },

  removeFixedExpenseItem(event) {
    const index = Number(event.currentTarget.dataset.index);
    if (!Number.isInteger(index)) return;
    const fixedExpenseItems = this.data.form.fixedExpenseItems
      .filter((_, itemIndex) => itemIndex !== index);
    const form = Object.assign({}, this.data.form, { fixedExpenseItems });
    this.setData(Object.assign({
      formErrors: Object.assign({}, this.data.formErrors, { fixedExpense: '' })
    }, fixedExpenseDraftState(form)));
  },

  validateBudgetForm() {
    const values = {};
    const errors = Object.assign({}, EMPTY_ERRORS);
    let valid = true;
    Object.keys(FIELD_CONFIG).forEach((field) => {
      const parsed = parseYuanToCents(this.data.form[field], {
        allowZero: true,
        maxCents: BUDGET_FIELD_MAX_CENTS
      });
      if (!parsed.ok) {
        errors[field] = parsed.error;
        valid = false;
      } else {
        values[FIELD_CONFIG[field]] = parsed.value;
      }
    });
    values.historicalSpentBeforeTrackingCents = 0;
    values.cycleStartDay = Number(this.data.form.cycleStartDay) || 1;
    values.fixedExpenseMode = this.data.form.fixedExpenseMode === 'items'
      ? 'items'
      : 'manual';
    values.fixedExpenseItems = [];
    if (values.fixedExpenseMode === 'items') {
      (this.data.form.fixedExpenseItems || []).forEach((item) => {
        const name = (item.name || '').trim();
        const amount = (item.amount || '').trim();
        if (!name && !amount) return;
        const parsed = parseYuanToCents(amount, {
          allowZero: false,
          maxCents: BUDGET_FIELD_MAX_CENTS
        });
        if (!name || name.length > 12 || !parsed.ok) {
          errors.fixedExpense = '请为每项固定支出填写 1–12 字名称和有效金额';
          valid = false;
          return;
        }
        values.fixedExpenseItems.push({
          id: item.id || commandId('fixed'),
          name,
          amountCents: parsed.value
        });
      });
      const itemTotalCents = values.fixedExpenseItems
        .reduce((sum, item) => sum + item.amountCents, 0);
      if (itemTotalCents > BUDGET_FIELD_MAX_CENTS) {
        errors.fixedExpense = '明细合计超过固定支出允许上限';
        valid = false;
      } else {
        values.fixedExpenseCents = itemTotalCents;
      }
    }
    values.categoryBudgets = [];
    if (valid) {
      const recordedSpentCents = this.data.transactions
        .filter((item) => item.direction !== 'income')
        .reduce((sum, item) => sum + item.amountCents, 0);
      const recordedIncomeCents = this.data.transactions
        .filter((item) => item.direction === 'income')
        .reduce((sum, item) => sum + item.amountCents, 0);
      const relationValidation = validateBudgetAmounts(
        values,
        recordedSpentCents,
        recordedIncomeCents
      );
      Object.assign(errors, relationValidation.errors);
      valid = relationValidation.valid;
    }
    return { errors, valid, values };
  },

  async saveBudgetForm() {
    if (this._budgetSaveInFlight || this.data.isBudgetSaving) return;
    const validation = this.validateBudgetForm();
    if (!validation.valid) {
      this.setData({ formErrors: validation.errors });
      return;
    }
    const now = new Date();
    if (this.data.drawerMode === 'edit' && this.data.budget) {
      validation.values.trackingStartDate = this.data.budget.trackingStartDate;
    } else {
      validation.values.trackingStartDate = toDateKey(now);
    }
    this._budgetSaveInFlight = true;
    this.setData({ isBudgetSaving: true, formErrors: Object.assign({}, EMPTY_ERRORS) });
    try {
      await budgetStore.saveBudget(validation.values, now);
      await this.refreshAfterMutation();
      this.setData({ drawerVisible: false, legacyHistoricalSpentText: '' });
      wx.showToast({ title: '设置已保存', icon: 'success' });
    } catch (error) {
      console.error('保存设置失败', error);
      this.setData({
        formErrors: Object.assign({}, this.data.formErrors, {
          income: error.message || '保存失败，请重试'
        })
      });
      wx.showToast({ title: '请检查预算设置', icon: 'none' });
    } finally {
      this._budgetSaveInFlight = false;
      this.setData({ isBudgetSaving: false });
    }
  },

  resetCurrentMonth() {
    wx.showModal({
      title: '重置本月数据',
      content: '将删除本月设置和所有消费记录，且无法恢复。确定继续吗？',
      confirmText: '确定重置',
      confirmColor: '#C84F4A',
      success: async (result) => {
        if (!result.confirm) return;
        try {
          await budgetStore.resetCurrentMonth(new Date());
          const now = new Date();
          this.setData(Object.assign({
            budget: null,
            drawerMode: 'first',
            drawerVisible: true,
            cycleStartDayIndex: 0,
            formErrors: Object.assign({}, EMPTY_ERRORS),
            legacyHistoricalSpentText: '',
            result: null,
            transactions: [],
            viewState: 'empty'
          }, fixedExpenseDraftState(emptyForm())));
        } catch (error) {
          console.error('重置失败', error);
          wx.showToast({ title: '重置失败，请重试', icon: 'none' });
        }
      }
    });
  },

  async handleExportLedger() {
    if (this._exportInFlight || this.data.isExporting) return;
    this._exportInFlight = true;
    let fileCreated = false;
    this.setData({ isExporting: true, exportError: '' });
    try {
      const exported = await exportLedger(new Date());
      fileCreated = true;
      this.setData({
        exportFileName: exported.fileName,
        exportFilePath: exported.filePath
      });
      trackEvent('ledger_export', { outcome: 'created' });
      await this.openExportedLedger(exported.filePath);
    } catch (error) {
      console.error('导出流水失败', error);
      this.setData({
        exportError: fileCreated
          ? 'Excel 已生成，但暂时无法打开；可点“直接转发文件”或重试。'
          : error.message || '导出失败，请重试'
      });
      trackEvent('ledger_export', { outcome: fileCreated ? 'open_failed' : 'failed' });
    } finally {
      this._exportInFlight = false;
      this.setData({ isExporting: false });
    }
  },

  chooseBillFile() {
    if (this._billImportReadInFlight || this.data.billImportLoading) return;
    this._billImportReadInFlight = true;
    this.setData({
      billImportError: '',
      billImportLoading: true,
      billImportPreview: null
    });
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['xlsx', 'csv', 'txt'],
      success: async (result) => {
        try {
          const preview = await previewBill(result.tempFiles && result.tempFiles[0], new Date());
          this.setData({
            activeTab: 'details',
            billImportPreview: preview
          }, () => {
            const selectedMonth = this.getDetailsMonthDate() || new Date();
            this.refreshDetails(this.data.detailsPeriod === 'month' ? selectedMonth : new Date());
            if (this.data.detailsAnalysisVisible) this.refreshDetailsAnalysis(selectedMonth);
          });
          trackEvent('bill_import', {
            outcome: 'previewed',
            recordCount: preview.importCount
          });
        } catch (error) {
          console.error('预览平台账单失败', error);
          this.setData({
            billImportError: error.message || '账单解析失败，请重新选择'
          });
          trackEvent('bill_import', { outcome: 'preview_failed' });
        } finally {
          this._billImportReadInFlight = false;
          this.setData({ billImportLoading: false });
        }
      },
      fail: (error) => {
        this._billImportReadInFlight = false;
        this.setData({ billImportLoading: false });
        if (!error || !/cancel/i.test(error.errMsg || '')) {
          console.error('选择平台账单失败', error);
          this.setData({ billImportError: '没有读取到文件，请重新选择微信或支付宝账单。' });
        }
      }
    });
  },

  async confirmBillImport() {
    const preview = this.data.billImportPreview;
    if (!preview || !preview.records.length
      || this._billImportSaveInFlight || this.data.isBillImportSaving) return;
    this._billImportSaveInFlight = true;
    this.setData({ isBillImportSaving: true, billImportError: '' });
    try {
      const result = await addTransaction({
        action: 'import',
        commandId: commandId(`${preview.source}-import`),
        source: preview.source,
        transactions: preview.records
      });
      const importedCount = result.importedCount || 0;
      this.setData({ billImportPreview: null });
      await this.refreshAfterMutation();
      wx.showToast({
        title: importedCount ? `已导入 ${importedCount} 笔` : '没有新增记录',
        icon: importedCount ? 'success' : 'none'
      });
      trackEvent('bill_import', {
        outcome: importedCount ? 'success' : 'duplicate',
        recordCount: importedCount
      });
    } catch (error) {
      console.error('导入平台账单失败', error);
      this.setData({ billImportError: error.message || '导入失败，请重试' });
      trackEvent('bill_import', { outcome: 'save_failed' });
    } finally {
      this._billImportSaveInFlight = false;
      this.setData({ isBillImportSaving: false });
    }
  },

  handleUndoImportBatch(event) {
    if (this.data.isImportBatchUndoing) return;
    const importBatchId = event.currentTarget.dataset.id;
    const batch = this.data.importBatches.find((item) => item.id === importBatchId);
    if (!batch) return;
    wx.showModal({
      title: '撤销这次账单导入',
      content: `将删除 ${batch.sourceLabel} ${batch.dateFrom} 至 ${batch.dateTo} 导入的剩余 ${batch.count} 笔记录，不影响手工记录和其他批次。`,
      confirmText: '撤销导入',
      confirmColor: '#C84F4A',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ isImportBatchUndoing: true, billImportError: '' });
        try {
          const undoResult = await addTransaction({
            action: 'undoImport',
            commandId: commandId('undo-import'),
            importBatchId
          });
          await this.refreshAfterMutation();
          wx.showToast({
            title: undoResult.removedCount ? `已撤销 ${undoResult.removedCount} 笔` : '该批次已撤销',
            icon: undoResult.removedCount ? 'success' : 'none'
          });
          trackEvent('bill_import', {
            outcome: 'batch_undone',
            recordCount: undoResult.removedCount || 0
          });
        } catch (error) {
          console.error('撤销账单导入失败', error);
          this.setData({ billImportError: error.message || '撤销导入失败，请重试' });
        } finally {
          this.setData({ isImportBatchUndoing: false });
        }
      }
    });
  },

  async handleCreateBackup() {
    if (this._backupCreateInFlight || this.data.isBackingUp) return;
    this._backupCreateInFlight = true;
    this.setData({ isBackingUp: true, backupError: '' });
    try {
      const backup = await createDataBackup(new Date());
      this.setData({
        backupFileName: backup.fileName,
        backupFilePath: backup.filePath
      });
      wx.showToast({ title: '完整备份已生成', icon: 'success' });
      trackEvent('data_backup', { outcome: 'created' });
    } catch (error) {
      console.error('生成完整备份失败', error);
      this.setData({ backupError: error.message || '备份失败，请重试' });
      trackEvent('data_backup', { outcome: 'create_failed' });
    } finally {
      this._backupCreateInFlight = false;
      this.setData({ isBackingUp: false });
    }
  },

  shareBackupFile() {
    if (!this.data.backupFilePath) return;
    if (typeof wx.shareFileMessage !== 'function') {
      wx.showToast({ title: '当前微信版本不支持直接转发文件', icon: 'none' });
      return;
    }
    wx.shareFileMessage({
      filePath: this.data.backupFilePath,
      fileName: this.data.backupFileName,
      fail: (error) => {
        console.error('转发完整备份失败', error);
        wx.showToast({ title: '转发失败，请重试', icon: 'none' });
      }
    });
  },

  saveBackupToDisk() {
    if (!this.data.backupFilePath || !this.data.canSaveToDisk) return;
    wx.saveFileToDisk({
      filePath: this.data.backupFilePath,
      success: () => wx.showToast({ title: '备份已保存到电脑', icon: 'success' }),
      fail: (error) => {
        console.error('保存完整备份失败', error);
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    });
  },

  chooseBackupFile() {
    if (this._backupReadInFlight || this.data.isRestoringBackup) return;
    this._backupReadInFlight = true;
    this.setData({ backupError: '', backupPreview: null });
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['json'],
      success: async (result) => {
        try {
          const preview = await previewDataBackup(result.tempFiles && result.tempFiles[0]);
          this.setData({ backupPreview: preview });
          trackEvent('data_backup', { outcome: 'previewed' });
        } catch (error) {
          console.error('预览完整备份失败', error);
          this.setData({ backupError: error.message || '备份文件无法识别' });
          trackEvent('data_backup', { outcome: 'preview_failed' });
        } finally {
          this._backupReadInFlight = false;
        }
      },
      fail: (error) => {
        this._backupReadInFlight = false;
        if (!error || !/cancel/i.test(error.errMsg || '')) {
          console.error('选择完整备份失败', error);
          this.setData({ backupError: '没有读取到备份文件，请重新选择。' });
        }
      }
    });
  },

  confirmRestoreBackup() {
    const preview = this.data.backupPreview;
    if (!preview || this.data.isRestoringBackup) return;
    wx.showModal({
      title: '用备份覆盖本机数据',
      content: `备份时间 ${preview.exportedAtText}，包含 ${preview.recordCount} 笔流水（${preview.monthFrom} 至 ${preview.monthTo}）。恢复后将替换当前本机预算、流水和主题。`,
      confirmText: '确认恢复',
      confirmColor: '#C84F4A',
      success: async (result) => {
        if (!result.confirm) return;
        this.setData({ isRestoringBackup: true, backupError: '' });
        try {
          await restoreDataBackup(preview.filePath);
          this._historyDateTouched = false;
          this.setData({
            backupPreview: null,
            reviewDetailVisible: false,
            reviewTransactions: []
          });
          await this.refreshPage();
          wx.showToast({ title: '本地数据已恢复', icon: 'success' });
          trackEvent('data_backup', { outcome: 'restored' });
        } catch (error) {
          console.error('恢复完整备份失败', error);
          this.setData({ backupError: error.message || '恢复失败，原数据已保留' });
          trackEvent('data_backup', { outcome: 'restore_failed' });
        } finally {
          this.setData({ isRestoringBackup: false });
        }
      }
    });
  },

  openExportedLedger(filePath) {
    const target = filePath || this.data.exportFilePath;
    if (!target) return Promise.reject(new Error('请先导出 Excel'));
    return new Promise((resolve, reject) => {
      wx.openDocument({
        filePath: target,
        fileType: 'xlsx',
        showMenu: true,
        success: resolve,
        fail: (error) => reject(new Error(error && error.errMsg
          ? error.errMsg
          : '打开 Excel 失败'))
      });
    });
  },

  shareExportedLedger() {
    if (!this.data.exportFilePath) return;
    if (typeof wx.shareFileMessage !== 'function') {
      wx.showToast({ title: '当前微信版本不支持直接转发文件', icon: 'none' });
      return;
    }
    wx.shareFileMessage({
      filePath: this.data.exportFilePath,
      fileName: this.data.exportFileName,
      fail: (error) => {
        console.error('转发 Excel 失败', error);
        wx.showToast({ title: '转发失败，请重试', icon: 'none' });
      }
    });
  },

  saveExportedLedgerToDisk() {
    if (!this.data.exportFilePath || !this.data.canSaveToDisk) return;
    wx.saveFileToDisk({
      filePath: this.data.exportFilePath,
      success: () => wx.showToast({ title: '已保存到电脑', icon: 'success' }),
      fail: (error) => {
        console.error('保存 Excel 失败', error);
        wx.showToast({ title: '保存失败，请重试', icon: 'none' });
      }
    });
  },

  handleTimelineGuide() {
    trackEvent('share_timeline_guide', { entry: 'share_card' });
    wx.showToast({
      title: '请点右上角菜单，选择分享到朋友圈',
      icon: 'none',
      duration: 2600
    });
  },

  onShareAppMessage() {
    trackEvent('share_friend', { entry: 'share_button' });
    return {
      title: this.data.shareTitle,
      path: '/pages/index/index?from=share'
    };
  },

  onShareTimeline() {
    return {
      title: this.data.shareTitle,
      query: 'from=share'
    };
  }
});
