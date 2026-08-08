# 设计交付说明

## 设计结论

首页采用轻量薄荷绿记账界面，视觉重点依次为“今天还能花”、今日/本月摘要、快速记账、最近记录和隐私分享。页面保持单列、单任务和大触控目标，适配微信小程序的移动端使用场景。

## 交付物

- Figma 可编辑稿：[今天还能花｜微信小程序单页预览](https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=4-2)
- Figma 本地快照：`docs/design/figma-preview.png`（515 × 1410）
- Open Design HTML：`C:\Users\admin\AppData\Roaming\Open Design\namespaces\release-stable-win\data\projects\project-a3ef\today-safe-spend.html`
- Open Design 品牌规范：`C:\Users\admin\AppData\Roaming\Open Design\namespaces\release-stable-win\data\projects\project-a3ef\brand-spec.md`
- UI/UX Pro Max 设计系统：`design-system/default/MASTER.md`
- 首页实现覆盖规则：`design-system/default/pages/home.md`

## 关键规范

- 主色使用深绿与薄荷绿，背景为低对比暖灰绿，避免高饱和度和装饰性渐变。
- 核心金额使用最大字号，卡片间距和圆角统一，按钮可触区不小于 44px。
- 最近记录只显示时间和金额，不引入饮品、杯数或消费分类模型。
- 分享区明确说明“不包含逐笔明细、OPENID 或身份信息”；分享标题可包含汇总数据。
- Figma 捕获文本的本机字体不可用时，仅将修正行替换为 `Noto Sans SC Regular`，其余捕获层保持不变。

## 已验证与待验证

- 已验证：Open Design HTML 可加载；Figma 节点已生成；本地快照无裁切；分享隐私文案已修正。
- 待开发者工具验证：微信导航栏、安全区、数字键盘、系统弹窗、好友分享面板与朋友圈入口的最终视觉。
