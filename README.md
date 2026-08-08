# 今天还能花｜微信小程序 MVP

一个只用本地数据回答“今天还能安全花多少钱”的原生微信小程序。项目无登录、无后端、无云开发、无第三方 UI 库，首页完成设置、查看结果、记一笔、删除、修改、重置、跨天/跨月和隐私安全分享的核心闭环。

## 导入微信开发者工具

1. 打开微信开发者工具，选择“导入项目”；
2. 项目目录选择本仓库根目录：`C:\Users\admin\Documents\ChatGPT\小程序`；
3. AppID 可先使用 `project.config.json` 中的 `touristappid` 本地体验，或替换为你自己的小程序 AppID；
4. 项目类型选择“小程序”，点击导入并编译；
5. 首次进入填写四项设置，再测试记账、删除、修改和重置。

本项目不需要安装依赖，也没有构建命令。

## 项目结构

```text
app.*                         小程序入口与全局样式
pages/index/                  唯一主页面
domain/                       金额、日期与预算纯逻辑
infrastructure/storage.js     唯一微信缓存边界
services/budget-store.js      设置、重置与跨月
services/transactions.js      Promise 交易 API（仅 add/list）
services/analytics.js         隐私过滤后的统一 trackEvent
tests/                        Node 自动化测试
scripts/check-structure.js    单页、存储边界与分享静态检查
docs/PRD.md                   产品需求文档
specs/001-today-can-spend/    SDD 规格、计划、任务与验收矩阵
design-system/                UI 设计系统与首页覆盖规则
docs/design/                  Figma/Open Design 交付与页面快照
```

设计预览与交付链接见 `docs/design/DESIGN_HANDOFF.md`。

## 数据字段

本地存储 key 为 `today-can-spend:v1`，结构包含：

- `schemaVersion`：当前为 1；
- `monthKey`：`YYYY-MM`；
- `budget.incomeCents`：本月收入（分）；
- `budget.fixedExpenseCents`：固定支出（分）；
- `budget.savingGoalCents`：储蓄目标（分）；
- `budget.historicalSpentBeforeTrackingCents`：启用前已花（分）；
- `budget.trackingStartDate`：`YYYY-MM-DD`；
- `transactions[]`：本月交易，包含本地 ID、金额分和本地时间戳；
- `processedCommandIds[]`：最近交易命令 ID，用于幂等防重复。

页面不会直接调用缓存 API。交易模块只公开返回 Promise 的 `addTransaction(command)` 与 `listTransactions()`；删除通过 `addTransaction({ action: 'delete' })` 完成。

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

自动化覆盖金额解析、10 个核心计算/日期/存储场景、交易幂等、跨月沿用和损坏数据降级。微信分享面板、系统弹窗、数字键盘、安全区以及真机视觉仍需在微信开发者工具或真机验证；最终验收状态见 `specs/001-today-can-spend/acceptance.md`。
