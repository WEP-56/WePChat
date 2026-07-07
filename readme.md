<p align="center">
  <img src="img\icon.png" width="200">
</p>

<h1 align="center">WePChat</h1>

<p align="center">
  简单、轻量、克制——永远这样
</p>



WepChat 是一个本地优先的轻量移动端 AI 聊天应用，当前以静态 Vue/H5 为主体，按 HBuilderX / HTML5+ Android App 方向推进。

项目目标是做一个克制、快速、适合日常使用的 LLM 客户端：对话、Markdown 阅读、文件工作区、轻量代码/网页生成、图片生成与编辑。它不是 ComfyUI、Midjourney 或移动开发环境，也不追求内置完整 Linux。


这个项目的初衷是，Cherry studio/Chatbox 已经过于沉重，不适合我的使用场景了，我得做个简单点。所以WEPchat适合这些场景：
- 日常问答
- 想法快速验证：Wepchat支持编写html并预览，以及简单的js代码运行
- 测试模型连通性：Wepchat支持 openai的complication/respoense 接口，支持anthrupic的 messages 接口。配置简单，模型切换方便，可以快速的验证连通性
- 日常快速生图：Wepchat支持openai的图像生成/图像编辑

## 当前能力

- 多会话管理，支持常规对话和生图会话。
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


</table>

</div>

## 技术路线

WepChat 当前是静态前端项目：

- 入口：`index.html`
- 样式：`css/app.css`
- 主逻辑：`js/app.js`
- 模型 API：`js/api.js`
- 图片 API：`js/image-api.js`
- Agent 工具：`js/tools.js`
- 本地存储：`js/store.js`
- 通用能力：`js/util.js`
- HBuilderX 配置：`manifest.json`

核心运行方式是 H5 + HTML5+。Android App 侧能力依赖 HBuilderX/HTML5+ 的 `plus.*` API，例如文件、相册、分享、压缩、通知和外部浏览器打开。

## Agent 工具边界

WepChat 的 Agent 工具是受控的轻量工具集，不提供真实 shell、Node.js 包管理器、Python 环境或完整 Linux。

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

WepChat 刻意保持轻量：

- 不内置完整 Linux。
- 不提供真实 shell。
- 不做长期后台执行承诺。
- 不把图片生成做成重型工作站。
- 不把 HTML 预览做成完整浏览器。

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
