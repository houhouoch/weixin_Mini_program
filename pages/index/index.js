const { deriveBudget } = require('../../domain/budget');
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
const { addTransaction, listTransactions } = require('../../services/transactions');

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

function statusCopy(result) {
  if (result.status === 'budgetUnavailable') {
    return '固定支出和储蓄目标已经用完本月收入，请调整设置。';
  }
  if (result.status === 'monthOverspent') {
    return `本月已超支 ¥${formatCents(result.statusAmountCents)}，先暂停非必要消费。`;
  }
  if (result.status === 'todayOverspent') {
    return `今天已超出建议额度 ¥${formatCents(result.statusAmountCents)}，明天会重新计算。`;
  }
  if (result.status === 'runningLow') {
    return '今天的额度快用完了，接下来稍微收一收。';
  }
  return '按这个金额以内消费，月底会更从容。';
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

Page({
  data: {
    amountInput: '',
    amountSizeClass: 'amount-normal',
    budget: null,
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
    readMessage: '',
    recentTransactions: [],
    result: null,
    shareTitle: '今天还能花｜开始我的支出记录',
    statusTone: 'normal',
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
      let context = await budgetStore.loadBudgetContext(now);
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
      this.renderReady(context.budget, transactions, now);
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
        content: '要沿用上月预算设置吗？沿用后历史金额和消费记录会清零。',
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

  renderReady(budget, transactions, now) {
    const result = deriveBudget(budget, transactions, now);
    const amountText = formatCents(result.todayRemainingCents);
    const recentTransactions = transactions.slice(0, 5).map((item) => ({
      id: item.id,
      amountText: formatCents(item.amountCents),
      occurredAtText: formatRecordTime(item.occurredAt, now)
    }));
    const persona = personaForStatus(result.status);
    const useDays = daysSince(budget.trackingStartDate, now);
    const shareTitle = `${persona}｜打卡${useDays}天｜${transactions.length}笔｜本月已花¥${formatCents(result.totalSpentCents)}`;

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
        status: result.status,
        statusText: statusCopy(result),
        todayRemainingText: amountText,
        todaySpentText: formatCents(result.todaySpentCents),
        todaySuggestedBudgetText: formatCents(result.todaySuggestedBudgetCents)
      },
      shareTitle,
      statusTone: result.status,
      transactions,
      viewState: 'ready'
    });
    trackEvent('result_viewed', { status: result.status, entry: this.data.fromShare ? 'share' : 'direct' });
  },

  handleAmountInput(event) {
    this.setData({ amountInput: event.detail.value, inputError: '', feedback: '' });
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
        commandId: commandId('create'),
        occurredAt: now.getTime()
      });
      this.setData({
        amountInput: '',
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
    const amountText = event.currentTarget.dataset.amount;
    wx.showModal({
      title: '删除记录',
      content: `删除这笔 ¥${amountText} 的消费记录？删除后预算会重新计算。`,
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
    if (context.status === 'ready') this.renderReady(context.budget, transactions, now);
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
          await budgetStore.resetCurrentMonth();
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
