# 首页视觉覆盖规则

本页是 MASTER 的具体落地，Figma 目标节点为 [V2 节点 7:3](https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=7-3)。

## 信息顺序

1. 标题和日期；
2. 原创消费旅程插画 + 今日可花金额 + 人格；
3. 今日已花、本月可用和额度进度；
4. 分类、可选用途、金额、保存；
5. 小票式最近记录；
6. 隐私安全分享。

## 数据映射

| 视觉位置 | 数据 |
|---|---|
| 主金额 | result.todayRemainingText |
| 人格标签 | result.persona |
| 预算轨道 | 今日已花 / 今日建议额度 |
| 分类快捷项 | categories + selectedCategoryId |
| 用途输入 | noteInput，最多 20 个字符 |
| 小票行 | categoryLabel、purposeText、occurredAtText、amountText |

## 页面规则

- 主图使用 /assets/images/spending-journey-hero-v2.png，aspectFill，文字层由 WXML 独立渲染。
- 分类固定两行四列；默认餐饮，保存后保留所选分类，清空用途和金额。
- 小票最多展示最近 5 笔，行高允许删除触控区，不固定整个小票高度。
- 用途为空时用分类名作为标题，避免空白或“未命名”。
- 余额状态只改变轨道进度色，不替换整张主图。
- 底部抽屉继续承担首次设置与修改预算，不新增页面或 tabBar。
