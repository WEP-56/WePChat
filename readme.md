<p align="center">
  <img src="img\icon.png" width="200">
</p>

<h1 align="center">WePChat</h1>

<p align="center">
  简单、轻量、克制——永远这样
</p>



WePChat 是一个本地优先的轻量移动端 AI 聊天应用，当前以静态 Vue/H5 为主体，按 HBuilderX / HTML5+ Android App 方向推进。

项目目标是做一个克制、快速、适合日常使用的 LLM 客户端：对话、Markdown 阅读、文件工作区、轻量代码/网页生成、图片生成与编辑，以及在手机上远程驱动桌面 Codex 处理本机项目。它不是 ComfyUI、Midjourney 或移动开发环境，也不追求内置完整 Linux。


这个项目的初衷是，Cherry Studio / Chatbox 已经过于沉重，不适合我的使用场景了，我得做个简单点。所以 WePChat 适合这些场景：
- 日常问答
- 想法快速验证：WePChat 支持编写 HTML 并预览，以及简单的 JavaScript 代码运行
- 测试模型连通性：WePChat 支持 OpenAI 的 Completions / Responses 接口，支持 Anthropic 的 Messages 接口。配置简单，模型切换方便，可以快速验证连通性
- 日常快速生图：WePChat 支持 OpenAI 的图像生成 / 图像编辑
- 移动端远控 Codex：手机 App 通过局域网连接电脑上的 `wepchat-host`，让桌面 Codex 在指定项目里读代码、改文件、跑命令，并把输出和审批回传到手机端

## 当前能力

- 多会话管理，支持常规对话和生图会话。
- 远程 Codex 会话，通过 `wepchat-host` 在局域网内连接桌面 Codex，并操作已注册的本机工作区。
- 多模型提供商配置，支持 OpenAI-compatible、Responses、Completions、Messages 等常见接口形态。
- 模型元数据管理，记录上下文、输出上限、视觉、工具、结构化输出、图像生成/编辑等能力。
- Markdown 渲染、代码块复制、链接打开、图片展示。
- 当前会话工作区，支持文件树、新建、上传、编辑、删除、导出和 HTML 运行预览。
- IndexedDB + 内存缓存持久化，避免 Android WebView `localStorage` 配额过小导致大文本和图片丢失。
- Agent 工具调用可视化，工具参数流式生成时提前显示工具卡片。
- 轻量 JavaScript 沙盒，用于计算、文本/JSON/CSV 处理、编码解码和数据转换。
- 工作区文件工具，包括读取片段、写入、精确/正则/忽略空白编辑、目录创建、移动/重命名、批量删除和路径检查。
- HTML 多页面预览，支持工作区内相对链接跳转、地址栏、前进、后退、刷新和外链跳转。
- 图片生成工作台，支持尺寸、质量、格式、背景和风格预设。
- 常规对话中的 `image_go` 工具，可由文本模型判断是否需要转交图片模型。
- 远控模式下支持 Codex 线程创建/恢复、流式消息、命令输出、文件 diff 展示、停止生成和移动端审批。
- 数据导入导出、单文件导出、整工作区 ZIP 导出。
- Android/HBuilderX 环境下的相册保存、系统分享、公共下载目录写入和后台运行通知提醒。
- 关于页可检查 GitHub Release，展示更新日志并跳转到 Releases 页面；不会自动下载或安装更新。

## 截图
<div align="center">

<table>
<tr>
<td><img src="img\image1.jpg" width="250"/></td>
<td><img src="img\image2.jpg" width="250"/></td>
<td><img src="img\image3.jpg" width="250"/></td>
</tr>

<tr>
<td><img src="img\image4.jpg" width="250"/></td>
<td><img src="img\image5.jpg" width="250"/></td>
<td><img src="img\image6.jpg" width="250"/></td>
</tr>

</table>

</div>

## 技术路线

WePChat 当前是静态前端项目，并带有一个可选的桌面 host 适配器：

- 入口：`index.html`
- 样式：`css/app.css`
- 主逻辑：`js/app.js`
- 模型 API：`js/api.js`
- 图片 API：`js/image-api.js`
- Agent 工具：`js/tools.js`
- 远控客户端：`js/remote-api.js`、`js/remote-scan.js`
- 本地存储：`js/store.js`
- 通用能力：`js/util.js`
- HBuilderX 配置：`manifest.json`
- 桌面远控 host：`wepchat-host/`

核心运行方式是 H5 + HTML5+。Android App 侧能力依赖 HBuilderX/HTML5+ 的 `plus.*` API，例如文件、相册、分享、压缩、通知和外部浏览器打开。

## 远控模式 / wepchat-host

`wepchat-host` 是 WePChat 的桌面侧局域网桥接器，用来让手机端 WePChat 控制电脑上的 Codex。当前这次与你对话、读取项目并更新 README 的流程，就是这种“手机 App -> 局域网 host -> 桌面 Codex -> 本机项目”的使用方式。

基本链路：

```text
WePChat Android/H5
  -> HTTP/WebSocket + token
wepchat-host
  -> stdio JSON-RPC
codex app-server
  -> 本机 repo、shell、git、Codex 配置和 Codex 会话
```

手机端不会直接连接 `codex app-server`。`wepchat-host` 负责鉴权、工作区白名单、协议翻译、事件转发和审批路由。

当前远控模式支持：

- Host 管理：添加、编辑、删除、测试局域网内的 `wepchat-host`。
- 配对方式：粘贴 host 输出的地址和 token；APK 环境下可扫码连接。
- 工作区选择：只允许选择 host 已注册的目录，手机端不会向 Codex 传任意本机路径。
- Codex 会话：创建线程、恢复线程、发送 turn、停止 turn、读取/列出线程。
- 桌面工作区文件：远程模式可读取 host 当前工作区的文件列表，点击文件会把相对路径插入输入框。
- 图片输入：远程模式可从手机选择图片，并随 turn 一起发送给桌面 Codex。
- 流式回传：模型消息、工具项状态、命令输出、文件 diff 和 turn 生命周期会实时显示到手机端。
- 审批转发：Codex 需要执行命令或确认文件改动时，审批会显示在手机端，由用户接受或拒绝。

从当前仓库根目录启动 host：

```powershell
cd E:\wepchat\wepchat
npm --prefix .\wepchat-host install
node .\wepchat-host\bin\wepchat-host.js --lan
```

或显式注册多个工作区：

```bash
wepchat-host --lan --workspace E:\wepchat\wepchat --workspace D:\projects\foo
```

默认监听 `127.0.0.1:8797`；加 `--lan` 后监听局域网地址，手机才能访问。启动后终端会打印带 token 的配对 URL 和二维码，手机端可以在“远程 Codex”设置里扫码或粘贴。host 会自动生成 token 并持久化到：

```text
~/.wepchat-host/config.json
```

更多 host 侧协议、API 和安全模型见 `wepchat-host/README.md`。

## Agent 工具边界

WePChat 内置 Agent 工具是受控的轻量工具集，不提供真实 shell、Node.js 包管理器、Python 环境或完整 Linux。

远控模式是另一条能力边界：命令、文件修改和 git 操作由桌面 Codex 在 host 注册的本机工作区里完成，并沿用 Codex 自身的 sandbox 与 approval policy。手机端只通过 `wepchat-host` 发送协议消息和处理审批。

当前模型可见工具包括：

- `run_js`：隔离 JavaScript 沙盒。需要读取工作区文件时，必须通过 `inputFiles` 显式挂载。
- `list_files` / `read_file` / `write_file` / `edit_file`：工作区文件查看、读取、写入和修改。
- `create_folder` / `move_path` / `path_exists` / `delete_file`：文件夹和路径管理。
- `preview_file`：打开已有 HTML 文件预览。
- `web_fetch`：GET/POST 抓取网页或接口文本，POST 会额外确认。
- `image_go`：生成或编辑图片。

工具说明和系统提示词快照见 `docs/tools.md`。

## 本地运行

项目是静态页面，直接启动一个静态服务器即可预览：

```bash
python -m http.server 8765
```

然后打开：

```text
http://127.0.0.1:8765/
```

也可以使用任意静态服务器。部分 Android/HTML5+ 能力只在 HBuilderX App 环境中可用，浏览器环境会降级为普通 H5 行为。

## Android 打包

使用 HBuilderX 打开项目目录，按 `manifest.json` 配置打包 Android App。

当前 `manifest.json` 中已配置常用权限，包括文件、相册、分享、压缩、网络、语音、通知等。不同 Android 版本和 ROM 对公共下载目录、相册保存、系统分享和后台行为的限制不同，实机回归仍然必要。

## 发布与更新

Release tag 使用：

```text
vX.Y.Z
```

仓库地址：

```text
https://github.com/WEP-56/WePChat
```

应用内关于页会请求 GitHub latest release，比对本地版本 tag 与最新 release tag，并展示更新日志和跳转链接。自动检查默认关闭；开启后每次启动静默检查。无法连接 GitHub 时不会弹错误提示。

当前只做版本检查、更新日志展示和跳转，不做 APK 自动下载或安装。

## 设计取舍

WePChat 刻意保持轻量：

- 不内置完整 Linux。
- 常规聊天不提供真实 shell；需要项目级操作时交给远控模式里的桌面 Codex。
- 不做长期后台执行承诺。
- 不把图片生成做成重型工作站。
- 不把 HTML 预览做成完整浏览器。
- 不做沉重繁琐的配置、subagent 或智能体体系。

短期重点是让日常对话、文件流转、轻量生成和移动端验证体验足够稳定。

## 开发检查

常用语法检查：

```bash
node --check js/app.js
node --check js/api.js
node --check js/image-api.js
node --check js/tools.js
node --check js/store.js
node --check js/util.js
node --check js/model-metadata.js
git diff --check
```

更多当前状态、风险和下一阶段计划见 `docs/handoff.md`。

## Linux.do
[学ai，上L站](https://linux.do/)
