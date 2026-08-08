# Implementation Plan

## 架构

```text
pages/index (展示与交互)
  -> services/budget-store (预算与月份生命周期，Promise)
  -> services/transactions (仅 addTransaction/listTransactions，Promise)
  -> services/analytics (trackEvent 隐私过滤)
  -> domain/budget (纯计算)
  -> domain/date (纯日期)
  -> infrastructure/storage (唯一微信缓存边界)
```

交易删除使用 `addTransaction({ action: 'delete', transactionId, commandId })`，从而满足交易模块仅暴露两个 API，同时保留删除能力。防重复由页面锁和数据层 `commandId` 幂等共同保证。

## 文件计划

- `app.js|json|wxss`：应用生命周期与全局基础样式。
- `project.config.json`、`sitemap.json`：开发者工具导入配置。
- `pages/index/*`：唯一页面。
- `domain/money.js`：金额解析/格式化。
- `domain/date.js`：月键、日键、剩余天数。
- `domain/budget.js`：预算派生与状态。
- `infrastructure/storage.js`：Promise 化微信缓存。
- `services/budget-store.js`：设置、读取、重置、跨月。
- `services/transactions.js`：添加、删除命令、列表。
- `services/analytics.js`：统一隐私安全事件。
- `tests/*.test.js`：Node 内建测试。
- `scripts/check-structure.js`：页面数、缓存边界、分享和文件结构检查。
- `preview/`：独立浏览器视觉预览，不参与小程序运行。

## 实施顺序

1. 纯金额/日期/预算逻辑与测试；
2. 存储边界与服务；
3. 页面状态机与交互；
4. 样式和响应式；
5. 分享与埋点；
6. 自动化检查、Open Design/Figma 预览和开发者工具验证说明。

## 验证策略

- `node --test tests/*.test.js`：公式、边界、日期、服务幂等、损坏存储。
- `node scripts/check-structure.js`：单页、无 tabBar、页面无缓存 API、分享入口和所需文件。
- 浏览器预览截图：375px 与窄屏布局。
- 微信开发者工具：导入、编译、分享生命周期、键盘、系统弹窗、安全区；若本机不可自动操作则标记待验证。
