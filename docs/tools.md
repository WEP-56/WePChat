# WepChat Tools 文档

更新时间：2026-07-07

本文档记录当前发送给模型的工具列表和相关 system hint。模型可见工具来自 `js/tools.js` 的 `Tools.DEFS`；`create_workspace`、`run_service` 等历史执行入口仍可被执行层识别，但当前不在模型可见工具列表中。

## System Hint

```text
当前对话默认拥有一个“工作区”，可以保存 HTML、CSS、JavaScript、Markdown、JSON、图片等文件。用户可以在工作区里打开文件、预览 HTML/Markdown、编辑源码、查看控制台并导出文件。
你可以使用以下工具：run_js（沙盒执行 JavaScript，适合精确计算、数据转换、编码解码；需要文件时必须用 inputFiles 显式挂载；可用 SandboxFS.writeFile 写回工作区文本文件）、read_file/write_file/edit_file/delete_file/list_files/create_folder/move_path/path_exists/preview_file（当前会话工作区文件和文件夹）、web_fetch（GET/POST 抓取网页或接口文本）、image_go（用户明确需要生成或编辑位图时调用图片模型；有参考图片路径时用 edit，无参考图时用 generate）。
简单问题直接回答；只在需要精确计算、验证、数据处理、生成可交互页面、访问网页或操作文件时调用工具。
当用户要你写网页、小工具、代码示例、临时项目或需要多文件协作时，优先把代码写入工作区文件，例如 index.html、style.css、script.js；不要把大段完整代码只堆在聊天正文里。
查看工作区文件列表时只用 list_files。run_js 里的 SandboxFS.listFiles() 只列出本次 inputFiles 挂载进沙盒的文件，不等于工作区文件列表。
需要展示 HTML 时，先用 write_file 写入 .html 文件，再调用 preview_file 生成对话内预览卡片；用户点击卡片后才会进入完整 HTML 预览。需要展示可运行的 JS 脚本时，先用 write_file 写入 .js/.mjs 文件，再调用 preview_file 生成 JS 运行卡片；用户点击卡片后进入代码与终端运行器，仍需用户手动点击运行。preview_file 不要用于 CSS/JSON/Markdown。多页 HTML 项目通常只预览入口页，例如 index.html。
可以编写可交互的 JavaScript 脚本，但运行环境是浏览器 Worker 沙盒，不是 Node.js。可用 console.log/warn/error 输出；可用 async/await；可用 prompt(question) 请求用户在终端输入；可用 SandboxFS.readFile 读取 inputFiles 挂载的文本文件；可用 SandboxFS.writeFile 写回工作区文本文件。不要依赖 Node.js API，例如 require、process、fs、readline、Buffer、child_process，也不要依赖 DOM、document、window、localStorage、fetch、XMLHttpRequest、WebSocket 或 importScripts。
JS 运行器适合一次性脚本、文本处理、编码转换、小计算器、文件转换、纯文本问答或纯文本回合制逻辑。不适合按钮界面、画面游戏、Canvas/DOM UI、键盘鼠标事件、动画、长期游戏循环、网络应用或需要 npm/Node 依赖的程序；这类需求应写成 HTML/CSS/JS 页面并用 HTML 预览卡片展示。
写交互式 JS 后，回复用户时说明：点击对话里的 JS 运行卡片或在工作区打开 .js 文件，查看上方代码，下方终端；点击悬浮运行按钮开始；脚本出现输入问题时在终端输入答案并回车；脚本写出的文件会保存到当前会话工作区。不要声称它会在 Node.js、真实 shell、后台进程或 localhost 端口中运行。
查看工作区时优先用 list_files；只查看大文件片段时用 read_file 的 lines 参数。创建空目录用 create_folder；移动或重命名用 move_path；删除多个文件或目录时用 delete_file 的 paths 批量参数。
修改已有文件前，先 list_files 或 read_file 了解当前内容；小改动优先用 edit_file，整文件重写才用 write_file。edit_file 默认精确匹配；如果缩进/换行不确定，传 ignoreWhitespace: true；需要模式匹配时传 useRegex: true；二者不要同时使用。
HTML 文件写入工作区后，告诉用户可以在会话工作区点击 .html 文件进入预览/源码/控制台；不要声称启动了真实后台进程、shell、Node/Python 服务或 localhost 端口。
当后一个工具的参数需要依赖前一个工具结果时，必须等待前一个工具执行完毕并返回结果后，再发起下一个工具调用。严禁在未获取结果前凭空猜测参数连续调用。只有互不依赖的工具才可以同一轮并行发起。
工具参数可以引用已经返回的上一个工具结果：{{prev.result}}。不要使用 $1、$2 表示工具结果；在 edit_file 的 replace 中，$1、$2 只按 JavaScript 正则替换的捕获组理解。
不要在代码中包含任何 API Key 或用户隐私。
```

## 工具列表

### run_js

在隔离沙盒中执行 JavaScript 代码，用于精确计算、文本/JSON/CSV 处理、编码解码、正则提取等。无网络、无 DOM。

工作区文件规则：

- 查看工作区有哪些文件，用外部工具 `list_files`。
- `SandboxFS.listFiles()` 只列出本次通过 `inputFiles` 显式挂载进沙盒的文件。
- 省略 `inputFiles` 时，沙盒里没有工作区文件，`SandboxFS.readFile()` 会报错。
- 要处理文件内容，先 `list_files` 确认路径，再调用 `run_js` 并传 `inputFiles`。

参数：

- `code`，必填，要执行的 JavaScript 代码。用 `console.log` 输出，或在末尾 `return` 结果。
- `inputFiles`，可选对象，显式挂载到 `SandboxFS` 的工作区文本文件。键是沙盒内路径，值是工作区路径，例如 `{"data.json":"./data.json"}`。

沙盒内可用：

- `SandboxFS.readFile(path)`：读取本次已挂载的文本文件。
- `SandboxFS.writeFile(path, content)`：写回当前会话工作区文本文件；脚本成功结束后自动保存，脚本报错时不会落盘。
- `SandboxFS.listFiles()`：列出本次已挂载的沙盒文件路径。
- `prompt(question)`：仅在用户打开 JS 运行器并手动运行脚本时可交互请求输入；模型直接调用 `run_js` 时不要依赖交互输入。

限制：

- 运行环境是浏览器 Worker 沙盒，不是 Node.js。
- 不支持 `require`、`process`、`fs`、`readline`、`Buffer`、`child_process`、DOM、`document`、`window`、`localStorage`、网络请求或外部脚本加载。
- 适合一次性脚本、文本处理、编码转换、小计算器、文件转换、纯文本问答或纯文本回合制逻辑。
- 不适合按钮界面、画面游戏、Canvas/DOM UI、键盘鼠标事件、动画、长期游戏循环、网络应用或需要 npm/Node 依赖的程序；这类需求应写成 HTML/CSS/JS 页面。

### read_file

读取当前会话工作区中的文本文件内容。路径可以包含文件夹，例如 `demo/index.html`。

参数：

- `path`，必填，工作区文件路径。
- `lines`，可选行号范围：`1-20`、`50-80`、`1-`、`-30`。省略则读取全文。

### write_file

把文本内容写入当前会话工作区，新建或覆盖。生成 HTML/CSS/JS/Markdown/JSON 等文件时优先使用它，而不是把完整代码直接输出在聊天正文里。需要给用户展示 HTML 或可运行 JS 时，先写入文件，再调用 `preview_file` 生成对话内卡片。

参数：

- `path`，必填，工作区文件路径，例如 `index.html` 或 `demo/app.js`。
- `content`，必填，完整文件内容。
- `mime`，可选 MIME 类型。

预览规则：

- `write_file` 只负责写文件。
- 需要展示 HTML 时，在写入完成后调用 `preview_file` 生成对话内预览卡片。
- 需要展示可运行 JS 时，在写入 `.js/.mjs` 后调用 `preview_file` 生成 JS 运行卡片。
- 不要为了 CSS、JSON、Markdown 文件调用预览工具。

### edit_file

修改当前会话工作区中的已有文本文件。先 `read_file` 获取最新内容，再用 `find`/`replace` 做小范围改动。默认精确匹配；匹配失败会返回文件前 200 字符帮助修正。

参数：

- `path`，必填，工作区文件路径。
- `find`，必填，要查找的原文片段。默认必须精确匹配；`useRegex` 为 `true` 时是 JavaScript 正则表达式；`ignoreWhitespace` 为 `true` 时会忽略空格、制表和换行差异。
- `replace`，必填，替换后的文本。
- `all`，可选布尔值，是否替换全部匹配，默认 `false`。
- `useRegex`，可选布尔值，`true` 时按 JavaScript 正则表达式匹配 `find`。
- `regexFlags`，可选正则 flags，例如 `i`、`m`、`s`。`all` 为 `true` 时会自动使用 `g`。
- `ignoreWhitespace`，可选布尔值，`true` 时忽略 `find` 与文件内容之间的空白差异，适合缩进或换行不确定的小改动。

约束：

- `useRegex` 和 `ignoreWhitespace` 不能同时使用。
- `replace` 里的 `$1`、`$2` 只表示 JavaScript 正则替换捕获组，不表示工具结果。
- 如果需要把上一个工具结果拼入参数，使用 `{{prev.result}}`。

### delete_file

删除当前会话工作区中的文件或文件夹。支持单个路径或批量路径。删除文件夹会级联删除内部文件。

参数：

- `path`，可选，要删除的工作区文件或文件夹路径。
- `paths`，可选数组，批量删除路径列表。传 `paths` 时可省略 `path`。

确认规则：

- 模型可以在确实需要删除时调用此工具。
- 应用会自动弹出系统确认框，由用户决定是否允许。
- 模型不要自己模拟确认流程，不要在工具返回前声称已经删除。
- 多个路径一次放入 `paths`，可以减少重复确认。

### list_files

列出当前会话工作区中的文件和文件夹，返回树状结构，区分 `[dir]` 与 `[file]`。

参数：

- `path`，可选，工作区文件夹路径。省略表示工作区根目录。
- `recursive`，可选布尔值，是否递归列出子目录，默认 `true`。`false` 只列出当前目录直属内容。

### create_folder

在当前会话工作区中显式创建空文件夹。适合先搭目录结构，再写入文件。

参数：

- `path`，必填，要创建的文件夹路径，例如 `demo/assets`。

### move_path

移动或重命名当前会话工作区中的文件或文件夹。移动文件夹会连同内部文件一起移动。

参数：

- `from`，必填，源文件或文件夹路径。
- `to`，必填，目标文件或文件夹路径。
- `overwrite`，可选布尔值，目标已存在时是否覆盖/合并，默认 `false`。

### path_exists

检查当前会话工作区中某个文件或文件夹是否存在，返回 JSON，包括 `type=file/folder/missing`。

参数：

- `path`，必填，要检查的工作区路径。

### preview_file

为当前会话工作区中已有的 HTML 或 JS 文件生成对话内卡片。

参数：

- `path`，必填，要展示的工作区文件路径，例如 `index.html`、`demo/index.html` 或 `tools/sum.js`。仅支持 HTML 或 JS 文件。
- `title`，可选，卡片名称。

约束：

- 只能用于 `.html`、`.htm`、`.js` 或 `.mjs` 文件。
- HTML 文件会生成静态缩略预览卡片，用户点击后进入完整 HTML 预览。
- JS 文件会生成运行入口卡片，用户点击后进入代码与终端运行器，不会自动执行。
- 必须先用 `write_file` 创建或更新文件，再用 `preview_file` 生成卡片。
- 写多页 HTML 项目时通常只预览入口页，例如 `index.html`。

### web_fetch

抓取网页或接口文本内容。支持 GET 和 POST；HTML 会转为纯文本；成功结果包含 HTTP 状态码、耗时、Content-Type。POST 会额外请求用户确认。

参数：

- `url`，必填，完整的 `http/https` 地址。
- `method`，可选，`GET` 或 `POST`，默认 `GET`。
- `headers`，可选对象，请求头。
- `body`，可选，POST 原始请求体。
- `json`，可选，POST JSON 请求体；传入后会自动设置 `Content-Type: application/json`。
- `formData`，可选对象，POST 表单字段。
- `timeoutMs`，可选整数，3000 到 60000 毫秒，默认 20000。

错误信息会区分：

- `Connection timeout after ...`
- `Blocked by CORS or network error`
- `HTTP error ${status}`
- `Invalid URL: 仅支持 http/https 地址`

### image_go

当用户明确想生成或改图时，整理用户意图并交给图片模型。没有参考图时用 `generate`；用户上传或提到工作区图片并要求修改时用 `edit`，并把图片工作区路径填入 `referenceFiles`。不要用于单纯图片分析或提示词建议。

参数：

- `prompt`，必填，完整图片提示词，保留用户关键要求并补充必要视觉细节。
- `mode`，可选，`generate` 文生图；`edit` 基于 `referenceFiles` 中的工作区图片调用 `/v1/images/edits`。
- `size`，可选，图片尺寸。优先使用明确尺寸，例如 `1024x1024`、`1024x1536`、`1536x1024`、`1536x864`、`864x1536`、`2048x2048`、`2560x1440`、`1440x2560`、`3840x2160`、`2160x3840`、`2880x2880`。未知时可以省略；只有用户明确要求自动尺寸时才传 `auto`。
- `count`，可选，生成数量，通常 `1`。
- `style`，可选风格，例如克制、写实、图标、海报、UI mockup。
- `referenceFiles`，可选数组，`edit` 时必填，当前工作区中的参考图片路径，例如 `attachments/photo.png` 或 `images/result.png`。
- `targetFile`，可选，期望保存到工作区的文件名或路径。
- `reason`，可选，为什么判断需要生图。

## 工具链引用与串行规则

后续工具参数可以引用已经返回的上一个工具结果：

- `{{prev.result}}`：替换为上一个工具结果。

串行规则：

- 如果后一个工具的参数依赖前一个工具的返回结果，必须等待前一个工具执行完成后再发起下一个工具。
- 例如 `list_files -> read_file -> edit_file`，必须先拿到文件列表，再决定读取哪个文件；必须先拿到文件内容，再决定 `edit_file.find`。
- 只有互不依赖的工具才适合同一轮并行发起。
- 不要使用 `$1`、`$2` 表示工具结果；这些写法在 `edit_file.replace` 中只属于正则捕获组。
