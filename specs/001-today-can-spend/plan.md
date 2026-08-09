# Implementation Plan

## 架构

```text
pages/index (展示与交互)
  -> services/budget-store (预算与月份生命周期，Promise)
  -> services/transactions (仅 addTransaction/listTransactions，Promise)
  -> services/spending-summary (日/月/年本地聚合，Promise)
  -> services/theme-store (预设与安全微调，Promise)
  -> services/analytics (trackEvent 隐私过滤)
  -> domain/categories (分类白名单与展示名)
  -> domain/budget (纯计算)
  -> domain/date (纯日期)
  -> infrastructure/storage (唯一微信缓存边界)
```

交易修改与删除使用 `addTransaction({ action: 'update' | 'delete', transactionId, commandId, ... })`，从而满足交易模块仅暴露两个 API，同时支持当前月和归档纠错。`listTransactions({ dateKey })` 在同一读取 API 内提供按日明细。防重复由页面锁和数据层 `commandId` 幂等共同保证。

V1.2 已按“历史归档与聚合纯函数 → 消费回看 → 主题 token 派生”的顺序实现。页面只保存有限主题参数，不保存任意 CSS/WXSS 色值。年度总额可以包含启用前汇总，但年度趋势、最高月和分类排行只使用真实逐笔记录，并显示数据范围说明。

## 文件计划

- `app.js|json|wxss`：应用生命周期与全局基础样式。
- `project.config.json`、`sitemap.json`：开发者工具导入配置。
- `pages/index/*`：唯一页面。
- `domain/money.js`：金额解析/格式化。
- `domain/date.js`：月键、日键、剩余天数。
- `domain/budget.js`：预算派生与状态。
- `domain/categories.js`：固定分类白名单与展示名。
- `infrastructure/storage.js`：Promise 化微信缓存。
- `services/budget-store.js`：设置、读取、重置、跨月。
- `services/transactions.js`：添加、修改、删除命令与当前/归档按日列表。
- `services/spending-summary.js`：按日/月/年聚合真实本地记录。
- `services/theme-store.js`：主题预设、安全微调和默认恢复。
- `services/analytics.js`：统一隐私安全事件。
- `tests/*.test.js`：Node 内建测试。
- `scripts/check-structure.js`：页面数、缓存边界、分享和文件结构检查。
- `assets/images/`：小程序直接使用的本地原创视觉资产。

## 实施顺序

1. 纯金额/日期/预算逻辑与测试；
2. 存储边界、交易字段迁移与服务；
3. 分类、用途、金额页面状态机与交互；
4. ImageGen 原创资产、Figma 高保真稿、样式和响应式；
5. 分享与埋点；
6. 自动化检查、Figma 预览和开发者工具验证说明。

## V1.2 实施顺序

1. 语义状态文案和样式映射；
2. 日/月聚合纯函数与消费回看模块；
3. schema 3 历史归档迁移和真实年视图；
4. 主题预设、token 派生和安全微调；
5. 开发者工具与真机的状态、图表、主题对比度验证。

## V1.3 实施顺序

1. 扩展交易服务以定位当前月或归档记录；
2. 实现按日期读取、原月份内修改和归档删除；
3. 将回看、记账、记录与历史改为独立折叠区；
4. 新增日期明细和交易编辑底部抽屉；
5. 自动化、静态检查与开发者工具交互验证。

## 验证策略

- `node --test tests/*.test.js`：公式、边界、日期、服务幂等、损坏存储。
- `node scripts/check-structure.js`：单页、无 tabBar、页面无缓存 API、分享入口和所需文件。
- Figma 截图：375px 视觉、插画、表单和票据列表检查。
- V1.2 Figma 截图：正常、额度将尽、今日超额、消费回看展开和主题抽屉五种独立候选检查。
- 微信开发者工具：导入、编译、分享生命周期、键盘、系统弹窗、安全区；若本机不可自动操作则标记待验证。
