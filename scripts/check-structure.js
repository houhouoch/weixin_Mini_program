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
  'domain/theme.js',
  'infrastructure/file-system.js',
  'services/ledger-export.js',
  'services/spending-summary.js',
  'services/theme-store.js',
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

const pageJs = fs.readFileSync(path.join(root, 'pages/index/index.js'), 'utf8');
check(!/wx\.(get|set|remove|clear)Storage/.test(pageJs), '页面层不直接访问微信缓存');
check(pageJs.includes('wx.showShareMenu'), '开启微信分享菜单');
check(pageJs.includes('onShareAppMessage'), '实现好友分享生命周期');
check(pageJs.includes('onShareTimeline'), '实现朋友圈分享生命周期');
check(pageJs.includes("path: '/pages/index/index?from=share'"), '分享路径只包含来源标记');
check(pageJs.includes("query: 'from=share'"), '朋友圈 query 只包含来源标记');
check(!/openid|unionid|avatar|nickName/i.test(pageJs), '页面分享逻辑不包含身份字段');
check(pageJs.includes('handleCategorySelect'), '页面支持选择消费分类');
check(pageJs.includes('handleNoteInput'), '页面支持填写消费用途');
check(pageJs.includes('handleReviewPeriod'), '页面支持日/月/年回看切换');
check(pageJs.includes('openThemeDrawer'), '页面支持打开主题工作室');
check(pageJs.includes('saveThemeSettings'), '页面支持保存安全主题设置');
check(pageJs.includes('toggleSection'), '页面支持独立折叠非核心模块');
check(pageJs.includes('refreshHistoryDetail'), '页面支持按日期读取历史明细');
check(pageJs.includes('saveEditedTransaction'), '页面支持修改错误交易');
check(pageJs.includes('handleExportLedger'), '页面支持导出 Excel 流水');
check(pageJs.includes('showMenu: true'), 'Excel 预览显示右上角文档菜单');
check(pageJs.includes('wx.shareFileMessage'), '页面支持直接转发 Excel 文件');
check(pageJs.includes('wx.saveFileToDisk'), 'PC 端支持保存 Excel 到磁盘');

const wxml = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8');
check(wxml.includes('open-type="share"'), '好友分享使用 open-type="share"');
check(wxml.includes('朋友圈 · 右上角'), '提供朋友圈右上角菜单引导');
check(wxml.includes('这笔花在哪儿'), '记录区先回答消费去向');
check(wxml.includes('maxlength="20"'), '用途说明限制为 20 个字符');
check(/id: 'day'[\s\S]*id: 'month'[\s\S]*id: 'year'/.test(pageJs), '回看区提供日/月/年三个粒度');
check(wxml.includes('警示黄与超支红保持固定'), '主题抽屉说明警示语义色不可覆盖');
check(
  ['review', 'composer', 'history'].every((section) => wxml.includes(`data-section="${section}"`)),
  '消费回看、快速记账、记录历史均可独立折叠'
);
check(wxml.includes('mode="date"'), '历史回顾使用原生日期选择器');
check(wxml.includes('修改消费明细'), '页面提供交易修改抽屉');
check(wxml.includes('启用前汇总不会伪装成某一天的明细'), '日期空状态说明汇总基线边界');
check(wxml.includes('导出并打开 Excel'), '历史折叠区提供 Excel 导出入口');
check(wxml.includes('不含启用前汇总、OPENID 或身份信息'), '导出区明示隐私范围');

const stateSource = fs.readFileSync(path.join(root, 'services/state-store.js'), 'utf8');
check(stateSource.includes('const SCHEMA_VERSION = 3'), '本地数据使用 schema 3');
check(stateSource.includes('HISTORY_MONTH_LIMIT = 36'), '历史归档设置本地保留上限');

const themeSource = fs.readFileSync(path.join(root, 'domain/theme.js'), 'utf8');
check(!/--theme-(danger|warning)/.test(themeSource), '用户主题不生成 danger/warning 语义变量');

const wxss = fs.readFileSync(path.join(root, 'pages/index/index.wxss'), 'utf8');
check(wxss.includes('.hero-card--todayOverspent'), '今日超额拥有独立视觉状态');
check(wxss.includes('@media (prefers-reduced-motion: reduce)'), '动画尊重减少动态效果偏好');

const transactionSource = fs.readFileSync(path.join(root, 'services/transactions.js'), 'utf8');
check(
  /module\.exports\s*=\s*\{\s*addTransaction,\s*listTransactions\s*\}/.test(transactionSource),
  '交易模块仅公开 addTransaction/listTransactions'
);
check(transactionSource.includes("command.action === 'update'"), '交易服务支持修改命令');
check(transactionSource.includes('options.dateKey'), '交易服务支持按日期读取当前和归档记录');
check(transactionSource.includes('交易日期只能在原月份内修改'), '交易服务阻止跨月搬移记录');

const analyticsSource = fs.readFileSync(path.join(root, 'services/analytics.js'), 'utf8');
check(analyticsSource.includes('FORBIDDEN_KEY'), '埋点入口过滤金额和身份字段');

const workbookSource = fs.readFileSync(path.join(root, 'domain/ledger-workbook.js'), 'utf8');
check(workbookSource.includes('0x04034B50'), 'XLSX 生成器写入 ZIP 本地文件头');
check(workbookSource.includes('0x06054B50'), 'XLSX 生成器写入 ZIP 中心目录结尾');
check(!/openid|unionid|avatar|nickName/i.test(workbookSource), 'Excel 生成器不包含身份字段');

if (failures.length) {
  console.error(`\n${failures.length} 项检查失败：`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('\n结构检查全部通过。');
