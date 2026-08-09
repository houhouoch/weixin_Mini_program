const ALLOWED_EVENTS = [
  'app_open',
  'transaction_saved',
  'result_viewed',
  'share_friend',
  'share_timeline_guide',
  'share_entry_open',
  'ledger_export'
];
const FORBIDDEN_KEY = /amount|price|income|expense|saving|openid|unionid|name|avatar|phone/i;

function sanitizePayload(payload) {
  const safe = {};
  Object.keys(payload || {}).forEach((key) => {
    const value = payload[key];
    if (FORBIDDEN_KEY.test(key)) return;
    if (['string', 'number', 'boolean'].indexOf(typeof value) >= 0) {
      safe[key] = value;
    }
  });
  return safe;
}

function trackEvent(name, payload) {
  if (ALLOWED_EVENTS.indexOf(name) < 0) return Promise.resolve(false);
  const safePayload = sanitizePayload(payload);
  if (typeof console !== 'undefined' && typeof console.info === 'function') {
    console.info('[trackEvent]', name, safePayload);
  }
  return Promise.resolve(true);
}

module.exports = { trackEvent };
