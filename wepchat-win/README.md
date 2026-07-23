# WePChat (Windows)

本地优先的轻量 AI 聊天客户端 · Tauri 2 + 专用前端。

产品边界见 [`docs/product-boundary.md`](docs/product-boundary.md)。  
架构草案见 [`docs/architecture.md`](docs/architecture.md)。

## 开发

要求：Rust stable、Node.js、Windows WebView2（Win10/11 通常已自带）。

```powershell
cd e:\wepchat\wepchat\wepchat-win
npm install
npm run dev
```

## 构建

```powershell
npm run build
```

产物在 `src-tauri/target/release/bundle/`（安装包等）。

## 目录

```text
wepchat-win/
  ui/                 专用前端（壳 UI）
  src-tauri/          Tauri + Rust
  docs/               产品与架构文档
  image/              UX 演示图
```

## 当前阶段（M1+ 生图雏形）

- 四区布局：图标轨 / 列表 / 主区 / 右侧多侧栏
- 模式：聊天 · **生图** · 设置
- 设置：工作区路径、多供应商（OpenAI Chat / Responses / Anthropic）、**生图参数**
- **供应商 HTTP 走 Rust**（`http_request` / `http_stream`），避免 WebView CORS
- 流式对话 + 会话落盘（`{workspaceRoot}/{sessionId}/session.json`）
- **工具循环（M1）**：12 个公开工具名；真磁盘工作区；Files / Browser / 静态预览联动
- **生图雏形**：`/images/generations`；图落盘 `images/`；中区时间线 + 右点阵画布；`image_go` 聊天工具
- Codex：不做（见 `docs/`）
