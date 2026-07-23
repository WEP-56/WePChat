# Handoff：WePChat Windows（下一会话从这里开）

> 更新：2026-07-22（multipart 图编辑 + 生图雏形 + 流式预览减闪）  
> 工作区：`e:\wepchat\wepchat\wepchat-win`  
> 仓库：`E:\wepchat\wepchat` · 首次 Windows 提交 `54f5c61`（`main`，未 push）  
> 安卓参考：`js/app-methods-generation.js`、`js/tools/*`、`js/image-api.js`、`js/store.js`（生图设置字段）

---

## 1. 一句话现状

Windows WePChat（Tauri 2 + 专用 `ui/`）已能：

**聊天**：加供应商、拉模型元数据、流式对话、会话落盘/复制/删除、回答多版本重新生成、自定义弹窗。  

**工具环（M1）**：真磁盘工作区 FS、12 公开工具、按工具组权限、`generateAssistant` 循环、Files / Browser / Runner。  

**预览**：`write_file` 流式 staging + 会话级静态 HTTP（相对 CSS/JS）+ **in-place `document.write` 减闪**。  

**生图（雏形）**：`mode:'image'` 会话、中区时间线 + 底部输入、右点阵画布、生成 `/images/generations` + 参考图 multipart `/images/edits`、落盘 `images/`、聊天 `image_go` 真调用。

---

## 2. 产品/架构约束（勿回退）

| 原则 | 说明 |
|------|------|
| 契约兼容安卓 | 工具名、JSON Schema、消息 toolCalls 形状对齐 |
| 执行层 Windows 自研 | **真磁盘** `{workspaceRoot}/{sessionId}/`，禁止 `session.files` 内存盘 |
| 出站 HTTP 走 Rust | WebView 禁止直连供应商；`http_request` / `http_stream` |
| 路径安全在 Rust | 相对路径 only；禁 `..`、绝对路径、盘符、UNC |
| 不做 Codex / 真 Shell | `run_js` = Worker 沙盒；不调系统 `node.exe` |
| 新设置字段 | 必须进 Rust `AppSettings` + `#[serde(default)]`，否则 `save_settings` 会丢 |
| 模块化 | 生图 / 预览 / 工具尽量独立模块，少往 `app.js` 堆逻辑 |

参考：`docs/product-boundary.md`、`docs/architecture.md`、`docs/win_tools.md`。

---

## 3. 已完成能力速查

### 3.1 壳与基础设施

- Tauri 2、四区布局、自定义标题栏  
- `settings.json`：workspace、providers、active model、agent、toolPermissions、**生图字段**  
- 会话：`session.json`，`mode: 'chat' | 'image'`，`workspacePath`

### 3.2 HTTP

| 命令 | 作用 |
|------|------|
| `http_request` | 非流式；可选 `responseEncoding: 'base64'`（下图） |
| `http_stream` + `http-stream` 事件 | SSE 流式 |
| `http_stream_abort` | 中断 |

JS 必须包 `args`：

```js
invoke('http_request', { args: { method, url, headers, body, timeoutMs, responseEncoding } })
```

### 3.3 工作区 FS（`workspace_fs.rs`）

| 命令 | 说明 |
|------|------|
| `ws_list` / `ws_stat_tree` / `ws_read` / `ws_write` / `ws_edit` / … | 文本工具 |
| `ws_write` + `encoding: 'base64'` | **二进制**（生图落盘，上限 16MB） |
| `ws_read_bytes` | 读文件 → `contentBase64` + mime（缩略图 / 参考） |

文本单文件默认 512KB；图片走 base64 通道。

### 3.4 工具与权限

- `ui/js/tools/*` + `tool-stream.js`  
- 设置「工具与代理」：总开关、轮次、**toolPermissions**（含 `image_go`），分段切换自动落盘  
- `authorizeToolCall`

### 3.5 HTML 预览

| 层 | 文件 / 行为 |
|----|-------------|
| 流式 staging | `preview-stream.js`（200ms 节流） |
| 静态服务 | `preview_server.rs`：127.0.0.1 + token；staging 覆盖磁盘 |
| 减闪 paint | `browser-preview.js`：`document.write` + `<base href>`；滚动恢复；避免每帧 `frame.src=` |
| 落盘后 | `loadBrowserPath` 优先磁盘 |

### 3.6 生图雏形

| 层 | 文件 / 行为 |
|----|-------------|
| API | `ui/js/image-api.js`：优先 `POST …/images/generations`（b64_json）；HTTP 全走 Tauri |
| 模式 | `ui/js/image-mode.js`：仅调生图模型；会话 `mode:'image'`；时间线 + composer |
| 画布 | `ui/js/image-canvas.js`：点阵、pan/zoom、拖位置、选中→参考 chip（**无**吸附/连线） |
| 落盘 | `{session}/images/YYYYMMDD_HHMMSS_*.png`；`session.json` **不嵌** base64 |
| 设置 | 设置页「生图」；供应商对话框「生图接口」可选 BaseURL/Key/端点 |
| 聊天工具 | `ui/js/tools/image-go.js` → 同一 `runImageRequest` |
| 编辑策略 | 选中画布图作 reference；`ws_read_bytes` 读取后经 Rust HTTP bridge 上传 multipart `/images/edits` |

布局（image mode，对齐 Grok Imagine 气质）：

```text
[轨] [左：生图会话] [中：提示时间线 + 输入] [右：点阵画布，默认打开]
```

---

## 4. 关键文件

| 文件 | 为何 |
|------|------|
| `src-tauri/src/settings.rs` | AppSettings + 生图字段 + toolPermissions |
| `src-tauri/src/workspace_fs.rs` | 文本 FS + base64 写 / bytes 读 |
| `src-tauri/src/http_client.rs` | HTTP + base64 请求/响应；二进制请求体上限 64MB |
| `src-tauri/src/preview_server.rs` | 会话静态预览 |
| `src-tauri/src/lib.rs` | 命令注册 |
| `ui/js/app.js` | 壳、会话、模式切换、右侧栏接线（尽量少堆业务） |
| `ui/js/api.js` | 聊天供应商协议 |
| `ui/js/image-api.js` | 生图 HTTP |
| `ui/js/image-mode.js` | 生图模式状态与 UI |
| `ui/js/image-canvas.js` | 点阵画布 |
| `ui/js/browser-preview.js` | 预览 in-place paint |
| `ui/js/preview-stream.js` | write_file 流式 staging |
| `ui/js/tools/*` | 工具注册与执行 |
| 安卓 `js/image-api.js` / `store.js` 生图段 | 字段与协议参考 |

### 启动

```powershell
cd e:\wepchat\wepchat\wepchat-win
npm install   # 若需要
npm run dev   # 改 Rust 会重编
```

---

## 5. 已知坑（务必读）

1. **Tauri invoke 参数名**：结构体参数叫 `args` 时，JS 必须 `{ args: { ... } }`。  
2. **`<dialog>` display**：未 open 必须 `display:none`，避免占文档流。  
3. **save_settings**：Rust `AppSettings` 未知字段会丢；新字段必须加到 `settings.rs`。  
4. **app.js 很大**：新能力优先独立模块。  
5. **生图 session.json**：消息里的 `images[]` 存 path/mime/生成元数据，不存 base64；缩略图用 `ws_read_bytes` 现读。  
6. **画布参考图**：参考图走 multipart `/images/edits`；Android 同款重复 `image` 字段与 `image[]` payload 会在 400/422 时兼容重试，请按供应商配置编辑模型/端点。  
7. **run_js**：当前 Worker；sidecar 后置。  
8. **流式预览**：`document.write` 会重跑页面脚本；双缓冲淡入仍可做。

---

## 6. 下一会话待办

### 已完成（勿重复开工）

- M1 工具环 / 权限 / Files·Browser·Runner  
- 会话静态预览 HTTP + write_file 流式 staging  
- HTML 流式 in-place paint 减闪  
- 生图雏形：设置 + API + 模式壳 + 画布 + `image_go`
- 生图编辑：工作区参考图读取 + multipart `/images/edits` + 编辑模型/端点设置

### 可选下一刀

| 优先级 | 项 | 说明 |
|--------|----|------|
| 中 | 生图体验 | 画布状态持久化打磨；供应商侧测图入口 |
| 中 | 预览 | 双 iframe 交叉淡入；半截 HTML 更稳妥 |
| 低 | run_js sidecar | 仍保持 Worker 为默认 |
| 低 | 文档对齐 | `win_tools.md` / `architecture.md` 状态栏若仍写「未落地」可改 |

---

## 7. 建议开场白（粘到新会话）

```text
继续 wepchat-win：读 docs/HANDOFF-tools-sidebar.md。
现状：工具环 + 静态预览减闪 + 生图雏形（image mode / image_go / 点阵画布 / multipart 图编辑）已落地。
可选：画布持久化打磨、供应商测图入口、预览双缓冲、run_js sidecar。
约束：真磁盘工作区、设置字段进 Rust AppSettings、HTTP/FS 走 Rust。
```

---

## 8. 提交状态

- 主仓路径：`wepchat-win/`，历史提交 `54f5c61`（未 push）。  
- **后续改动需用户明确说「提交」再 commit。**  
- **勿**提交 `node_modules/`、`src-tauri/target/`。

---

## 9. 预览链路（备忘）

```text
SSE arguments delta
  → PreviewStream（path+content，200ms）
  → preview_server overlay
  → BrowserPreview document.write + <base href=…/dir/>
  → Tools.execute → ws_write 落盘
  → loadBrowserPath 读磁盘再 paint
```

## 10. 生图链路（备忘）

```text
生图模式 composer / 聊天 image_go
  → ImageMode.runImageRequest
  → 无参考图：ImageAPI.generate（JSON http_request → /images/generations）
  → 有参考图：ws_read_bytes → base64 binary body → multipart /images/edits
  → dataUrl → ws_write encoding=base64 → images/*.png
  → 时间线缩略图 + 画布贴片
  → session 只存 path（无 base64）
```
