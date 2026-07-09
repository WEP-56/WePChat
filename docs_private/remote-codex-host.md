# WepChat Remote Codex Host 设计草案

本文记录 WepChat “远程”模式的第一阶段设计。目标是在不迁移现有 HBuilderX + Vue + H5 主体的前提下，让手机端 WepChat 通过局域网控制电脑上的 Codex 工作。

## 结论

第一版不要接管 Codex Desktop 的 UI，也不要要求用户先打开 `codex` TUI。应新增一个独立 npm 包 `wepchat-host`：

```text
WepChat Android H5
  -> ws/http + token
wepchat-host
  -> stdio JSON-RPC
codex app-server
  -> local Codex config/session/repo/shell/git/tools
```

`wepchat-host` 是远程控制面的 owner。它启动或管理自己的 `codex app-server` 子进程，给手机端提供稳定的 WepChat 协议，并把 Codex 原始 app-server 事件翻译成 WepChat 消息、工具卡片和审批卡片。

这样做的原因：

- 现有 HBuilderX/H5 能直接使用 HTTP/WebSocket，不需要 Capacitor。
- `codex app-server` 的 WebSocket transport 仍标为 experimental；手机端不应直接暴露到 Codex 原始协议。
- Codex Desktop 的官方移动远控走 ChatGPT/Codex 自己的配对和 relay，不适合作为 WepChat 的内置依赖。
- `wepchat-host` 可以后续加 Claude Code adapter，但手机端协议保持稳定。

## 已确认的 Codex 能力

调研来源：

- Codex manual: `Codex App Server`, `CLI command reference`, `Codex CLI features`, `Remote connections`
- 本机 `codex --help`, `codex resume --help`, `codex app-server --help`
- 本机 `codex app-server generate-ts` 生成的协议类型

关键事实：

- `codex app-server` 是 Codex rich client 使用的接口，支持 JSON-RPC 2.0 风格消息。
- 默认 transport 是 `stdio://`，也支持 `ws://IP:PORT` 和 Unix socket；WebSocket 被标记为 experimental/unsupported。
- client 必须先发送 `initialize`，再发送 `initialized` notification。
- 核心抽象是 `Thread`、`Turn`、`Item`。
- `thread/start` 支持 `cwd`、`model`、`approvalPolicy`、`sandbox` 等参数。
- `turn/start` 支持 `cwd` override，且会影响本 turn 及后续 turns。
- `thread/list` 支持按 `cwd` 精确过滤，支持 `sourceKinds`、分页、排序。
- `thread/resume` 推荐用 `threadId`，也支持 `cwd` override。
- CLI `codex resume` 默认按当前工作目录筛选；`--all` 才跨目录显示。
- CLI `codex resume <SESSION_ID>` 可以恢复指定 session；`--last` 恢复当前目录最近 session。
- app-server 会发出 `item/agentMessage/delta`、`item/started`、`item/completed`、`turn/completed` 等 notifications。
- app-server 的审批不是普通 notification，而是 server request，例如 `item/commandExecution/requestApproval`，client 需要用同一个 request id 回复 `accept` / `decline` 等 decision。

## 项目目录如何选定

WepChat 手机端不能直接浏览电脑文件系统。`wepchat-host` 需要维护一个明确的 workspace registry。

第一版支持三种来源，按优先级：

1. 启动目录

   用户在目标项目目录运行：

   ```bash
   npx wepchat-host --lan
   ```

   host 自动把当前目录注册为默认 workspace。

2. 命令行显式传入

   ```bash
   npx wepchat-host --lan --workspace E:\wepchat\wepchat --workspace D:\projects\foo
   ```

3. 配置文件

   建议放在：

   ```text
   ~/.wepchat-host/config.json
   ```

   示例：

   ```json
   {
     "bind": "127.0.0.1",
     "port": 8797,
     "workspaces": [
       { "name": "WepChat", "path": "E:\\wepchat\\wepchat" }
     ],
     "codex": {
       "command": "codex",
       "model": "",
       "approvalPolicy": "on-request",
       "sandbox": "workspace-write"
     }
   }
   ```

手机端只展示已注册 workspace。不要在 MVP 中允许手机端输入任意电脑路径；这会扩大安全边界，也容易踩 Windows 路径、权限和盘符问题。

## 新建会话流程

手机端创建远程会话时：

1. 用户选择 host。
2. WepChat 请求 `GET /workspaces`。
3. 用户选择 workspace。
4. WepChat 发送 `remote.thread.start`。
5. `wepchat-host` 验证 workspace path 在 allowlist 内。
6. host 调用 Codex：

   ```json
   {
     "method": "thread/start",
     "params": {
       "cwd": "E:\\wepchat\\wepchat",
       "approvalPolicy": "on-request",
       "sandbox": "workspace-write",
       "threadSource": "wepchat-host"
     }
   }
   ```

7. host 返回 WepChat 自己的 `remoteThreadId`、Codex `threadId` 和 workspace 信息。
8. 用户发送第一条消息时，host 调用 `turn/start`。

`thread/start` 和 `turn/start` 分离是有价值的：可以先建线程、展示空会话、加载历史或设置模型，再发首条 prompt。

## 恢复会话流程

远程模式要支持两类恢复。

### 恢复 WepChat 已知远程会话

WepChat 本地 session 保存：

```json
{
  "mode": "remote",
  "remote": {
    "hostId": "host_xxx",
    "workspacePath": "E:\\wepchat\\wepchat",
    "codexThreadId": "018f...",
    "hostSessionId": "rmt_..."
  }
}
```

恢复时：

1. 手机连接 host。
2. host 验证 workspace 仍在 allowlist。
3. host 调用 `thread/resume`，优先使用 `threadId`。
4. host 可调用 `thread/read { includeTurns: true }` 回放历史，补齐手机端本地缺失消息。

### 恢复 Codex CLI/Desktop/VSCode 历史会话

host 提供“导入/继续 Codex 历史”列表：

1. host 调用 `thread/list`：

   ```json
   {
     "cwd": "E:\\wepchat\\wepchat",
     "sortKey": "recency_at",
     "sortDirection": "desc",
     "limit": 30
   }
   ```

2. 只展示 `cwd` 与当前 workspace 精确匹配的 threads。
3. 用户选择后，host 调用 `thread/resume { threadId }`。
4. WepChat 创建一个新的 remote session 镜像该 Codex thread。

这等价于 CLI 的 `codex resume` 当前目录筛选逻辑，但由 host 通过 app-server 协议完成，不需要启动 TUI。

## 是否需要先开启 Codex CLI

不需要。

推荐流程是：

```bash
cd E:\wepchat\wepchat
npx wepchat-host --lan
```

`wepchat-host` 自己启动：

```bash
codex app-server --stdio
```

然后通过 stdio JSON-RPC 控制它。

不要要求用户先运行：

```bash
codex
```

原因：

- TUI 是人机终端界面，不适合被手机结构化控制。
- 解析终端输出不稳定。
- 审批、diff、工具状态在 app-server 里是结构化事件。
- WepChat 需要断线重连和移动端事件缓存，不能绑定终端生命周期。

## Codex Desktop 怎么办

第一版结论：**不接管正在运行的 Codex Desktop 会话。**

Codex Desktop 的官方远控路径是：

```text
Codex Desktop host
  -> OpenAI secure relay
ChatGPT mobile / supported Codex App client
```

这个路径需要从 Codex App 内设置移动访问、扫码配对，并使用同账号/工作区。它不是给第三方 H5 客户端直接复用的局域网接口。

WepChat 第一版与 Desktop 的关系应定义为：

- 可以和 Codex Desktop 共用同一台电脑上的 Codex 登录、配置和历史 session 存储。
- 可以通过 `thread/list` 看到 app-server 可识别的历史 threads，包括 CLI/VSCode/appServer 等来源。
- 可以恢复已落盘的历史 thread。
- 不承诺接管 Desktop 当前正在运行的 turn。
- 不控制 Desktop 窗口，不读取 Desktop UI 状态，不复用 Desktop 的官方 mobile pairing。

如果用户正在 Desktop 里让 Codex 跑一个长任务，MVP 不应该让手机“抢同一条活跃 turn”。更稳的规则是：一个 active turn 只由一个控制面操作。WepChat 可以恢复已完成/已保存的 thread，或从同一 workspace 新开 thread。

后续可以单独调研：

- `codex app-server daemon`
- `codex app-server proxy`
- `codex remote-control`
- app-server 对 running thread rejoin 的实际行为

但这些不进入第一版承诺。

## wepchat-host 连接流程

### 电脑端

第一次：

```bash
npm install -g wepchat-host
cd E:\wepchat\wepchat
wepchat-host --lan
```

或不安装：

```bash
npx wepchat-host --lan
```

host 启动后：

1. 检查 `codex` 是否存在。
2. 检查 Codex 登录状态，可通过 app-server 的 auth/account 能力或 `codex doctor` 辅助提示。
3. 启动 `codex app-server --stdio`。
4. 发送 `initialize` + `initialized`。
5. 启动 HTTP/WebSocket server。
6. 生成随机 token。
7. 打印局域网 URL 和配对二维码。

输出示例：

```text
WepChat Host

Local:  http://127.0.0.1:8797
LAN:    http://192.168.1.23:8797
Token:  8S2u...redacted

Workspaces:
  - WepChat  E:\wepchat\wepchat

Open WepChat -> 设置 -> 远程 Codex -> 扫码连接
```

### 手机端

1. 设置页添加远程 host。
2. 扫码或手动输入 `host + token`。
3. WepChat 调 `GET /health`。
4. WepChat 调 `GET /workspaces`。
5. 用户新建“远程”会话。
6. 选择 workspace。
7. 选择“新建 Codex thread”或“恢复历史 thread”。
8. 进入现有聊天 UI。

## WepChat 与 host 的自定义协议

不要把 Codex 原始 JSON-RPC 直接暴露给手机端。定义 WepChat Remote Protocol。

### HTTP

```text
GET /health
GET /pairing
GET /workspaces
GET /threads?workspaceId=...
```

### WebSocket client -> host

```json
{ "type": "remote.thread.start", "id": "1", "workspaceId": "ws_1" }
{ "type": "remote.thread.resume", "id": "2", "threadId": "018f..." }
{ "type": "remote.turn.start", "id": "3", "threadId": "018f...", "text": "继续修这个 bug" }
{ "type": "remote.turn.interrupt", "id": "4", "threadId": "018f..." }
{ "type": "remote.approval.respond", "id": "5", "approvalId": "appr_1", "decision": "accept" }
```

### WebSocket host -> client

```json
{ "type": "remote.message.delta", "threadId": "018f...", "itemId": "item_1", "text": "..." }
{ "type": "remote.item.started", "threadId": "018f...", "item": { "type": "commandExecution", "command": "npm test" } }
{ "type": "remote.item.completed", "threadId": "018f...", "item": { "type": "commandExecution", "exitCode": 0 } }
{ "type": "remote.approval.required", "approvalId": "appr_1", "title": "运行命令", "command": "npm test", "cwd": "E:\\wepchat\\wepchat" }
{ "type": "remote.turn.completed", "threadId": "018f...", "status": "completed" }
```

host 内部维护：

```text
phone ws message
  -> WepChat protocol router
  -> Codex JSON-RPC request
  -> Codex notification/server-request
  -> event translator
  -> phone ws event
```

## 审批流

Codex app-server 会主动向 client 发 server request：

```json
{
  "method": "item/commandExecution/requestApproval",
  "id": 42,
  "params": {
    "threadId": "...",
    "turnId": "...",
    "itemId": "...",
    "command": "npm test",
    "cwd": "E:\\wepchat\\wepchat"
  }
}
```

`wepchat-host` 需要：

1. 生成自己的 `approvalId`。
2. 记录 `approvalId -> codexRequestId`。
3. 推送手机审批卡片。
4. 手机选择通过/拒绝。
5. host 向 Codex app-server 回应：

   ```json
   {
     "id": 42,
     "result": { "decision": "accept" }
   }
   ```

第一版只做：

- `accept`
- `decline`
- `cancel`

`acceptForSession` 和 execpolicy/network amendment 后续再做，因为它们涉及更长期的权限记忆。

## 断线与重连

手机断线不应该立即中断 Codex turn。

host 需要维护一个轻量 session store：

```json
{
  "hostSessionId": "rmt_...",
  "workspaceId": "ws_1",
  "codexThreadId": "018f...",
  "activeTurnId": "0190...",
  "eventSeq": 123,
  "recentEvents": []
}
```

重连时：

1. 手机带上 `hostSessionId` 和 last seen `eventSeq`。
2. host 回放 ring buffer。
3. 如果 ring buffer 不足，手机调用 `thread/read includeTurns=true` 重新同步主要消息。

host 重启后：

- 已完成 turns 可通过 `thread/read` 恢复。
- 正在运行的 child process/active turn 是否可恢复取决于 Codex app-server 状态；MVP 不承诺 host 进程退出后 active turn 仍继续。

## 安全边界

默认安全策略：

- 默认只监听 `127.0.0.1`。
- 只有显式 `--lan` 才监听局域网地址。
- 局域网访问必须带 token。
- token 不写进命令行参数，优先生成并保存在 host 本地配置。
- 手机端不直接访问 `codex app-server`。
- `wepchat-host` 只允许操作 registered workspaces。
- 所有传入 workspace/path 必须 resolve 后验证在 allowlist 内。
- 不提供任意 shell API 给手机端。
- 不提供“手机输入电脑任意路径并打开”的能力。
- 推荐 Tailscale/ZeroTier；不建议公网暴露。
- Windows 防火墙放行应由用户明确确认。

## MVP 范围

第一阶段只做这些：

- `wepchat-host` npm 包
- host 启动 `codex app-server --stdio`
- host HTTP/WebSocket server
- token 配对
- workspace registry
- remote mode 设置页连接测试
- 新建 remote session
- 按 workspace 列 Codex 历史 threads
- `thread/start`
- `thread/resume`
- `turn/start`
- agent message delta
- command/file/tool item 卡片的基础展示
- command approval accept/decline/cancel
- `turn/interrupt`
- 断线重连时的基础事件回放

不做：

- 接管 Codex Desktop 当前 UI 会话
- 复用 Codex 官方 mobile pairing
- 手机端任意浏览电脑文件系统
- 完整 git 面板
- 完整 diff 编辑器
- 远程终端
- 多 host relay/cloud
- 手机 push notification
- Claude Code adapter

## 后续阶段

第二阶段：

- 文件树只读浏览
- diff viewer
- git status / stage / commit
- 图片和截图附件
- host mDNS discovery
- 打开 agent 启动的 localhost 服务 URL

第三阶段：

- Claude Code adapter
- Tailscale 连接提示
- host 常驻服务安装
- 系统通知
- 多电脑 host 管理
- 更完整的审批策略

## 对现有 WepChat 的改动点

手机端第一版保持 HBuilderX/H5。

数据层：

```js
session.mode = 'chat' | 'image' | 'remote'
session.remote = {
  hostId,
  workspaceId,
  workspacePath,
  codexThreadId,
  hostSessionId
}
```

设置层：

```js
settings.remoteHosts = [
  {
    id,
    name,
    baseUrl,
    token,
    lastConnectedAt
  }
]
```

新增模块：

```text
js/remote-api.js
```

职责：

- 管理 host HTTP/WebSocket 连接。
- 发送 remote protocol 消息。
- 将 host event 转为现有 message/tool card 数据。
- 处理重连和 event seq。

UI：

- 设置页新增“远程 Codex”。
- 新建会话增加“远程”模式。
- 远程会话顶部显示 host/workspace 状态。
- 输入框复用常规聊天。
- 审批复用现有确认弹窗/工具卡片风格。

## 关键设计判断

`wepchat-host` 应当像一个“小型本地 Codex 客户端”，而不是 Codex Desktop 的遥控器。

用户不需要先打开 CLI，也不需要打开 Desktop。流程应是：

```text
电脑运行 wepchat-host
手机连接 host
选择 workspace
新建或恢复 Codex thread
手机对话、查看进度、审批动作
```

Desktop 可以继续作为用户在电脑前的主界面，但 MVP 不要混用同一条正在运行的 turn。WepChat 远程模式的价值在于“离开电脑后从手机舒服地启动、继续、审批 Codex 工作”，不是把 Codex Desktop 镜像到手机上。
