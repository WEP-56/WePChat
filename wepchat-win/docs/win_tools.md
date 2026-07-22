# WePChat Windows Tools 设计

更新时间：2026-07-22

> **状态：M1 已落地（2026-07-22）。**  
> Rust `workspace_fs` + `ui/js/tools/*` + `generateAssistant` 工具循环 + Files/Browser 联动已接。  
> `run_js` 首版为 **Worker 沙盒**（非 Node sidecar，与 `win_tools.md` §7 远期方向不同，见下文）。  
> `image_go` 为 stub；`preview_file` 首版用 `iframe.srcdoc`，尚未启会话级静态 HTTP 服务（M2）。

本文档定义 WePChat Windows 端工具系统的公开契约、执行边界和实现方向。  
与安卓：**工具名称、参数 Schema、模型侧用法**兼容；**工作区、预览、run_js、web_fetch 的执行层**在 Windows 用 Rust 重做（真实磁盘 + IPC HTTP），不是安卓 H5 运行时。

## 1. 已确定原则

1. 对模型公开的工具名保持不变。
2. 工具 JSON Schema、参数名称和主要使用方法保持不变。
3. Windows 会话工作区是真实磁盘目录，不使用安卓端的 `session.files` 内存文件模型。
4. 模型只能提供工作区相对路径，不能指定真实工作区根目录或任意绝对路径。
5. `preview_file` 改为右侧浏览器标签和本地静态 HTTP 预览服务的入口。
6. HTML 类任务允许在目标文件尚未生成时先打开预览，随后跟随文件生成过程更新。
7. Windows 端可以提供更强的 JavaScript 运行能力，但不能直接暴露不受控制的系统 Shell。
8. 删除、联网和其他高风险能力继续由应用执行权限控制，不能由模型绕过。
9. OpenAI Chat、OpenAI Responses、Anthropic 共用一套内部工具定义和执行器。

## 2. 公开工具

Windows 端继续向模型公开以下 12 个工具：

```text
run_js
read_file
write_file
edit_file
delete_file
list_files
create_folder
move_path
path_exists
preview_file
web_fetch
image_go
```

兼容名称是否继续保留，由实际会话数据兼容需求决定；兼容名称不进入模型可见工具列表。

## 3. 总体架构

```text
LLM Provider
  -> Provider Tool Adapter
  -> Tool Registry / Dispatcher (WebView)
  -> Permission Controller
  -> Tauri IPC
  -> Rust Tool Runtime
       -> Workspace FS
       -> Preview Server
       -> Network Client
       -> Managed JS Runtime
  -> Tool Result
  -> Provider Adapter
  -> LLM
```

职责划分：

- WebView 维护工具定义、工具调用状态、确认 UI、工具卡片和右侧标签页。
- Provider Adapter 只负责三种供应商之间的工具格式转换。
- Rust 负责真实文件、路径安全、本地 HTTP 服务、进程生命周期和网络访问。
- 模型不能直接调用 Tauri 命令，也不能把内部上下文字段作为工具参数传入。

建议保持一个统一执行入口：

```js
executeTool(name, args, context)
```

其中 `name` 和 `args` 来自模型，`context` 由应用注入：

```js
{
  sessionId,
  workspaceId,
  workspacePath,
  previousResults,
  permissionPolicy
}
```

`workspacePath` 永远不发送给模型。

## 4. 工作区模型

每个会话创建独立工作区：

```text
{configuredWorkspaceRoot}/{sessionId}/
```

会话记录应保存创建时的实际工作区位置。用户修改默认工作区目录后：

- 已有会话继续使用原工作区。
- 新会话使用新的默认工作区。
- 工具执行以会话记录中的工作区为准。

模型传入的路径全部是工作区相对路径，例如：

```text
index.html
src/app.js
assets/logo.png
```

## 5. 文件工具

### 5.1 read_file

公开参数保持不变：

- `path`
- `lines`

Windows 执行逻辑：

- 从真实工作区读取文件。
- 默认只读取 UTF-8 文本文件。
- 保留 `1-20`、`50-80`、`1-`、`-30` 行范围语义。
- 二进制文件返回明确错误，不把二进制内容塞入模型上下文。
- 返回内容受工具输出上限约束。

### 5.2 write_file

公开参数保持不变：

- `path`
- `content`
- `mime`

Windows 执行逻辑：

- 自动创建父目录。
- 先写同目录临时文件，再原子替换目标文件。
- 新建和覆盖都返回明确结果。
- 文件已存在时返回受长度限制的 diff。
- 成功后发出工作区变更事件。
- 如果目标被活动预览引用，通知预览服务刷新。

### 5.3 edit_file

公开参数保持不变：

- `path`
- `find`
- `replace`
- `all`
- `useRegex`
- `regexFlags`
- `ignoreWhitespace`

Windows 执行逻辑：

- Rust 在单次操作中完成读取、匹配、替换和原子写回。
- 默认精确匹配。
- `useRegex` 和 `ignoreWhitespace` 不能同时启用。
- 匹配失败时返回文件前 200 字符，帮助模型修正。
- 成功后返回 diff，并发出工作区变更事件。

### 5.4 delete_file

公开参数保持不变：

- `path`
- `paths`

Windows 执行逻辑：

- 支持文件、空目录和非空目录。
- 支持批量删除。
- 执行前由应用展示一次确认，列出将删除的主要路径和数量。
- Rust 再次验证所有路径仍处于当前工作区。
- 成功后关闭或更新引用已删除文件的预览、文件标签。

### 5.5 list_files

公开参数保持不变：

- `path`
- `recursive`

Windows 执行逻辑：

- 扫描真实目录。
- 返回清晰的树形结构，区分 `[dir]` 和 `[file]`。
- `recursive: false` 只列出直属项。
- 忽略应用内部临时目录和预览 staging 目录。
- 对文件数量、遍历深度和输出长度设置上限。

### 5.6 create_folder

公开参数保持不变：

- `path`

Windows 执行逻辑：

- 在当前工作区创建真实目录。
- 父目录不存在时递归创建。
- 已存在且为目录时返回幂等成功。
- 已存在且为文件时返回明确冲突错误。

### 5.7 move_path

公开参数保持不变：

- `from`
- `to`
- `overwrite`

Windows 执行逻辑：

- 只允许当前工作区内部移动或重命名。
- 默认不覆盖目标。
- 移动目录时保留完整目录树。
- 操作后更新预览入口、文件标签和目录树引用。

### 5.8 path_exists

公开参数保持不变：

- `path`

返回结果保持简单：

```json
{
  "path": "src/app.js",
  "type": "file"
}
```

`type` 取值为 `file`、`folder` 或 `missing`。

## 6. preview_file

公开参数保持不变：

- `path`
- `title`

### 6.1 新行为

`preview_file` 不再要求目标文件已经存在。

当模型准备制作 HTML 类界面时：

1. 先调用 `preview_file`。
2. 应用立即打开或聚焦右侧“浏览器”标签。
3. 如果文件不存在，标签显示等待生成状态。
4. 模型继续使用 `write_file`、`edit_file` 创建 HTML、CSS、JavaScript 和资源文件。
5. 预览服务检测变更并刷新浏览器标签。

如果目标文件已经存在，则立即打开预览。

同一会话、同一路径重复调用时聚焦已有浏览器标签，不重复创建服务。

`.js` 和 `.mjs` 仍可进入右侧“运行”标签；是否允许 `preview_file` 在文件不存在时提前打开运行标签，与 HTML 采用一致策略。

### 6.2 本地静态服务

每个活动会话最多启动一个静态预览服务，多个 HTML 入口共享该服务：

```text
http://127.0.0.1:{randomPort}/{randomToken}/{entryPath}
```

服务要求：

- 只绑定 `127.0.0.1`。
- 随机端口和随机访问 token。
- 只读取当前会话工作区。
- 禁止目录穿越和目录列表。
- 支持 HTML、CSS、JavaScript、JSON、字体和图片等静态资源。
- 默认发送 `Cache-Control: no-store`。
- 会话释放或应用退出时停止服务。
- 服务异常退出时允许自动重建并更新浏览器标签 URL。

### 6.3 预览刷新

第一阶段实现文件操作级实时刷新：

- `write_file`、`edit_file`、`move_path`、`delete_file` 成功后发出变更事件。
- 服务判断活动入口或依赖资源是否受影响。
- 通过 WebSocket、SSE 或 Tauri Event 通知右侧浏览器刷新。

真流式预览作为增强能力：

- 从供应商的工具参数增量中解析 `write_file.content`。
- 增量内容只写入预览 staging 层。
- 以 100 至 200ms 的频率更新，不能逐 token 写正式文件。
- 工具参数完整并校验成功后，才原子提交到真实工作区。
- 最终提交失败时保留正式文件原状，并让预览标签显示错误。

建议 staging 位置由应用管理且不暴露给模型：

```text
{appData}/preview-staging/{sessionId}/{toolCallId}/
```

## 7. run_js

公开参数保持不变：

- `code`
- `inputFiles`

**当前 M1 实现**：浏览器 Worker 沙盒（与安卓同源 API：`console` / `SandboxFS` / 超时 terminate）。  
**远期方向**仍是受控原生 JS 运行器（sidecar），而不是不受限制的系统 Shell。Worker 方案满足契约与验收；sidecar 后置。

已确定要求：

- 独立进程执行。
- 有运行超时、输出长度和内存限制。
- 超时后杀死完整进程树。
- 工作目录与当前会话绑定。
- `inputFiles` 继续兼容现有使用方式。
- 运行输出进入右侧“运行”标签。
- 模型不能借此启动 PowerShell、cmd 或任意后台进程。

待确定事项：

- 使用随应用分发的 Node sidecar、Deno sidecar，还是嵌入式 JavaScript 引擎。
- 是否开放 Node 标准库的受限子集。
- 是否允许网络访问。
- 写文件是直接限制在工作区，还是继续使用显式写回机制。

在运行时和权限模型确定前，不应把 `run_js` 实现为直接调用用户机器上的 `node.exe`。

## 8. web_fetch

工具名称和参数保持安卓兼容，但 Windows 端由 Rust HTTP 客户端执行：

- 不受 WebView CORS 限制。
- 只允许 `http` 和 `https`。
- 保留 GET/POST、headers、body、json、formData 和 timeoutMs。
- 保留联网权限策略和 POST 额外确认。
- 限制重定向次数、响应大小和总耗时。
- 默认阻止访问本机、局域网和云元数据地址，除非后续明确设计授权机制。

## 9. image_go

工具名称和参数保持不变。Windows 端继续通过当前会话的图片供应商执行：

- 生成结果保存到真实工作区。
- `referenceFiles` 只允许引用当前工作区图片。
- `targetFile` 仍是工作区相对路径。
- 成功后更新文件标签页，并生成图片结果卡片。

## 10. 路径与权限安全

Rust 路径层必须统一处理：

- 拒绝绝对路径、盘符路径、UNC 路径和 `..`。
- 路径规范化后再次确认目标位于会话工作区。
- 防止 symlink、junction 和 reparse point 逃出工作区。
- 拒绝 Windows 设备名，如 `CON`、`NUL`、`COM1`。
- 拒绝 NTFS Alternate Data Streams 路径。
- 限制路径长度、单文件大小、文件数量和目录遍历深度。
- 文件删除、移动和覆盖前后都重新检查边界。

建议权限默认值：

| 操作 | 默认策略 |
|---|---|
| 读取、列目录、检查存在 | 当前工作区内直接允许 |
| 新建、编辑、创建目录 | 当前工作区内允许，并展示工具记录 |
| 覆盖、移动 | 当前工作区内允许，并展示 diff 或路径变更 |
| 删除 | 每次确认，支持一次确认多个路径 |
| GET 网络请求 | 按用户联网策略 |
| POST 网络请求 | 每次确认 |
| JS 运行 | 受控运行时内允许 |

## 11. 内部结果协议

模型最终看到的结果仍以简洁文本为主，但内部建议使用结构化结果：

```js
{
  ok: true,
  content: "已更新 src/app.js",
  changes: [
    { path: "src/app.js", operation: "updated" }
  ],
  uiAction: {
    type: "refresh-preview",
    sessionId: "...",
    path: "index.html"
  }
}
```

- `content` 回传给模型。
- `changes` 用于刷新文件树、记录操作历史和生成 diff 卡片。
- `uiAction` 只由应用消费，不发送给模型。
- 工具失败使用统一错误码和可读错误文本，避免模型依赖 Rust 原始错误信息。

## 12. Provider Adapter

内部只维护一份标准工具定义，再转换为各供应商格式：

- OpenAI Chat Completions：`tools[].function`
- OpenAI Responses：function tool
- Anthropic Messages：`input_schema`

工具调用完成后，Provider Adapter 负责把统一结果转换为对应的 tool result 消息。工具执行器不关心当前供应商。

## 13. System Hint 调整

Windows 版提示词需要保留安卓工具使用方法，同时修改以下事实：

```text
当前会话拥有真实磁盘工作区，所有文件路径都相对于当前会话工作区。
当用户要求制作 HTML 页面、交互界面或网页小工具时，先调用 preview_file 打开右侧浏览器标签，再使用 write_file/edit_file 创建和修改页面。浏览器标签会随着工作区文件变化自动更新。
run_js 使用 Windows 端受控 JavaScript 运行器；具体可用 API 以运行器能力说明为准。不要把它描述为 PowerShell、cmd、任意 Shell 或无限制后台服务。
```

当 `run_js` 运行时最终确定后，必须同步补充可用 API、文件访问、网络访问和进程限制。

## 14. 实施顺序

### M1: 真实工作区

1. 工具注册表和三供应商 Tool Adapter。
2. 会话工作区记录和 Rust 路径安全层。
3. 八个文件与目录工具。
4. 工具确认、结果卡片和工作区变更事件。
5. 右侧文件标签与真实目录树联动。

### M2: HTML 预览

1. 会话级静态 HTTP 服务。
2. `preview_file` 提前打开浏览器标签。
3. 文件变更自动刷新。
4. 多入口标签、服务恢复和生命周期管理。
5. 工具参数 staging 和真流式预览。

### M3: 运行与网络

1. 确定并接入受控 JavaScript Runtime。
2. 右侧运行标签、输入输出和终止操作。
3. Rust `web_fetch` 与联网权限策略。
4. `image_go` 的真实工作区输入输出。

## 15. 验收要求

- 12 个公开工具名称和参数与安卓端兼容。
- 模型无法通过任意工具访问会话工作区之外的文件。
- 应用重启后会话文件仍真实存在并可重新打开。
- 修改默认工作区不会破坏旧会话路径。
- `preview_file` 可在入口文件不存在时打开等待标签。
- HTML、CSS、JS 或资源更新后预览自动刷新。
- 同一会话不会为每个 HTML 文件重复启动 HTTP 服务。
- 删除工具始终经过用户确认。
- 三种供应商共用相同工具执行结果。
- 运行器超时后不会残留子进程。
- 工具错误不会导致聊天流或应用界面整体中断。

