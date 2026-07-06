# WepChat 项目设想

WepChat 计划做成一个面向 Android 的轻量 LLM 聊天应用。主项目优先使用 uni-app / uni-app x / HBuilderX 开发，目标是保留跨端开发效率，同时尽量做出接近 Android 原生应用的体验，避免明显的网页套壳感。

## 产品方向

核心目标是做一个美观、简单、高效、功能完整的移动端 LLM 客户端，参考 ChatGPT、Claude 网页端，以及 Cherry Studio、Chatbox 这类客户端的思路，但移动端交互要更克制、更轻。

支持的能力：

- 多会话管理
- 会话文件管理
- Markdown 渲染
- 链接识别与预览
- HTML 预览
- 文件上传
- 数据导入导出
- 用户自定义模型提供商
- OpenAI-compatible、Responses、Completions、Messages 等常见接口适配
- 轻量 Agent 工具调用
- 本地 JavaScript 沙盒执行
- 可执行 HTML/CSS/JS 预览

## 技术判断

第一阶段不做完整 Linux 实例，也不做 Termux/PRoot 级别的运行环境。

原因：

- 移动端维护完整 Linux 运行环境成本高。
- Android 对本地可执行文件、进程、权限和文件系统有额外限制。
- 当前需求只是让 Agent 做简单计算、文本处理、加解密、数据转换和小工具预览，不需要真实 shell、包管理器、编译器或完整 rootfs。
- 完整 Linux 会把项目复杂度从“聊天客户端”推向“移动开发环境”，不适合作为第一版核心。

因此第一版采用更轻的方案：**JavaScript 沙盒 + HTML 预览 + 受控文件工作区**。

## Agent 沙盒设计

Agent 不需要内置 Linux，只需要有限、明确、可控的工具。

建议第一版工具：

```ts
run_js(code: string): Promise<{
  stdout: string
  stderr: string
  result?: unknown
}>

preview_html(input: {
  html: string
  css?: string
  js?: string
  files?: Record<string, string>
}): Promise<void>

read_file(path: string): Promise<string>

write_file(path: string, content: string): Promise<void>

list_files(path?: string): Promise<string[]>

web_fetch(url: string): Promise<string>
```

这些工具足够覆盖：

- 数学计算
- JSON/CSV/文本处理
- 正则提取
- hash、base64、简单加解密
- 小型数据分析
- 生成可交互 HTML 工具
- 生成图表、表格、计算器、小页面、小 demo
- 处理用户上传的文本类文件

## JavaScript 执行

`run_js` 不应直接在主 UI 环境里执行 `eval`。推荐隔离执行环境：

```text
主 WebView
  - 聊天 UI
  - 会话管理
  - 设置
  - 文件管理

Sandbox WebView / Worker
  - 执行 Agent 生成的 JavaScript
  - 捕获 console 输出
  - 限制运行时间
  - 限制输出大小
  - 不暴露 API Key
  - 不直接访问真实文件系统
```

执行策略：

- 每次执行使用独立上下文，避免污染主应用状态。
- 设置超时，例如 3-10 秒。
- 限制 stdout/stderr 最大长度。
- 禁止访问主应用敏感对象。
- 文件读写只能通过受控工具完成。
- 网络访问默认关闭，或由用户显式授权。

## HTML 预览

HTML 预览不只是静态渲染，而是允许执行局部 JavaScript，用于快速生成交互式小工具。

典型用法：

```text
用户：帮我做一个贷款计算器
Agent：生成 HTML/CSS/JS
App：调用 preview_html 展示可交互页面
```

预览面板建议提供：

- 预览
- 源码
- 控制台输出
- 保存到会话文件
- 导出 HTML
- 重新运行

HTML 预览同样应运行在隔离 WebView 中，不能直接读取真实文件、Provider Key 或应用内部配置。

## 安全边界

Agent 工具必须默认最小权限。

建议规则：

- Agent 只能访问当前会话的 workspace。
- 任何跨会话文件访问都需要用户确认。
- 网络请求默认关闭，或首次请求时弹窗确认。
- 不向沙盒暴露 API Key、用户隐私配置、系统路径。
- 所有工具调用都记录在会话中。
- 长时间运行自动中断。
- 大输出自动截断，并提示用户。
- 文件写入前可以显示 diff 或写入摘要。

## System Prompt 思路

Agent 的系统提示可以明确告诉模型：

```text
你可以使用 JavaScript 工具解决需要精确计算、文本处理、数据转换、编码解码、简单加解密的问题。

当需要制作可交互预览时，你可以生成 HTML/CSS/JS，并调用 HTML 预览工具。

不要访问用户未授权的文件。不要请求外部网络，除非用户明确要求。不要在代码中包含或读取 Provider API Key。

对于简单问题优先直接回答；只有在计算、验证、转换、生成可交互页面或处理文件时才调用工具。
```

## 第一版建议

第一版先做下面这些功能：

1. 聊天主界面
2. Provider 配置
3. OpenAI-compatible Chat Completions 接口
4. 会话列表与本地持久化
5. Markdown 渲染
6. 文件上传与会话文件
7. `run_js`
8. `preview_html`
9. 工具调用 UI
10. 数据导入导出

暂时不做：

- 完整 Linux
- 真实 shell
- Python 运行时
- Node.js 包管理
- git / 编译器
- 长时间后台任务

后续如果产品验证成功，再考虑加入 MicroPython、远程沙盒或 Android 原生插件。

## 当前结论

对于当前目标，uni-app / HBuilderX 可以继续作为主技术路线。

只要第一版把 Agent 能力定义为“轻量 JavaScript 沙盒 + 可执行 HTML 预览 + 受控文件工具”，就不需要 Kotlin 原生主项目，也不需要 Flutter，更不需要内置完整 Linux。
