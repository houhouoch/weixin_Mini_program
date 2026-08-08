const { TRANSACTION_MAX_CENTS } = require('../domain/money');
const { readState, saveState } = require('./state-store');

let mutationQueue = Promise.resolve();

function sortedTransactions(transactions) {
  return transactions.slice().sort((a, b) => b.occurredAt - a.occurredAt);
}

function assertCommand(command) {
  if (!command || typeof command.commandId !== 'string' || !command.commandId) {
    throw new Error('交易命令缺少唯一标识');
  }
  if (command.action === 'create') {
    if (!Number.isInteger(command.amountCents)
      || command.amountCents <= 0
      || command.amountCents > TRANSACTION_MAX_CENTS) {
      throw new Error('交易金额无效');
    }
    if (!Number.isFinite(command.occurredAt)) {
      throw new Error('交易时间无效');
    }
    return;
  }
  if (command.action === 'delete') {
    if (typeof command.transactionId !== 'string' || !command.transactionId) {
      throw new Error('待删除交易无效');
    }
    return;
  }
  throw new Error('未知交易命令');
}

async function executeCommand(command) {
  assertCommand(command);
  const result = await readState();
  if (!result.state) {
    throw new Error('请先完成本月设置');
  }
  const state = result.state;
  if (state.processedCommandIds.indexOf(command.commandId) >= 0) {
    return { duplicate: true, transactions: sortedTransactions(state.transactions) };
  }

  let transactions = state.transactions.slice();
  if (command.action === 'create') {
    transactions.push({
      id: command.transactionId || command.commandId,
      amountCents: command.amountCents,
      occurredAt: command.occurredAt
    });
  } else {
    transactions = transactions.filter((item) => item.id !== command.transactionId);
  }

  const processedCommandIds = state.processedCommandIds
    .concat(command.commandId)
    .slice(-100);
  await saveState(Object.assign({}, state, { transactions, processedCommandIds }));
  return { duplicate: false, transactions: sortedTransactions(transactions) };
}

function addTransaction(command) {
  const run = () => executeCommand(command);
  mutationQueue = mutationQueue.then(run, run);
  return mutationQueue;
}

async function listTransactions() {
  const result = await readState();
  if (!result.state) return [];
  return sortedTransactions(result.state.transactions);
}

module.exports = { addTransaction, listTransactions };
