# Handoff：Tools + 右侧边栏（下一会话从这里开）

> 更新：2026-07-22  
> 工作区：`e:\wepchat\wepchat\wepchat-win`  
> 计划原文：Claude plan `generic-sauteeing-starfish.md`（已批准，**尚未写工具代码**）  
> 安卓工具循环权威实现：`e:\wepchat\wepchat\js\app-methods-generation.js` + `js/tools/*` + `js/app-helpers.js`（流式 toolCalls）

---

## 1. 一句话现状

Windows WePChat（Tauri 2 + 专用 `ui/`）已能：**加供应商、拉模型元数据、流式聊天、会话落盘/复制/删除、回答多版本重新生成、自定义弹窗、M1 工具循环、Files/Browser 联动**。  

**2026-07-22 已落地**：`workspace_fs.rs`、`ui/js/tools/*`、`tool-stream.js`、`generateAssistant` 工具环、设置「工具与代理」、右侧 Files 树 + Browser srcdoc + Runner 最近输出。  

下一会话可选：M2 静态预览 HTTP、`image_go` 真生图、run_js sidecar、验收用例手工跑通。

---

## 2. 产品/架构约束（勿回退）

| 原则 | 说明 |
|------|------|
| 契约兼容安卓 | 工具名、JSON Schema、消息里 toolCalls 形状对齐安卓 |
| 执行层 Windows 自研 | **真磁盘** `{workspaceRoot}/{sessionId}/`，禁止 `session.files` 内存盘 |
| 出站 HTTP 走 Rust | WebView 禁止直连供应商（CORS）；`http_request` / `http_stream` 已就绪 |
| 路径安全在 Rust | 相对路径 only；禁 `..`、绝对路径、盘符、UNC |
| 不做 Codex / 真 Shell | `run_js` 首版用 **Worker 沙盒**（安卓同源 API）；不调系统 `node.exe` |
| UI | 聊天区内容优先、角色标签已淡化；工具卡片也要紧凑 |

参考：

- `docs/product-boundary.md`
- `docs/architecture.md`
- `docs/win_tools.md`（设计契约，状态栏仍写「未落地」）
- 安卓参考：`e:\wepchat\wepchat\js\tools\*`、`app-methods-generation.js`、`app-helpers.js`

---

## 3. 已完成清单（本对话及之前）

### 3.1 基础设施

- Tauri 2 壳、四区布局、自定义标题栏
- `settings.json`：`workspaceRoot`、`providers`、`activeProviderId/Model`、`systemPrompt`、`temperature`、`maxTokens`、`theme`
- 会话：`{workspaceRoot}/{sessionId}/session.json`，带 `workspacePath`

### 3.2 HTTP（已解决 CORS）

| 命令 | 作用 |
|------|------|
| `http_request` | 非流式（拉模型等） |
| `http_stream` + 事件 `http-stream` | SSE 流式 |
| `http_stream_abort` | 中断 |

**前端调用约定（易踩坑）**：Tauri 按参数名解包，必须包一层 `args`：

```js
invoke('http_request', { args: { method, url, headers, body, timeoutMs } })
invoke('http_stream', { args: { requestId, method, url, headers, body } })
```

实现：`src-tauri/src/http_client.rs`，`ui/js/api.js`（Tauri 优先，XHR 仅回退）。

### 3.3 供应商 / 模型元数据

- `ui/js/model-metadata.js`（从安卓拷贝）
- 供应商对话框：模型列表、获取模型、单模测试、元数据编辑
- **Dialog 层级坑已修**：未 open 的 `<dialog>` 必须 `display:none`，否则会排进文档流、整页可滚

### 3.4 会话与分支

- 列表：重命名 / 置顶 / 复制 / 删除（Rust `copy_session` 等）
- 消息：复制、编辑用户、删除、重新生成（最多 6 个 `variants`）
- `parentAssistantId` + `parentVariantId`；旧分支 `branchBlocked` 禁发
- Rust：`src-tauri/src/sessions.rs`（list/load/save/delete/copy/get_session_workspace）

### 3.5 聊天布局

- 无显眼「你/助手」标签；用户右气泡、助手纯正文；版心 ~720px；操作条淡显

### 3.6 UI 基建

- `ui/js/ui-dialog.js`：toast / confirm / prompt（用 `<dialog showModal>` 叠层）
- `ui/js/runtime.js`：`U.truncate` / `U.uuid` 等

---

## 4. 下一会话要做的事（已批准计划摘要）

完整步骤见计划文件；执行顺序建议：

### Phase 1 — Rust 工作区 FS

**新建** `src-tauri/src/workspace_fs.rs`，命令（参数结构体 + JS `{ args: {...} }`）：

| 命令 | 用途 |
|------|------|
| `ws_list` | 树/列表文本（给模型 list_files） |
| `ws_read` | 读文本 + 可选 lines |
| `ws_write` | 写文件 + 简单 diff 摘要 |
| `ws_edit` | find/replace（精确 / regex / ignoreWhitespace） |
| `ws_delete` | 批量路径 |
| `ws_mkdir` | 建目录 |
| `ws_move` | 移动/重命名 |
| `ws_exists` | file / folder / missing |
| `ws_stat_tree` | 右侧栏结构化树 |
| `ws_read_bytes` 或复用 `ws_read` | 预览读 HTML |

解析会话目录：复用 `sessions::get_session_workspace` / `session_dir`。  
限制：单文件 512KB、工具输出 16KB、深度/数量上限。

### Phase 2 — 前端工具层

```text
ui/js/tools/
  registry.js / defs.js / system-hint.js
  fs.js / web-fetch.js / run-js.js / preview.js / index.js
```

- `Tools.DEFS` + `Tools.execute(name, args, ctx)`
- Schema **从安卓 `js/tools/*.js` 的 definition 拷贝**，execute 改 IPC
- `web_fetch` → `http_request`；POST 需 confirm；禁非 http(s)、基础 SSRF
- `run_js` → Worker（参考安卓 `run-js.js` WORKER_SRC）；写回走 `ws_write`
- `image_go` → stub 字符串
- `preview_file` → `ctx.openPreview` 打开右侧 Browser + `srcdoc`（首版不启静态 HTTP 服务）

### Phase 3 — 生成循环 + 工具卡片

改 `generateAssistant`（`ui/js/app.js`）：

```text
tools = agentEnabled && API.supportsTools(provider) ? Tools.DEFS : []
systemPrompt += Tools.SYSTEM_HINT
loop: API.send → toolCalls → authorize/confirm → Tools.execute → workingMessages 追加 → 再 send
maxToolRounds 默认 8，maxToolCalls 默认 24
```

流式工具状态：从安卓 `app-helpers.js` 移植  
`syncStreamToolCalls` / `finalizeStreamToolCalls` / `discardStreamToolCalls` / `cancelStreamToolCalls`  
→ 建议 `ui/js/tool-stream.js`。

聊天区渲染 `assistantMsg.toolCalls` 卡片（composing/running/done/error）。

设置：`agentEnabled`（建议默认 true）、可选 maxToolRounds/maxToolCalls。  
`AppSettings`（Rust）需增加字段并 `#[serde(default)]`。

### Phase 4 — 右侧边栏

| Tab | 行为 |
|-----|------|
| Files | `ws_stat_tree` 画树；点文件 `ws_read`；显示 workspacePath；工具写后 refresh |
| Browser | 路径 → 读 HTML → `iframe.srcdoc`；`preview_file` 复用同 path tab |
| Runner | 首版：最近 run_js 输出或占位 |

现有壳：`app.js` 里 `renderRightContent` / `addRightTab` / `state.rightTabs`。

### Phase 5 — 文档与验收

- 更新 `win_tools.md` / `architecture.md` 状态
- 验收用例见下方 §6

---

## 5. 关键文件速查

### 必读

| 文件 | 为何 |
|------|------|
| `docs/win_tools.md` | 工具契约与安全 |
| `docs/architecture.md` | 当前 IPC 与职责 |
| `src-tauri/src/lib.rs` | 命令注册 |
| `src-tauri/src/sessions.rs` | 会话目录 |
| `src-tauri/src/http_client.rs` | HTTP 范例（args 解包） |
| `ui/js/api.js` | 供应商协议 + streamTools |
| `ui/js/app.js` | 壳、会话、生成、右侧栏（大文件） |
| 安卓 `js/tools/*` | Schema + run_js Worker + system-hint |
| 安卓 `js/app-methods-generation.js` | 工具循环权威实现 |
| 安卓 `js/app-helpers.js` | 流式 toolCalls UI 状态 |

### 启动

```powershell
cd e:\wepchat\wepchat\wepchat-win
npm install   # 若需要
npm run dev   # 改 Rust 会重编
```

---

## 6. 验收清单（做完后自测）

1. 对话：「写 hello.txt 并 list」→ 磁盘 `{workspace}/{id}/hello.txt` 存在；Files 可见  
2. edit / delete（删除有确认）  
3. `write_file index.html` + `preview_file` → Browser 出页面  
4. `web_fetch` GET 正常；POST 弹确认  
5. `run_js`：`console.log(1+1)` 结果回模型  
6. 路径 `../` 或 `C:\...` → 错误字符串，不落盘  
7. 关闭 agent → 请求不带 tools  
8. 无工具纯聊、重新生成、分支切换仍正常  

---

## 7. 已知坑（务必读）

1. **Tauri invoke 参数名**：结构体参数叫 `args` 时，JS 必须 `{ args: { ... } }`，不能摊平字段。  
2. **`<dialog>` 的 `display`**：禁止无条件 `display:flex`；用 `dialog:not([open]){display:none}` + `[open]{display:flex}`。  
3. **Toast/确认叠层**：`UIDialog` 已用 `showModal`；toast 需挂到当前 top-layer dialog。  
4. **save_settings**：Rust `AppSettings` 未知字段会丢；新设置字段必须加到 `settings.rs`。  
5. **app.js 很大**：工具与右侧栏尽量新模块，避免继续堆成单文件灾难。  
6. **run_js 文档矛盾**：`win_tools.md` 写「非 Worker / 待定 sidecar」；**本切片明确 Worker**，落地后在文档标注后置 sidecar。  

---

## 8. 建议开场白（粘到新会话）

```text
继续 wepchat-win：按 docs/HANDOFF-tools-sidebar.md 实施 Tools + 右侧边栏。
计划已批准：Rust workspace_fs → ui/js/tools → generateAssistant 工具循环 → Files/Browser。
约束：真磁盘工作区、工具名兼容安卓、HTTP/FS 走 Rust、run_js 用 Worker、image_go stub。
先读 HANDOFF 与 win_tools.md，再从 workspace_fs.rs 开始写。
```

---

## 9. 本对话未提交

若用户需要 git commit，请其明确说「提交」；当前 handoff **不自动 commit**。  
工作区应包含上述会话/供应商/HTTP/布局改动 + 本文件。
