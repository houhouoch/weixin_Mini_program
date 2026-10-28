# 今天还能花｜微信小程序

## Apple 6.0 界面（2026-10-27）

已应用用户确认的 [Apple 6.0 设计](https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=172-230)：浅色/石墨、27px 导航图标、清晰表面层级、录音波形、识别骨架、240ms 曲线展开与保存反馈。设置中的“减少动态效果”独立随主题保存，不改变账本 schema 5；旧主题与备份继续兼容。

首页提供额度计算说明和始终可用的手动入口；确认页逐笔调整支出/收入、分类、金额与时间，分别显示收支合计，确认前不保存。账单按收支独立显示数量和空态，日历可回看往月并点击日期，走势使用真实支出并留空未来日期。模板、历史、日/月/年/自定义分析放在设置的“更多工具”；导入预览/去重/撤销、Excel、JSON 备份恢复、预算周期、固定支出明细与分享均保留。

本次验收：60/60 Node 测试、结构检查、微信 WXML/WXSS 编译、25 项开发者工具检查；真实千问将“咖啡花了50，朋友给我a了20”拆为支出50与收入20，保存/修改/删除均验证，测试流水已清理。Console 无错误/警告，`auto_preview` 成功（848125 字节）。录音界面以页面状态替身检查；手机麦克风授权、真实转写和手持触控仍需手机实测，预览成功不代表这些项目已验收。


一个以“今天还能安全花多少钱”为核心的本地记账与预算小程序。预算、流水和账单文件保持本地优先；主动提交的文字或语音由阿里百炼千问整理，本地规则作为不可用时的回退。

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
- 快速记录支出与额外收入，文字和语音支持中文数字与多笔拆分；提交后优先由阿里百炼千问整理，不可用时回退本地规则，每笔用途、金额、分类和时间都在确认后才保存。
- 每日建议额度按“可支配周期预算 ÷ 周期总天数”稳定计算；首页显示已扣除储蓄目标后的本月省下金额。
- 按日、月、年或自定义时间段查看流水；月度分析可切换近 36 个月，点击日历日期可查看当天支出，并用平滑曲线展示每日支出走势。
- 在同一入口本地解析微信支付 XLSX/CSV 和支付宝 CSV 账单，支持预览、去重和批次撤销。
- 导出 Excel 流水，生成或恢复完整 JSON 本地备份。
- 提供周总结、Apple 风格浅色/深色外观和不携带逐笔数据的微信分享。

## 数据与隐私边界

- 所有预算和流水默认只保存在当前微信客户端的本地存储中。
- 不要求登录，不读取微信昵称、头像、手机号、OPENID 或通讯录。
- 账单文件只在设备本地解析；原始文件、交易单号和身份信息不会写入 Git 仓库。
- 用户主动提交的文字或语音转写会发送到国内阿里云 FC 与千问，最长 500 字；AI 不可用时回退本地规则，不保存为云端流水。
- 仓库中的 `project.config.json` 使用测试 AppID。每台电脑的真实 AppID 写入已忽略的 `project.private.config.json`，请勿提交该文件。

## 项目结构

```text
app.*                         完整版小程序入口与全局样式
serverless/parse-ledger/     阿里云 FC 千问解析函数
config/ai.js                 FC HTTPS 接口地址（不含凭据）
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

### 启用阿里百炼千问

1. 在阿里云华北 2（北京）开通百炼按量服务，并创建 API Key。
2. 在国内地域创建 Function Compute 3.0 Node.js 18 或更高版本函数，上传 `serverless/parse-ledger`，处理程序设为 `index.handler`；当前验证环境使用 Node.js 20。
3. 创建 POST HTTP 触发器；开发阶段可使用 FC 测试域名，正式发布前绑定已备案 HTTPS 自定义域名并加入小程序“request 合法域名”。
4. 当前仓库配置的 `fcapp.run` 地址只用于开发预览，不作为正式发布域名；API Key 与微信 AppSecret 只能保存在 FC 环境变量中，不得写入小程序代码或 Git。
5. 在 FC 环境变量中配置 `DASHSCOPE_API_KEY`、`WECHAT_APP_ID` 和 `WECHAT_APP_SECRET`；可选 `DASHSCOPE_MODEL`，默认 `qwen3.7-flash`。
6. 将 HTTP 地址写入 `config/ai.js` 的 `endpoint`。API Key 与微信 AppSecret 禁止写入小程序源码或 Git。

## 本地验证

小程序端没有 npm 依赖；FC 使用 Node.js 18 内置模块。自动化测试建议使用 Node.js 18 或更高版本。

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
- 本地存储优先；阿里百炼千问用于用户主动提交的文字/语音解析，不保存预算、流水、账单文件或照片。
- 页面不直接读写缓存，数据操作由服务与基础设施模块统一处理。

## 发布包资源检查（2026-10-27）

发布配置已排除 `.impeccable` 设计验收截图及 `assets/images` 旧版插画，文件仍保留在本地仓库。当前 Apple 6.0 页面只使用图标资产；微信开发者工具重新扫描显示“未发现代码质量问题”。60 项 Node 测试、结构检查、WXML/WXSS 编译与 8 项页面回归通过，Console 无错误或警告；新手机预览包为 476819 字节（原包 848125 字节）。

`2026.10.27` 上传已由开发者工具确认成功，但不代表已提交审核或发布。正式 AI 仍使用 FC 测试域名；用户确认尚无域名，正式域名及 request 合法域名尚未验收。发布后台当前被浏览器安全策略拦截，不能代为提交审核或发布。

## 保存与分析交互（2026-10-28）

记账确认后显示保存笔数与“撤销 N 笔”，新记录短暂高亮，今日额度平滑更新。撤销只影响当前会话最近一次保存且未修改的记录；记录已经改动时会拒绝整批撤销。离开小程序或再次成功记账后，原撤销入口失效；普通账单修改和删除入口保留。

日历和每日走势可以互相选择日期，曲线上显示选中标记与当日支出；零支出日可查，未来日期不可选，切换月份会清空旧选择。减少动态效果时额度和曲线直接显示最终状态。

本次不改变导入方式、预算公式、账本 schema 或本地存储位置。服务增加 createBatch/undoCreate 命令，一次校验后一次写入；AI 草稿、手动录入、模板共用该保存链路。已写入但刷新失败会明确提示“已保存”，避免重复记账。验收结果见规格中的 acceptance.md；手机实测与模拟器验证分开记录。

本次验收：69/69 Node 测试、结构检查、微信官方编译、10 项原生页面回归及手动保存/撤销补测通过，Console 无错误或警告。481025 字节手机预览包已推送；手机手持操作仍待验收，本次未正式上传或发布。

## 曲线拖动查看（2026-10-28）

在曲线上左右拖动可连续查看日期和当日支出；松手保留选择并读取当天明细。上下滑动继续滚动页面。明细已移到曲线下方，展开不会推走图表；往月可点“回到本月”。拖动直接使用月度汇总，不逐像素读取账本，不更改账本数据、预算公式、导入流程或本地存储格式。

连续拖动版本验收：72 项测试、11 项模拟器回归、编译与 Console 检查通过。484194 字节手机预览已推送；手机手持操作待验收。
