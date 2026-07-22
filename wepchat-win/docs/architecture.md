# WePChat Windows — 架构草案

> 状态：v0.4（M1 工具 + 右侧栏）  
> 更新：2026-07-22  
> 约束：`product-boundary.md` 优先

---

## 1. 总览

```text
┌──────────────────────────────────────────────────────────┐
│  WebView2  ·  专用前端 ui/                                │
│  壳 UI · api.js 协议适配 · SSE 解析 · 会话状态             │
└───────────────────────────┬──────────────────────────────┘
                            │ Tauri IPC（invoke / event）
┌───────────────────────────▼──────────────────────────────┐
│  Rust  ·  src-tauri                                        │
│  settings · 会话磁盘 · **HTTP 出站（reqwest，无 CORS）**   │
│  http_* · **workspace_fs（ws_* 真磁盘工具）**               │
└───────────────────────────┬──────────────────────────────┘
                            │ HTTPS
┌───────────────────────────▼──────────────────────────────┐
│  模型供应商（OpenAI 兼容 / Anthropic / 自建网关…）         │
└──────────────────────────────────────────────────────────┘
```

**职责划分（重要）**

| 层 | 做什么 | 不做什么 |
|----|--------|----------|
| WebView JS | UI、会话状态、协议拼装（Chat/Responses/Anthropic）、SSE 行解析 | **不**用 XHR/fetch 直连供应商（CORS） |
| Rust | 设置/会话落盘、**全部出站 HTTP**、后续工具 FS/预览/网络 | 不解析各家 SSE 语义（留给 api.js） |

- 与安卓的关系：**复用协议与工具契约**（名字、参数、消息形状），**不复用安卓运行时**（无 `plus`/`uni`、无 `session.files` 内存盘）。
- **不做** wepchat-host / Codex。

---

## 2. 仓库布局（当前）

```text
wepchat-win/
  docs/
    product-boundary.md
    architecture.md
    win_tools.md          ← 工具契约（设计稿，多数尚未落地）
  image/
  ui/
    index.html
    css/app.css
    js/
      app.js              壳 + 供应商 + 会话 + 聊天 + 工具循环
      api.js              供应商协议适配（传输层走 Tauri）
      tool-stream.js      流式 toolCalls UI 状态
      tools/              工具注册表 / FS / web_fetch / run_js / preview
      network-stability.js
      markdown.js
      runtime.js          小工具 U.*
    libs/                 marked / purify / highlight
  src-tauri/
    src/
      lib.rs
      main.rs
      settings.rs
      http_client.rs      出站 HTTP
      sessions.rs         会话目录
      workspace_fs.rs     工作区真磁盘 FS 命令
    capabilities/
    tauri.conf.json
  package.json
  README.md
```

---

## 3. 前端壳

| 区域 | 行为 |
|------|------|
| 图标轨 | `chat` / `image` / `settings` |
| 列表 | 会话 / 生图任务 / 设置分类 |
| 主区 | 对话流式渲染；设置（供应商、工作区、关于） |
| 右栏 | 预览 / 文件 / 运行（UI 壳有，工具未接） |

---

## 4. Rust IPC（已实现）

| 命令 | 作用 |
|------|------|
| `get_app_meta` | 名称、版本、平台 |
| `get_settings` / `save_settings` | `%APPDATA%/com.wepchat.app/settings.json` |
| `get_default_workspace_root` | `文档/WePChat/workspaces` |
| `resolve_workspace_root` | 自定义或默认 |
| `list_sessions` / `load_session` / `save_session` / `delete_session` / `copy_session` | 会话与工作区目录 |
| `get_session_workspace` / `get_workspace_info` | 会话路径 / 根目录信息 |
| `http_request` | 非流式 HTTP（拉模型列表等） |
| `http_stream` + 事件 `http-stream` | 流式 HTTP（聊天 SSE） |
| `http_stream_abort` | 中断进行中的流 |
| `ws_list` / `ws_read` / `ws_write` / `ws_edit` | 工作区列表/读/写/编辑 |
| `ws_delete` / `ws_mkdir` / `ws_move` / `ws_exists` | 删除/建目录/移动/存在性 |
| `ws_stat_tree` | 右侧 Files 结构化树 |
| 事件 `workspace-changed` | 写/删/移后通知前端刷新 |

启动时创建 app data 与工作区根目录。

> WebView `connect-src` 只约束页面侧；供应商流量在 Rust，**不依赖**对方 CORS。

### settings.json 字段（camelCase）

| 字段 | 说明 |
|------|------|
| `workspaceRoot` | 自定义工作区根；空则默认 |
| `theme` | light / dark / system（UI 应用待完善） |
| `providers` | 供应商数组（含 apiKey） |
| `activeProviderId` / `activeModel` | 当前选用 |
| `systemPrompt` / `temperature` / `maxTokens` | 全局对话参数 |
| `agentEnabled` | 是否向模型暴露工具（默认 true） |
| `maxToolRounds` / `maxToolCalls` | 工具循环上限（默认 8 / 24） |

---

## 5. 前端传输约定

`ui/js/api.js`：

- 在 Tauri 下：`plainRequest` → `http_request`；`sseOnce` → `http_stream` + `http-stream` 事件。
- 非 Tauri 时保留 XHR 回退（便于浏览器单独调试，**正式桌面路径不走这条**）。

---

## 6. 阶段

| 阶段 | 内容 | 状态 |
|------|------|------|
| M0 | 四区壳 + 设置路径 | 已落地 |
| M1 | 多供应商 + 流式聊 + 会话落盘 + 分支/重生成 + 工具 FS + Files/Browser | **基本完成**（srcdoc 预览；静态 HTTP 服务属 M2） |
| M2 | HTML/JS 预览 HTTP 服务 + 流式 HTML | 未开始（见 `win_tools.md`） |
| M3 | 生图 + `.wepchat` 互导 | 未开始 |
| M4 | GH Action 安装包/便携；可选更新 | 未开始 |

---

## 7. 已知缺口（相对文档）

1. **预览服务**：Browser 用 `iframe.srcdoc`，尚无会话级 `127.0.0.1` 静态 HTTP（M2）。
2. **run_js**：Worker 沙盒已接；Node/Deno sidecar 后置。
3. **image_go**：stub，未接生图供应商。
4. **回答分支**：助手 `variants`（最多 6）+ `parentVariantId`；旧分支时 `branchBlocked`。
5. **主题 / 生图页**：入口有，能力未做。

---

## 修订记录

| 版本 | 日期 | 说明 |
|------|------|------|
| v0.1 | 2026-07-21 | 初稿 |
| v0.2 | 2026-07-21 | 对齐 M0 实际结构；重建文档 |
| v0.4 | 2026-07-22 | M1 工具循环 + workspace_fs + 右侧 Files/Browser |
| v0.3 | 2026-07-22 | LLM HTTP 改走 Rust；职责与缺口对齐代码 |
