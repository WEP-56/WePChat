# Handoff：WePChat Windows

> 最后更新：2026-07-24（生图 I1 布局首段：小生成对话列 + 主画布）
> 项目目录：`E:\wepchat\wepchat\wepchat-win`  
> Git 仓库：`E:\wepchat\wepchat`，分支 `main`，当前 HEAD `8310ad7`  
> 当前工作树有大量未提交改动；除非用户明确要求，不要 commit，也不要清理或覆盖用户文件。

---

## 1. 当前结论

Windows 端是 Tauri 2 + 原生 HTML/CSS/JS 的桌面应用。本轮已经完成：

- SQLite 会话存储 S1、S2 已完成；S3 已完成分页/标题搜索/checkpoint，FTS5 全局搜索延后。
- 聊天稳定 DOM、40ms 流式合并、滚动跟随、消息 rail、消息元信息。
- 本地 KaTeX 公式、GFM 任务列表修复。
- HTML 文件预览和聊天代码块 artifact 预览；用户最终实测确认均可用。
- 左右侧栏拖拽、回到底部按钮、供应商弹窗等回归修复。
- 文件树跨会话刷新与“最后活动会话”恢复。
- 普通聊天附件链路已补齐：上传/拖拽/粘贴/工作区文件引用均先进入当前会话工作区，composer 与消息中显示附件气泡。
- 聊天输入框会随内容行数向上自动增高，超过高度上限后才内部滚动；底部 Enter 提示已隐藏。聊天顶部模型选择已改为定制下拉面板，保留原生 select 作为内部状态源。全局右键菜单已替换为轻量定制菜单。

用户最后反馈：

- 公式和复选框已正常。
- 工作区文件恢复正常，真实文件从未丢失。
- 手动 HTML 预览和 Preview Sandbox/代码块“运行”均已正常。

下一阶段可选：继续补 S3 性能基准与实机回归；或沿 `docs/image-mode-plan.md` 继续生图 I1/I2。当前已把生图主视图改成左侧窄生成对话列 + 右侧主画布，且进入生图模式不再强制打开右侧 tab 画布。画布已补选择/抓手工具、框选、上传图片到当前会话工作区、选中图作为 composer 多参考附件、参考/编辑显式模式选择、点击图像后的画布内编辑输入框、生成中占位卡片、拖拽吸附黄线。已修复参考取消、composer stop 按钮隐藏/颜色、输入框自动增高，并把图片模型/尺寸选择改成 WePChat 风格自绘 popover。左侧生图列表已改为搜索 + 新建生图行 + 会话行更多菜单。FTS5 全局消息搜索和截图能力按用户意见延后。

---

## 2. 必读文档与状态

| 文档 | 状态 |
| --- | --- |
| `docs/sqlite-storage-plan.md` | 存储改造实施依据；S1/S2 已完成，S3 已完成分页/标题搜索/checkpoint，FTS5 延后 |
| `docs/deepsearch.md` | 渲染/滚动/artifact 调研与路线；P0 + P1 主体已落地 |
| `docs/image-mode-plan.md` | 生图模式 Grok-like「小对话框 + 大画布」改造计划；I1 布局首段与部分 I2 画布交互已落地，I0 对话链路补齐、会话列表管理和更多文件操作仍待继续 |
| `docs/HANDOFF.md` | 本文件，下一会话先读 |
| `docs/product-boundary.md` | 产品边界 |
| `docs/architecture.md` | 总体架构 |
| `docs/win_tools.md` | Windows 工具约束 |

注意：`deepsearch.md` 的旧实施记录写过外层预览 iframe 仅 `sandbox="allow-scripts"`。这条已经过时；当前正确实现见本文件“HTML 预览安全模型”。不要回退。

---

## 3. SQLite 存储：S1/S2 已实施

### 3.1 存储位置与边界

```text
{workspaceRoot}/wepchat.db
{workspaceRoot}/{sessionId}/          # 模型文件、HTML、图片等真实工作区
```

- `settings.json` 继续放 appData，不迁移 SQLite。
- 会话和消息进入 SQLite。
- 工作区文件、生成图片继续使用真实文件系统。
- 不迁移旧 `{sessionId}/session.json`；旧文件不再读取。
- 换 workspace root 等于切换整套数据集。

### 3.2 关键文件

| 文件 | 作用 |
| --- | --- |
| `src-tauri/src/db.rs` | 全局单连接、按 root 重开、WAL、quick_check、user_version 迁移 |
| `src-tauri/src/sessions.rs` | list/load/save/copy/delete 与消息增量 upsert |
| `src-tauri/src/lib.rs` | 注册 SQLite/预览/FS 命令 |
| `src-tauri/Cargo.toml` | `rusqlite 0.32 + bundled` |
| `ui/js/app.js` | 前端保存队列、全量保存、消息增量保存 |

### 3.3 Schema v1 实际形态

- `sessions`：常用索引列 + `meta_json`。
- `messages`：`session_id/id/seq/role/content/payload_json/created_at`。
- 消息主键实际使用 `(session_id, id)`，不是全局 message id；这样复制会话不会冲突，也不破坏 variant/parent 链。
- `payload_json` 保存 reasoning、toolCalls、usage、variants、images、attachments、error、durationMs 等。
- 图片只存 path/mime/元数据，不进 SQLite 二进制。

### 3.4 S1 行为

- `list_sessions` 是轻查询，`messages` 恒为空数组，并返回 `summary`、`messageCount`。
- `load_session` 按 seq 读取消息并组装旧 JSON 契约。
- `save_session` 在单事务内 upsert session + 全量替换该会话消息。
- `copy_session` 库内复制。
- `delete_session` CASCADE 删除数据库行并删除工作区目录。
- 数据库打不开或 quick_check 失败时，把 db/wal/shm 改名为 `.corrupt-{timestamp}` 后重建。

### 3.5 S2 行为

- Rust 命令：`session_upsert_message`。
- 前端：`queueSessionWrite()` 保留 `state.sessionSaveChains` 的每会话串行语义。
- `persistSession()`：结构变化、首次消息、新用户消息、最终收尾仍走全量事务。
- `persistActiveMessage()`：工具轮边界只 clone 并 upsert 当前 `assistantMsg`。
- 增量失败自动回退全量保存。
- `generateAssistant` 两个工具轮边界已替换为消息级保存；最终状态仍全量保存。

### 3.6 S3 当前状态

已完成：

1. `session_messages_page(sessionId, beforeSeq, limit)`，默认 50，最大 200，返回最新页/旧页、`nextBeforeSeq`、`hasMore`。
2. 前端聊天会话初次打开只加载最近 50 条；滚动到顶部时 prepend 旧消息并保持滚动锚点。
3. 当前会话若只有部分历史，任何全量保存前会自动补齐旧消息，避免把未加载历史截断。
4. 左侧已有搜索框已启用为会话标题搜索。
5. Tauri 窗口关闭时执行 `wal_checkpoint(TRUNCATE)`。

延后/待办：

1. FTS5 全局消息搜索按用户意见延后。
2. 仍需做计划中的 100×500、长会话写放大和分页性能基准；当前已完成正确性测试，但尚未正式跑完整性能验收。

任何 schema 变化必须递增 `PRAGMA user_version` 并做顺序迁移，禁止启动时 DROP。

---

## 4. 聊天渲染与滚动

### 4.1 模块

| 文件 | 作用 |
| --- | --- |
| `ui/js/chat-view.js` | 消息 id → 稳定 DOM；reasoning/tool/body/images/error/actions 分区更新 |
| `ui/js/chat-scroll.js` | 跟随状态机、上翻保护、ResizeObserver、回到底部 |
| `ui/js/chat-rail.js` | 用户消息刻度、hover 摘要、点击定位、active 居中 |
| `ui/js/markdown.js` | marked + highlight + DOMPurify + KaTeX + 块级流式渲染 |
| `ui/dev/render-test.html` | 本地渲染冒烟页 |

### 4.2 当前行为

- `renderChat()` 只是接线；实际由 `renderChatView()` reconcile。
- 流式消息以 40ms + rAF 合并刷新。
- Markdown 按顶层 token 缓存，流式中通常只更新尾块；完成态整篇收尾。
- 用户在底部时跟随；上翻即脱离；滚回近底/点击按钮后恢复。
- 回到底部按钮仅远离底部时出现。
- rail 少于两条用户消息隐藏；hover 会加长加粗并显示约 72 字摘要。
- rail smooth scroll 期间锁定用户刚点击的刻度，避免“下一个点击后上一个变深”。
- 消息操作行显示模型、时间、输入/输出 token、耗时。

### 4.3 Markdown/KaTeX

- 本地资源：`ui/libs/katex/`，不要改成 CDN。
- 支持 `$...$`、`$$...$$`、`\(...\)`、`\[...\]`。
- `\[ ... \]` 多行块在进入 marked 前包装为单一 `.math-source` 文本节点，避免 `breaks:true` 插入 `<br>` 后 KaTeX 无法跨节点匹配。
- 完全空的 `1. [ ]` 会补零宽字符以触发 GFM task 语法。
- marked 自定义 `checkbox()` 输出 `.task-list-checkbox`；插入 DOM 后再规范 `type/disabled/li class`，CSS 强制恢复原生 checkbox appearance。
- KaTeX 在 DOMPurify 清洗之后运行，`trust:false`、`throwOnError:false`。

---

## 5. HTML 文件与 artifact 预览

### 5.1 链路

```text
write_file 流式 arguments
  → PreviewStream staging
  → preview_stage 覆盖层
  → preview_server（127.0.0.1 随机端口 + 会话 token）
  → BrowserPreview 加载 __wep_preview__ harness
  → postMessage paint/navigate
  → harness 内部 iframe document.write 或同 token 路径导航
  → 工具落盘后从真实工作区读取并收尾
```

聊天中的 `html/htm/xml/svg/vue` 代码围栏有“运行”按钮：

- 打开独立 browser artifact 标签。
- 流式尾部代码块 500ms 节流刷新。
- 消息完成时用最终围栏内容收尾。

### 5.2 当前安全模型（不要回退）

- 主窗口 CSP 在 `src-tauri/tauri.conf.json` 放行：
  `frame-src 'self' http://127.0.0.1:* http://localhost:*`。
- 外层 `.rp-frame` 当前必须是：

```html
sandbox="allow-scripts allow-same-origin"
```

- 原因：若缺少 `allow-same-origin`，harness 会变成 opaque origin；即使地址文本完全相同，读取内部 iframe `contentDocument` 也会触发：

```text
Unsafe attempt to load URL ... Domains, protocols and ports must match.
```

- 允许 same-origin 只恢复 harness 自己的 `127.0.0.1:随机端口` origin；它与 Tauri 主窗口仍跨协议/端口，不能访问主应用 DOM 或 `__TAURI__` IPC。
- harness 只接受 `ev.source === window.parent` 的消息。
- navigate 只允许当前 `location.origin` 且 pathname 位于当前 token 根路径内。
- preview_server 全响应附 CSP：外部网络、表单、插件默认关闭；允许同源/data/blob 静态资源与脚本。
- 模型 HTML绝不能直接写入主窗口 DOM。

### 5.3 关键文件

- `src-tauri/src/preview_server.rs`
- `ui/js/browser-preview.js`
- `ui/js/preview-stream.js`
- `ui/js/app.js` 中 `paintBrowserHttp/openPreview/openCodeArtifact`
- `src-tauri/tauri.conf.json`

Rust 内嵌 `HARNESS_HTML` 修改后必须彻底停止并重启 Tauri 进程；只刷新标签不会更新旧 server 代码。

---

## 6. 工作区与会话恢复

- 工作区永远按会话隔离：`{workspaceRoot}/{sessionId}/`。
- 文件树通过 `Tools.fs.statTree(sessionId)` → `ws_stat_tree` 读取真实磁盘。
- 右侧 Files 面板支持上传文件到当前工作区、把文件树文件拖到聊天框引用、在资源管理器打开工作区/定位选中文件。
- 聊天附件上传路径默认在 `attachments/` 下；外部文件永远先写入工作区，LLM 看到的是工作区相对路径和可读取的文本内容，不暴露外部绝对路径。
- 图片附件会在视觉模型中按 provider 协议传图片；当前会话上下文模型无视觉能力时不阻塞发送，只 toast 提醒，并降级为工作区路径文本。
- 落盘前会剥离用户附件 `dataUrl/content`，只存 `path/name/mime/size/kind/source`；打开会话/分页加载时按工作区文件水合近期消息附件。
- Windows 前端 HTML5 拖拽依赖 `src-tauri/tauri.conf.json` 的窗口配置 `"dragDropEnabled": false`；否则外部文件拖入会被 Tauri webview file-drop 接管，DOM `drop` 收不到 `File` 对象。文件树拖到聊天框另有 `draggingWorkspacePath` 内存 fallback，避免 custom dataTransfer type 在 dragover 阶段不可见。
- 已移除失效的全局 `filesTabBound`：右栏 DOM 每次重建后都会重新绑定文件树并刷新。
- 切换会话会清空 `state.filesTree/filesSelectedPath`，避免展示上一会话缓存。
- `localStorage['wepchat:last-active-session']` 保存最后活动会话；启动优先恢复它，找不到才用 sessions[0]。
- 首次运行新逻辑时还没有 localStorage 记录，会先进入 updated_at 最新会话；手动进入目标会话一次后，下一次启动会恢复它。

本轮只读核对过测试数据：

```text
C:\Users\14844\Documents\WePChat\workspaces\session_5g9yigc\s2-smoke\
  app.js
  index.html
  style.css
```

当时“重启后文件不见”的另一个原因是应用启动进入了工作区为空的最新会话；磁盘文件从未丢失。

---

## 7. 本轮其他 UI 修复

- `initChatScroll` 必须调用 `ChatScroll.initChatScroll(...)`，不要改回未定义的裸函数。
- `.jump-bottom[hidden] { display:none; }`，解决按钮始终显示。
- 供应商 dialog 内容区可纵向滚动，footer sticky，取消/保存按钮完整显示。
- 左栏实际绑定 `--list-w` 与 flex-basis，内容不能再撑到 1:1。
- 左栏拖拽使用 `startWidth + dx`；右栏使用 `startWidth - dx`。
- 右栏 browser/files 的 `--right-w-wide` 与普通 `--right-w` 在拖动时同步更新；有标签页也可缩放。
- 拖动期间 `html.is-resizing` 关闭 width transition。

---

## 8. 产品与实现约束

| 原则 | 说明 |
| --- | --- |
| 真磁盘工作区 | 禁止回到 `session.files` 内存盘 |
| HTTP 走 Rust | 供应商请求使用 `http_request/http_stream`，避免 WebView CORS |
| 路径安全在 Rust | 禁绝对路径、盘符、UNC、`..` |
| 不做真 Shell | `run_js` 仍是浏览器 Worker 沙盒 |
| 设置字段双端同步 | 新设置必须进入 Rust `AppSettings` 并有 `serde(default)`，否则保存会丢 |
| 图片不进会话库 | 图片文件在工作区，消息只存 path/mime/meta |
| 模块化 | 新能力优先独立文件，避免继续膨胀 `app.js` |
| invoke 参数契约 | Rust 命令参数结构体叫 `args` 时，JS 必须 `{ args: {...} }` |

---

## 9. 当前验证状态

已通过：

- `cargo test`：SQLite save/load/list/copy/resave/delete、非法 id 等单测（S1/S2 实施时）。
- `cargo check`：包括最终 preview harness 修复。
- `node --check`：`app.js`、`markdown.js`、`chat-view.js`、`chat-scroll.js`、`chat-rail.js`、`browser-preview.js`。
- `git diff --check`。
- 无浏览器的 marked 管线检查：多行 `\[...\]` 输出单一 `.math-source`，空/完成任务输出专用 checkbox。
- 用户真实窗口测试：公式、task list、工作区、手动 HTML 预览、artifact Preview 均通过。

Playwright 自动浏览器测试未执行：用户选择自行实测。

---

## 10. 当前工作树

当前改动尚未提交。最近一次状态包含：

```text
M  docs/HANDOFF.md
?? docs/image-mode-plan.md
M  docs/sqlite-storage-plan.md
M  src-tauri/src/db.rs
M  src-tauri/src/lib.rs
M  src-tauri/src/sessions.rs
M  src-tauri/src/workspace_fs.rs
M  ui/css/app.css
M  ui/index.html
M  ui/js/api.js
M  ui/js/app-core.js
M  ui/js/app.js
M  ui/js/chat-scroll.js
M  ui/js/chat-view.js
?? image.png
```

注意：

- `image.png` 是用户提供的 Grok Imagine 参考截图，不要擅自删除。
- `node_modules/`、`src-tauri/target/` 不要提交。
- 工作树中已有用户改动，编辑前先看 `git diff`，不要 reset/checkout 覆盖。
- 用户没有要求提交；下一会话也必须等明确授权。

---

## 11. 启动与检查

```powershell
cd E:\wepchat\wepchat\wepchat-win
npm run dev
```

常用检查：

```powershell
node --check ui\js\app.js
node --check ui\js\markdown.js
node --check ui\js\chat-view.js
node --check ui\js\chat-scroll.js
node --check ui\js\chat-rail.js
node --check ui\js\browser-preview.js

cd src-tauri
cargo test
cargo check

cd ..
git diff --check
git status --short
```

---

## 12. 建议下一会话开场

```text
继续 wepchat-win。先完整阅读 docs/HANDOFF.md、docs/sqlite-storage-plan.md；要做生图模式先读 docs/image-mode-plan.md；需要处理聊天长期性能时再读 docs/deepsearch.md。

当前：SQLite S1/S2 已落地并通过实测；S3 已完成 session_messages_page、聊天历史 prepend 保位、左侧标题搜索、退出 WAL checkpoint；FTS5 全局搜索延后。稳定聊天 DOM/流式滚动/rail/KaTeX/task list 已完成；手动 HTML 与代码块 artifact 预览均已实测可用。生图模式改造计划见 docs/image-mode-plan.md；I1 布局首段已把生图主视图改成左侧窄生成对话列 + 右侧主画布，并取消进入生图时强制打开右侧 tab 画布；画布已补选择/抓手、框选、上传、多参考附件、参考/编辑显式选择、画布内编辑输入、生成占位、拖拽吸附黄线；已修复参考取消、stop 按钮、输入框自动增高和生图模型/尺寸自绘选择器；左侧生图列表已改为搜索 + 新建生图 + 更多菜单。工作树未提交，勿覆盖用户改动。

优先补 SQLite S3 性能基准和实机回归，或实施生图模式 I1/I2；任何 schema 变化必须走 user_version 迁移。预览 iframe 当前必须保留 allow-scripts allow-same-origin，原因与安全边界见 HANDOFF。
```
