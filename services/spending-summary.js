const { deriveSpendingSummary } = require('../domain/spending-summary');
const { readState } = require('./state-store');

async function getSpendingSummary(period, now, range) {
  const result = await readState();
  if (!result.state) throw new Error('暂无可回看的本地数据');
  return deriveSpendingSummary(result.state, period, now || new Date(), range);
}

module.exports = { getSpendingSummary };
