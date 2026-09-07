# Agent entrypoint

Before changing this repository, read and follow [`Agent.md`](./Agent.md). It is the
project's authoritative engineering and product rulebook.

For feature work, also read the active specification under `specs/` and keep its
`tasks.md` and `acceptance.md` aligned with the implementation.

## 微信小程序操作规则

1. 根据任务需要选择 Computer Use／GUI、MCP、CLI 或 Automator；无需先尝试其他工具或因使用 Computer Use／GUI 单独请求确认。工具选择不改变任务范围和操作本身的授权要求。
2. 每次修改完成后必须执行：编译检查、关键页面自动化测试、Console 错误检查和真机预览。
