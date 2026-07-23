# WePChat Win — app.js 拆分计划（3,500+ 行维护痛点）

## 当前痛点
- `ui/js/app.js` 已超过 **3,500 行**，单文件极难维护（巨型 IIFE / 大块函数、重复渲染逻辑、状态混杂、事件绑定散落）。
- 难以添加新功能（theme、image-mode、tools、preview 等）。
- 测试困难、CI 不友好。
- Android 端已有成熟拆分经验（js/ 分文件 + skills）可参考。

## 拆分目标
- 拆分为 **6-8 个专注模块文件**，每个模块 **< 600 行**。
- 保持**零耦合**（尽量不直接 `require`/`import` 共享状态，使用事件/Store 模式）。
- 保留全局 `state`、`window.WePChatThemeSystem` 等核心对象，便于逐步迁移。
- 增加 **renderers** 和 **binders** 模式，便于技能集成。

## 推荐拆分结构（按功能/类型分组）

### 1. 核心状态与初始化 (state-core.js ~300 行)
- `state` 对象定义
- `defaultSettings()`、`defaultToolPermissions()`
- `persistSettings()`、`loadBackend()`
- 初始化入口（boot / main）

### 2. 渲染器与 DOM 操作 (renderers.js ~500 行)
- `renderSessions()`、`renderProviders()`、`renderModelSelect()`
- `renderRightPane()`、`renderRightTabs()`、`renderRightContent()`
- `renderThemeUI()`、`renderImageSessionList()` 等所有 `render*` 函数
- 所有 `$()` / `$all()` 辅助器

### 3. 事件绑定与生命周期 (events.js ~400 行)
- `bindEvents()`（所有 click、resize、keydown）
- `bindRightEvents()`、`bindSettingsEvents()` 等子绑定器
- `startResize()`、`startSessionMenu()` 等

### 4. 会话管理 (sessions.js ~400 行)
- `openSession(id)`、`createNewChat()`、`deleteSessionById()`
- `persistSession()`、`hydrateSessionImages()`
- `renderSessions()`

### 5. 设置管理 (settings.js ~300 行)
- `persistSettings()`、`saveAgentSettings()`、`saveImageSettings()`
- `setSettingsPage()`、`renderSettings()` 子模块

### 6. 右侧面板 (right-pane.js ~300 行)
- `showImageCanvasPane()`、`bindFilesTab()`、`bindBrowserTab()`
- `openFileInViewer()`、`paintFilesTree()`（已优化过的函数）

### 7. 工具/其他功能 (tools.js + image-mode.js + preview.js 等，按需提取)
- `createNewChat()`、`image_go`、`web_fetch` 等工具绑定
- `ImageMode.bind()`、`renderCanvas()`
- 浏览器预览、markdown、network-stability 等

### 8. 工具函数与杂项 (utils.js ~200 行)
- 所有 `$(sel)`、`U.escapeHtml()`、`nowIso()`、`uid()`、`cloneJson()` 等
- 错误处理、`toast`、`confirmStopIfGenerating()`

## 拆分步骤（推荐顺序）

1. **Week 1**: 创建 utils.js + state-core.js + renderers.js（最核心的 DOM/状态部分）。
2. **Week 2**: 迁移 events.js、sessions.js、settings.js（按模块逐个添加事件绑定）。
3. **Week 3**: 迁移 right-pane.js + tools.js（尤其是 image-mode、canvas、files tab）。
4. **Week 4**: 测试、清理旧代码、更新 `ui/index.html` script 顺序（theme-system.js 必须在 app.js 前）。
5. **Week 5**: 性能优化 + 技能集成（把每个模块包装成 MCP skill）。

## 关键规则（维护纪律）
- **零全局污染**：任何新模块必须通过 `window.WePChatThemeSystem` 或 `state` 访问共享状态。
- **事件驱动**：新功能必须用 `addEventListener` 而不是直接调用旧函数。
- **逐步迁移**：不要一次性替换整个 app.js，先在同一个文件中测试新模块。
- **类型注释**：每个文件顶部加 JSDoc / TypeScript-style 注释（文件负责什么）。
- **测试**：每个模块单独写 Vitest / Jest 测试（用 `mock` 状态）。

## 预期效果
- 文件数从 1 → 8，平均每文件 < 500 行。
- 维护成本大幅降低（改 theme 只改 1-2 个文件）。
- 容易添加新技能（每个模块对应一个 skill）。
- 后续可引入 `subagent` 或 `workflow` 架构。

## 实施建议
- 先在分支 `feature/app-split` 上操作。
- 每次提交 PR 时附带 `app.js-split-plan.md` 更新日志。
- 完成后可删除或重命名 `app.js` 为 `app-main.js`，让 `app.js` 只负责 boot 入口。

**下一步行动**：
1. 我已经为你生成了 `ui/js/app.js-split-plan.md`（以上全文）。
2. 请确认或调整任何部分。
3. 我可以立即开始拆分第 1 批文件（state-core + renderers + utils）。

后续按功能边界继续迁移会话、供应商、聊天/工具和右侧面板；每次迁移后先通过语法与启动回归，再删除入口中的旧实现。

## 实施记录

### 2026-07-23：第一批基础模块

- 已创建 `ui/js/app-core.js`：集中导出 `state`、Tauri `invoke`、DOM 查询、设置默认值、工具权限和通用工具函数。
- 已创建 `ui/js/appearance.js`：集中处理主题选择、显示模式和真实玻璃开关的渲染与事件绑定。
- 已创建 `ui/js/window-controls.js`：集中处理标题栏窗口控制和左侧列表伸缩。
- `app.js` 通过 ES module 显式导入这些能力，保留 `boot()` 作为组合入口；当前行为不变。

### 架构调整

原计划中的“所有 renderer 集中到一个文件”和“零 import 共享状态”不再采用。渲染器与事件绑定应跟随功能模块，模块通过 `app-core.js` 共享状态，避免继续形成新的大文件和隐式全局依赖。
