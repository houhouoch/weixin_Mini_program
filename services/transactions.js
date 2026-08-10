const { TRANSACTION_MAX_CENTS } = require('../domain/money');
const { categoriesForDirection, isValidCategoryId } = require('../domain/categories');
const { parseLocalDateKey, toDateKey, toMonthKey } = require('../domain/date');
const { readState, saveState } = require('./state-store');

const NOTE_MAX_LENGTH = 20;
const IMPORT_MAX_RECORDS = 5000;

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
  const next = transactionFromCommand(command);
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

function importTransactions(state, records) {
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
      occurredAt: record.occurredAt
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
    importResult = importTransactions(state, command.transactions);
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
    skippedCount: importResult.skippedCount
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
  if (options && options.all === true) return sortedTransactions(allTransactions);
  if (!options || options.dateKey === undefined) {
    return sortedTransactions(result.state.transactions);
  }
  if (!parseLocalDateKey(options.dateKey)) {
    throw new Error('历史日期无效');
  }
  return sortedTransactions(
    allTransactions.filter((item) => toDateKey(item.occurredAt) === options.dateKey)
  );
}

module.exports = { addTransaction, listTransactions };
