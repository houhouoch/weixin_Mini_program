const { deriveBudget } = require('../../domain/budget');
const { CATEGORIES, getCategoryLabel } = require('../../domain/categories');
const {
  daysSince,
  formatChineseDate,
  formatRecordTime,
  toDateKey
} = require('../../domain/date');
const {
  BUDGET_FIELD_MAX_CENTS,
  TRANSACTION_MAX_CENTS,
  centsToInput,
  formatCents,
  parseYuanToCents
} = require('../../domain/money');
const budgetStore = require('../../services/budget-store');
const { trackEvent } = require('../../services/analytics');
const { getSpendingSummary } = require('../../services/spending-summary');
const themeStore = require('../../services/theme-store');
const { addTransaction, listTransactions } = require('../../services/transactions');
const {
  DEFAULT_THEME_SETTINGS,
  getThemePresets,
  resolveTheme
} = require('../../domain/theme');

const EMPTY_ERRORS = {
  income: '',
  fixedExpense: '',
  savingGoal: '',
  historicalSpentBeforeTracking: ''
};

const FIELD_CONFIG = {
  income: 'incomeCents',
  fixedExpense: 'fixedExpenseCents',
  savingGoal: 'savingGoalCents',
  historicalSpentBeforeTracking: 'historicalSpentBeforeTrackingCents'
};

function commandId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function statusPresentation(result, spentProgressPercent) {
  if (result.status === 'budgetUnavailable') {
    return {
      eyebrow: '本月暂无可用额度',
      amountText: '¥0.00',
      statusLine1: '固定支出和储蓄目标',
      statusLine2: '已用完本月收入',
      badge: '调整设置',
      railText: '本月没有可分配额度'
    };
  }
  if (result.status === 'monthOverspent') {
    return {
      eyebrow: '本月已超出',
      amountText: `已超 ¥${formatCents(result.statusAmountCents)}`,
      statusLine1: '本月预算已经用完',
      statusLine2: '先暂停非必要消费',
      badge: '本月预警',
      railText: `本月已超 ¥${formatCents(result.statusAmountCents)}`
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

function emptyForm(now) {
  return {
    income: '',
    fixedExpense: '',
    savingGoal: '',
    historicalSpentBeforeTracking: now.getDate() === 1 ? '0.00' : ''
  };
}

const INITIAL_THEME = resolveTheme(DEFAULT_THEME_SETTINGS);
const REVIEW_PERIODS = Object.freeze([
  Object.freeze({ id: 'day', label: '日' }),
  Object.freeze({ id: 'month', label: '月' }),
  Object.freeze({ id: 'year', label: '年' })
]);

Page({
  data: {
    amountInput: '',
    amountSizeClass: 'amount-normal',
    budget: null,
    categories: CATEGORIES,
    dateLabel: '',
    drawerMode: 'first',
    drawerVisible: false,
    feedback: '',
    form: emptyForm(new Date()),
    formErrors: EMPTY_ERRORS,
    fromShare: false,
    inputError: '',
    isBudgetSaving: false,
    isSaving: false,
    noteInput: '',
    readMessage: '',
    recentTransactions: [],
    reviewError: '',
    reviewLoading: false,
    reviewPeriod: 'day',
    reviewPeriods: REVIEW_PERIODS,
    reviewSummary: null,
    result: null,
    shareTitle: '今天还能花｜开始我的支出记录',
    selectedCategoryId: 'food',
    statusTone: 'normal',
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
    this.setData({ fromShare, dateLabel: formatChineseDate(new Date()) });
    wx.showShareMenu({
      menus: ['shareAppMessage', 'shareTimeline']
    });
    trackEvent('app_open', { entry: fromShare ? 'share' : 'direct' });
    if (fromShare) trackEvent('share_entry_open', { entry: 'share' });
  },

  onShow() {
    this.refreshPage();
  },

  async refreshPage() {
    if (this._isReading) return;
    this._isReading = true;
    const now = new Date();
    if (!this.data.budget) this.setData({ viewState: 'loading' });
    this.setData({ dateLabel: formatChineseDate(now) });

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
        this.setData({
          budget: null,
          drawerMode: 'first',
          drawerVisible: true,
          form: emptyForm(now),
          formErrors: Object.assign({}, EMPTY_ERRORS),
          readMessage: context.status === 'corrupt'
            ? '本地数据无法识别，已安全回到首次设置。'
            : '',
          result: null,
          transactions: [],
          viewState: 'empty'
        });
        return;
      }

      const transactions = await listTransactions();
      await this.renderReady(context.budget, transactions, now);
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

  async renderReady(budget, transactions, now) {
    const result = deriveBudget(budget, transactions, now);
    const recentTransactions = transactions.slice(0, 5).map((item) => ({
      id: item.id,
      amountText: formatCents(item.amountCents),
      categoryId: item.categoryId,
      categoryLabel: getCategoryLabel(item.categoryId),
      purposeText: item.note || getCategoryLabel(item.categoryId),
      occurredAtText: formatRecordTime(item.occurredAt, now)
    }));
    const persona = personaForStatus(result.status);
    const useDays = daysSince(budget.trackingStartDate, now);
    const shareTitle = `${persona}｜打卡${useDays}天｜${transactions.length}笔｜本月已花¥${formatCents(result.totalSpentCents)}`;
    const spentProgressPercent = result.todaySuggestedBudgetCents > 0
      ? Math.min(100, Math.round(
        result.todaySpentCents * 100 / result.todaySuggestedBudgetCents
      ))
      : result.todaySpentCents > 0 ? 100 : 0;
    const presentation = statusPresentation(result, spentProgressPercent);
    const amountText = presentation.amountText;

    this.setData({
      amountSizeClass: amountText.length > 9
        ? 'amount-small'
        : amountText.length > 7 ? 'amount-medium' : 'amount-normal',
      budget,
      readMessage: '',
      recentTransactions,
      result: {
        monthlyRemainingNegative: result.monthlyRemainingCents < 0,
        monthlyRemainingText: formatCents(result.monthlyRemainingCents),
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
    await this.refreshReview(now);
    trackEvent('result_viewed', { status: result.status, entry: this.data.fromShare ? 'share' : 'direct' });
  },

  async refreshReview(now) {
    this.setData({ reviewLoading: true, reviewError: '' });
    try {
      const reviewSummary = await getSpendingSummary(
        this.data.reviewPeriod,
        now || new Date()
      );
      this.setData({ reviewSummary });
    } catch (error) {
      console.error('读取消费回看失败', error);
      this.setData({ reviewError: '消费回看暂时没读到，请稍后重试。' });
    } finally {
      this.setData({ reviewLoading: false });
    }
  },

  handleReviewPeriod(event) {
    const reviewPeriod = event.currentTarget.dataset.period;
    if (reviewPeriod === this.data.reviewPeriod) return;
    this.setData({ reviewPeriod });
    this.refreshReview(new Date());
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

  handleNoteInput(event) {
    this.setData({ noteInput: event.detail.value, feedback: '' });
  },

  async handleAddTransaction() {
    if (this._transactionInFlight || this.data.isSaving) {
      this.setData({ feedback: '正在保存，请稍候。' });
      return;
    }
    const parsed = parseYuanToCents(this.data.amountInput, {
      allowZero: false,
      maxCents: TRANSACTION_MAX_CENTS
    });
    if (!parsed.ok) {
      this.setData({ inputError: parsed.error, feedback: '' });
      return;
    }

    const now = new Date();
    this._transactionInFlight = true;
    this.setData({ isSaving: true, inputError: '', feedback: '' });
    try {
      const result = await addTransaction({
        action: 'create',
        amountCents: parsed.value,
        categoryId: this.data.selectedCategoryId,
        commandId: commandId('create'),
        note: this.data.noteInput,
        occurredAt: now.getTime()
      });
      this.setData({
        amountInput: '',
        noteInput: '',
        feedback: result.duplicate ? '这笔记录已经保存过了。' : '已记下，今日额度已更新。'
      });
      wx.hideKeyboard();
      await this.refreshAfterMutation();
      trackEvent('transaction_saved', { result: result.duplicate ? 'duplicate' : 'success' });
    } catch (error) {
      console.error('保存交易失败', error);
      this.setData({ feedback: '', inputError: '保存失败，请重试' });
    } finally {
      this._transactionInFlight = false;
      this.setData({ isSaving: false });
    }
  },

  handleDeleteTransaction(event) {
    const transactionId = event.currentTarget.dataset.id;
    const transaction = this.data.transactions.find((item) => item.id === transactionId);
    if (!transaction) return;
    const amountText = formatCents(transaction.amountCents);
    const categoryLabel = getCategoryLabel(transaction.categoryId);
    const purpose = transaction.note ? ` · ${transaction.note}` : '';
    wx.showModal({
      title: '删除记录',
      content: `删除“${categoryLabel}${purpose}”的 ¥${amountText} 记录？删除后预算会重新计算。`,
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
    const transactions = await listTransactions();
    if (context.status === 'ready') await this.renderReady(context.budget, transactions, now);
  },

  applyThemeModel(model) {
    this.setData({
      themeDraft: Object.assign({}, model.settings),
      themeName: model.resolved.name,
      themePresets: model.presets,
      themeResolved: model.resolved,
      themeSettings: Object.assign({}, model.settings),
      themeStyle: model.resolved.styleText
    });
  },

  openSettings() {
    if (!this.data.budget) return;
    const budget = this.data.budget;
    this.setData({
      drawerMode: 'edit',
      drawerVisible: true,
      form: {
        income: centsToInput(budget.incomeCents),
        fixedExpense: centsToInput(budget.fixedExpenseCents),
        savingGoal: centsToInput(budget.savingGoalCents),
        historicalSpentBeforeTracking: centsToInput(
          budget.historicalSpentBeforeTrackingCents
        )
      },
      formErrors: Object.assign({}, EMPTY_ERRORS)
    });
  },

  closeDrawer() {
    if (this.data.drawerMode === 'first') return;
    this.setData({ drawerVisible: false, formErrors: Object.assign({}, EMPTY_ERRORS) });
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
    this.setData({
      themeDraft: settings,
      themePresets: getThemePresets(settings.presetId),
      themeResolved: resolved,
      themeStyle: resolved.styleText
    });
  },

  handleThemePreset(event) {
    this.previewTheme({
      presetId: event.currentTarget.dataset.id,
      hueShift: 0,
      warmth: 0,
      brightness: 0
    });
  },

  handleThemeSlider(event) {
    const field = event.currentTarget.dataset.field;
    const settings = Object.assign({}, this.data.themeDraft, {
      [field]: Number(event.detail.value)
    });
    this.previewTheme(settings);
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
    this.setData({
      [`form.${field}`]: event.detail.value,
      [`formErrors.${field}`]: ''
    });
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
      this.setData({ drawerVisible: false });
      wx.showToast({ title: '设置已保存', icon: 'success' });
    } catch (error) {
      console.error('保存设置失败', error);
      wx.showToast({ title: '保存失败，请重试', icon: 'none' });
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
          this.setData({
            budget: null,
            drawerMode: 'first',
            drawerVisible: true,
            form: emptyForm(now),
            formErrors: Object.assign({}, EMPTY_ERRORS),
            result: null,
            transactions: [],
            viewState: 'empty'
          });
        } catch (error) {
          console.error('重置失败', error);
          wx.showToast({ title: '重置失败，请重试', icon: 'none' });
        }
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
