const { getCategoryLabel } = require('./categories');
const { daysInMonth, parseLocalDateKey, toDateKey, toMonthKey } = require('./date');
const { formatCents } = require('./money');

const PERIODS = Object.freeze(['day', 'month', 'year', 'custom']);

function asDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function startOfDay(value) {
  const date = asDate(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(value, amount) {
  const date = startOfDay(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount);
}

function calendarDayDistance(start, end) {
  const startUtc = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
  const endUtc = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
  return Math.round((endUtc - startUtc) / 86400000);
}

function compactDateLabel(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function chineseDateLabel(date) {
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

function sumAmounts(records) {
  return records.reduce((total, item) => total + item.amountCents, 0);
}

function formatMetric(cents) {
  const text = formatCents(cents);
  return `¥${text.endsWith('.00') ? text.slice(0, -3) : text}`;
}

function metric(label, value) {
  return { label, value };
}

function withBarPercent(items) {
  const max = Math.max(0, ...items.map((item) => item.amountCents));
  return items.map((item) => Object.assign({}, item, {
    percent: item.amountCents <= 0 || max <= 0
      ? 0
      : Math.max(10, Math.round(item.amountCents * 100 / max)),
    amountText: formatMetric(item.amountCents),
    accessibilityLabel: `${item.fullLabel || item.label}消费${formatMetric(item.amountCents)}`
  }));
}

function monthSource(state, monthKey) {
  if (state.monthKey === monthKey && state.budget) {
    return {
      baselineCents: state.budget.historicalSpentBeforeTrackingCents,
      monthKey,
      tracked: true,
      transactions: state.transactions.filter((item) => item.direction !== 'income')
    };
  }
  const archived = (state.history || []).find((item) => item.monthKey === monthKey);
  if (!archived) {
    return { baselineCents: 0, monthKey, tracked: false, transactions: [] };
  }
  return {
    baselineCents: archived.historicalSpentBeforeTrackingCents,
    monthKey,
    tracked: true,
    transactions: archived.transactions.filter((item) => item.direction !== 'income')
  };
}

function allActualTransactions(state) {
  const archived = (state.history || []).reduce(
    (all, item) => all.concat(item.transactions),
    []
  );
  return archived.concat(state.transactions || [])
    .filter((item) => item.direction !== 'income');
}

function topCategory(records) {
  const totals = Object.create(null);
  records.forEach((item) => {
    totals[item.categoryId] = (totals[item.categoryId] || 0) + item.amountCents;
  });
  const entries = Object.keys(totals).map((categoryId) => ({
    categoryId,
    amountCents: totals[categoryId]
  })).sort((a, b) => b.amountCents - a.amountCents);
  return entries[0] || null;
}

function categoryBreakdown(records) {
  const total = sumAmounts(records);
  const grouped = Object.create(null);
  records.forEach((item) => {
    const current = grouped[item.categoryId] || { amountCents: 0, count: 0 };
    current.amountCents += item.amountCents;
    current.count += 1;
    grouped[item.categoryId] = current;
  });
  return Object.keys(grouped).map((categoryId) => ({
    categoryId,
    categoryLabel: getCategoryLabel(categoryId),
    amountCents: grouped[categoryId].amountCents,
    amountText: formatMetric(grouped[categoryId].amountCents),
    count: grouped[categoryId].count,
    percent: total > 0 ? Math.round(grouped[categoryId].amountCents * 100 / total) : 0
  })).sort((a, b) => b.amountCents - a.amountCents);
}

function summaryShell(period, metrics, chart, insightText, scopeText) {
  return { period, metrics, chart: withBarPercent(chart), insightText, scopeText };
}

function deriveDaySummary(state, now) {
  const all = allActualTransactions(state);
  const dates = [0, -1, -2].map((offset) => addDays(now, offset));
  const labels = ['今天', '昨天', '前天'];
  const metrics = dates.map((date, index) => {
    const key = toDateKey(date);
    const cents = sumAmounts(all.filter((item) => toDateKey(item.occurredAt) === key));
    return metric(labels[index], formatMetric(cents));
  });

  const chartDates = Array.from({ length: 7 }, (_, index) => addDays(now, index - 6));
  const chart = chartDates.map((date, index) => {
    const key = toDateKey(date);
    return {
      label: index === 6 ? '今' : String(date.getDate()),
      fullLabel: `${date.getMonth() + 1}月${date.getDate()}日`,
      amountCents: sumAmounts(all.filter((item) => toDateKey(item.occurredAt) === key))
    };
  });
  const keys = new Set(chartDates.map(toDateKey));
  const top = topCategory(all.filter((item) => keys.has(toDateKey(item.occurredAt))));
  const current = monthSource(state, toMonthKey(now));
  const insight = top
    ? `本周花得最多：${getCategoryLabel(top.categoryId)} ${formatMetric(top.amountCents)}`
    : '本周还没有分类消费';
  const scope = current.baselineCents > 0
    ? `趋势不含启用前汇总 ${formatMetric(current.baselineCents)}`
    : '趋势仅统计真实逐笔记录';
  return summaryShell('day', metrics, chart, insight, scope);
}

function deriveMonthSummary(state, now) {
  const monthKey = toMonthKey(now);
  const source = monthSource(state, monthKey);
  const actualTotal = sumAmounts(source.transactions);
  const total = source.baselineCents + actualTotal;
  const elapsedDays = state.monthKey === monthKey
    ? now.getDate()
    : daysInMonth(new Date(`${monthKey}-01T00:00:00`));
  const dayTotals = Object.create(null);
  source.transactions.forEach((item) => {
    const day = asDate(item.occurredAt).getDate();
    dayTotals[day] = (dayTotals[day] || 0) + item.amountCents;
  });
  const highest = Object.keys(dayTotals)
    .map((day) => ({ day: Number(day), amountCents: dayTotals[day] }))
    .sort((a, b) => b.amountCents - a.amountCents)[0];
  const metrics = [
    metric('本月', formatMetric(total)),
    metric('日均', formatMetric(Math.floor(total / Math.max(elapsedDays, 1)))),
    metric(highest ? `最高 ${highest.day}日` : '最高日', highest ? formatMetric(highest.amountCents) : '--')
  ];
  const weekTotals = [0, 0, 0, 0, 0];
  source.transactions.forEach((item) => {
    const bucket = Math.min(4, Math.floor((asDate(item.occurredAt).getDate() - 1) / 7));
    weekTotals[bucket] += item.amountCents;
  });
  const chart = weekTotals.map((amountCents, index) => ({
    label: `${index + 1}周`,
    fullLabel: `第${index + 1}周`,
    amountCents
  }));
  const top = topCategory(source.transactions);
  const insight = top
    ? `本月花得最多：${getCategoryLabel(top.categoryId)} ${formatMetric(top.amountCents)}`
    : '本月还没有分类消费';
  const scope = source.baselineCents > 0
    ? `本月总额含启用前汇总 ${formatMetric(source.baselineCents)}，趋势不含该汇总`
    : '本月总额与趋势均来自真实逐笔记录';
  return summaryShell('month', metrics, chart, insight, scope);
}

function deriveYearSummary(state, now) {
  const year = now.getFullYear();
  const months = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, '0')}`;
    const source = monthSource(state, key);
    return Object.assign(source, {
      month: index + 1,
      actualCents: sumAmounts(source.transactions),
      totalCents: source.baselineCents + sumAmounts(source.transactions)
    });
  });
  const tracked = months.filter((item) => item.tracked);
  const total = months.reduce((sum, item) => sum + item.totalCents, 0);
  const actualTotal = months.reduce((sum, item) => sum + item.actualCents, 0);
  const highest = tracked.slice().sort((a, b) => b.actualCents - a.actualCents)[0];
  const metrics = [
    metric('今年', formatMetric(total)),
    metric('月均', formatMetric(Math.floor(actualTotal / Math.max(tracked.length, 1)))),
    metric(highest ? `最高 ${highest.month}月` : '最高月', highest ? formatMetric(highest.actualCents) : '--')
  ];
  const yearTransactions = months.reduce((all, item) => all.concat(item.transactions), []);
  const top = topCategory(yearTransactions);
  const insight = top
    ? `今年花得最多：${getCategoryLabel(top.categoryId)} ${formatMetric(top.amountCents)}`
    : '今年还没有分类消费';
  const earliest = tracked[0];
  const hasBaseline = tracked.some((item) => item.baselineCents > 0);
  const scope = earliest
    ? `数据从 ${year}年${earliest.month}月开始${hasBaseline ? ' · 启用前汇总仅计入总额' : ' · 仅使用真实本地记录'}`
    : '还没有可用于年度回看的真实记录';
  const chart = months.map((item) => ({
    label: String(item.month),
    fullLabel: `${year}年${item.month}月`,
    amountCents: item.actualCents
  }));
  return summaryShell('year', metrics, chart, insight, scope);
}

function deriveCustomSummary(state, now, range) {
  const start = parseLocalDateKey(range && range.startDateKey);
  const end = parseLocalDateKey(range && range.endDateKey);
  if (!start || !end || start > end || end > now) {
    throw new Error('统计时间段无效');
  }

  const totalDays = calendarDayDistance(start, end) + 1;
  const startKey = toDateKey(start);
  const endKey = toDateKey(end);
  const records = allActualTransactions(state).filter((item) => {
    const dateKey = toDateKey(item.occurredAt);
    return dateKey >= startKey && dateKey <= endKey;
  });
  const total = sumAmounts(records);
  const bucketCount = Math.min(7, totalDays);
  const chart = Array.from({ length: bucketCount }, (_, index) => {
    const startOffset = Math.floor(index * totalDays / bucketCount);
    const endOffset = Math.floor((index + 1) * totalDays / bucketCount) - 1;
    const bucketStart = addDays(start, startOffset);
    const bucketEnd = addDays(start, endOffset);
    return {
      label: compactDateLabel(bucketStart),
      fullLabel: startOffset === endOffset
        ? chineseDateLabel(bucketStart)
        : `${chineseDateLabel(bucketStart)}至${chineseDateLabel(bucketEnd)}`,
      amountCents: 0
    };
  });
  records.forEach((item) => {
    const occurred = parseLocalDateKey(toDateKey(item.occurredAt));
    const offset = calendarDayDistance(start, occurred);
    const bucket = Math.min(bucketCount - 1, Math.floor(offset * bucketCount / totalDays));
    chart[bucket].amountCents += item.amountCents;
  });

  const metrics = [
    metric('区间支出', formatMetric(total)),
    metric('日均', formatMetric(Math.floor(total / totalDays))),
    metric('支出笔数', `${records.length}笔`)
  ];
  const top = topCategory(records);
  const insight = top
    ? `区间花得最多：${getCategoryLabel(top.categoryId)} ${formatMetric(top.amountCents)}`
    : '该时间段没有支出记录';
  const scope = `${chineseDateLabel(start)} 至 ${chineseDateLabel(end)} · 共${totalDays}天 · 不含收入和启用前汇总`;
  return Object.assign(summaryShell('custom', metrics, chart, insight, scope), {
    categoryBreakdown: categoryBreakdown(records),
    recordCount: records.length
  });
}

function deriveSpendingSummary(state, period, value, range) {
  if (!state || PERIODS.indexOf(period) < 0) {
    throw new Error('消费回看参数无效');
  }
  const now = startOfDay(value || new Date());
  if (period === 'custom') return deriveCustomSummary(state, now, range);
  if (period === 'month') return deriveMonthSummary(state, now);
  if (period === 'year') return deriveYearSummary(state, now);
  return deriveDaySummary(state, now);
}

module.exports = { PERIODS, deriveSpendingSummary };
