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

const CATEGORY_MAP = CATEGORIES.reduce((map, category) => {
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

module.exports = {
  CATEGORIES,
  getCategoryLabel,
  isValidCategoryId
};
