const { TRANSACTION_MAX_CENTS } = require('../domain/money');
const { categoriesForDirection } = require('../domain/categories');
const { readState, saveState } = require('./state-store');

const TEMPLATE_LIMIT = 8;

function validateTemplate(template) {
  const direction = template && template.direction;
  if (!template
    || typeof template.id !== 'string'
    || !/^[a-z0-9-]{1,100}$/.test(template.id)
    || (direction !== 'expense' && direction !== 'income')
    || !Number.isInteger(template.amountCents)
    || template.amountCents <= 0
    || template.amountCents > TRANSACTION_MAX_CENTS
    || !categoriesForDirection(direction).some((item) => item.id === template.categoryId)
    || typeof template.note !== 'string'
    || template.note.trim().length > 20) {
    throw new Error('常用模板内容无效');
  }
}

async function listQuickTemplates() {
  const result = await readState();
  return result.state ? result.state.quickTemplates.slice() : [];
}

async function saveQuickTemplate(template) {
  validateTemplate(template);
  const result = await readState();
  if (!result.state || !result.state.budget) throw new Error('请先完成预算设置');
  const existingIndex = result.state.quickTemplates.findIndex((item) => item.id === template.id);
  if (existingIndex < 0 && result.state.quickTemplates.length >= TEMPLATE_LIMIT) {
    throw new Error(`最多保存 ${TEMPLATE_LIMIT} 个常用模板`);
  }
  const saved = {
    id: template.id,
    direction: template.direction,
    categoryId: template.categoryId,
    note: template.note.trim(),
    amountCents: template.amountCents
  };
  const quickTemplates = result.state.quickTemplates.slice();
  if (existingIndex >= 0) quickTemplates[existingIndex] = saved;
  else quickTemplates.push(saved);
  await saveState(Object.assign({}, result.state, { quickTemplates }));
  return saved;
}

async function deleteQuickTemplate(templateId) {
  const result = await readState();
  if (!result.state) return false;
  const quickTemplates = result.state.quickTemplates
    .filter((item) => item.id !== templateId);
  if (quickTemplates.length === result.state.quickTemplates.length) return false;
  await saveState(Object.assign({}, result.state, { quickTemplates }));
  return true;
}

module.exports = {
  TEMPLATE_LIMIT,
  deleteQuickTemplate,
  listQuickTemplates,
  saveQuickTemplate
};
