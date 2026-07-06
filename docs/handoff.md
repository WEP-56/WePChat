# WepChat 接手文档

更新时间：2026-07-06

## 当前状态

WepChat 目前仍是静态 Vue/H5 主体，按 HBuilderX/uni-app App 打包方向推进。入口是 `index.html`，核心风格保持“克制、轻量、快速”：偏日常随手生成、快速验证想法，不做 ComfyUI、Midjourney 或图库类重型工作站。

当前版本已 bump 到 `1.0.1 / 101`，用户正在准备上 Android 实机测试。

主要文件：

- `index.html`：Vue 模板与页面结构。
- `css/app.css`：移动端 UI 样式。
- `js/app.js`：应用主逻辑、会话、设置、工作区、预览、生图和导出。
- `js/api.js`：文本模型 API 适配与流式响应。
- `js/image-api.js`：图像生成/编辑接口适配。
- `js/model-metadata.js`：模型元数据、能力与默认模型配置。
- `js/tools.js`：Agent 工具定义与执行，包括 `image_go`。
- `js/store.js`：本地存储。
- `js/markdown.js` / `js/util.js`：Markdown 与通用能力。

## 已完成重点能力

### 模型与元数据

- 新增模型元数据系统：上下文、输出上限、视觉、思考、工具、结构化输出、图像生成/编辑等能力标记。
- 提供商内区分文本模型 `models` 和图像模型 `imageModels`。
- 增加从接口获取模型列表的适配基础，可吸收部分 `/models` 返回的元数据。
- 图像生成设置独立于文本模型配置，支持图像模型、生成路径、编辑路径等配置。

### 生图模式与 image_go

- 新会话创建时选择“常规 / 生图”，创建后固定模式。
- 生图模式支持直接调用图像模型。
- 常规模式暴露 `image_go` 工具，LLM 可判断生成或编辑图片意图并路由到图像模型。
- `image_go` 支持 `generate` / `edit`，可引用工作区图片路径；如果 LLM 漏填引用图，逻辑会尝试使用最近的用户图片附件。
- 用户在对话框上传的图片/文本文件会先进入当前会话工作区 `attachments/`，便于后续图像编辑。
- 生成图片会进入当前会话工作区 `images/`，并在消息内展示。
- 图片预览页在生图会话中有底部编辑输入框，可走 `/v1/images/edits`。
- 生图模式有轻量工作台抽屉和图像设置页，但定位仍是快速生成，不做复杂工作流编排。

图像接口当前重点适配 OpenAI Images 协议和常见中转：

- `POST /v1/images/generations`
- `POST /v1/images/edits`

不再把 provider 内置 `image_generation` tool 强行塞进 OpenAI Responses 工具列表，避免 `Tool choice 'image_generation' not found in 'tools' parameter` 这类冲突。

### 工作区与导出

- 会话工作区支持文件树、新建、上传、删除、预览、编辑、HTML 运行预览。
- 对话上传文件现在也进入工作区，文件流转统一从工作区开始。
- 图片和文件预览页支持导出。
- 工作区文件长按可打开单文件导出面板，桌面右键也可触发。
- Android/HBuilderX App 环境下导出策略改为：
  - 图片：存相册、系统分享、公共下载目录。
  - 普通文件：公共下载目录，文本类可走系统分享。
  - 整工作区：生成 ZIP，再写入公共下载目录。
- H5 环境保持浏览器保存/下载/Web Share 降级。
- `manifest.json` 已加入 `Share` 权限，原有 `Gallery`、`Zip`、`File` 等能力保留。

相关实现集中在：

- `js/util.js`：`saveImageToGallery`、`shareImageFile`、`shareText`、`exportFilesAsZip`、公共下载目录写入。
- `js/app.js`：`exportWorkspaceFileByName`、`exportWorkspaceZip`、长按工作区文件导出。

### 数据与会话管理

- `设置 -> 数据` 中新增“会话管理”。
- 会话管理页可查看每个会话的模式、消息数、工作区文件数、工作区占用、更新时间。
- 可展开查看对应会话工作区文件。
- 支持重命名会话。
- 支持只清空某个会话的工作区文件，保留聊天记录。
- 支持真正删除会话，删除前明确提示会删除消息和工作区文件。
- 侧边栏原有会话删除仍保留，但数据页的会话管理是更明确的存储管理入口。

### token 与上下文提示

- 对话界面增加 token/上下文统计悬浮控件。
- 圆环显示上下文占用，接近满时提示新开会话。
- 切换模型时有提示，避免用户忽视上下文和模型能力变化。

## 当前验证结果

已在本地跑过：

- `node --check js/app.js`
- `node --check js/api.js`
- `node --check js/tools.js`
- `node --check js/store.js`
- `node --check js/util.js`
- `node --check js/image-api.js`
- `node --check js/model-metadata.js`
- `manifest.json` JSON 解析
- ZIP 生成冒烟，确认 `PK` ZIP 头和中心目录存在
- 本地服务 `http://127.0.0.1:8765/` 返回 `200`

## 实机测试重点

优先在 Android App 包里验证这些 WebView/HTML5+ 能力：

1. 图片预览导出：
   - 存相册是否触发权限并成功进入系统相册。
   - 系统分享面板是否能分享图片。
   - 下载目录是否写入 `下载/wepchat/`。
2. 普通文件导出：
   - 文本分享是否可用。
   - 不兼容分享的文件是否能写入公共下载目录。
3. 工作区导出：
   - 整工作区 ZIP 是否生成并写入下载目录。
   - ZIP 解压后目录结构和文件名是否正确。
4. 工作区文件长按：
   - Android 长按是否稳定触发导出面板。
   - 长按后是否不会误打开文件预览。
5. 生图链路：
   - 生图模式直接生成。
   - 常规模式 LLM 调用 `image_go`。
   - 图片预览页编辑入口走 `/v1/images/edits`。
6. 设置 -> 数据 -> 会话管理：
   - 展开文件列表布局是否正常。
   - 重命名、清空工作区、删除会话是否符合提示文案。
   - 删除当前会话、删除最后一个会话后的列表和当前会话状态。

## 风险与注意事项

- Android WebView/HTML5+ 的公共下载目录、相册保存、系统分享在不同 ROM 上可能表现不一致，需要实机确认。
- `plus.gallery.save`、`plus.share.sendWithSystem` 和 `plus.io.PUBLIC_DOWNLOADS` 是当前 App 端导出策略的关键点。
- 图像模型有时会返回文本描述，不应简单判断“返回文本 = 接口错”。调试时要看原始响应和 image candidates 解析。
- 继续避免把 provider 内置 tools 与 OpenAI Responses tools 混用。
- 工具权限仍需保守，尤其是删除文件、网络访问、未来代码执行和生图付费请求。
- 当前工作区仍是 localStorage 虚拟文件系统，不是真实磁盘目录；导出时才落到设备文件系统。

## 后续建议

短期优先级：

1. 根据 Android 实机结果修补导出兼容性，尤其是公共下载目录、相册和系统分享。
2. 实测 `/v1/images/edits` 的 multipart 字段兼容性；必要时支持 `image[]` 或代理特定字段名。
3. 图像设置页可继续补“默认编辑模型”和模板管理，但保持轻量。
4. 会话管理可以后续加“按占用排序”和“批量删除空工作区”，但当前不要做重型文件管理器。
5. 若继续推进执行能力，先增强 JS Worker / HTML Preview / 可选 WASM，不建议短期追完整 Linux。

## 当前未纳入本轮提交的已知脏项

- 根目录 `handoff.md` 当前处于删除状态，但本轮维护的是 `docs/handoff.md`。
- `img/open.png` 当前有二进制变更，未确认是否为用户打包资源调整。

提交前请再次确认是否需要纳入这些项。
