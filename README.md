# 今天还能花｜微信小程序 MVP

一个只用本地数据回答“今天还能安全花多少钱”的原生微信小程序。项目无登录、无后端、无云开发、无第三方 UI 库，首页完成设置、查看结果、折叠内容、记一笔、按日期回看、修改/删除明细、跨天/跨月、日/月/年消费回看、主题定制和隐私安全分享的核心闭环。

## 导入微信开发者工具

1. 打开微信开发者工具，选择“导入项目”；
2. 项目目录选择本仓库根目录：`C:\Users\admin\Documents\ChatGPT\小程序`；
3. AppID 可先使用 `project.config.json` 中的 `touristappid` 本地体验，或替换为你自己的小程序 AppID；
4. 项目类型选择“小程序”，点击导入并编译；
5. 首次进入填写四项设置，再测试折叠、记账、历史日期、修改、删除和重置。

本项目不需要安装依赖，也没有构建命令。

当前项目目录（排除 `.git`）约 947 KB，其中运行主图约 540 KB，已避免原始大图单独挤占主包；实际上传体积以开发者工具报告为准。

## 项目结构

```text
app.*                         小程序入口与全局样式
pages/index/                  唯一主页面
domain/                       金额、日期、分类、预算、回看与主题纯逻辑
infrastructure/storage.js     唯一微信缓存边界
services/budget-store.js      设置、重置、跨月与历史归档
services/transactions.js      Promise 交易 API（仅 add/list）
services/spending-summary.js  日/月/年真实本地记录聚合
services/theme-store.js       主题预设与安全微调持久化
services/analytics.js         隐私过滤后的统一 trackEvent
tests/                        Node 自动化测试
scripts/check-structure.js    单页、存储边界与分享静态检查
docs/PRD.md                   产品需求文档
specs/001-today-can-spend/    SDD 规格、计划、任务与验收矩阵
design-system/                UI 设计系统与首页覆盖规则
docs/design/                  Figma 交付、原创图片来源与页面快照
```

设计预览与交付链接见 `docs/design/DESIGN_HANDOFF.md`。

## 数据字段

预算和记录使用本地 key `today-can-spend:v1`，结构包含：

- `schemaVersion`：当前为 3；
- `monthKey`：`YYYY-MM`；
- `budget.incomeCents`：本月收入（分）；
- `budget.fixedExpenseCents`：固定支出（分）；
- `budget.savingGoalCents`：储蓄目标（分）；
- `budget.historicalSpentBeforeTrackingCents`：启用前已花（分）；
- `budget.trackingStartDate`：`YYYY-MM-DD`；
- `transactions[]`：本月交易，包含本地 ID、金额分、分类 ID、可选用途和本地时间戳；
- `processedCommandIds[]`：最近交易命令 ID，用于幂等防重复。
- `history[]`：最多保留 36 个已结束月份的启用前汇总与真实逐笔记录，用于年度回看。

页面不会直接调用缓存 API。交易模块只公开返回 Promise 的 `addTransaction(command)` 与 `listTransactions(options)`：创建、修改和删除分别通过 `addTransaction({ action: 'create' | 'update' | 'delete' })` 完成，`listTransactions({ dateKey: 'YYYY-MM-DD' })` 可读取当前月或归档中的指定日期真实明细。

固定分类为餐饮、交通、购物、日用、娱乐、医疗、人情、其他；用途最多 20 个字符，只保存在本机，不进入埋点或分享参数。旧版 `schemaVersion: 1/2` 数据会原地无损迁移到版本 3；版本 1 的旧记录保留金额和时间，并归入“其他”、用途留空。存储 key 保持不变，避免升级时丢失本机旧数据。

主题单独保存在 `today-can-spend:theme:v1`。用户只能从 6 套预设中选择，并在限定范围内调整色相、背景温度和亮度；超支红、警示黄及其文字色由系统锁定。重置本月会清空当前设置与当前月记录，但不会删除已经归档的往月数据或主题偏好。

消费回看的总额可包含“启用前已花”，但日/月/年趋势、最高日/月和分类排行只使用具有真实时间与分类的逐笔记录，不会把汇总金额伪造成历史明细。

## 计算公式

```text
本月日常消费总预算 = 收入 - 固定支出 - 储蓄目标
今天之前已花 = 启用前已花 + 小程序内今天之前记录
今日建议额度 = floor(max(日常预算 - 今天之前已花, 0) / 含今天的剩余天数)
今天还能花 = max(今日建议额度 - 今日已花, 0)
本月剩余可用 = 日常预算 - 启用前已花 - 小程序内全部记录
```

全部金额以整数分保存和计算。今日金额最低为 0；本月剩余允许为负。

## 分享与隐私

- 调用 `wx.showShareMenu` 开启好友和朋友圈；
- 好友按钮使用 `open-type="share"`；
- 分享标题包含预算人格、使用天数、记录笔数和本月累计花费摘要；
- 分享路径只含 `from=share`，不携带逐笔交易、OPENID、昵称、头像或其他身份信息；
- 接收者只会读取自己设备上的本地数据。

## 本地验证

需要本机 Node.js 18+：

```bash
node --test tests/*.test.js
node scripts/check-structure.js
```

自动化覆盖金额解析、核心计算/日期/存储场景、分类与用途校验、schema 1/2 迁移、交易幂等、跨月归档、历史纠错、跨日/跨月/跨年导入样本、日/月/年聚合、主题持久化与对比度。微信分享面板、系统弹窗、数字键盘、用途输入、安全区、CSS 变量兼容性以及真机视觉仍需在微信开发者工具或真机验证；最终验收状态见 `specs/001-today-can-spend/acceptance.md`。
