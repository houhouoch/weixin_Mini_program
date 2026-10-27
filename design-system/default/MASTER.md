# Apple 6.0 视觉系统

2026-10-27 用户确认。Figma: https://www.figma.com/design/IvhaEfmEubegbJT66jgkgC?node-id=172-230

原生 WXML/WXSS，系统字体，无 UI 库。浅色背景 #F5F5F7 / 白色表面 / #1D1D1F 正文 / #6E6E73 次文 / #0066CC 强调；石墨 #1C1C1E / #2C2C2E / #3A3A3C / #F5F5F7 / #AEAEB2 / #2997FF。成功与危险为独立语义色。

横向留白 24px；主金额 56px 按长度降级；标题 23–27px/600，正文 15px、说明 11–13px。面板圆角 16px，输入 12px，浮动底栏 22px。导航图标 27px、文字 11px、间距 4px、触控高 64px，底部跟随安全区。

过渡 180–240ms；按下 scale(.98)；录音和请求期间才显示波形/骨架。减少动态效果设置持久化并禁止位移动画与循环动画。使用 Phosphor 本地 SVG；不使用截图代替可编辑动态界面。
