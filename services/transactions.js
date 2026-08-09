const { TRANSACTION_MAX_CENTS } = require('../domain/money');
const { isValidCategoryId } = require('../domain/categories');
const { parseLocalDateKey, toDateKey, toMonthKey } = require('../domain/date');
const { readState, saveState } = require('./state-store');

const NOTE_MAX_LENGTH = 20;

let mutationQueue = Promise.resolve();

function sortedTransactions(transactions) {
  return transactions.slice().sort((a, b) => b.occurredAt - a.occurredAt);
}

function assertTransactionFields(command) {
  if (!Number.isInteger(command.amountCents)
    || command.amountCents <= 0
    || command.amountCents > TRANSACTION_MAX_CENTS) {
    throw new Error('交易金额无效');
  }
  if (!Number.isFinite(command.occurredAt)) {
    throw new Error('交易时间无效');
  }
  if (!isValidCategoryId(command.categoryId)) {
    throw new Error('请选择消费分类');
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

async function executeCommand(command) {
  assertCommand(command);
  const result = await readState();
  if (!result.state || (command.action === 'create' && !result.state.budget)) {
    throw new Error('请先完成本月设置');
  }
  let state = result.state;
  if (state.processedCommandIds.indexOf(command.commandId) >= 0) {
    return { duplicate: true, transactions: sortedTransactions(state.transactions) };
  }

  if (command.action === 'create') {
    state = Object.assign({}, state, {
      transactions: state.transactions.concat(transactionFromCommand(command))
    });
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
  return { duplicate: false, transactions: sortedTransactions(state.transactions) };
}

function addTransaction(command) {
  const run = () => executeCommand(command);
  mutationQueue = mutationQueue.then(run, run);
  return mutationQueue;
}

async function listTransactions(options) {
  const result = await readState();
  if (!result.state) return [];
  if (!options || options.dateKey === undefined) {
    return sortedTransactions(result.state.transactions);
  }
  if (!parseLocalDateKey(options.dateKey)) {
    throw new Error('历史日期无效');
  }
  const allTransactions = result.state.history.reduce(
    (all, item) => all.concat(item.transactions),
    result.state.transactions.slice()
  );
  return sortedTransactions(
    allTransactions.filter((item) => toDateKey(item.occurredAt) === options.dateKey)
  );
}

module.exports = { addTransaction, listTransactions };
