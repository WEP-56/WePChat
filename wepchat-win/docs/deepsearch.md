# Chatbox 体验调研：Open WebUI 与 DEEIX Chat

本文记录对 Open WebUI 和本地 `example/DEEIX-Chat` 的体验与工程设计调研，作为 WePChat Windows 后续优化的实现依据。

## 结论先行

Open WebUI 和 DEEIX Chat 好用，不是因为采用了 React、Svelte 或某个 UI 库，而是因为它们把以下问题单独建模了：

- 消息如何增量渲染，而不是每个 token 重绘整个页面。
- 用户阅读历史消息时，系统何时可以自动滚动。
- 一次生成任务如何脱离当前页面继续运行。
- Markdown、公式、代码、HTML、思考和工具调用如何分别呈现。
- 断线、切换会话、取消和恢复时，任务与消息如何保持一致。

WePChat Windows 使用 WebView2，本质上也是 Chromium。性能上不需要复制网页产品的技术栈，关键是复制这些行为模型，并用原生 DOM、CSS、ES module 和 Rust/Tauri 实现。

Open WebUI 部分基于其公开架构和稳定产品特征；当前环境没有可用浏览器，因此没有对最新版 Open WebUI 仓库做逐文件审计。DEEIX Chat 部分已对本地源码进行检查。

## 项目取舍

| 项目 | 值得学习 | 不应直接照搬 |
| --- | --- | --- |
| Open WebUI | 网页交互成熟、布局响应快、会话组织完整、Markdown 生态完善 | 功能面大，账号、权限、知识库、服务端状态和全局 store 会显著增加复杂度 |
| DEEIX Chat | 渲染链路、滚动控制、流式缓冲、run/seq 恢复、结构化消息状态 | Next.js、React、Go、Redis、PostgreSQL 组合对本地 WePChat 过重 |
| WePChat Windows | 本地优先、启动轻、Android 语义连续、Rust/Tauri 系统能力 | 当前消息渲染、HTML 流式预览和可恢复任务仍需完善 |

## DEEIX 的渲染体验

### 1. 内容渲染不是一个字符串

DEEIX 将一条助手消息拆成多个可独立更新的区域：

- 正文 Markdown。
- 数学公式和代码块。
- 图片、链接、脚注和表格。
- 处理链路：文件解析、RAG、上下文压缩、引用等。
- 思考链路：reasoning 或 upstream thinking。
- 工具链路：工具名称、参数、运行状态和结果。
- 消息元数据：模型、时间、输入/输出 token、缓存 token、耗时和费用。
- 错误、取消、pending、streaming、done 等运行状态。

对应源码主要位于：

- `example/DEEIX-Chat/frontend/features/chat/components/message/message-process-trace.tsx`
- `example/DEEIX-Chat/frontend/features/chat/components/message/message-thinking-trace.tsx`
- `example/DEEIX-Chat/frontend/features/chat/components/message/message-tool-trace.tsx`
- `example/DEEIX-Chat/frontend/features/chat/components/message/message-meta.tsx`

这些区域有自己的展开、折叠、loading 和完成状态，所以模型输出很长时，用户仍然能分辨“模型正文”和“系统正在做什么”。

WePChat 已有 reasoning 和 tool card，但仍主要由 `renderChat()` 一次性重建。下一步应把消息视为稳定的结构化节点：

```text
Message
  ├─ processTrace[]
  ├─ thinkingTrace
  ├─ toolCalls[]
  ├─ contentBlocks[]
  ├─ attachments[]
  ├─ usage
  └─ runState
```

### 2. Markdown、公式、HTML 和链接的策略

成熟实现通常区分两种状态：

- `streaming`：允许不完整语法，优先保证增量显示和低延迟。
- `done`：完整解析，补齐代码高亮、公式、Mermaid、脚注和交互动作。

代码块的动作不应污染正文：复制、打开预览、下载等按钮由代码块外层提供。外链需要判断协议和来源，禁止 `javascript:`，必要时显示确认对话框。DEEIX 的链接和代码处理集中在 `streamdown-components.tsx`。

WePChat 应保留现有 Markdown 入口，但把渲染分为：

1. 稳定前缀：已经完成的块不重复解析。
2. 活跃尾部：只重新解析当前正在增长的段落或代码块。
3. 完成收尾：生成结束后进行一次完整解析和动作绑定。

这样可以同时保证流式手感和最终内容质量。

## 舒服的对话浏览

### 1. 消息位置预览条

截图中的竖向预览条不是装饰，而是一个轻量导航器：

- 每个用户问题对应一个刻度。
- 当前可见消息对应高亮刻度。
- 鼠标悬停时显示问题摘要和答案摘要。
- 点击刻度跳转到对应消息。
- 当前刻度在消息很多时自动保持在 rail 中央。
- rail 自身只在内容超过可视高度时滚动。

本地实现见 `example/DEEIX-Chat/frontend/features/chat/components/sections/chat-message-position-rail.tsx`。它通过消息 ID 和滚动容器关联，而不是根据 DOM 的固定像素位置硬编码。

WePChat 的轻量版本可以只做三件事：

1. 按用户消息生成刻度。
2. hover 显示一行问题摘要。
3. 点击使用 `scrollIntoView({ block: "center" })` 跳转。

暂不需要复制完整的分支树、位置计算和复杂 portal。消息少于两个回合时隐藏 rail，避免界面增加噪音。

### 2. 滚动规则

DEEIX 的 `MessageScroller` 明确区分：

- 用户接近底部：新内容自动跟随。
- 用户已经上翻：不抢滚动位置。
- 流式消息：以当前消息作为滚动锚点。
- 顶部加载历史：prepend 后保持原阅读位置。
- 远离底部：显示“回到底部”按钮。

相关实现见：

- `example/DEEIX-Chat/frontend/components/ui/message-scroller.tsx`
- `example/DEEIX-Chat/frontend/features/chat/components/sections/chat-area.tsx`
- `example/DEEIX-Chat/frontend/features/chat/components/app-chat-area.tsx`

WePChat 当前在 `ui/js/app.js:1462` 清空并重建整个消息容器。即使 `stickBottom` 判断正确，这种方式也会造成布局抖动、详情卡片状态丢失和长消息卡顿。滚动优化必须与局部渲染一起进行。

## 会话截图与分享

DEEIX 的截图功能不是简单截取当前视口，而是一个小型导出流程：

1. 可选截取全部消息或用户选择的消息。
2. 必要时先分页加载完整历史。
3. 临时隐藏操作按钮、元信息、位置 rail 等非内容元素。
4. 展开被折叠的用户消息，避免截图内容不完整。
5. 等待两帧布局稳定后生成 PNG。
6. 预览、下载或复制到剪贴板。
7. 对超大画布进行尺寸保护，避免浏览器崩溃。

相关源码：

- `example/DEEIX-Chat/frontend/features/chat/hooks/use-chat-screenshot.ts`
- `example/DEEIX-Chat/frontend/features/chat/model/conversation-screenshot.ts`
- `example/DEEIX-Chat/frontend/features/chat/components/sections/chat-screenshot-selection-bar.tsx`

WePChat 的第一阶段建议只支持：

- 当前会话完整内容截图。
- 选中消息截图。
- PNG 下载。
- 复制图片到剪贴板。

截图必须使用独立的“导出准备态”，不能直接修改持久化消息，也不能把侧栏、加载圈、操作按钮和 token 圆环带入图片。

## 会话统计与消息元数据

DEEIX 的消息底部元信息很克制：默认弱化，hover 或触摸时出现，内容包括：

- 模型名称。
- 生成时间和耗时。
- 输入、输出、reasoning、缓存读写 token。
- 费用或计费信息（若后端提供）。
- 复制、重试、编辑、分支切换等操作。

截图中的一行统计之所以舒服，是因为它使用小字号、等宽数字、图标和 tooltip，不抢正文注意力。实现参考 `message-meta.tsx`。

WePChat 已经有 token 圆环和基础 usage 字段，后续可以补充一个消息级轻量统计条：

```text
模型 · 15:00:35 · 输入 1.2k · 输出 640 · 37s
```

只有存在 usage 或耗时数据时才显示；完整费用、缓存命中率等高级统计放进会话详情，不塞进每条消息。

## HTML 与代码的流式预览

DEEIX 的 HTML 预览不是把模型输出直接 `innerHTML` 到主页面，而是识别代码块并生成独立 artifact：

- `html/css/javascript` 代码块被识别为可预览 artifact。
- 未闭合代码块在 streaming 状态下也可以预览。
- 预览使用隔离 iframe，`sandbox="allow-scripts"`。
- 使用严格 CSP 禁止网络请求、表单、frame、worker 等能力。
- 预览区和源代码区分为两个 tab。
- 支持复制源代码和下载 HTML。
- 预览主题变量与聊天主题同步。
- 运行时错误显示在预览内部，而不是污染主界面。

主要源码：

- `example/DEEIX-Chat/frontend/features/chat/model/chat-artifacts.ts`
- `example/DEEIX-Chat/frontend/features/chat/components/sections/chat-artifact.tsx`
- `example/DEEIX-Chat/frontend/shared/lib/artifact-preview.ts`

这解释了为什么它的 HTML 流式预览比普通 Markdown 代码块自然：它有独立的 artifact 状态、预览文档构造、隔离执行环境和错误显示链路。

WePChat 的实现边界必须更严格：

- 不允许模型 HTML 直接进入主窗口 DOM。
- 默认先做静态 HTML/CSS 预览，脚本预览必须明确开启。
- 预览放在独立 iframe 或 Tauri 独立窗口。
- 网络、文件、剪贴板和系统能力默认关闭。
- 内容不完整时显示“预览更新中”，不要频繁销毁 iframe。
- 仅当代码内容实际发生变化且节流窗口到期时刷新预览。

## 流式缓冲与任务稳定性

DEEIX 的文本流缓冲位于 `use-chat-stream-buffer.ts`：普通文本约 50ms 刷新一次，thinking 约 40ms 刷新一次，并使用 `requestAnimationFrame` 对齐绘制。每个 exchange 拥有独立缓冲，完成或取消时立即 flush。

DEEIX 的生成任务还有独立 `runID`、`AbortController`、取消结算、事件 `seq` 和断线恢复。切换会话只解除当前页面订阅，不取消仍在服务端运行的任务。

WePChat 当前已实现会话级后台任务、侧栏加载状态和完成红点，但后续仍应逐步补齐：

- Rust 侧任务注册表，而不是只依赖 WebView 内存。
- `runId + sessionId + status + seq` 作为任务身份。
- 有限事件环形缓存，支持重新进入会话后续接。
- 取消、失败、完成状态的单一结算入口。
- 前端按会话和消息分桶的 `StreamBuffer`。
- 后台会话只更新数据和侧栏，不重绘当前聊天 DOM。

本地应用不需要 Redis 或 PostgreSQL。Rust 的 `tokio::spawn`、任务表、取消令牌、短期事件缓存和现有会话持久化足够覆盖主要场景。

## WePChat 实施路线

### P0：先解决性能和阅读体验

1. 把 `renderChat()` 从全量重建改为稳定消息节点 + 活跃消息局部更新。
2. 引入按 `sessionId + messageId` 分桶的流式缓冲，33～50ms 合并刷新。
3. 完善自动跟随、用户上翻保护、prepend 保持位置和回到底部按钮。
4. 流式期间不重复解析已经完成的 Markdown 块。

### P1：补齐内容表达能力

1. 正文、thinking、process、tool、error、usage 分离渲染。
2. 增加代码块复制、语言识别、公式和链接安全处理。
3. 增加轻量消息位置 rail。
4. 增加消息级耗时、模型和 token 统计。
5. 增加 HTML/CSS artifact 的隔离预览。

### P2：增强分享和长期会话

1. 会话截图预览、下载和剪贴板复制。
2. 选择部分消息截图。
3. 历史消息分页加载。
4. 超长会话再评估虚拟列表。
5. 需要时增加会话搜索和消息定位。

## 验收标准

### 渲染

- 长 Markdown、表格、代码、公式和链接不会破坏正文布局。
- 流式期间正文、thinking、工具卡可以同时更新且互不覆盖。
- 完成消息再次滚动时不会重复解析或闪烁。
- 代码块操作不会进入截图和复制正文。

### 滚动

- 用户在底部时自动跟随。
- 用户上翻后不会被新 token 拉回底部。
- 点击回到底部后恢复跟随。
- 加载旧消息后，用户原来看到的消息仍在原位置附近。
- 消息超过可视高度后出现 rail，点击可定位并显示摘要。

### HTML 预览

- 未闭合代码块可以低频更新预览。
- 预览错误只显示在预览区。
- 预览无法访问网络、文件和系统 API。
- 关闭和切换 artifact 不会影响主聊天。

### 截图与统计

- 完整截图和选择截图均可取消、预览、下载。
- 超长会话不会无提示地崩溃。
- 截图不包含侧栏、按钮、加载圈和 hover 浮层。
- token、耗时和模型信息在有数据时显示，无数据时不占位。

### 稳定性

- 切换会话不会取消后台任务。
- 后台完成任务在侧栏显示红点，进入后清除。
- 取消任务后不会出现“客户端已结束、服务端仍写入”的竞态。
- WebView 重载或重新进入会话后，pending 任务可以恢复或明确显示失败。

## 明确不做

- 不引入 Open WebUI 或 DEEIX 的完整后端体系。
- 不为了视觉效果引入大型动画库、玻璃效果或复杂三维背景。
- 不把所有消息预先虚拟化；Markdown 可变高度会使虚拟列表复杂化。
- 不允许 HTML 直接写入主窗口 DOM。
- 不把正文、thinking、tool 和错误继续塞进一个字符串后再用 CSS 猜状态。
- 不通过增加全局 `window.*` 对象解决模块边界问题。

## 参考源码

- [DEEIX 前端开发约束](../example/DEEIX-Chat/frontend/README.md)
- [消息滚动组件](../example/DEEIX-Chat/frontend/components/ui/message-scroller.tsx)
- [消息位置 rail](../example/DEEIX-Chat/frontend/features/chat/components/sections/chat-message-position-rail.tsx)
- [流式缓冲](../example/DEEIX-Chat/frontend/features/chat/hooks/use-chat-stream-buffer.ts)
- [生成任务提交](../example/DEEIX-Chat/frontend/features/chat/hooks/use-chat-message-submit.ts)
- [断线恢复](../example/DEEIX-Chat/frontend/features/chat/hooks/use-chat-data.ts)
- [截图模型](../example/DEEIX-Chat/frontend/features/chat/model/conversation-screenshot.ts)
- [HTML artifact 构造](../example/DEEIX-Chat/frontend/features/chat/model/chat-artifacts.ts)
- [HTML artifact 面板](../example/DEEIX-Chat/frontend/features/chat/components/sections/chat-artifact.tsx)
- [WePChat 当前聊天渲染](../ui/js/app.js)

