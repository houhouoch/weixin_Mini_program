const { getCategoryLabel } = require('./categories');
const { TRANSACTION_MAX_CENTS, formatCents, parseYuanToCents } = require('./money');

const USD_REFERENCE_RATE = 7.1;
const CHINESE_DIGITS = Object.freeze({
  零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4,
  五: 5, 六: 6, 七: 7, 八: 8, 九: 9
});
const CHINESE_UNITS = Object.freeze({ 十: 10, 百: 100, 千: 1000, 万: 10000 });

const EXPENSE_RULES = Object.freeze([
  Object.freeze({ id: 'food', words: ['咖啡', '奶茶', '早餐', '午餐', '晚餐', '夜宵', '吃饭', '餐厅', '外卖', '买菜', '水果', '零食'] }),
  Object.freeze({ id: 'transport', words: ['地铁', '公交', '打车', '出租车', '滴滴', '高铁', '火车', '机票', '停车', '加油', '交通'] }),
  Object.freeze({ id: 'shopping', words: ['淘宝', '京东', '拼多多', '衣服', '鞋', '包', '购物'] }),
  Object.freeze({ id: 'daily', words: ['日用', '纸巾', '洗衣', '话费', '水费', '电费', '房租'] }),
  Object.freeze({ id: 'entertainment', words: ['电影', '游戏', '唱歌', '演出', '娱乐', '会员', '订阅', '充值', 'gpt', 'openai'] }),
  Object.freeze({ id: 'medical', words: ['医院', '看病', '药', '体检', '医疗'] }),
  Object.freeze({ id: 'social', words: ['红包', '礼物', '请客', '份子', '人情'] })
]);

const INCOME_RULES = Object.freeze([
  Object.freeze({ id: 'income_salary', words: ['工资', '薪水', '薪资'] }),
  Object.freeze({ id: 'income_bonus', words: ['奖金', '年终奖'] }),
  Object.freeze({ id: 'income_reimbursement', words: ['报销'] }),
  Object.freeze({ id: 'income_refund', words: ['退款', '退货'] }),
  Object.freeze({ id: 'income_gift', words: ['收到红包', '收红包'] }),
  Object.freeze({ id: 'income_side_job', words: ['外快', '兼职', '稿费'] }),
  Object.freeze({ id: 'income_transfer', words: ['转入', '到账'] })
]);

function parseChineseNumber(value) {
  const text = String(value || '');
  if (!text) return null;
  const parts = text.split('点');
  if (!/[十百千万]/.test(parts[0])) {
    const integerDigits = Array.from(parts[0]).map((char) => CHINESE_DIGITS[char]);
    if (integerDigits.some((item) => item === undefined)) return null;
    const integerText = integerDigits.join('');
    if (parts.length === 1) return Number(integerText);
    const decimalDigits = Array.from(parts[1]).map((char) => CHINESE_DIGITS[char]);
    if (decimalDigits.some((item) => item === undefined)) return null;
    return Number(`${integerText}.${decimalDigits.join('')}`);
  }
  let section = 0;
  let total = 0;
  let digit = 0;
  for (const char of parts[0]) {
    if (Object.prototype.hasOwnProperty.call(CHINESE_DIGITS, char)) {
      digit = CHINESE_DIGITS[char];
      continue;
    }
    const unit = CHINESE_UNITS[char];
    if (!unit) return null;
    if (unit === 10000) {
      section += digit;
      total += (section || 1) * unit;
      section = 0;
    } else {
      section += (digit || 1) * unit;
    }
    digit = 0;
  }
  total += section + digit;
  if (parts.length === 1) return total;
  const decimals = Array.from(parts[1]).map((char) => CHINESE_DIGITS[char]);
  if (decimals.some((item) => item === undefined)) return null;
  return Number(`${total}.${decimals.join('')}`);
}

function normalizeChineseNumbers(text) {
  return text.replace(/[零〇一二两三四五六七八九十百千万]+(?:点[零〇一二两三四五六七八九]+)?/g, (match) => {
    const value = parseChineseNumber(match);
    return value === null ? match : String(value);
  });
}

function normalizeInput(value) {
  const normalized = String(value == null ? '' : value)
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xFF10))
    .replace(/．/g, '.')
    .replace(/，/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
  return normalizeChineseNumbers(normalized);
}

function inferDirection(text) {
  return /(?:收入|工资|薪水|薪资|奖金|报销|退款|外快|兼职|稿费|转入|到账|收到红包|收红包)/.test(text)
    ? 'income'
    : 'expense';
}

function inferCategory(text, direction) {
  const normalized = text.toLowerCase();
  const rules = direction === 'income' ? INCOME_RULES : EXPENSE_RULES;
  const match = rules.find((rule) => rule.words.some((word) => normalized.includes(word)));
  return match ? match.id : direction === 'income' ? 'income_other' : 'other';
}

function inferTime(text) {
  const match = text.match(/(?:今天)?(?:早上|上午|中午|下午|晚上)?\s*(\d{1,2})(?::|点|时)(\d{1,2})?分?/);
  if (!match) return '';
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  if (/下午|晚上/.test(match[0]) && hour < 12) hour += 12;
  if (hour > 23 || minute > 59) return '';
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function amountCandidate(text) {
  const patterns = [
    /(\d+(?:\.\d{1,2})?)\s*(?:美元|美金|刀)/i,
    /(?:花了|花费|消费|支付|用了|收入|收到|到账|进账|充值)[^\d]{0,16}(\d+(?:\.\d{1,2})?)/i,
    /(\d+(?:\.\d{1,2})?)\s*(?:元|块钱|块)/i,
    /(\d+(?:\.\d{1,2})?)(?!\s*(?:点|时|分|:))\s*$/
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) return { amountText: match[1], matchText: match[1] };
  }
  return null;
}

function inferNote(text, candidate, direction, categoryId) {
  const filler = direction === 'income'
    ? /(?:今天|刚刚|早上|上午|中午|下午|晚上|的时候|收入|收到|收了|进账|到账|一笔|人民币|元|块钱|块)/gi
    : /(?:今天|刚刚|早上|上午|中午|下午|晚上|的时候|花了|花费|消费|支出|支付|用了|买了|一笔|人民币|元|块钱|块|在|于)/gi;
  const note = text
    .replace(candidate.matchText, ' ')
    .replace(/\d{1,2}(?::|点|时)\d{0,2}分?/g, ' ')
    .replace(/(?:美元|美金|刀)/gi, ' ')
    .replace(filler, ' ')
    .replace(/[，,。；;：:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (/gpt|openai/i.test(note)) return 'GPT 充值';
  if (categoryId === 'food' && note.includes('早餐')) return '早餐';
  return (note || getCategoryLabel(categoryId)).slice(0, 20);
}

function parseSegment(segment) {
  const candidate = amountCandidate(segment);
  if (!candidate) return null;
  const amountPosition = segment.indexOf(candidate.amountText);
  const isUsd = /(?:美元|美金|刀)/i.test(segment.slice(
    Math.max(0, amountPosition - 8),
    amountPosition + candidate.amountText.length + 10
  ));
  const parsedAmount = parseYuanToCents(candidate.amountText, {
    allowZero: false,
    maxCents: TRANSACTION_MAX_CENTS
  });
  if (!parsedAmount.ok) return { ok: false, error: parsedAmount.error };
  const amountCents = isUsd
    ? Math.round(parsedAmount.value * USD_REFERENCE_RATE)
    : parsedAmount.value;
  if (amountCents > TRANSACTION_MAX_CENTS) {
    return { ok: false, error: '单笔金额超过上限' };
  }
  const direction = inferDirection(segment);
  const categoryId = inferCategory(segment, direction);
  return {
    ok: true,
    value: {
      amountCents,
      amountText: formatCents(amountCents),
      categoryId,
      categoryLabel: getCategoryLabel(categoryId),
      direction,
      directionLabel: direction === 'income' ? '收入' : '支出',
      note: inferNote(segment, candidate, direction, categoryId),
      sourceAmountText: isUsd ? `$${formatCents(parsedAmount.value)}` : '',
      sourceCurrency: isUsd ? 'USD' : 'CNY',
      referenceRate: isUsd ? USD_REFERENCE_RATE : null,
      sourceText: segment,
      timeText: inferTime(segment)
    }
  };
}

function splitSegments(text) {
  return text
    .split(/(?:。|；|;|然后|接着|之后|另外|还有|同时|再去|再花)/)
    .flatMap((item) => {
      const chunk = item.trim();
      if (!chunk) return [];
      const commaParts = chunk.split(/[，,]/).map((part) => part.trim()).filter(Boolean);
      return commaParts.length > 1 && commaParts.every((part) => amountCandidate(part))
        ? commaParts
        : [chunk];
    });
}

function parseQuickEntries(value) {
  const text = normalizeInput(value);
  if (!text) return { ok: false, error: '请输入内容，例如“咖啡 20”' };
  const parsed = [];
  let firstError = '';
  splitSegments(text).forEach((segment) => {
    const result = parseSegment(segment);
    if (result && result.ok) parsed.push(result.value);
    else if (result && !firstError) firstError = result.error;
  });
  if (!parsed.length) {
    return { ok: false, error: firstError || '没有识别到金额，请输入“用途 + 金额”' };
  }
  return { ok: true, value: parsed, sourceText: text };
}

function parseQuickEntry(value) {
  const result = parseQuickEntries(value);
  if (!result.ok) return result;
  return { ok: true, value: result.value[0] };
}

module.exports = {
  USD_REFERENCE_RATE,
  normalizeInput,
  parseChineseNumber,
  parseQuickEntries,
  parseQuickEntry
};
