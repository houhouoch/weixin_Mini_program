const CATEGORIES = Object.freeze([
  Object.freeze({ id: 'food', label: '餐饮' }),
  Object.freeze({ id: 'transport', label: '交通' }),
  Object.freeze({ id: 'shopping', label: '购物' }),
  Object.freeze({ id: 'daily', label: '日用' }),
  Object.freeze({ id: 'entertainment', label: '娱乐' }),
  Object.freeze({ id: 'medical', label: '医疗' }),
  Object.freeze({ id: 'social', label: '人情' }),
  Object.freeze({ id: 'other', label: '其他' })
]);

const INCOME_CATEGORIES = Object.freeze([
  Object.freeze({ id: 'income_side_job', label: '外快' }),
  Object.freeze({ id: 'income_bonus', label: '奖金' }),
  Object.freeze({ id: 'income_salary', label: '工资' }),
  Object.freeze({ id: 'income_reimbursement', label: '报销' }),
  Object.freeze({ id: 'income_transfer', label: '转入' }),
  Object.freeze({ id: 'income_gift', label: '红包' }),
  Object.freeze({ id: 'income_refund', label: '退款' }),
  Object.freeze({ id: 'income_other', label: '其他收入' })
]);

const CATEGORY_MAP = CATEGORIES.concat(INCOME_CATEGORIES).reduce((map, category) => {
  map[category.id] = category;
  return map;
}, Object.create(null));

function isValidCategoryId(categoryId) {
  return typeof categoryId === 'string'
    && Object.prototype.hasOwnProperty.call(CATEGORY_MAP, categoryId);
}

function getCategoryLabel(categoryId) {
  return isValidCategoryId(categoryId) ? CATEGORY_MAP[categoryId].label : '其他';
}

function categoriesForDirection(direction) {
  return direction === 'income' ? INCOME_CATEGORIES : CATEGORIES;
}

module.exports = {
  CATEGORIES,
  INCOME_CATEGORIES,
  categoriesForDirection,
  getCategoryLabel,
  isValidCategoryId
};
