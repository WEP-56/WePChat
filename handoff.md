# WepChat 接手文档

## 当前状态

WepChat 是一个基于 HBuilderX/uni-app 思路推进的移动端 LLM 聊天应用原型，目前仍以静态 Vue 页面为主，入口是 `index.html`。项目已经具备基础聊天、模型提供商配置、Markdown 渲染、工具调用、会话工作区、文件查看/编辑/HTML 预览、导入导出和 Android 打包配置。

当前前端主体文件：

- `index.html`：Vue 模板与页面结构。
- `css/app.css`：移动端 UI 样式。
- `js/app.js`：应用主逻辑、会话、设置、工作区、预览与导出。
- `js/api.js`：模型 API 适配与流式响应。
- `js/tools.js`：Agent 工具定义与执行。
- `js/store.js`：本地存储。
- `js/markdown.js` / `js/util.js`：Markdown 与通用能力。

## 已完成的重点能力

- 多提供商与多接口类型适配，支持常见 OpenAI 兼容接口。
- SSE/流式文本体验优化。
- 工具调用卡片、思考内容、diff 结果展示。
- 会话级工作区：文件树、新建、上传、删除、导出。
- HTML/Markdown/源码统一文件查看入口，HTML 支持预览、源码、控制台。
- Agent 工具：`run_js`、`preview_html`、`read_file`、`write_file`、`edit_file`、`delete_file`、`list_files`、`web_fetch`。
- 工具权限设置，删除文件仅支持询问或禁止。
- Android manifest 已按当前目标收敛权限，保留拍照、语音、文件、缓存、安装、应用数据等未来能力。

## 设计方向

WepChat 不只是聊天客户端，也在向“手机端轻量代码生成器 / HTML 编辑器 / 会话工作区”演进。Agent 写代码时应优先写入当前会话工作区，而不是把完整代码堆在聊天正文中。用户可以直接打开 `.html` 文件预览、编辑源码、查看控制台，再导出到其他设备继续运行。

## 下一阶段重点

### 1. 生图模式

目标是把生图变成一等模式，而不是普通聊天附件的补丁。

建议拆成：

- 提供商能力配置：文本模型、图像生成模型、图像编辑模型分开配置。
- 生图会话 UI：提示词、尺寸、风格、批量数、种子、参考图、结果网格。
- 结果管理：生成图自动进入当前会话工作区，支持预览、重命名、导出。
- 工具化：Agent 可请求生成图片，但应保留权限确认和成本提示。

轻量实现优先级：

1. 先支持 OpenAI 兼容或少数固定图像 API。
2. 结果以 dataURL/blob 写入工作区。
3. 后续再做图像编辑、局部重绘和多提供商抽象。

### 2. 简单 Linux 实例 / 扩展自身

纯 HBuilderX/Vue/WebView 不能直接提供真实 Linux 实例，也不能稳定运行后台进程、Node/Python 服务或 localhost 端口。要实现类似 Termux 的能力，通常需要 Android 原生层、插件、Termux 集成或远程沙盒。

可行路径按轻量程度排序：

1. **当前 Web 沙盒增强**：继续强化 JavaScript Worker 沙盒、文件工作区、HTML 预览。成本最低，适合数学、文本处理、加解密、简单代码生成。
2. **内置 WebAssembly 运行时**：评估 QuickJS、Python WASM、SQLite WASM 等，提供更强的本地执行能力，但包体、性能和兼容性需要验证。
3. **Android 原生插件**：通过 Kotlin/Java 插件接入受限命令执行或嵌入轻量运行时。能力强，但会明显增加维护和打包复杂度。
4. **Termux/外部应用联动**：调用外部 Termux 或类似环境。实现真实 Linux 能力，但用户安装和权限体验较重。
5. **远程沙盒**：把代码执行放到云端。体验接近 ChatGPT/Codex，但需要账号、成本、隔离、安全和网络依赖。

短期不建议直接追求完整 Linux。更稳妥的下一步是做“轻量本地执行层”：

- JavaScript Worker：保留默认计算与文本处理。
- HTML 工作区预览：继续作为小应用运行环境。
- 可选 Python/WASM 原型：先验证包体、启动时间和常用库可用性。
- 所有文件读写仍限定在会话工作区。

## 风险与注意事项

- Android WebView 的文件保存/目录选择能力不稳定，现有实现会优先使用浏览器文件选择 API，不支持时降级到下载目录或 Documents/wepchat。
- 后台进程、localhost 服务、真实 shell 不能在纯 Web 层承诺。
- 工具权限必须保持保守，尤其是删除文件、网络访问、未来代码执行和生图付费请求。
- 后续如果接入原生插件，需要同步维护 HBuilderX 云打包配置和 Android 权限声明。
