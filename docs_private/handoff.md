# WepChat 接手文档

更新时间：2026-07-07

## 当前状态

WepChat 是静态 Vue/H5 主体，按 HBuilderX/HTML5+ Android App 方向推进。入口是 `index.html`，核心风格保持“克制、轻量、快速”：偏日常对话、随手生成、快速验证想法，不做 ComfyUI、Midjourney 或图库类重型工作站。

当前一轮 Android 实机测试已确认无误，准备开新会话继续。最近完成的重点是：

- 工具写入/修改时的可视化流式展示。
- HTML/CSS 多页面预览的浏览器式跳转能力。
- 对话页 token 圈位置、生图模式隐藏、顶部模型名居中、移除新对话引导卡片。
- 长文本/多工具调用后的入库可靠性加固。
- 运行中切换会话拦截和后台通知提醒。
- 生图工作台轻量重构，以及图片生成设置里的风格预设管理。

开新会话时不要依赖本文档判断 Git 脏文件，直接以 `git status --short` 为准。`manifest.json` 如果有未提交改动，通常来自后台通知/推送权限。

## 主要文件

- `index.html`：Vue 模板与页面结构。
- `css/app.css`：移动端 UI 样式。
- `js/app.js`：应用主逻辑、会话、设置、工作区、预览、生图、导出。
- `js/api.js`：文本模型 API 适配与流式响应，也包含工具调用流式参数展示。
- `js/image-api.js`：图像生成/编辑接口适配。
- `js/model-metadata.js`：模型元数据、能力与默认模型配置。
- `js/tools.js`：Agent 工具定义与执行，包括 `image_go`。
- `js/store.js`：IndexedDB + 内存缓存本地存储。
- `js/markdown.js` / `js/util.js`：Markdown 与通用能力。
- `manifest.json`：HBuilderX/HTML5+ App 权限与版本配置。

## 已完成重点能力

### 模型与元数据

- 模型元数据系统支持上下文、输出上限、视觉、思考、工具、结构化输出、图像生成/编辑等能力标记。
- 提供商内区分文本模型 `models` 和图像模型 `imageModels`。
- 提供商编辑页保留图片 API 地址、图片 API Key、生图路径、编辑路径等高级配置。
- 图像生成设置独立于文本模型配置，保留首选图片提供商、生成模型、编辑模型。

### 工具调用可视化

- 模型执行写入/修改类工具时，工具卡片会在参数流式生成阶段提前出现。
- 工具卡片支持“编写中 / 执行中 / 完成 / 失败”等状态，避免长代码生成时界面长时间静默。
- 相关实现集中在：
  - `js/api.js`：`streamTools` 和工具调用增量解析。
  - `js/app.js`：工具调用状态更新、增量落 UI。
  - `index.html`：工具卡片状态文案。

### HTML 预览

- 工作区 HTML 预览支持多页面自然跳转，不再只能看单页。
- 预览页增加轻量浏览器栏：地址栏、前进、后退、刷新。
- 支持工作区内相对链接跳转，例如 `index.html -> page1.html -> page2.html`。
- 支持外链跳转，App 端优先走外部浏览器能力，避免导航站/起始页类项目体验断掉。
- 相关实现集中在 `index.html`、`css/app.css`、`js/app.js` 的 preview/browser 逻辑。

### 生图模式与 image_go

- 新会话创建时选择“常规 / 生图”，创建后固定模式。
- 生图模式支持直接调用图像模型。
- 常规模式暴露 `image_go` 工具，LLM 可判断生成或编辑图片意图并路由到图像模型。
- `image_go` 支持 `generate` / `edit`，可引用工作区图片路径；如果 LLM 漏填引用图，逻辑会尝试使用最近的用户图片附件。
- 用户上传的图片/文本文件会进入当前会话工作区 `attachments/`，便于后续图像编辑。
- 生成图片会进入当前会话工作区 `images/`，并在消息内展示。
- 图片预览页在生图会话中有底部编辑输入框，可走 `/v1/images/edits`。
- 不再把 provider 内置 `image_generation` tool 强行塞进 OpenAI Responses 工具列表，避免 `Tool choice 'image_generation' not found in 'tools' parameter` 这类冲突。

### 生图工作台与风格预设

本轮最新状态，已实机测试通过：

- 生图工作台去掉模型选择、协议选择、生图/编辑路径、数量。
- 工作台从上到下是：
  - 尺寸：`auto`、`1024x1024`、`1536x864`、`864x1536`、`2048x2048`、`2560x1440`、`1440x2560`、`3840x2160`、`2160x3840`、`2880x2880`
  - 质量：自动、高、中、低
  - 格式：PNG、WebP、JPEG
  - 背景：自动、透明、不透明
  - 风格：来自设置里的风格预设
  - 提示词输入
  - 生成图片按钮
- 工作台有独立提示词输入，生成后写入当前生图会话。
- 图片生成设置页移除了默认尺寸、数量、输出格式、协议和路径设置。
- 图片生成设置页新增风格预设管理，支持新增、编辑、删除、查看。
- 默认预设包括电影感写实、电商主图、动漫插画、扁平图标、极简 UI、水彩手绘。
- 风格预设会注入到最终图片提示词中，并记录到生成图片的 `imageMeta`。
- `js/image-api.js` 支持 `quality` 和 `background`：
  - `auto` 不传。
  - 非 `auto` 时传给 OpenAI Images。
  - 遇到 400/422 时会降级重试不带高级参数的 payload，兼容中转。

相关实现：

- `index.html`：`sheet === 'imageWorkbench'`、`settings-image`。
- `css/app.css`：`.select-control`、`.image-wb-prompt`、`.preset-*`。
- `js/store.js`：`imageQuality`、`imageBackground`、`imageStylePresetId`、`imageStylePresets`。
- `js/app.js`：`imageSizeOptions`、`imageStylePresets`、预设 CRUD、`sendWorkbenchImageMessage()`、`runImageRequest()`。
- `js/image-api.js`：`quality/background` 参数与兼容降级。

### 工作区与导出

- 会话工作区支持文件树、新建、上传、删除、预览、编辑、HTML 运行预览。
- 对话上传文件现在也进入工作区，文件流转统一从工作区开始。
- 图片和文件预览页支持导出。
- 工作区文件长按可打开单文件导出面板，桌面右键也可触发。
- Android/HBuilderX App 环境下导出策略：
  - 图片：存相册、系统分享、公共下载目录。
  - 普通文件：公共下载目录，文本类可走系统分享。
  - 整工作区：生成 ZIP，再写入公共下载目录。
- H5 环境保持浏览器保存/下载/Web Share 降级。
- `js/util.js` 使用 HTML5+ 能力处理 App 端导出：
  - 图片：`plus.nativeObj.Bitmap.loadBase64Data` + `bitmap.save(path)`。
  - 文本：`FileWriter.write(字符串)`。
  - ZIP：文件先暂存 `_doc/`，再 `plus.zip.compress`。
  - 公共下载目录、相册保存前会申请必要权限。
  - 所有 plus 桥接操作有超时兜底，失败会 toast，不再静默。

### 数据与会话管理

- `设置 -> 数据` 中有会话管理。
- 会话管理页可查看每个会话的模式、消息数、工作区文件数、工作区占用、更新时间。
- 可展开查看对应会话工作区文件。
- 支持重命名会话。
- 支持只清空某个会话的工作区文件，保留聊天记录。
- 支持真正删除会话，删除前明确提示会删除消息和工作区文件。
- 侧边栏原有会话删除仍保留，但数据页的会话管理是更明确的存储管理入口。

### 存储与持久化

- Android WebView localStorage 配额过小，base64 图片很快撑爆；当前已改为 IndexedDB + 内存缓存，外部同步 API 基本不变。
- 启动时 `Store.init()` 预热 IndexedDB 并迁移旧 localStorage 数据。
- `Store._pendingWrites` 跟踪异步写入，`Store.flush()` 可等待入库。
- `js/app.js` 中新增 `persistSessionSoon()`、`flushSessionPersist()`，在流式回复、工具调用、页面隐藏、App pause 等时机加固落库。
- 这个改动是为修复“当时能看到长文本，关闭重开后正文消失但工具记录还在”的高概率入库问题。

### token、运行中保护与通知

- 对话界面 token/上下文统计圆环已移动到对话区域右上角，不再与“回到底部”重叠。
- 生图模式不显示 token 统计圆环。
- 新对话的三条引导卡片已移除，避免输入时遮挡输入框。
- 顶部模型名区域已居中。
- 运行中切换会话、新建会话、删除当前会话、导入数据、清空数据等操作会先提示；用户确认后停止当前任务再继续。
- App 进入后台且任务仍在运行时，会尝试发本地通知提醒“WepChat 正在运行”。
- `manifest.json` 已加入 `Push` 相关权限和 Android `POST_NOTIFICATIONS`。
- 由于框架限制，长期后台仍可能被系统回收；当前只做提示和拦截，不承诺真正长期保活。

## 当前验证结果

本轮已通过：

- Android 实机测试：用户确认本轮更新无误。
- 本地语法检查：
  - `node --check js/app.js`
  - `node --check js/store.js`
  - `node --check js/image-api.js`
  - 此前也跑过 `js/api.js`、`js/tools.js`、`js/util.js`、`js/model-metadata.js`。
- `git diff --check`：只有 CRLF 提示，无空白错误。
- 本地静态服务 `http://127.0.0.1:8765/` 验证过页面能打开。
- Playwright/Chrome 轻量巡检过：
  - 生图模式入口。
  - 生图工作台控件顺序和默认预设。
  - 图片生成设置页风格预设列表。
  - 编辑预设弹窗。
  - 控制台只有 `favicon.ico` 404，没有应用错误。

## 实机回归重点

下轮如果继续发包，优先回归这些点：

1. 工具调用长代码写入/修改时，工具卡片是否能提前出现并持续展示参数内容。
2. HTML 预览多页面跳转、地址栏、前进、后退、刷新、外链跳转。
3. 长文本 + 多轮工具调用后，关闭重开正文是否仍完整。
4. 运行中切换会话、新建会话、删除当前会话是否有拦截提示。
5. 后台运行通知是否在 Android 13+ 权限场景下正常申请/展示。
6. 生图工作台参数是否在不同屏幕尺寸下不拥挤、不遮挡。
7. 风格预设新增、编辑、删除后是否持久化。
8. `quality/background` 对不同图片 API 中转的兼容性。
9. 图片预览编辑入口 `/v1/images/edits` 的 multipart 字段兼容性。
10. 导出能力：相册、系统分享、下载目录、整工作区 ZIP。

## 风险与注意事项

- Android WebView/HTML5+ 的公共下载目录、相册保存、系统分享在不同 ROM 上可能表现不一致。
- 后台运行能力受 HBuilderX/HTML5+ 和系统限制，当前只做通知提醒与切换会话拦截。
- 图像模型有时会返回文本描述，不应简单判断“返回文本 = 接口错”。调试时要看原始响应和 image candidates 解析。
- `quality/background` 不是所有中转都支持；当前已做 400/422 降级，但仍需实测。
- 继续避免把 provider 内置 tools 与 OpenAI Responses tools 混用。
- 工具权限仍需保守，尤其是删除文件、网络访问、未来代码执行和生图付费请求。
- 当前工作区是 IndexedDB 虚拟文件系统，不是真实磁盘目录；导出时才落到设备文件系统。
- 如果遇到“当时能看、重开消失”，优先检查 `Store.flush()` 是否被触发、IndexedDB 写入是否失败、单条会话对象是否过大。

## 后续建议

下一轮主要聚焦：

1. 内置更新能力：
   - 补充 App 内更新检查。
   - 从 GitHub 仓库 Release 拉取新版本信息和安装包。
   - Android/HBuilderX 环境下需要明确下载、保存、触发安装 APK 的流程，以及失败 toast 和权限提示。
   - 注意区分 H5 环境和 App 环境，H5 端可只展示 release 链接。
2. Tools 优化/更新：
   - 添加文件夹相关工具。当前列出工作区文件的工具不会列出文件夹，强模型可以通过路径拼凑创建文件夹，弱模型不稳定。
   - 建议至少补：列出文件夹/树、创建文件夹、删除文件夹、移动/重命名文件或文件夹、检查路径是否存在。
   - 重新审视已有 tools 的参数设计和返回文案，尽量让弱模型也能按工具描述完成文件组织任务。
   - 讨论并筛选新的实用 tools，但保持工具集克制，避免把工具面板做重。

其他短期优先级：

1. 继续观察长文本 + 多工具调用入库问题；若复现，增加写入错误日志和会话体积诊断。
2. 实测更多图片 API 中转对 `size/quality/background/output_format` 的兼容性，必要时做 provider 级能力开关。
3. 实测 `/v1/images/edits` 的 multipart 字段兼容性；必要时支持 `image[]` 或代理特定字段名。
4. HTML 预览可以后续加“在外部浏览器打开当前地址”，但不要把预览页做成完整浏览器。
5. 会话管理可以后续加“按占用排序”和“批量删除空工作区”，但当前不要做重型文件管理器。
6. 若继续推进执行能力，先增强 JS Worker / HTML Preview / 可选 WASM，不建议短期追完整 Linux。

## 开新会话时的建议读法

新会话先读这份文档，再重点打开：

- `index.html`
- `css/app.css`
- `js/app.js`
- `js/store.js`
- `js/image-api.js`
- `js/api.js`
- `manifest.json`

如果任务涉及导出，再读 `js/util.js`。如果任务涉及模型能力或生图路由，再读 `js/model-metadata.js` 和 `js/tools.js`。
