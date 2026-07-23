# WePChat Windows

WePChat Windows 是大型项目 **WePChat** 的 Windows 桌面分支。它继承 Android 主端的产品定位、核心功能、数据契约与视觉语言，并使用 **Rust + Tauri 2 + WebView2** 按 Windows 桌面应用的工程方式独立实现。

本文件是 Windows 分支的工程入口文档。产品范围以 [`docs/product-boundary.md`](docs/product-boundary.md) 为准，详细架构以 [`docs/architecture.md`](docs/architecture.md) 为准。

## 项目定位

WePChat Windows 是本地优先、轻量、克制的 AI 聊天客户端，主要面向以下场景：

- 快速配置和验证模型供应商、API Key 与模型连通性。
- 日常对话、Markdown 阅读和多会话管理。
- 在当前会话工作区中读写文件、运行轻量 JavaScript、预览 HTML。
- 使用图片模型生成或编辑图片。
- 与 Android 端保持核心配置、会话语义和工具契约兼容。

Windows 分支不是 Android WebView 代码的直接封装，也不是 Codex、Claude Code、完整 IDE 或通用 Shell。平台能力必须由 Windows 端的 Rust/Tauri 实现承担。

## 技术架构

```text
┌─────────────────────────────────────────────────────────┐
│ ui/ · WebView2                                           │
│ 页面、交互、会话视图状态、供应商协议适配、流式内容渲染   │
└──────────────────────────┬──────────────────────────────┘
                           │ Tauri IPC / events
┌──────────────────────────▼──────────────────────────────┐
│ src-tauri/ · Rust                                        │
│ 窗口与系统集成、设置/会话落盘、工作区文件、HTTP、预览服务 │
└──────────────────────────┬──────────────────────────────┘
                           │ HTTPS / local filesystem
┌──────────────────────────▼──────────────────────────────┐
│ 模型供应商、用户工作区、Windows 系统                     │
└─────────────────────────────────────────────────────────┘
```

职责边界：

| 层 | 负责 | 不负责 |
|---|---|---|
| WebView 前端 | UI、交互状态、消息与工具卡片渲染、模型协议拼装、SSE 语义解析 | 绕过 IPC 直接访问任意文件、实现 Windows 系统能力、承载重型后台任务 |
| Rust/Tauri | 设置和会话持久化、工作区路径安全、文件系统、供应商 HTTP、预览服务、窗口与系统集成 | 拼装页面 DOM、维护前端组件状态、复制 Android 运行时 |
| Android 主端 | 产品语义、成熟交互参考、数据与工具契约来源 | 决定 Windows 原生交互细节或 Windows 工程实现 |

供应商 HTTP 的正式桌面路径必须经过 Rust，避免 WebView CORS 和浏览器网络行为差异。文件操作必须经过受控 Tauri command，并在 Rust 侧完成路径校验和工作区边界限制。

## 目录结构

```text
wepchat-win/
├─ README.md                     Windows 分支工程入口文档
├─ package.json                  Tauri CLI 与 npm 脚本
├─ package-lock.json             Node 依赖锁文件
├─ docs/
│  ├─ product-boundary.md        产品范围与明确不做的能力
│  ├─ architecture.md            架构、IPC 和阶段说明
│  ├─ win_tools.md               Windows 工具契约
│  └─ HANDOFF-tools-sidebar.md   工具与右侧栏交接说明
├─ ui/                           WebView2 专用前端
│  ├─ index.html                 页面结构与脚本入口
│  ├─ css/
│  │  └─ app.css                 Windows 壳、页面和主题样式
│  ├─ libs/                      固定版本的前端第三方库
│  └─ js/
│     ├─ app.js                  应用组合入口与历史主体逻辑
│     ├─ app-core.js             共享状态、默认值、IPC 与基础工具
│     ├─ appearance.js           主题与外观设置
│     ├─ window-controls.js      Windows 标题栏与窗口控制
│     ├─ api.js                  模型供应商协议适配
│     ├─ image-api.js            图片模型协议适配
│     ├─ image-mode.js           生图模式流程
│     ├─ image-canvas.js         图片画布
│     ├─ markdown.js             Markdown 渲染入口
│     ├─ preview-stream.js       流式文件预览状态
│     ├─ browser-preview.js      浏览器预览控制
│     ├─ theme-system.js         主题应用与系统深浅色判断
│     └─ tools/                  前端工具注册与适配
├─ src-tauri/
│  ├─ Cargo.toml                 Rust crate 与依赖
│  ├─ tauri.conf.json            窗口、安全策略和打包配置
│  ├─ capabilities/              Tauri 权限声明
│  └─ src/
│     ├─ main.rs                 桌面程序入口
│     ├─ lib.rs                  Tauri Builder 与 command 注册
│     ├─ settings.rs             设置结构和持久化
│     ├─ sessions.rs             会话与工作区目录管理
│     ├─ workspace_fs.rs         受控工作区文件操作
│     ├─ http_client.rs          非流式/流式供应商 HTTP
│     └─ preview_server.rs       本地静态预览服务
└─ example/                      示例或验证用工程，不进入正式运行链路
```

`node_modules/`、`src-tauri/target/` 和 `src-tauri/gen/` 是依赖或生成目录，不属于手工维护的业务源码。

## 开发环境

要求：

- Windows 10 或 Windows 11。
- Rust stable，使用 rustup 管理。
- Node.js LTS 与 npm。
- Microsoft Edge WebView2 Runtime。Windows 10/11 通常已经安装。
- Visual Studio Build Tools，包含 Desktop development with C++ 和 Windows SDK。

安装依赖并启动开发环境：

```powershell
cd E:\wepchat\wepchat\wepchat-win
npm install
npm run dev
```

构建安装包：

```powershell
npm run build
```

默认生成 NSIS/MSI，产物位于：

```text
src-tauri/target/release/bundle/
```

## 开发约束

以下规则适用于 Windows 分支的所有新增代码和维护工作。

### 1. 单文件不得超过 800 行

- 新建的业务源文件必须保持在 **800 行以内**。适用范围包括 `.rs`、`.js`、`.css` 和手写 `.html`。
- 文件接近 700 行时，应在继续添加功能前确定拆分边界；不得等到超过 800 行后再处理。
- 拆分必须按功能所有权进行，例如供应商、会话、主题、预览、文件系统，而不是建立新的 `utils-all.js`、`renderers.js` 或 `events.js` 巨型文件。
- 生成文件、依赖库、锁文件和第三方压缩文件不受此限制，但不得手工承载业务逻辑。
- 当前仓库中的 `app.js`、`app.css`、`api.js`、`image-mode.js`、`workspace_fs.rs` 等超长文件是历史例外。本阶段允许不立即拆分，但它们进入冻结状态：只接受必要修复和连接代码，不得继续加入完整新功能。新功能必须放入独立模块。
- 评审时既检查文件总行数，也检查单个函数职责。把超长函数移动到另一个文件不等于完成模块化。

可使用以下 PowerShell 命令检查手写源码行数：

```powershell
Get-ChildItem ui,src-tauri\src -Recurse -File |
  Where-Object { $_.Extension -in '.js', '.css', '.html', '.rs' } |
  ForEach-Object {
    [pscustomobject]@{ Lines = (Get-Content $_.FullName).Count; File = $_.FullName }
  } |
  Where-Object Lines -gt 800 |
  Sort-Object Lines -Descending
```

### 2. Android 对齐原则

Windows 分支的主体逻辑、操作语义和界面风格应与 Android 主端保持一致：

- 保持模式划分、主要工作流、功能命名、设置含义和默认值一致。
- 保持供应商、模型、会话、消息、工具调用和 `.wepchat` 数据契约兼容。
- 保持“简单、轻量、克制”的视觉语言、内容密度、信息层级和反馈语气。
- Android 已经验证过的错误处理、重试策略、能力判断和边界规则应优先复用其语义。
- 修改共享契约前必须核对 Android 端实现，并明确兼容或迁移策略。

“保持一致”不代表复制 Android 平台实现：

- 不引入 `plus.*`、uni-app、HBuilderX 或 Android WebView 专用 API。
- 不照搬移动端底部导航、返回手势、触摸热区、软键盘规避等平台特有交互。
- 不为了代码表面一致而绕过 Rust/Tauri 的安全和职责边界。

### 3. Rust + Tauri Windows 实现原则

- 系统能力优先由 Rust 实现，通过窄而明确的 Tauri command/event 暴露给前端。
- command 参数和返回值应使用明确的 Rust 结构体；跨 IPC 字段统一采用 `camelCase`，并通过 Serde 显式约束默认值。
- Rust command 返回 `Result<T, String>` 或项目约定的结构化错误，不得通过 panic 表达可恢复错误。
- 文件路径必须在 Rust 侧规范化并验证仍位于当前会话工作区内。前端校验只能作为体验优化，不能作为安全边界。
- 网络、磁盘和长耗时任务不得阻塞 WebView UI 线程；需要取消的任务必须提供稳定的任务 ID 或中断 command。
- 不新增真实 Shell、任意命令执行或未受控 sidecar，除非产品边界文档先明确批准。
- 不随意扩大 `tauri.conf.json` CSP 或 capabilities。新增权限必须说明使用位置、风险和最小权限范围。
- Windows 路径、编码、WebView2 行为、高 DPI、窗口缩放和安装包场景必须作为正式运行环境处理。

### 4. Windows UI/UX 原则

- 产品视觉基因跟随 Android，但布局和操作方式必须符合 Windows 桌面习惯。
- 使用桌面标题栏、窗口按钮、可调整侧栏、鼠标 hover、右键/上下文操作和键盘焦点，不伪装成手机界面。
- 主要操作必须同时支持清晰的鼠标路径；适合快捷键的高频操作应提供 Windows 常用快捷键。
- 图标按钮必须有 `title` 或可访问名称；键盘操作必须有可见 `:focus-visible` 状态。
- 控件使用稳定尺寸，文本不得溢出或遮挡；至少验证 `960×600` 最小窗口和 `1280×800` 默认窗口。
- 深色、浅色和跟随系统模式必须同步影响根节点、原生控件 `color-scheme` 和主题色。
- 不使用移动端专属的长按作为唯一入口，不依赖 hover 才能发现核心操作。
- Windows 端可以调整间距、密度、导航位置和控件形式，但不得改变功能语义或造成跨端认知断裂。

### 5. 前端模块约束

- `app.js` 作为历史入口和组合层维护，不再承载完整新功能。
- 新模块使用 ES module 的显式 `import` / `export`。共享状态从 `app-core.js` 获取，不建立第二套状态源。
- 渲染、事件、状态转换应跟随功能模块放置，例如主题模块同时拥有主题渲染和主题事件。
- 除既有兼容接口（如 `window.ImageMode`、`window.WePChatThemeSystem`）外，不增加新的 `window.*` 全局对象。
- 禁止在 HTML 中加入 Vue 指令或其他未启用框架的模板语法。当前前端以原生 DOM + ES module 为准。
- DOM 查找必须有明确选择器，优先使用稳定的 `id`、`data-*` 和语义 class，不依赖显示文本判断业务状态。
- 用户输入、模型输出和文件内容进入 HTML 前必须转义或经过现有净化链路。

### 6. 数据与兼容约束

- 设置和会话结构新增字段时必须提供默认值，旧数据加载不得失败。
- Rust 结构、前端默认设置、Android 对应字段和备份格式应同步核对。
- 持久化字段不得仅存在于 UI 临时状态中；保存后必须使用后端返回值重新归一化状态。
- 删除或重命名字段前必须提供迁移策略，不得静默丢弃用户会话、供应商配置或工作区路径。
- API Key、用户消息和工作区内容不得写入日志、截图、示例数据或错误遥测。

### 7. 依赖与安全约束

- 优先使用 Rust/浏览器标准库和仓库现有能力。新增依赖前说明必要性、体积、许可证和维护状态。
- 前端第三方库应固定版本并放在现有依赖流程中，不从运行时 CDN 动态加载核心代码。
- Node 或 Rust 依赖变化必须提交对应锁文件。
- 不提交 `node_modules/`、`target/`、临时截图、调试日志、用户配置和生成缓存。
- 所有文件、网络和预览入口都按不可信输入处理。

## 开发流程

1. 阅读 `docs/product-boundary.md`，确认需求属于 Windows 产品范围。
2. 涉及共享功能时检查 Android 主端的行为、字段和错误语义。
3. 确定 Windows 实现边界：前端负责交互，Rust 负责系统能力和安全边界。
4. 在编码前确认目标文件不会超过 800 行；接近上限时先创建功能模块。
5. 实现最小完整流程，包括加载、空状态、错误、取消、保存和恢复。
6. 运行静态检查、Rust 检查和关键路径手工回归。
7. 更新受影响的架构、工具契约或产品边界文档。

## 提交前检查

至少运行：

```powershell
node --check ui\js\app.js
Get-ChildItem ui\js -Recurse -Filter *.js | ForEach-Object { node --check $_.FullName }
cargo fmt --manifest-path src-tauri\Cargo.toml --check
cargo check --manifest-path src-tauri\Cargo.toml
```

涉及发布时再运行：

```powershell
npm run build
```

手工回归至少覆盖：

- 应用启动无控制台异常。
- 窗口最小化、最大化、关闭和侧栏缩放。
- 设置加载、修改、保存及重启恢复。
- 供应商连接、非流式请求和流式中断。
- 新建、切换、复制、重命名和删除会话。
- 工作区路径边界、文件读写与 HTML 预览。
- 浅色、深色、跟随系统和主题样式切换。
- `960×600` 与 `1280×800` 下无重叠、遮挡或文本溢出。

## 文档优先级

发生冲突时按以下顺序处理：

1. [`docs/product-boundary.md`](docs/product-boundary.md)：决定做什么和不做什么。
2. 本 README 的开发约束：决定 Windows 分支如何实现和维护。
3. [`docs/architecture.md`](docs/architecture.md)：记录当前架构与 IPC。
4. [`docs/win_tools.md`](docs/win_tools.md)：定义工具行为和参数契约。

代码行为与文档不一致时，不应默认代码就是正确答案；先确认当前产品决策，再同步修复代码或文档。
