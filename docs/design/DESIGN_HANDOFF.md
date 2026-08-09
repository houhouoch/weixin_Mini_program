# 设计交付说明

## 设计结论

首页采用“暖色编辑插画 + 预算轨道 + 黄色记录台 + 纸质小票”的单页结构。视觉先回答“今天还能花多少”，记录动作再回答“这笔花在哪儿”，避免只有金额输入和连续白色圆角卡片的通用 AI 界面感。

## 交付物

- Figma 可编辑稿：[今天还能花 V2｜原创插画记账页](https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=7-3)
- Figma 节点：\`7:3\`（375 × 1366）
- Figma 本地快照：\`docs/design/figma-preview.png\`（375 × 1366）
- 原创主视觉：\`assets/images/spending-journey-hero-v2.jpg\`
- UI 规范：\`design-system/default/MASTER.md\`
- 首页覆盖规则：\`design-system/default/pages/home.md\`

## V1.2 概念稿

原 V2 节点 `7:3` 保持不变。新方案放在独立 Figma Section `17:2` 中，五张稿可分别评审，不会覆盖当前设计：

| 方案 | Figma 节点 | 本地快照 | 设计重点 |
|---|---|---|---|
| 正常 | [17:3](https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=17-3) | `docs/design/figma-v1.2-normal.png` | 作为对照基线，完整保留当前 V2 |
| 额度将尽 | [17:87](https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=17-87) | `docs/design/figma-v1.2-running-low.png` | 琥珀状态、剩余金额、13% 标签和接近满格进度 |
| 今日超额 | [17:171](https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=17-171) | `docs/design/figma-v1.2-today-overspent.png` | 明确显示“已超 ¥20.00”，标题、文案、进度和标签共同转为危险状态 |
| 消费回看展开 | [17:255](https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=17-255) | `docs/design/figma-v1.2-spending-review.png` | 单页日/月/年切换、三日摘要、7 天趋势和最高分类 |
| 主题工作室 | [17:339](https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=17-339) | `docs/design/figma-v1.2-theme-studio.png` | 6 套预设、安全微调、语义警示色锁定 |

整组对比快照为 `docs/design/figma-v1.2-concepts.png`。这五张设计确认稿已同步到小程序单页运行代码；Figma 节点继续作为视觉基线，不覆盖原 V2。

## V1.3 折叠与历史纠错

V1.3 位于独立 Figma Section `25:2`，继续保留 V2 原创插画与视觉语言，同时把非核心内容改为按需展开：

| 状态 | Figma 节点 | 本地快照 | 设计重点 |
|---|---|---|---|
| 折叠首页 | [25:3](https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=25-3) | `docs/design/figma-v1.3-collapsed-home.png` | 核心金额与预算轨道常驻；消费回看、记一笔、记录与历史分别折叠 |
| 历史展开 | [25:4](https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=25-4) | `docs/design/figma-v1.3-history-expanded.png` | 原生日期入口、当日笔数/总额、逐笔修改与删除 |
| 修改明细 | [25:5](https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=25-5) | `docs/design/figma-v1.3-edit-transaction.png` | 底部抽屉修改分类、用途、金额与同月日期，并明确跨月边界 |

三张稿均按 375px 宽度逐张导出检查。Figma 文件没有本地组件、变量、样式或可用 Code Connect 映射，因此本轮遵循原文件的独立画板方式扩展，没有覆盖旧节点。
整组对比快照为 `docs/design/figma-v1.3-concepts.png`。

## 图片来源

主视觉由 GPT 图像生成能力根据本产品提示词原创生成，内容为咖啡、交通、购物、收据和硬币组成的日常消费路径。原图先上传到 Figma 用于裁切、排版和叠加动态金额；Figma 本身不负责生成这张图片。仓库运行资产压缩为 1024 × 683、约 148 KB 的渐进式 JPEG；设计快照保留在仓库但不进入微信主包。

图片不含文字、品牌、水印、人物身份或用户消费明细。小程序运行时使用仓库内 JPEG，不依赖短期 Figma 资源链接。

## 工具选择

- 本轮正式链路：图像生成 → Figma → 原生 WXML/WXSS。
- Open Design 已退出当前交付链路。对于这个单页探索稿，它与 Figma 的排版职责重复，且没有提供代码约束、多人批注或批量页面生成等额外收益。
- 如果未来需要快速生成大量 HTML 页面候选、浏览器响应式原型或非设计人员直接改网页结构，Open Design 才有重新引入的理由。

## 关键规范

- 主色：森林绿 \`#123F35\`；背景：暖纸色 \`#F5EBD7\`；强调：奶油黄 \`#F4B942\`、珊瑚红 \`#E96950\`。
- 交易字段为“分类 + 可选用途 + 金额 + 时间”；分类固定为餐饮、交通、购物、日用、娱乐、医疗、人情、其他。
- 最近记录展示分类、用途、时间和金额；用途为空时用分类名补位。
- 分享区明确“只分享结果，不分享消费明细”，分享路径不携带逐笔数据或身份字段。
- 主要触控区域按 88rpx 目标设计；不加载网络字体或第三方 UI。

## 已验证与待验证

- 已验证：原创图片已本地化；原 V2/V1.2 未被覆盖；V1.3 三张节点均可独立打开；375px 快照无横向裁切；折叠标题、日期明细、修改抽屉及触控目标可读。
- 已实现并自动验证：语义状态转换、日/月/年聚合、schema 3 历史归档、指定日期读取、当前月/归档纠错、同月日期边界、主题预设与核心对比度。
- 待开发者工具验证：微信导航栏、安全区、系统字体差异、数字键盘、用途输入、折叠/保存/删除交互、好友分享面板和朋友圈入口。
