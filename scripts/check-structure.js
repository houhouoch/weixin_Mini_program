const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
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
  'assets/images/spending-journey-hero-v2.png',
  'README.md'
];

const failures = [];
function check(condition, message) {
  if (!condition) failures.push(message);
  else console.log(`PASS ${message}`);
}

required.forEach((file) => check(fs.existsSync(path.join(root, file)), `存在 ${file}`));
check(
  fs.statSync(path.join(root, 'assets/images/spending-journey-hero-v2.png')).size < 1000000,
  '运行主图小于 1 MB'
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

const wxml = fs.readFileSync(path.join(root, 'pages/index/index.wxml'), 'utf8');
check(wxml.includes('open-type="share"'), '好友分享使用 open-type="share"');
check(wxml.includes('朋友圈 · 右上角'), '提供朋友圈右上角菜单引导');
check(wxml.includes('这笔花在哪儿'), '记录区先回答消费去向');
check(wxml.includes('maxlength="20"'), '用途说明限制为 20 个字符');

const transactionSource = fs.readFileSync(path.join(root, 'services/transactions.js'), 'utf8');
check(
  /module\.exports\s*=\s*\{\s*addTransaction,\s*listTransactions\s*\}/.test(transactionSource),
  '交易模块仅公开 addTransaction/listTransactions'
);

const analyticsSource = fs.readFileSync(path.join(root, 'services/analytics.js'), 'utf8');
check(analyticsSource.includes('FORBIDDEN_KEY'), '埋点入口过滤金额和身份字段');

if (failures.length) {
  console.error(`\n${failures.length} 项检查失败：`);
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}
console.log('\n结构检查全部通过。');
