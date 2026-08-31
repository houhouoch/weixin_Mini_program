const { getCategoryLabel } = require('./categories');
const { TRANSACTION_MAX_CENTS, formatCents, parseYuanToCents } = require('./money');

const EXPENSE_RULES = Object.freeze([
  Object.freeze({ id: 'food', words: ['咖啡', '奶茶', '早餐', '午餐', '晚餐', '夜宵', '吃饭', '餐厅', '外卖', '买菜', '水果', '零食'] }),
  Object.freeze({ id: 'transport', words: ['地铁', '公交', '打车', '出租车', '滴滴', '高铁', '火车', '机票', '停车', '加油', '交通'] }),
  Object.freeze({ id: 'shopping', words: ['淘宝', '京东', '拼多多', '衣服', '鞋', '包', '购物'] }),
  Object.freeze({ id: 'daily', words: ['日用', '纸巾', '洗衣', '话费', '水费', '电费', '房租'] }),
  Object.freeze({ id: 'entertainment', words: ['电影', '游戏', '唱歌', '演出', '娱乐', '会员'] }),
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

function normalizeInput(value) {
  return String(value == null ? '' : value)
    .replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xFF10))
    .replace(/．/g, '.')
    .replace(/，/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

function inferDirection(text) {
  return /(?:收入|工资|薪水|薪资|奖金|报销|退款|外快|兼职|稿费|转入|到账|收到红包|收红包)/.test(text)
    ? 'income'
    : 'expense';
}

function inferCategory(text, direction) {
  const rules = direction === 'income' ? INCOME_RULES : EXPENSE_RULES;
  const match = rules.find((rule) => rule.words.some((word) => text.includes(word)));
  return match ? match.id : direction === 'income' ? 'income_other' : 'other';
}

function inferNote(text, amountText, direction, categoryId) {
  const escapedAmount = amountText.replace('.', '\\.');
  const filler = direction === 'income'
    ? /(?:今天|刚刚|收入|收到|收了|进账|到账|一笔|人民币|元|块钱|块)/g
    : /(?:今天|刚刚|花了|花费|消费|支出|支付|用了|买了|一笔|人民币|元|块钱|块|在)/g;
  const note = text
    .replace(new RegExp(escapedAmount), ' ')
    .replace(filler, ' ')
    .replace(/[，,。；;：:]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return (note || getCategoryLabel(categoryId)).slice(0, 20);
}

function parseQuickEntry(value) {
  const text = normalizeInput(value);
  if (!text) return { ok: false, error: '请输入内容，例如“咖啡 20”' };

  const amountMatch = text.match(/\d+(?:\.\d{1,2})?/);
  if (!amountMatch) return { ok: false, error: '没有识别到金额，请输入“用途 + 金额”' };

  const parsedAmount = parseYuanToCents(amountMatch[0], {
    allowZero: false,
    maxCents: TRANSACTION_MAX_CENTS
  });
  if (!parsedAmount.ok) return parsedAmount;

  const direction = inferDirection(text);
  const categoryId = inferCategory(text, direction);
  return {
    ok: true,
    value: {
      amountCents: parsedAmount.value,
      amountText: formatCents(parsedAmount.value),
      categoryId,
      categoryLabel: getCategoryLabel(categoryId),
      direction,
      directionLabel: direction === 'income' ? '收入' : '支出',
      note: inferNote(text, amountMatch[0], direction, categoryId),
      sourceText: text
    }
  };
}

module.exports = {
  parseQuickEntry
};
