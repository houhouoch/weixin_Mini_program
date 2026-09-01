const { categoriesForDirection, getCategoryLabel } = require('./categories');
const { TRANSACTION_MAX_CENTS, formatCents, parseYuanToCents } = require('./money');
const { USD_REFERENCE_RATE } = require('./quick-entry');

function categoryForEntry(categoryId, direction) {
  const categories = categoriesForDirection(direction);
  return categories.some((category) => category.id === categoryId)
    ? categoryId
    : direction === 'income' ? 'income_other' : 'other';
}

function normalizeTime(value) {
  const text = String(value || '').trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(text)) return '';
  return text;
}

function normalizeAiEntries(entries) {
  if (!Array.isArray(entries) || !entries.length || entries.length > 10) {
    return { ok: false, error: 'AI 没有整理出可确认的账单' };
  }
  const normalized = [];
  for (const item of entries) {
    const direction = item && item.direction === 'income' ? 'income' : 'expense';
    const currency = item && item.currency === 'USD' ? 'USD' : 'CNY';
    const parsed = parseYuanToCents(String(item && item.amount == null ? '' : item.amount), {
      allowZero: false,
      maxCents: TRANSACTION_MAX_CENTS
    });
    if (!parsed.ok) return { ok: false, error: 'AI 返回的金额需要手动确认' };
    const amountCents = currency === 'USD'
      ? Math.round(parsed.value * USD_REFERENCE_RATE)
      : parsed.value;
    if (amountCents > TRANSACTION_MAX_CENTS) {
      return { ok: false, error: 'AI 返回的单笔金额超过上限' };
    }
    const categoryId = categoryForEntry(item.categoryId, direction);
    const sourceAmountText = currency === 'USD' ? `$${formatCents(parsed.value)}` : '';
    normalized.push({
      amountCents,
      amountText: formatCents(amountCents),
      categoryId,
      categoryLabel: getCategoryLabel(categoryId),
      direction,
      directionLabel: direction === 'income' ? '收入' : '支出',
      note: String(item.note || getCategoryLabel(categoryId)).trim().slice(0, 20),
      referenceRate: currency === 'USD' ? USD_REFERENCE_RATE : null,
      sourceAmountText,
      sourceCurrency: currency,
      sourceText: '',
      timeText: normalizeTime(item.time)
    });
  }
  return { ok: true, value: normalized };
}

module.exports = {
  normalizeAiEntries
};
