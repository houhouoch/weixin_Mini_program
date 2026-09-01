const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const heroPath = 'assets/images/spending-journey-hero-v2.jpg';
const required = [
  'app.js',
  'app.json',
  'app.wxss',
  'project.config.json',
  'sitemap.json',
  'pages/index/index.js',
  'pages/index/index.json',
  'pages/index/index.wxml',
  'pages/index/index.wxss',
  'domain/spending-summary.js',
  'domain/ledger-workbook.js',
  'domain/alipay-bill.js',
  'domain/gb18030.js',
  'domain/wechat-bill.js',
  'domain/theme.js',
  'domain/ai-entry.js',
  'infrastructure/file-system.js',
  'services/ledger-export.js',
  'services/data-backup.js',
  'services/spending-summary.js',
  'services/theme-store.js',
  'services/ai-entry.js',
  'services/wechat-bill-import.js',
  heroPath,
  'README.md'
];

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
  else console.log(`PASS ${message}`);
}

required.forEach((file) => check(fs.existsSync(path.join(root, file)), `存在 ${file}`));
check(
  fs.statSync(path.join(root, heroPath)).size < 200 * 1024,
  '运行主图小于 200 KB'
);

function totalBytes(target) {
  const stat = fs.statSync(target);
  if (stat.isFile()) return stat.size;
  return fs.readdirSync(target)
    .reduce((sum, name) => sum + totalBytes(path.join(target, name)), 0);
}

const runtimeEntries = [
  'app.js', 'app.json', 'app.wxss', 'sitemap.json',
  'assets', 'domain', 'infrastructure', 'pages', 'services'
];
const estimatedMainPackageBytes = runtimeEntries
  .reduce((sum, entry) => sum + totalBytes(path.join(root, entry)), 0);
check(estimatedMainPackageBytes < 1.5 * 1024 * 1024, '运行主包原始文件小于 1.5 MB');

const projectConfig = JSON.parse(
  fs.readFileSync(path.join(root, 'project.config.json'), 'utf8')
);
const ignoredPackageFolders = new Set(
  (projectConfig.packOptions && projectConfig.packOptions.ignore || [])
    .filter((item) => item.type === 'folder')
    .map((item) => item.value)
);
check(
  ['design-system', 'docs', 'scripts', 'specs', 'tests']
    .every((folder) => ignoredPackageFolders.has(folder)),
  '设计稿、文档、脚本、规格和测试不进入微信主包'
);

const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
check(Array.isArray(appConfig.pages) && appConfig.pages.length === 1, '仅注册一个页面');
check(!Object.prototype.hasOwnProperty.call(appConfig, 'tabBar'), '未配置 tabBar');
check(
  appConfig.plugins
    && appConfig.plugins.WechatSI
    && appConfig.plugins.WechatSI.provider === 'wx069ba97219f66d99',
  '接入微信官方语音识别插件'
);
check(!Object.prototype.hasOwnProperty.call(appConfig, 'permission'), 'app.json 不误用仅用于位置声明的 permission 字段');

const indexPageConfig = JSON.parse(
  fs.readFileSync(path.join(root, 'pages/index/index.json'), 'utf8')
);
check(indexPageConfig.navigationBarTitleText === '', '首页不重复渲染可能被裁切的原生导航标题');

const pageJs = fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8');
const dateImportMatch = pageJs.match(
  /const\s*\{([^}]*)\}\s*=\s*require\('\.\.\/\.\.\/domain\/date'\)/
);
check(
  dateImportMatch && /\bbudgetCycleRange\b/.test(dateImportMatch[1]),
  '预算周期函数从日期领域模块导入'
);
check(
  !pageJs.includes('categoryBudgetAlerts')
    && !pageJs.includes('handleCategoryBudgetInput')
    && pageJs.includes('values.categoryBudgets = [];'),
  '页面移除分类预算交互并在保存时清空兼容字段'
);
check(!/wx\.(get|set|remove|clear)Storage/.test(pageJs), '页面层不直接访问微信缓存');
check(!pageJs.includes('wx.getFileSystemManager'), '页面层不直接访问微信文件系统管理器');
check(pageJs.includes('wx.getDeviceInfo()'), '页面优先使用新版设备信息接口');
check(pageJs.includes('wx.showShareMenu'), '开启微信分享菜单');
check(
  pageJs.includes("requirePlugin('WechatSI')")
    && pageJs.includes('getRecordRecognitionManager')
    && pageJs.includes("source: 'voice'")
    && pageJs.includes('confirmSmartEntries'),
  '语音识别结果进入同一账单确认流程'
);
check(!pageJs.includes('wx.chooseMedia'), '页面逻辑不包含摄像机或照片选择');
check(pageJs.includes('parseQuickEntries') && pageJs.includes('saveTransactionDrafts'), '文字与语音支持多笔账单拆分确认');
check(pageJs.includes('parseEntriesWithAi') && pageJs.includes("showSmartDrafts(entries, options, 'ai')"), '文字与语音优先使用国内函数服务智能整理并进入同一确认层');
check(pageJs.includes('onShareAppMessage'), '实现好友分享生命周期');
check(pageJs.includes('onShareTimeline'), '实现朋友圈分享生命周期');
check(pageJs.includes("path: '/pages/index/index?from=share'"), '分享路径只包含来源标记');
check(pageJs.includes("query: 'from=share'"), '朋友圈 query 只包含来源标记');
check(!/openid|unionid|avatar|nickName/i.test(pageJs), '页面分享逻辑不包含身份字段');
check(pageJs.includes('handleCategorySelect'), '页面支持选择消费分类');
check(pageJs.includes('handleNoteInput'), '页面支持填写消费用途');
check(pageJs.includes('handleReviewPeriod'), '页面支持日/月/年/自定义回看切换');
check(pageJs.includes('handleReviewRangeStartChange'), '页面支持选择统计开始日期');
check(pageJs.includes('handleReviewRangeEndChange'), '页面支持选择统计结束日期');
check(pageJs.includes('openThemeDrawer'), '页面支持打开主题工作室');
check(pageJs.includes('saveThemeSettings'), '页面支持保存安全主题设置');
check(pageJs.includes('toggleSection'), '页面支持独立折叠非核心模块');
check(pageJs.includes('refreshHistoryDetail'), '页面支持按日期读取历史明细');
check(pageJs.includes('saveEditedTransaction'), '页面支持修改错误交易');
check(pageJs.includes('handleExportLedger'), '页面支持导出 Excel 流水');
check(pageJs.includes('wx.chooseMessageFile'), '页面支持从微信会话选择账单文件');
check(!pageJs.includes('wx.openPrivacyContract'), '页面不重复提供微信后台隐私指引入口');
check(pageJs.includes('chooseBillFile'), '页面使用统一入口选择微信或支付宝账单');
check(pageJs.includes('confirmBillImport'), '页面支持预览后确认导入平台账单');
check(pageJs.includes('handleUndoImportBatch'), '页面支持按批次撤销账单导入');
check(pageJs.includes('handleCreateBackup') && pageJs.includes('confirmRestoreBackup'), '页面支持完整备份与恢复');
check(pageJs.includes('showMenu: true'), 'Excel 预览显示右上角文档菜单');
check(pageJs.includes('wx.shareFileMessage'), '页面支持直接转发 Excel 文件');
check(pageJs.includes('wx.saveFileToDisk'), 'PC 端支持保存 Excel 到磁盘');

const wxml = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8');
check(!wxml.includes('handlePhotoEntry') && !wxml.includes('photoReviewVisible'), '首页不提供摄像机或照片记账入口');
check(wxml.includes('<text class="page-title">今天还能花</text>'), '页面内产品标题保持完整显示');
check(wxml.includes("reviewPeriod === 'custom'"), '自定义统计只在对应回看模式展示');
check(wxml.includes('mode="date"') && wxml.includes('reviewRangeStartKey') && wxml.includes('reviewRangeEndKey'), '页面使用原生日期选择器设置统计区间');
check(wxml.includes('reviewSummary.categoryBreakdown') && wxml.includes('reviewTransactions'), '自定义统计支持分类和逐笔流水下钻');
check(wxml.includes('{{result.periodLabel}}超支 ¥{{result.monthlyOverspentText}}'), '负数周期余额使用周期超支与绝对值表达');
check(wxml.includes('open-type="share"'), '好友分享使用 open-type="share"');
check(wxml.includes('朋友圈 · 右上角'), '提供朋友圈右上角菜单引导');
check(wxml.includes('这笔花在哪儿'), '记录区先回答消费去向');
check(wxml.includes('maxlength="20"'), '用途说明限制为 20 个字符');
check(/id: 'day'[\s\S]*id: 'month'[\s\S]*id: 'year'[\s\S]*id: 'custom'/.test(pageJs), '回看区提供日/月/年/自定义四种范围');
check(wxml.includes('警示黄与超支红由系统锁定'), '主题抽屉说明警示语义色不可覆盖');
check(!wxml.includes('<slider'), '主题设置不再提供任意调色滑杆');
check(
  ['review', 'composer', 'history'].every((section) => wxml.includes(`data-section="${section}"`)),
  '消费回看、快速记账、记录历史均可独立折叠'
);
check(wxml.includes('mode="date"'), '历史回顾使用原生日期选择器');
check(wxml.includes('修改收支明细'), '页面提供交易修改抽屉');
check(wxml.includes('data-direction="income"') && wxml.includes('记下收入'), '页面提供额外收入入口');
check(wxml.includes('固定收入无需重复记录'), '收入入口提示避免重复记录固定收入');
check(wxml.includes('已扣除储蓄目标 ¥{{budgetSavingGoalText}}'), '首页明确显示扣除储蓄目标后的周期省下金额');
check(pageJs.includes("income: '8000'") && pageJs.includes("fixedExpense: '800'") && pageJs.includes("savingGoal: '2000'") && wxml.includes('bindtap="useDefaultBudget"'), '首次设置可使用 8000/800/2000 示例预算先进入首页');
check(wxml.includes('detailsAnalysisSummary.calendarDays') && wxml.includes('monthlyTrendCanvas'), '支出分析展示每日金额日历和走势曲线');
check(wxml.includes('bindtap="handleDetailsMonthChange"')
  && pageJs.includes('REVIEW_MIN_MONTH_KEY')
  && pageJs.includes("getSpendingSummary('month', new Date(),"), '月度分析支持近 36 个月切换且不进入未来月份');
check(wxml.includes('bindtap="handleDetailsCalendarDay"')
  && wxml.includes('detailsDayTransactions')
  && pageJs.includes("listTransactions({ dateKey })"), '月历日期可点击并读取当天真实支出');
check(wxml.includes('文字与语音会发送至阿里云千问整理'), '页面明示文字与语音的云端处理边界');
check(wxml.includes('historyIncomeText') && wxml.includes('historyExpenseText'), '历史摘要区分收入与支出');
check(wxml.includes('启用前汇总不会伪装成某一天的明细'), '日期空状态说明汇总基线边界');
check(wxml.includes('导出并打开 Excel'), '历史折叠区提供 Excel 导出入口');
check(wxml.includes('不含启用前汇总、OPENID 或身份信息'), '导出区明示隐私范围');
check(wxml.includes('导入微信或支付宝账单'), '历史折叠区提供统一平台账单导入入口');
check(wxml.includes('微信先解压邮件账单'), '导入区说明微信加密压缩包需先解压');
const billImportSource = fs.readFileSync(path.join(root, 'services/wechat-bill-import.js'), 'utf8');
check(billImportSource.includes('还款只是在结清已有欠款'), '导入预览提供还款去重口径');
check(wxml.includes('不会上传账单，不保存微信或支付宝交易单号原文'), '导入区明示本地解析与隐私边界');
check(!wxml.includes('bindtap="openPrivacyContract"'), '设置抽屉不展示重复隐私指引入口');
check(wxml.includes('最近可撤销的导入') && wxml.includes('handleUndoImportBatch'), '历史区显示可撤销导入批次');
check(wxml.includes('完整数据备份与恢复') && wxml.includes('选择备份文件恢复'), '历史区提供完整本地备份恢复入口');

const stateSource = fs.readFileSync(path.join(root, 'services/state-store.js'), 'utf8');
check(stateSource.includes('const SCHEMA_VERSION = 5'), '本地数据使用 schema 5');
check(wxml.includes('bindchange="handleCycleStartDayChange"'), '设置支持自定义预算周期起始日');
check(
  wxml.includes('工资或父母发放生活费到账的日期')
    && wxml.includes('15 日表示每月 15 日至下月 14 日'),
  '预算周期用发薪或生活费到账日解释'
);
check(
  wxml.includes('budget-field-heading__title">固定收入')
    && wxml.includes('budget-field-heading__title">固定支出'),
  '固定收入与固定支出使用醒目分组标题'
);
check(
  /budget-field-heading__title">固定收入<\/text>\s*<\/view>/.test(wxml)
    && /budget-field-heading__title">固定支出<\/text>\s*<\/view>/.test(wxml)
    && !wxml.includes('budget-field-heading__scope'),
  '固定收入与固定支出标题不重复显示每个预算周期'
);
check(
  !wxml.includes('data-field="historicalSpentBeforeTracking"')
    && pageJs.includes('values.historicalSpentBeforeTrackingCents = 0;')
    && wxml.includes('导入微信/支付宝账单'),
  '设置移除启用前消费输入并引导按日期补记或导入'
);
check(wxml.includes('bindtap="saveCurrentAsTemplate"'), '快速记账支持保存常用模板');
check(wxml.includes('bindtap="useQuickTemplate"'), '常用模板支持一键记账');
check(!wxml.includes('分类预算提醒'), '页面不展示分类预算设置或提醒');
check(
  wxml.includes('class="fixed-expense-add"') && wxml.includes('新增固定支出'),
  '固定支出明细使用清晰的次级新增入口'
);
check(
  wxml.includes('data-mode="manual"')
    && wxml.includes('data-mode="items"')
    && wxml.includes('bindtap="handleFixedExpenseModeChange"'),
  '设置支持直接填写与明细合计两种方式'
);
check(
  wxml.includes('明细自动合计')
    && wxml.includes('class="budget-detail-section" wx:if="{{form.fixedExpenseMode === \'items\'}}"')
    && !wxml.includes('syncFixedExpenseFromItems')
    && pageJs.includes("if (mode === 'items') form.fixedExpense = totalText;"),
  '固定支出明细只在明细合计模式展示并实时累加'
);
check(
  wxml.includes('aria-label="移除这项固定支出明细">移除</button>'),
  '固定支出明细使用单行移除操作'
);
check(wxml.includes('本周总结'), '日回看支持周总结');
check(stateSource.includes("direction: 'expense'"), '旧数据迁移为支出方向');
check(stateSource.includes('HISTORY_MONTH_LIMIT = 36'), '历史归档设置本地保留上限');

const themeSource = fs.readFileSync(path.join(root, 'domain/theme.js'), 'utf8');
check(!/--theme-(danger|warning)/.test(themeSource), '用户主题不生成 danger/warning 语义变量');
check(themeSource.includes("name: '浅色'")
  && themeSource.includes("name: '深色'")
  && !/name: '(海蓝|鼠尾草|暖砂)'/.test(themeSource), '主题只提供 Apple 浅色与深色外观');
const wxss = fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8');
check(/\.minimal-entry__voice\s*\{[^}]*width:\s*88rpx[^}]*height:\s*88rpx/.test(wxss), '语音入口保留 88rpx 圆形触控区');
check(
  /\.fixed-expense-add\s*\{[^}]*min-height:\s*88rpx/.test(wxss),
  '固定支出新增入口满足 88rpx 触控高度'
);
check(
  /\.fixed-expense-row__delete\s*\{[^}]*width:\s*112rpx[^}]*white-space:\s*nowrap/.test(wxss),
  '固定支出移除操作拥有独立宽度且禁止折行'
);
check(
  /\.budget-field-heading__title\s*\{[^}]*font-size:\s*32rpx[^}]*font-weight:\s*850/.test(wxss),
  '固定收支标题拥有更高字号和字重层级'
);
check(
  /\.fixed-expense-mode__option\s*\{[^}]*min-height:\s*88rpx/.test(wxss)
    && /\.fixed-expense-add\s*\{[^}]*min-height:\s*88rpx/.test(wxss),
  '固定支出模式与明细新增操作满足 88rpx 触控高度'
);
check(wxss.includes('.hero-card--todayOverspent'), '今日超额拥有独立视觉状态');
check(wxss.includes('@media (prefers-reduced-motion: reduce)'), '动画尊重减少动态效果偏好');

const transactionSource = fs.readFileSync(path.join(root, 'services/transactions.js'), 'utf8');

const budgetSource = fs.readFileSync(path.join(root, 'domain/budget.js'), 'utf8');
const budgetStoreSource = fs.readFileSync(path.join(root, 'services/budget-store.js'), 'utf8');
check(
  budgetSource.includes("value === 'items' ? 'items' : 'manual'")
    && budgetStoreSource.includes('const fixedExpenseMode = normalizeFixedExpenseMode')
    && budgetStoreSource.includes("fixedExpenseItems: fixedExpenseMode === 'items'"),
  '固定支出计算方式向后兼容并持久化'
);
check(
  budgetSource.includes("const fixedExpenseItems = fixedExpenseMode === 'items'")
    && budgetSource.includes("fixedExpenseMode === 'items' && itemTotal !== fixed")
    && stateSource.includes("fixedExpenseMode === 'items'"),
  '直接填写忽略明细，明细合计模式要求总额严格等于明细'
);
check(
  /module\.exports\s*=\s*\{\s*addTransaction,\s*listTransactions\s*\}/.test(transactionSource),
  '交易模块仅公开 addTransaction/listTransactions'
);
check(transactionSource.includes("command.action === 'update'"), '交易服务支持修改命令');
check(transactionSource.includes("command.action === 'import'"), '交易服务支持批量导入命令');
check(transactionSource.includes("command.action === 'undoImport'"), '交易服务支持撤销导入批次命令');
check(transactionSource.includes('importBatchId') && transactionSource.includes('importedAt'), '新导入交易持久化本地批次元数据');
check(transactionSource.includes('existingIds'), '交易服务按稳定标识去重导入');
check(transactionSource.includes("command.source !== 'alipay'"), '交易服务接受支付宝平台导入');
check(transactionSource.includes("record.direction === 'income'"), '批量导入保留支付宝收入方向');
check(transactionSource.includes('options.dateKey'), '交易服务支持按日期读取当前和归档记录');
check(transactionSource.includes('options.startDateKey') && transactionSource.includes('options.categoryId'), '交易服务支持区间与分类筛选');
check(transactionSource.includes('交易日期只能在原月份内修改'), '交易服务阻止跨月搬移记录');

const analyticsSource = fs.readFileSync(path.join(root, 'services/analytics.js'), 'utf8');
check(analyticsSource.includes('FORBIDDEN_KEY'), '埋点入口过滤金额和身份字段');

const workbookSource = fs.readFileSync(path.join(root, 'domain/ledger-workbook.js'), 'utf8');
check(workbookSource.includes('0x04034B50'), 'XLSX 生成器写入 ZIP 本地文件头');
check(workbookSource.includes('0x06054B50'), 'XLSX 生成器写入 ZIP 中心目录结尾');
check(!/openid|unionid|avatar|nickName/i.test(workbookSource), 'Excel 生成器不包含身份字段');

const billParserSource = fs.readFileSync(path.join(root, 'domain/wechat-bill.js'), 'utf8');
check(billParserSource.includes('skippedStatusCount'), '微信账单解析器跳过退款与撤销记录');
check(billParserSource.includes('duplicateInFileCount'), '微信账单解析器识别文件内重复记录');
check(!/openid|unionid|avatar|nickName/i.test(billParserSource), '微信账单解析器不提取身份字段');

const alipayParserSource = fs.readFileSync(path.join(root, 'domain/alipay-bill.js'), 'utf8');
check(alipayParserSource.includes('skippedRepaymentCount'), '支付宝账单解析器单独统计还款跳过');
check(alipayParserSource.includes('skippedNeutralizedRefundCount'), '支付宝账单解析器抵消匹配全额退款');
check(alipayParserSource.includes("categoryId: direction === 'expense'"), '支付宝账单解析器同时生成收支记录');
check(!/openid|unionid|avatar|nickName/i.test(alipayParserSource), '支付宝账单解析器不提取身份字段');

const fileSystemSource = fs.readFileSync(path.join(root, 'infrastructure/file-system.js'), 'utf8');
check(fileSystemSource.includes('readZipEntry'), 'XLSX 通过微信文件系统读取压缩条目');
check(fileSystemSource.includes("encoding: 'utf-8'"), 'XLSX 条目分别指定 UTF-8 编码');
check(fileSystemSource.includes('decodeUtf8Data'), 'XLSX 兼容微信返回 ArrayBuffer');
check(fileSystemSource.includes('decodeGb18030'), '支付宝 CSV 兼容 GB18030 编码');

const backupSource = fs.readFileSync(path.join(root, 'services/data-backup.js'), 'utf8');
check(backupSource.includes("BACKUP_FILE_TYPE = 'today-can-spend-backup'"), '完整备份使用可验证的产品格式标识');
check(backupSource.includes('normalizeState') && backupSource.includes('isValidThemeSettings'), '恢复前校验并迁移状态与主题');
check(!/openid|unionid|avatar|nickName/i.test(backupSource), '完整备份服务不加入身份字段');

if (failures.length) {
  console.error(`\n${failures.length} 项检查失败：`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('\n结构检查全部通过。');
