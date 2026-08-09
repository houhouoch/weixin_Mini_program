# 今天还能花｜微信小程序 MVP

一个只用本地数据回答“今天还能安全花多少钱”的原生微信小程序。项目无登录、无后端、无云开发、无第三方 UI 库，首页完成预算关联校验、查看结果、折叠内容、手动记账、微信支付账单导入、按日期回看、修改/删除明细、跨天/跨月、日/月/年消费回看、Excel 流水导出、主题定制和隐私安全分享的核心闭环。

## 导入微信开发者工具

1. 打开微信开发者工具，选择“导入项目”；
2. 项目目录选择本仓库根目录：`C:\Users\admin\Documents\ChatGPT\小程序`；
3. AppID 可先使用 `project.config.json` 中的 `touristappid` 本地体验，或替换为你自己的小程序 AppID；
4. 项目类型选择“小程序”，点击导入并编译；
5. 首次进入填写四项设置，再测试折叠、记账、历史日期、修改、删除和重置。

本项目不需要安装依赖，也没有构建命令。

运行主图为 1024 × 683、约 148 KB 的渐进式 JPEG。`docs`、`design-system`、`specs`、`tests` 和 `scripts` 通过 `packOptions.ignore` 保留在 Git 仓库但不进入微信主包；本地结构检查同时限制单张运行图小于 200 KB、运行主包原始文件小于 1.5 MB。最终上传体积以开发者工具报告为准。

## 项目结构

```text
app.*                         小程序入口与全局样式
pages/index/                  唯一主页面
domain/                       金额、日期、预算、回看、账单解析与主题纯逻辑
infrastructure/storage.js     唯一微信缓存边界
infrastructure/file-system.js 小程序用户文件读写与 XLSX 条目读取边界
services/budget-store.js      设置、重置、跨月与历史归档
services/transactions.js      Promise 交易 API（仅 add/list）
services/spending-summary.js  日/月/年真实本地记录聚合
services/ledger-export.js      本地 XLSX 流水生成与交付
services/wechat-bill-import.js 微信账单本地解析、预览与已有流水去重
services/theme-store.js       主题预设与安全微调持久化
services/analytics.js         隐私过滤后的统一 trackEvent
tests/                        Node 自动化测试
scripts/check-structure.js    单页、存储边界、分享与主包体积静态检查
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

页面不会直接调用缓存 API。交易模块只公开返回 Promise 的 `addTransaction(command)` 与 `listTransactions(options)`：创建、修改、删除和账单导入分别通过 `addTransaction({ action: 'create' | 'update' | 'delete' | 'import' })` 完成；`listTransactions({ dateKey: 'YYYY-MM-DD' })` 可读取当前月或归档中的指定日期真实明细，`listTransactions({ all: true })` 仅供本地导入预览去重。

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

预算设置另外满足：收入必须大于 0；固定支出不得超过收入；固定支出 + 储蓄目标不得超过收入；固定支出 + 启用前已花 + 已记录消费不得超过收入。输入违反关系时，页面显示最多可填值或需要的最低收入。真实交易不会因预算不足被拒绝，而是进入超支预警。

## Excel 导出

展开“记录与历史”，点“导出并打开 Excel”。小程序会在本机生成真实 `.xlsx`，包含当前月与归档月的日期、时间、分类、用途、金额和数据来源。文件打开时启用右上角菜单，页面也会在生成后显示“直接转发文件”。

启用前已花是没有日期和分类的汇总，不会被伪造成逐笔流水。文件只写入小程序用户目录，不上传，不含 OPENID 或身份信息。`wx.openDocument` 文档菜单、`wx.shareFileMessage` 和 PC 端保存需在微信开发者工具/真机验证。

## 导入微信支付账单

1. 在微信支付中申请个人账单并接收邮件；
2. 在电脑或手机上使用邮件中的密码解压账单压缩包；
3. 把解压出的 `.xlsx` 或 `.csv` 发到任意微信会话；
4. 小程序展开“记录与历史”，点“从微信会话选择文件”；
5. 核对日期范围、新增、重复、跳过和新增支出合计，再点确认导入。

账单只在本机解析，不上传。解析器兼容文本日期以及微信官方 XLSX 内部使用的 Excel 数值日期序列。读取 XLSX 时只请求账单工作表和共享文本索引，并兼容微信返回 UTF-8 字符串或 ArrayBuffer 两种结果。当前版本只导入最近 36 个月至当前时刻的有效支出；收入、不计收支、退款、撤销、关闭、无效行和超期行会跳过。交易单号只生成不含原文的本地去重指纹，原文不保存。导入后的流水可按日期修改、删除，并在导出 Excel 中标记为“微信支付导入”。加密 ZIP 不能直接选择，支付宝和银行格式仍是后续路线图。

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

自动化覆盖金额解析、预算关联约束、核心计算/日期/存储场景、分类与用途校验、schema 1/2 迁移、交易幂等、跨月归档、历史纠错、日/月/年聚合、微信 CSV/XLSX 账单解析、过滤、去重、跨月导入、XLSX 导出来源与 ZIP/CRC 完整性、主题持久化与对比度。微信分享面板、真实官方脱敏账单、文件选择/预览/转发/保存、系统弹窗、数字键盘、安全区、CSS 变量兼容性以及真机视觉仍需在微信开发者工具或真机验证；最终验收状态见 `specs/001-today-can-spend/acceptance.md`。

修复版本 `1.5.3` 已于 2026-08-09 通过微信开发者工具 CLI 上传到 AppID `wxd7449a88684708f3`，上传包为 290332 字节（283.5 KB）。用户提供的真实官方 XLSX 已完成本地解析校验；本版本进一步修复微信端共享字符串未按 UTF-8 返回造成的表头识别失败，并移除重复错误提示。微信会话文件选择与确认写入仍需开发者工具/真机复验。
