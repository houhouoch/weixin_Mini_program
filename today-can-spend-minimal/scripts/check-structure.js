const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const failures = [];

function check(condition, message) {
  if (condition) console.log(`PASS ${message}`);
  else failures.push(message);
}

function source(file) {
  return fs.readFileSync(path.join(root, file), 'utf8');
}

function totalBytes(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return stat.size;
  return fs.readdirSync(target)
    .reduce((sum, name) => sum + totalBytes(path.join(target, name)), 0);
}

const required = [
  'AGENTS.md',
  'Agent.md',
  'README.md',
  'docs/PRD.md',
  'docs/FUNCTION_PARITY.md',
  'specs/001-minimal-rebuild/spec.md',
  'specs/001-minimal-rebuild/plan.md',
  'specs/001-minimal-rebuild/tasks.md',
  'specs/001-minimal-rebuild/acceptance.md',
  'app.js',
  'app.json',
  'app.wxss',
  'project.config.json',
  'sitemap.json',
  'pages/index/index.js',
  'pages/index/index.json',
  'pages/index/index.wxml',
  'pages/index/index.wxss',
  'domain/budget.js',
  'domain/categories.js',
  'domain/date.js',
  'domain/money.js',
  'domain/spending-summary.js',
  'domain/ledger-workbook.js',
  'domain/wechat-bill.js',
  'domain/alipay-bill.js',
  'domain/gb18030.js',
  'domain/theme.js',
  'infrastructure/storage.js',
  'infrastructure/file-system.js',
  'services/budget-store.js',
  'services/transactions.js',
  'services/spending-summary.js',
  'services/wechat-bill-import.js',
  'services/ledger-export.js',
  'services/data-backup.js',
  'services/theme-store.js',
  'services/quick-templates.js',
  'services/analytics.js'
];

required.forEach((file) => check(fs.existsSync(path.join(root, file)), `存在 ${file}`));

const runtimeEntries = [
  'app.js', 'app.json', 'app.wxss', 'sitemap.json',
  'assets', 'domain', 'infrastructure', 'pages', 'services'
];
const mainPackageBytes = runtimeEntries
  .reduce((sum, entry) => sum + totalBytes(path.join(root, entry)), 0);
check(mainPackageBytes < 1.5 * 1024 * 1024, '运行主包原始文件小于 1.5 MB');

const projectConfig = JSON.parse(source('project.config.json'));
check(projectConfig.projectname === 'today-can-spend-minimal', '项目名明确区分独立简约版');
check(projectConfig.appid === 'touristappid', '仓库配置不固化用户正式 AppID');
const ignoredFolders = new Set((projectConfig.packOptions.ignore || [])
  .filter((item) => item.type === 'folder')
  .map((item) => item.value));
check(['design-system', 'docs', 'scripts', 'specs', 'tests']
  .every((folder) => ignoredFolders.has(folder)), '设计、文档、脚本、规格和测试不进入主包');

const appConfig = JSON.parse(source('app.json'));
check(Array.isArray(appConfig.pages) && appConfig.pages.length === 1, '仅注册一个页面');
check(!Object.prototype.hasOwnProperty.call(appConfig, 'tabBar'), '未配置 tabBar');
check(appConfig.window.navigationBarTitleText === '', '原生导航栏不重复渲染产品标题');
check(appConfig.window.backgroundColor === '#F5F5F7', '应用使用中性浅灰背景');

const storage = source('infrastructure/storage.js');
check(storage.includes("today-can-spend:minimal:v1"), '简约版使用独立业务数据 key');
check(storage.includes("today-can-spend:minimal:theme:v1"), '简约版使用独立主题 key');
check(!storage.includes("const STORAGE_KEY = 'today-can-spend:v1'"), '不覆盖完整版业务数据 key');

const pageJs = source('pages/index/index.js');
check(!/wx\.(get|set|remove|clear)Storage/.test(pageJs), '页面层不直接访问微信缓存');
check(!pageJs.includes('wx.getFileSystemManager'), '页面层不直接访问文件系统管理器');
check(/sections:\s*\{\s*composer:\s*true,\s*history:\s*false,\s*review:\s*false/.test(pageJs), '快速记账默认展开，回看和账本默认收起');
check(pageJs.includes('composerDetailsOpen: false'), '分类、用途和模板管理默认收起');
check(pageJs.includes('isBackupPreviewLoading: false'), '备份文件读取有独立加载状态');
check(pageJs.includes('transactions: transactions.map((item) => toTransactionView(item, now))'), '首页最近记录使用可展示的交易视图模型');
check(pageJs.includes('wx.showShareMenu'), '开启微信好友和朋友圈分享菜单');
check(pageJs.includes('onShareAppMessage'), '实现好友分享生命周期');
check(pageJs.includes('onShareTimeline'), '实现朋友圈分享生命周期');
check(pageJs.includes("path: '/pages/index/index?from=share'"), '好友分享 path 只带来源标记');
check(pageJs.includes("query: 'from=share'"), '朋友圈 query 只带来源标记');
check(!/openid|unionid|avatar|nickName/i.test(pageJs), '页面逻辑不含身份字段');

[
  'handleAddTransaction',
  'saveCurrentAsTemplate',
  'useQuickTemplate',
  'deleteQuickTemplate',
  'handleReviewPeriod',
  'handleReviewRangeStartChange',
  'handleReviewRangeEndChange',
  'handleReviewCategoryDetail',
  'openEditTransaction',
  'saveEditedTransaction',
  'handleDeleteTransaction',
  'openSettings',
  'saveBudgetForm',
  'handleCycleStartDayChange',
  'handleFixedExpenseModeChange',
  'addFixedExpenseItem',
  'removeFixedExpenseItem',
  'chooseBillFile',
  'confirmBillImport',
  'handleUndoImportBatch',
  'handleExportLedger',
  'shareExportedLedger',
  'handleCreateBackup',
  'chooseBackupFile',
  'confirmRestoreBackup',
  'openThemeDrawer',
  'saveThemeSettings',
  'handleTimelineGuide'
].forEach((handler) => check(pageJs.includes(`${handler}(`), `保留页面处理器 ${handler}`));

const wxml = source('pages/index/index.wxml');
const wxss = source('pages/index/index.wxss');

check(wxml.includes('<text class="page-title">今天还能花</text>'), '页面内完整显示产品标题');
check(wxml.includes('class="budget-hero'), '首页存在清晰的核心额度区');
check(wxml.includes('class="quick-record'), '首页存在常驻快速记账区');
check(!wxml.includes('data-section="composer"'), '快速记账不再要求用户先展开');
check(wxml.includes('class="composer-details-toggle"'), '低频记账字段通过一层补充信息渐进披露');
check(wxml.includes('loading="{{isBackupPreviewLoading}}"'), '备份文件读取按钮显示加载反馈');
check(wxml.includes('data-section="review"'), '消费回看保持渐进披露');
check(wxml.includes('data-section="history"'), '账本与数据保持渐进披露');
check(wxml.indexOf('class="budget-hero') < wxml.indexOf('class="quick-record'), '核心额度先于快速记账');
check(wxml.indexOf('class="quick-record') < wxml.indexOf('data-section="review"'), '快速记账先于低频回看');
check(wxml.indexOf('data-section="review"') < wxml.indexOf('data-section="history"'), '消费回看先于高级数据工具');
check(!/<image\b/i.test(wxml), '首页不再使用装饰主图');
check(!/spending-journey-hero/i.test(wxml), '页面不引用旧插画资产');

check(wxml.includes('data-direction="expense"') && wxml.includes('data-direction="income"'), '保留支出和额外收入入口');
check(wxml.includes('maxlength="20"'), '用途或来源限制为 20 个字符');
check(wxml.includes('bindtap="saveCurrentAsTemplate"'), '保留保存常用模板');
check(wxml.includes('bindtap="useQuickTemplate"'), '保留模板一键记账');
check(wxml.includes("reviewPeriod === 'custom'"), '保留自定义时间段回看');
check(wxml.includes('reviewSummary.categoryBreakdown') && wxml.includes('reviewTransactions'), '保留分类和流水下钻');
check(wxml.includes('本周总结'), '保留周总结');
check(wxml.includes('historyIncomeText') && wxml.includes('historyExpenseText'), '历史摘要区分收入和支出');
check(wxml.includes('修改收支明细'), '保留交易修改抽屉');
check(wxml.includes('导入微信或支付宝账单'), '保留统一平台账单入口');
check(wxml.includes('handleUndoImportBatch'), '保留导入批次撤销');
check(wxml.includes('Excel'), '保留 Excel 导出');
check(wxml.includes('完整数据备份与恢复'), '保留完整数据备份恢复');
check(wxml.includes('open-type="share"'), '好友分享使用微信原生能力');
check(wxml.includes('朋友圈') && wxml.includes('右上角'), '保留朋友圈右上角菜单引导');

check(wxml.includes('bindchange="handleCycleStartDayChange"'), '设置保留自定义预算周期');
check(wxml.includes('固定收入') && wxml.includes('固定支出') && wxml.includes('想存下的钱'), '设置保留预算核心字段');
check(wxml.includes('data-mode="manual"') && wxml.includes('data-mode="items"'), '设置保留固定支出两种方式');
check(wxml.includes("form.fixedExpenseMode === 'items'"), '固定支出明细仅在明细合计模式出现');
check(!wxml.includes('分类预算提醒'), '不恢复已确认删除的分类预算提醒');
check(!wxml.includes('bindtap="openPrivacyContract"'), '不重复增加隐私协议入口');
check(wxml.includes('警示') && wxml.includes('超支'), '主题说明语义色不可被覆盖');

check(!/linear-gradient|radial-gradient|conic-gradient/i.test(wxss), '样式不使用渐变');
check(!/border[^;{]*dashed|border-style:\s*dashed/i.test(wxss), '样式不使用虚线票据');
check(!/background-image\s*:/i.test(wxss), '样式不使用装饰背景图');
check(wxss.includes('#F5F5F7') && wxss.includes('#1D1D1F') && wxss.includes('#6E6E73'), '样式使用 Apple 式中性基础色');
check(wxss.includes('var(--theme-primary'), '主题只通过语义强调色进入页面');
check((wxss.match(/min-height:\s*88rpx/g) || []).length >= 8, '主要操作广泛满足 88rpx 触控高度');
check(wxss.includes('env(safe-area-inset-bottom)'), '底部抽屉和内容尊重安全区');
check(wxss.includes('@media (prefers-reduced-motion: reduce)'), '动画尊重减少动态效果偏好');
check(/overflow-x:\s*hidden/.test(wxss), '页面禁止横向滚动');
check(wxss.includes('@media') && /max-width:\s*3[2-7]0px/.test(wxss), '存在窄屏适配规则');
const uniqueHexColors = new Set((wxss.match(/#[0-9a-f]{3,8}\b/gi) || [])
  .map((color) => color.toUpperCase()));
check(uniqueHexColors.size <= 24, `样式颜色收敛（当前 ${uniqueHexColors.size} 个唯一十六进制色）`);

const theme = source('domain/theme.js');
check((theme.match(/Object\.freeze\(\{ id:/g) || []).length === 6, '主题仍提供六套预设');
check(theme.includes("presetId: 'systemBlue'"), '默认主题为系统蓝');
check(theme.includes('LEGACY_PRESET_MAP'), '旧版主题在备份迁移时映射到简约预设');
check(!/--theme-(danger|warning)/.test(theme), '用户主题不覆盖警示和危险语义色');

const analytics = source('services/analytics.js');
check(analytics.includes("'data_backup'"), '备份事件已加入统一埋点允许列表');
check(analytics.includes('FORBIDDEN_KEY'), '埋点过滤金额与身份字段');

const transactions = source('services/transactions.js');
check(/module\.exports\s*=\s*\{\s*addTransaction,\s*listTransactions\s*\}/.test(transactions), '交易模块仅公开两个 Promise API');
check(transactions.includes("command.action === 'import'"), '交易服务保留账单批量导入');
check(transactions.includes("command.action === 'undoImport'"), '交易服务保留整批撤销');
check(transactions.includes("command.action === 'update'"), '交易服务保留纠错');
check(transactions.includes('交易日期只能在原月份内修改'), '交易纠错不允许跨自然月移动');

const backup = source('services/data-backup.js');
check(backup.includes("BACKUP_FILE_TYPE = 'today-can-spend-backup'"), '备份格式与完整版兼容');
check(backup.includes('normalizeThemeSettings(document.themeSettings)'), '恢复时迁移旧主题到简约预设');

if (failures.length) {
  console.error(`\n${failures.length} 项检查失败：`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('\n简约版结构检查全部通过。');
