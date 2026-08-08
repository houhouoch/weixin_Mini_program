const TRANSACTION_MAX_CENTS = 99999999;
const BUDGET_FIELD_MAX_CENTS = 999999999;

function parseYuanToCents(value, options) {
  const config = options || {};
  const allowZero = config.allowZero !== false;
  const maxCents = Number.isInteger(config.maxCents)
    ? config.maxCents
    : BUDGET_FIELD_MAX_CENTS;
  const text = String(value == null ? '' : value).trim();

  if (!text) {
    return { ok: false, error: '请输入金额' };
  }
  if (!/^\d+(?:\.\d{1,2})?$/.test(text)) {
    return { ok: false, error: '请输入正确金额，最多两位小数' };
  }

  const parts = text.split('.');
  const yuan = Number(parts[0]);
  const fraction = (parts[1] || '').padEnd(2, '0');
  const cents = yuan * 100 + Number(fraction || 0);

  if (!Number.isSafeInteger(cents)) {
    return { ok: false, error: '金额过大，请重新输入' };
  }
  if (!allowZero && cents === 0) {
    return { ok: false, error: '金额必须大于 0' };
  }
  if (cents > maxCents) {
    return { ok: false, error: '金额超过允许上限' };
  }
  return { ok: true, value: cents };
}

function formatCents(cents) {
  const value = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const sign = value < 0 ? '-' : '';
  const absolute = Math.abs(value);
  const yuan = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${sign}${yuan}.${fraction}`;
}

function centsToInput(cents) {
  if (!Number.isInteger(cents)) return '';
  return formatCents(cents);
}

module.exports = {
  BUDGET_FIELD_MAX_CENTS,
  TRANSACTION_MAX_CENTS,
  centsToInput,
  formatCents,
  parseYuanToCents
};
