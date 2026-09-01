# Implementation Plan

## 架构

```text
pages/index (展示与交互)
  -> services/budget-store (预算与月份生命周期，Promise)
  -> services/transactions (仅 addTransaction/listTransactions，Promise)
  -> services/spending-summary (日/月/年/自定义区间本地聚合，Promise)
  -> services/theme-store (浅色/深色外观与旧主题迁移，Promise)
  -> services/ledger-export (本地 XLSX 生成与文件写入，Promise)
  -> services/data-backup (完整 JSON 备份、预览与恢复，Promise)
  -> services/wechat-bill-import (账单解析、预览与已有流水去重，Promise)
  -> services/analytics (trackEvent 隐私过滤)
  -> domain/categories (分类白名单与展示名)
  -> domain/quick-entry (中文数字、多笔语句与外币参考换算纯规则)
  -> domain/budget (纯计算与关联校验)
  -> domain/ledger-workbook (纯 XLSX/ZIP 生成)
  -> domain/wechat-bill (纯 CSV/XLSX 解析、过滤与稳定指纹)
  -> domain/alipay-bill (纯 CSV 解析、状态/退款配对与稳定指纹)
  -> domain/gb18030 (支付宝官方 CSV 本地解码)
  -> domain/date (纯日期)
  -> infrastructure/storage (唯一微信缓存边界)
  -> infrastructure/file-system (小程序用户文件边界)
```

Apple 5.0 仍保持单页路由：文字/语音多笔核对与照片核对使用全屏状态层，不新增 tabBar 或后端。`wx.chooseMedia` 只提供相机/相册临时图片；未配置 OCR 服务时进入手动核对回退。月历与每日曲线在 `domain/spending-summary` 中由真实支出流水派生，页面只负责绘制。

月度分析使用独立 `detailsAnalysisSummary`，与日/月/年/自定义回看状态分离。页面保存所选月份键，服务继续读取同一份本地状态；领域层接收“真实今天 + 所选月份”，避免历史月误标今天或当前月日均按月初计算。

月历日期点击复用 `listTransactions({ dateKey })`，页面只筛选支出并派生当天合计与展示行；不新增交易 API、不复制存储，也不把收入混入支出日历。

交易修改与删除使用 `addTransaction({ action: 'update' | 'delete', transactionId, commandId, ... })`，从而满足交易模块仅暴露两个 API，同时支持当前月和归档纠错。`listTransactions({ dateKey })` 在同一读取 API 内提供按日明细。防重复由页面锁和数据层 `commandId` 幂等共同保证。

V1.2 已按“历史归档与聚合纯函数 → 消费回看 → 主题 token 派生”的顺序实现。当前外观只保存 `light` 或 `graphite` 模式，不保存任意 CSS/WXSS 色值；旧彩色主题统一迁移到浅色，旧 `midnight` 迁移到深色。年度总额可以包含启用前汇总，但年度趋势、最高月和分类排行只使用真实逐笔记录，并显示数据范围说明。

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
- `services/spending-summary.js`：按日/月/年/自定义时间段聚合真实本地记录。
- `services/theme-store.js`：浅色/深色外观、旧主题迁移和默认恢复。
- `domain/ledger-workbook.js`：将当前与归档逐笔记录生成标准 XLSX。
- `infrastructure/file-system.js`：Promise 化小程序用户目录写入、UTF-8/GB18030 文本与 XLSX 条目读取。
- `services/ledger-export.js`：读取本地状态并交付 Excel 文件。
- `services/data-backup.js`：生成、校验、预览和恢复完整本地 JSON 备份。
- `domain/wechat-bill.js`：CSV/XLSX 表头发现、支出过滤、分类推断与稳定指纹。
- `domain/alipay-bill.js`：支付宝 CSV 状态过滤、还款排除、退款配对、分类与稳定指纹。
- `domain/gb18030.js`：无运行时依赖解码支付宝官方 CSV。
- `services/wechat-bill-import.js`：统一读取并自动识别微信/支付宝账单，生成确认预览。
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
4. 浅色/深色外观、token 派生和旧主题迁移；
5. 开发者工具与真机的状态、图表、主题对比度验证。

## V1.3 实施顺序

1. 扩展交易服务以定位当前月或归档记录；
2. 实现按日期读取、原月份内修改和归档删除；
3. 将回看、记账、记录与历史改为独立折叠区；
4. 新增日期明细和交易编辑底部抽屉；
5. 自动化、静态检查与开发者工具交互验证。

## V1.4 实施顺序

1. 在预算领域层实现跨字段关联校验，页面和服务共用；
2. 汇总当前月与归档月的真实逐笔记录；
3. 用纯 JavaScript 生成 XLSX XML 与无压缩 ZIP/CRC 结构；
4. 写入小程序用户目录，通过 `wx.openDocument` 预览、通过 `wx.shareFileMessage` 转发；
5. 完成结构、CRC、字段隐私和回归验证。

## V1.5 实施顺序

1. 确认个人微信账单只能由用户主动导出并选择文件，不实现钱包直连。
2. 先实现无微信依赖的 CSV/XLSX 解析、表头发现、过滤与稳定指纹测试。
3. 在交易命令内部实现跨当前月与历史归档的批量写入和双层去重。
4. 在“记录与历史”折叠区加入选择、读取、可恢复错误、预览和确认导入。
5. 更新 PRD/Agent/验收，执行 Node、结构、开发者工具编译和真实脱敏文件检查。

## V1.6 实施顺序

1. 将固定月收入与逐笔额外收入分开建模，为交易增加收支方向与独立分类白名单。
2. 升级 schema 4，将旧 schema 1/2/3 当前与归档流水无损迁移为支出。
3. 预算只用收入增加可用额度；今日已花、消费回看和分类排行只聚合支出。
4. 在快速记录与编辑抽屉加入可访问的收支分段入口，历史显示正负号及收支合计。
5. Excel 增加收支列和双合计，补齐领域、服务、迁移与静态结构验证。

## V1.8 实施顺序

1. 扩展消费汇总纯函数，校验并聚合包含首尾日的自定义时间段。
2. 在现有消费回看折叠区加入原生起止日期选择器，不新增页面和存储字段。
3. 展示区间支出总额、自然日日均、支出笔数、最高分类及最多 7 段趋势。
4. 补充跨月、收入排除、启用前汇总排除和非法日期自动化测试。
5. 更新验收记录，并执行 Node、结构和微信开发者工具验证。

## V1.9 实施顺序

1. 修正负余额展示语义，扩展自定义统计分类构成与区间流水筛选。
2. 为新导入交易持久化本地批次元数据，并通过现有交易 API 实现整批撤销。
3. 新增完整 JSON 备份领域格式、文件交付、恢复校验和失败回滚。
4. 在现有折叠区加入按需展开的下钻、批次管理和数据备份入口。
5. 补充自动化、结构、开发者工具与 Git 收口验证。

## V2.0 实施顺序

1. 升级 schema 5，增加预算周期、固定支出明细、兼容用分类预算字段和根级常用模板，并完成旧版本迁移。
2. 将自然月归档与预算周期计算解耦，补齐跨月/跨周期服务状态和总预算关联校验。
3. 在既有设置抽屉加入周期和固定明细；在快速记账加入模板保存、一键记录和删除。
4. 扩展日回看周总结；分类预算输入与提醒按用户确认从页面移除。
5. 完成迁移、领域、服务、结构、开发者工具、文档与 Git 收口验证。

## V2.0.6 设置语义精简顺序

1. 将周期起始日解释为工资或父母生活费等稳定收入到账日，并保留 15 日至次月 14 日示例。
2. 将固定收入、固定支出提升为独立的高层级分组标题，补齐收入来源与支出边界说明。
3. 移除启用前已花输入；已有消费改为手工补记或微信/支付宝账单导入，页面保存时将兼容字段归零。
4. 对仍有旧汇总的设备给出保存前提示，不静默改变现有结果。
5. 更新静态验收、PRD、README，并完成 Node、微信开发者工具自动化、Console 与真机预览验证。

## V2.0.7 固定支出计算方式顺序

1. 在预算模型中增加向后兼容的 `fixedExpenseMode`，旧数据默认 `manual`，跨周期继续沿用。
2. 在设置抽屉增加“直接填写 / 明细合计”切换，保证两种模式都有明确文字状态和至少 88rpx 触控高度。
3. 明细合计模式实时计算只读总额；直接填写模式展示明细差额并提供一键同步。
4. 共用预算校验确保手工总额不小于明细、自动总额严格等于明细，同时保留收入和储蓄约束。
5. 补充领域、服务、结构和开发者工具交互验证，再完成文档与 Git 收口。

## V2.0.8 固定支出模式渐进披露顺序

1. 直接填写模式只保留固定支出总额输入，完全隐藏固定支出明细区域。
2. 页面和预算服务在直接填写模式保存空明细，避免隐藏字段触发校验或造成语义误解。
3. 明细合计模式继续展示明细、实时合计只读总额，并保留新增、修改和移除能力。
4. 更新当前 PRD、规格、设计规则和验收矩阵，再完成 Node、开发者工具和 Git 验证。

## 验证策略

- `node --test tests/*.test.js`：公式、边界、日期、服务幂等、损坏存储。
- `node scripts/check-structure.js`：单页、无 tabBar、页面无缓存 API、分享入口和所需文件。
- Figma 截图：375px 视觉、插画、表单和票据列表检查。
- V1.2 Figma 截图：正常、额度将尽、今日超额、消费回看展开和主题抽屉五种独立候选检查。
- 微信开发者工具：导入、编译、分享生命周期、键盘、系统弹窗、安全区；若本机不可自动操作则标记待验证。
