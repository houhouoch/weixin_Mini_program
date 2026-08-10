const { TRANSACTION_MAX_CENTS } = require('../domain/money');
const { categoriesForDirection, isValidCategoryId } = require('../domain/categories');
const { parseLocalDateKey, toDateKey, toMonthKey } = require('../domain/date');
const { readState, saveState } = require('./state-store');

const NOTE_MAX_LENGTH = 20;
const IMPORT_MAX_RECORDS = 5000;
const IMPORT_BATCH_ID_PATTERN = /^[a-z0-9-]{1,100}$/;

let mutationQueue = Promise.resolve();

function sortedTransactions(transactions) {
  return transactions.slice().sort((a, b) => b.occurredAt - a.occurredAt);
}

function assertTransactionFields(command) {
  const direction = command.direction === undefined ? 'expense' : command.direction;
  if (direction !== 'expense' && direction !== 'income') {
    throw new Error('收支类型无效');
  }
  if (!Number.isInteger(command.amountCents)
    || command.amountCents <= 0
    || command.amountCents > TRANSACTION_MAX_CENTS) {
    throw new Error('交易金额无效');
  }
  if (!Number.isFinite(command.occurredAt)) {
    throw new Error('交易时间无效');
  }
  if (!isValidCategoryId(command.categoryId)) {
    throw new Error('请选择收支分类');
  }
  if (!categoriesForDirection(direction).some((item) => item.id === command.categoryId)) {
    throw new Error(direction === 'income' ? '请选择收入分类' : '请选择支出分类');
  }
  if (command.note !== undefined && typeof command.note !== 'string') {
    throw new Error('用途说明无效');
  }
  if ((command.note || '').trim().length > NOTE_MAX_LENGTH) {
    throw new Error(`用途说明不能超过 ${NOTE_MAX_LENGTH} 个字`);
  }
}

function assertCommand(command) {
  if (!command || typeof command.commandId !== 'string' || !command.commandId) {
    throw new Error('交易命令缺少唯一标识');
  }
  if (command.action === 'create') {
    assertTransactionFields(command);
    return;
  }
  if (command.action === 'update' || command.action === 'delete') {
    if (typeof command.transactionId !== 'string' || !command.transactionId) {
      throw new Error('待修改交易无效');
    }
    if (command.action === 'update') assertTransactionFields(command);
    return;
  }
  if (command.action === 'import') {
    if ((command.source !== 'wechat' && command.source !== 'alipay')
      || !Array.isArray(command.transactions)
      || command.transactions.length > IMPORT_MAX_RECORDS) {
      throw new Error('平台账单导入命令无效');
    }
    if (command.importedAt !== undefined && !Number.isFinite(command.importedAt)) {
      throw new Error('平台账单导入时间无效');
    }
    command.transactions.forEach((transaction) => {
      assertTransactionFields(transaction);
      if (command.source === 'wechat' && transaction.direction === 'income') {
        throw new Error('微信账单导入当前仅支持支出记录');
      }
      const idPattern = command.source === 'wechat'
        ? /^wechat-[a-z0-9-]+$/
        : /^alipay-[a-z0-9-]+$/;
      if (typeof transaction.id !== 'string' || !idPattern.test(transaction.id)) {
        throw new Error('平台账单记录标识无效');
      }
    });
    return;
  }
  if (command.action === 'undoImport') {
    if (typeof command.importBatchId !== 'string'
      || !IMPORT_BATCH_ID_PATTERN.test(command.importBatchId)) {
      throw new Error('待撤销导入批次无效');
    }
    return;
  }
  throw new Error('未知交易命令');
}

function locateTransaction(state, transactionId) {
  const currentIndex = state.transactions.findIndex((item) => item.id === transactionId);
  if (currentIndex >= 0) {
    return { kind: 'current', index: currentIndex, monthKey: state.monthKey };
  }
  for (let historyIndex = 0; historyIndex < state.history.length; historyIndex += 1) {
    const transactionIndex = state.history[historyIndex].transactions
      .findIndex((item) => item.id === transactionId);
    if (transactionIndex >= 0) {
      return {
        kind: 'history',
        historyIndex,
        index: transactionIndex,
        monthKey: state.history[historyIndex].monthKey
      };
    }
  }
  return null;
}

function transactionFromCommand(command) {
  return {
    id: command.transactionId || command.commandId,
    amountCents: command.amountCents,
    categoryId: command.categoryId,
    direction: command.direction === 'income' ? 'income' : 'expense',
    note: (command.note || '').trim(),
    occurredAt: command.occurredAt
  };
}

function updateLocatedTransaction(state, location, command) {
  if (toMonthKey(command.occurredAt) !== location.monthKey) {
    throw new Error('交易日期只能在原月份内修改');
  }
  const previous = location.kind === 'current'
    ? state.transactions[location.index]
    : state.history[location.historyIndex].transactions[location.index];
  const next = Object.assign({}, previous, transactionFromCommand(command));
  if (location.kind === 'current') {
    const transactions = state.transactions.slice();
    transactions[location.index] = next;
    return Object.assign({}, state, { transactions });
  }
  const history = state.history.slice();
  const archive = Object.assign({}, history[location.historyIndex], {
    transactions: history[location.historyIndex].transactions.slice()
  });
  archive.transactions[location.index] = next;
  history[location.historyIndex] = archive;
  return Object.assign({}, state, { history });
}

function deleteLocatedTransaction(state, location) {
  if (location.kind === 'current') {
    return Object.assign({}, state, {
      transactions: state.transactions.filter((_, index) => index !== location.index)
    });
  }
  const history = state.history.slice();
  const archive = Object.assign({}, history[location.historyIndex], {
    transactions: history[location.historyIndex].transactions
      .filter((_, index) => index !== location.index)
  });
  history[location.historyIndex] = archive;
  return Object.assign({}, state, { history });
}

function monthDistance(currentMonthKey, monthKey) {
  const current = /^(\d{4})-(\d{2})$/.exec(currentMonthKey);
  const target = /^(\d{4})-(\d{2})$/.exec(monthKey);
  if (!current || !target) return Number.POSITIVE_INFINITY;
  return (Number(current[1]) - Number(target[1])) * 12
    + Number(current[2]) - Number(target[2]);
}

function importTransactions(state, records, metadata) {
  const existingIds = new Set(
    state.history.reduce(
      (ids, archive) => ids.concat(archive.transactions.map((item) => item.id)),
      state.transactions.map((item) => item.id)
    )
  );
  const current = state.transactions.slice();
  const historyByMonth = new Map(state.history.map((archive) => [
    archive.monthKey,
    Object.assign({}, archive, { transactions: archive.transactions.slice() })
  ]));
  let duplicateCount = 0;
  let importedCount = 0;
  let skippedCount = 0;

  records.forEach((record) => {
    if (existingIds.has(record.id)) {
      duplicateCount += 1;
      return;
    }
    const monthKey = toMonthKey(record.occurredAt);
    const distance = monthDistance(state.monthKey, monthKey);
    if (distance < 0 || distance > 36) {
      skippedCount += 1;
      return;
    }
    const transaction = {
      id: record.id,
      amountCents: record.amountCents,
      categoryId: record.categoryId,
      direction: record.direction === 'income' ? 'income' : 'expense',
      note: (record.note || '').trim(),
      occurredAt: record.occurredAt,
      importBatchId: metadata.importBatchId,
      importedAt: metadata.importedAt
    };
    if (distance === 0) {
      current.push(transaction);
    } else {
      const archive = historyByMonth.get(monthKey) || {
        monthKey,
        historicalSpentBeforeTrackingCents: 0,
        transactions: []
      };
      archive.transactions.push(transaction);
      historyByMonth.set(monthKey, archive);
    }
    existingIds.add(record.id);
    importedCount += 1;
  });

  return {
    duplicateCount,
    importedCount,
    skippedCount,
    state: Object.assign({}, state, {
      transactions: current,
      history: Array.from(historyByMonth.values())
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey))
        .slice(-36)
    })
  };
}

function undoImportBatch(state, importBatchId) {
  let removedCount = 0;
  const keepOtherBatches = (item) => {
    if (item.importBatchId !== importBatchId) return true;
    removedCount += 1;
    return false;
  };
  const transactions = state.transactions.filter(keepOtherBatches);
  const history = state.history.map((archive) => Object.assign({}, archive, {
    transactions: archive.transactions.filter(keepOtherBatches)
  })).filter((archive) => archive.historicalSpentBeforeTrackingCents > 0
    || archive.transactions.length > 0);
  return {
    removedCount,
    state: Object.assign({}, state, { history, transactions })
  };
}

async function executeCommand(command) {
  assertCommand(command);
  const result = await readState();
  if (!result.state
    || ((command.action === 'create' || command.action === 'import') && !result.state.budget)) {
    throw new Error('请先完成本月设置');
  }
  let state = result.state;
  if (state.processedCommandIds.indexOf(command.commandId) >= 0) {
    return { duplicate: true, transactions: sortedTransactions(state.transactions) };
  }

  let importResult = null;
  if (command.action === 'create') {
    state = Object.assign({}, state, {
      transactions: state.transactions.concat(transactionFromCommand(command))
    });
  } else if (command.action === 'import') {
    importResult = importTransactions(state, command.transactions, {
      importBatchId: command.commandId,
      importedAt: command.importedAt || Date.now()
    });
    state = importResult.state;
  } else if (command.action === 'undoImport') {
    importResult = undoImportBatch(state, command.importBatchId);
    state = importResult.state;
  } else {
    const location = locateTransaction(state, command.transactionId);
    if (!location) throw new Error('没有找到这笔记录');
    state = command.action === 'update'
      ? updateLocatedTransaction(state, location, command)
      : deleteLocatedTransaction(state, location);
  }

  const processedCommandIds = state.processedCommandIds
    .concat(command.commandId)
    .slice(-100);
  state = Object.assign({}, state, { processedCommandIds });
  await saveState(state);
  return Object.assign({
    duplicate: false,
    transactions: sortedTransactions(state.transactions)
  }, importResult ? {
    duplicateCount: importResult.duplicateCount,
    importedCount: importResult.importedCount,
    skippedCount: importResult.skippedCount,
    removedCount: importResult.removedCount
  } : {});
}

function addTransaction(command) {
  const run = () => executeCommand(command);
  mutationQueue = mutationQueue.then(run, run);
  return mutationQueue;
}

async function listTransactions(options) {
  const result = await readState();
  if (!result.state) return [];
  const allTransactions = result.state.history.reduce(
    (all, item) => all.concat(item.transactions),
    result.state.transactions.slice()
  );
  if (options && options.importBatches === true) {
    const batches = new Map();
    allTransactions.forEach((item) => {
      if (!item.importBatchId || !Number.isFinite(item.importedAt)) return;
      const existing = batches.get(item.importBatchId) || {
        id: item.importBatchId,
        importedAt: item.importedAt,
        source: item.id.indexOf('alipay-') === 0 ? 'alipay' : 'wechat',
        timestamps: []
      };
      existing.timestamps.push(item.occurredAt);
      batches.set(item.importBatchId, existing);
    });
    return Array.from(batches.values()).map((batch) => ({
      id: batch.id,
      importedAt: batch.importedAt,
      source: batch.source,
      sourceLabel: batch.source === 'alipay' ? '支付宝' : '微信支付',
      count: batch.timestamps.length,
      dateFrom: toDateKey(Math.min(...batch.timestamps)),
      dateTo: toDateKey(Math.max(...batch.timestamps))
    })).sort((a, b) => b.importedAt - a.importedAt).slice(0, 5);
  }
  if (options && options.all === true) return sortedTransactions(allTransactions);
  if (!options || (options.dateKey === undefined && options.startDateKey === undefined)) {
    return sortedTransactions(result.state.transactions);
  }
  if (options.startDateKey !== undefined || options.endDateKey !== undefined) {
    if (!parseLocalDateKey(options.startDateKey)
      || !parseLocalDateKey(options.endDateKey)
      || options.startDateKey > options.endDateKey) {
      throw new Error('统计时间段无效');
    }
    if (options.direction !== undefined
      && options.direction !== 'expense'
      && options.direction !== 'income') {
      throw new Error('收支筛选无效');
    }
    if (options.categoryId !== undefined && !isValidCategoryId(options.categoryId)) {
      throw new Error('分类筛选无效');
    }
    return sortedTransactions(allTransactions.filter((item) => {
      const dateKey = toDateKey(item.occurredAt);
      return dateKey >= options.startDateKey
        && dateKey <= options.endDateKey
        && (options.direction === undefined || item.direction === options.direction)
        && (options.categoryId === undefined || item.categoryId === options.categoryId);
    }));
  }
  if (!parseLocalDateKey(options.dateKey)) {
    throw new Error('历史日期无效');
  }
  return sortedTransactions(
    allTransactions.filter((item) => toDateKey(item.occurredAt) === options.dateKey)
  );
}

module.exports = { addTransaction, listTransactions };
