# 验证记录

验证日期：2026-08-13

## 自动检查

- `node --test tests/*.test.js`：47/47 通过；
- `node scripts/check-structure.js`：全部通过；
- JavaScript `node --check`：28/28 通过；
- WXML 事件处理器：全部存在；容器标签配平；
- WXSS：无渐变、虚线、装饰背景图；仅 9 个唯一六位十六进制色；
- 业务主包原始文件小于 1.5 MB。

## 微信开发者工具与 Automator

- 官方 CLI `auto`：成功打开独立 `touristappid` 项目；
- `miniprogram-automator`：6/6 关键流程通过：
  1. 空 storage 进入首次设置；
  2. 通过真实输入控件保存固定收入、固定支出和储蓄目标；
  3. “补充信息”默认收起，点击后展开，并通过真实金额/用途输入记录 `¥12.34`；
  4. 保存常用模板后可通过模板按钮一键记账；
  5. 消费回看和账本与数据均可展开；
  6. 设置和外观抽屉可打开并应用主题；
- 自动化只操作 `today-can-spend:minimal:v1` 与 `today-can-spend:minimal:theme:v1`，结束后已恢复原值；
- `exception`：0；业务日志错误：0。

Automator 同时收到 1 条无内容的 `{ type: 'error', args: [{}] }`。对照同一时间的开发者工具日志，来源是开发者工具 2.02.2608122 自身：

```text
[timing] markDevLaunchEnv timingData not found
```

该事件不来自小程序 `console.error`；小程序运行日志只有正常生命周期、storage、Toast 和 `wx.showShareMenu:ok`。自动化脚本仍保持严格模式并返回非零，避免把未知 Console error 静默当成通过；验收时将它单独归为开发者工具内部诊断。

## CLI preview

- 受跟踪项目继续使用 `touristappid`，避免把正式 AppID 写入仓库；
- CLI 使用临时副本和本机已有测试 AppID 成功生成 preview；
- 包体：416,995 Byte（407.2 KB）；
- 证据：`docs/design/preview-info.json`、`docs/design/wechat-preview-qr.png`。

## 视觉检查

- Figma 已新增独立页面 `Minimal 2.0 · 2026-08-13`；
- 可编辑画面包括正常首页、今日超额首页、预算设置抽屉；
- 微信模拟器截图确认：标题未裁切、金额未截断、设置抽屉尊重顶部和底部安全区，常用路径无需先展开；
- 视觉证据位于 `docs/design/`。

## 待开发者工具或真机验证

- 真实手机扫码后的分享面板与朋友圈右上角菜单；
- 微信/支付宝文件选择器、Excel/JSON 文件转发与保存；
- 原生日期选择器和数字键盘；
- 大字号、320px 小屏与更多华为/小米/iPhone 真机安全区；
- preview 二维码已生成，但本记录不冒充真实手机已扫码通过。
