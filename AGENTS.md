# Agent entrypoint

Before changing this repository, read and follow [`Agent.md`](./Agent.md). It is the
project's authoritative engineering and product rulebook.

For feature work, also read the active specification under `specs/` and keep its
`tasks.md` and `acceptance.md` aligned with the implementation.

## 微信小程序操作规则

1. 修改小程序源码时，直接操作项目文件，不通过 GUI 编辑器复制粘贴。
2. 打开、编译、预览、上传项目时，优先使用微信开发者工具官方 CLI 或 miniprogram-ci。
3. 页面点击、输入、导航、截图、日志检查和回归测试，优先使用 miniprogram-automator 或已配置的微信小程序 MCP。
4. MCP 连接异常时，回退到官方 CLI 或 Automator，不立即改用鼠标操作。
5. 只有 MCP、CLI、Automator 均无法完成且必须查看真实界面时，才进行最少量 GUI 操作。
6. 每次修改完成后必须执行：编译检查、关键页面自动化测试、Console 错误检查和真机预览。
