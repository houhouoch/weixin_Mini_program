# 今天还能花｜微信小程序

一个以“今天还能安全花多少钱”为核心的本地记账与预算小程序。项目使用微信原生 JavaScript、WXML、WXSS 和 JSON 开发，不依赖后端、云开发或第三方 UI 库。

## 仓库包含什么

| 目录 | 用途 | 建议 |
| --- | --- | --- |
| 仓库根目录 | 功能完整版本，包含预算、记账、账单导入、回看、导出和备份 | 后续功能开发优先使用 |
| `today-can-spend-minimal/` | 独立的简约视觉版本，使用单独的本地存储键 | 用于预开发和对比验证 |

两个版本都可以作为独立的小程序项目导入微信开发者工具。

## 主要功能

- 首次使用可直接以收入 ¥8,000、固定支出 ¥800、储蓄目标 ¥2,000 的示例预算“先看看”，之后再从设置修改。
- 按工资或生活费到账日自定义预算周期，例如每月 15 日至下月 14 日。
- 设置固定收入、储蓄目标和固定支出；固定支出支持直接填写或由明细自动合计。
- 快速记录支出与额外收入，文字和语音支持中文数字与多笔拆分；每笔用途、金额、分类和时间都在确认后才保存。
- 支持直接拍照或从相册选择消费图片；当前无后端版本仅在本机预览并手动核对，不伪造 OCR 结果。
- 每日建议额度按“可支配周期预算 ÷ 周期总天数”稳定计算；首页显示已扣除储蓄目标后的本月省下金额。
- 按日、月、年或自定义时间段查看流水；月度分析可切换近 36 个月，点击日历日期可查看当天支出，并用平滑曲线展示每日支出走势。
- 在同一入口本地解析微信支付 XLSX/CSV 和支付宝 CSV 账单，支持预览、去重和批次撤销。
- 导出 Excel 流水，生成或恢复完整 JSON 本地备份。
- 提供周总结、主题颜色和不携带逐笔数据的微信分享。

## 数据与隐私边界

- 所有预算和流水默认只保存在当前微信客户端的本地存储中。
- 不要求登录，不读取微信昵称、头像、手机号、OPENID 或通讯录。
- 账单文件只在设备本地解析；原始文件、交易单号和身份信息不会写入 Git 仓库。
- 拍照/相册记账只使用微信返回的临时图片路径，不保存图片，不上传图片。若后续接入 OCR，需要单独评审服务端、密钥、成本和隐私告知。
- 仓库中的 `project.config.json` 使用测试 AppID。每台电脑的真实 AppID 写入已忽略的 `project.private.config.json`，请勿提交该文件。

## 项目结构

```text
app.*                         完整版小程序入口与全局样式
pages/index/                  完整版单页界面
domain/                       金额、日期、预算和账单解析纯逻辑
infrastructure/               本地存储与文件系统边界
services/                     预算、流水、导入导出、备份和主题服务
tests/                        Node 自动化测试
scripts/check-structure.js    小程序结构与包体静态检查
docs/                         PRD、设计交付与验证资料
specs/001-today-can-spend/    SDD 规格、任务和验收矩阵
today-can-spend-minimal/      可独立导入的简约版本
```

## 首次拉取与导入

Windows 和 macOS 使用同一套仓库：

```bash
git clone https://github.com/houhouoch/weix_iMini_program.git
cd weix_iMini_program
```

随后安装并打开[微信开发者工具](https://developers.weixin.qq.com/miniprogram/dev/devtools/download.html)，选择“导入项目”：

- 完整版：选择仓库根目录。
- 简约版：选择 `today-can-spend-minimal` 目录。
- 项目类型选择“小程序”，先使用测试号编译，或在项目详情中选择你自己的 AppID。

### 配置每台电脑的 AppID

本仓库正式发布目标为“今天还能花多少钱”（AppID：`wxd7449a88684708f3`）。有该小程序权限的开发者应把此 AppID 写入本机的 `project.private.config.json`；公开的 `project.config.json` 继续保留测试 AppID。

最简单的方式是在微信开发者工具中选择实际 AppID，工具会生成本机专用的 `project.private.config.json`。也可以手动复制示例：

```bash
# 完整版
cp project.private.config.example.json project.private.config.json

# 简约版
cp today-can-spend-minimal/project.private.config.example.json \
   today-can-spend-minimal/project.private.config.json
```

将新文件中的 `touristappid` 替换为实际 AppID。Windows PowerShell 可把 `cp` 换成 `Copy-Item`。私有配置已被 `.gitignore` 排除，不会随提交同步到 GitHub。

### 启用语音记账

项目使用微信官方“微信同声传译”插件（AppID：`wx069ba97219f66d99`）。发布账号需要先在微信公众平台的“小程序信息设置 → 第三方设置 → 插件管理”中添加该插件；未获得插件权限时，页面会明确提示并继续保留手动文字输入，不会阻断记账。

首次使用语音时，微信会申请麦克风权限。用户点击麦克风开始、再次点击结束；识别文本进入与手动输入相同的账单确认流程，不会自动保存。

## 本地验证

项目运行时没有 npm 依赖。自动化测试建议使用 Node.js 18 或更高版本。

```bash
# 完整版
node --test tests/*.test.js
node scripts/check-structure.js

# 简约版
cd today-can-spend-minimal
node --test tests/*.test.js
node scripts/check-structure.js
```

Node 测试验证业务逻辑和静态结构；微信开发者工具中的编译、Console、模拟器和真机预览仍是发布前的最终验证边界。

## Windows 与 Mac 协作流程

每次开始修改前先同步远端，避免两台电脑同时积累未提交改动：

```bash
git switch main
git pull --rebase origin main
git switch -c feature/你的功能名
```

完成修改并验证后：

```bash
git add <本次修改的文件>
git commit -m "feat: 简要说明"
git push -u origin feature/你的功能名
```

合并功能分支后，另一台电脑再次执行 `git switch main` 和 `git pull --rebase origin main`。不要提交真实账单、导出的流水、备份文件或 `project.private.config.json`。

## 产品与开发文档

- [产品需求文档](docs/PRD.md)
- [SDD 功能规格](specs/001-today-can-spend/spec.md)
- [实施计划](specs/001-today-can-spend/plan.md)
- [验收矩阵](specs/001-today-can-spend/acceptance.md)
- [设计交付说明](docs/design/DESIGN_HANDOFF.md)
- [简约版说明](today-can-spend-minimal/README.md)

## 当前技术约束

- 原生 JavaScript/WXML/WXSS/JSON。
- 单页面、无 tabBar、无第三方 UI 库。
- 本地存储优先，不接云开发和后台服务。
- 页面不直接读写缓存，数据操作由服务与基础设施模块统一处理。
