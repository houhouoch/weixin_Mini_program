# Implementation Plan

## 架构策略

```text
pages/index (重写信息架构与视觉，少量状态调整)
  -> services/* (保持接口与行为)
  -> domain/* (保持预算、日期、导入、统计与导出逻辑)
  -> infrastructure/storage (仅切换为简约版独立 key)
  -> infrastructure/file-system (保持文件边界)
```

## 实施顺序

1. 审计完整版功能、页面事件、状态与测试；
2. 建立独立 PRD、Agent、SDD、设计系统和验收基线；
3. 复制业务模块、测试和官方工具脚本；
4. 重写首页 WXML/WXSS，调整默认展开和简短状态文案；
5. 将六套主题收敛为中性表面 + 单强调色，并切换独立存储 key；
6. 更新结构检查，运行 Node 测试和语法检查；
7. 使用官方 CLI 启动后连接 Automator，检查关键交互、Console 和截图；
8. 生成真机预览包，更新 README、验收、Git 提交与推送状态。

## 验证策略

- `node --test tests/*.test.js`：业务等价与回归；
- `node scripts/check-structure.js`：单页、模块边界、首页层级、触控、语义状态和隐私；
- 微信开发者工具官方 CLI：编译和 preview；
- Automator：启动、设置、直接记账、折叠、主题、Console 和截图；
- 真实手机：扫码后的安全区、大字号、分享和文件系统菜单，未执行时明确标记。
