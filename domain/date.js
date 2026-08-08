function pad2(value) {
  return String(value).padStart(2, '0');
}

function asDate(value) {
  return value instanceof Date ? value : new Date(value);
}

function toDateKey(value) {
  const date = asDate(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toMonthKey(value) {
  const date = asDate(value);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function daysInMonth(value) {
  const date = asDate(value);
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
}

function daysRemainingIncludingToday(value) {
  const date = asDate(value);
  return Math.max(daysInMonth(date) - date.getDate() + 1, 1);
}

function parseLocalDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey || '');
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return toDateKey(date) === dateKey ? date : null;
}

function daysSince(startDateKey, value) {
  const start = parseLocalDateKey(startDateKey);
  const end = asDate(value);
  if (!start) return 1;
  const normalizedEnd = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  const difference = Math.floor((normalizedEnd.getTime() - start.getTime()) / 86400000);
  return Math.max(difference + 1, 1);
}

function formatChineseDate(value) {
  const date = asDate(value);
  const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()];
  return `${date.getMonth() + 1}月${date.getDate()}日 · 周${week}`;
}

function formatRecordTime(timestamp, now) {
  const date = asDate(timestamp);
  const today = asDate(now || Date.now());
  const prefix = toDateKey(date) === toDateKey(today)
    ? '今天'
    : `${date.getMonth() + 1}月${date.getDate()}日`;
  return `${prefix} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

module.exports = {
  daysInMonth,
  daysRemainingIncludingToday,
  daysSince,
  formatChineseDate,
  formatRecordTime,
  parseLocalDateKey,
  toDateKey,
  toMonthKey
};
