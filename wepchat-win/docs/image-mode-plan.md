# WePChat Windows — 生图模式改造计划

> 状态：调研稿 / 待实施  
> 更新：2026-07-24  
> 参考：用户提供的 Grok Imagine 网页截图 `image.png`  
> 目标方向：小对话框，大画布。生图模式是「画布工作台」，不是聊天页的变体。

---

## 1. 目标结论

生图模式建议从当前的「中间时间线 + 右侧画布」改成：

```text
┌──────────────┬──────────────────────────────┬───────────────────────────────┐
│ 左侧会话列表  │ 小型生成对话列与简易参数调整    │ 大画布                        │
│ image list   │ prompt / history / presets   │ dot grid / images / tools     │
└──────────────┴──────────────────────────────┴───────────────────────────────┘
```

核心体验：

- 画布是主视图，占据最大面积，默认常开，不再作为右侧 tab 侧栏。
- 对话列是“小聊天框式生成控制台”：消息流、任务状态、参考图、参数和 composer 都要向普通聊天模式的成熟体验靠齐。
- 生成结果自动落到画布；点击历史缩略图只定位/选中画布中的图片。
- 参考图、编辑、再次生成都围绕画布选中项展开。
- 左栏生图会话不是旧版简易列表，要拥有普通聊天同等级的基础会话管理能力：新建、打开、搜索、重命名、复制、删除、置顶/状态显示。

这和普通聊天的成熟链路保持边界：普通聊天继续是长文本对话；生图模式服务于视觉资产的创建、比较、挑选和迭代。

---

## 2. 截图观察

用户截图里的 Grok Imagine 形态有几个值得借鉴的点：

- 左侧是产品/项目导航，不强调消息内容。
- 中间是一条窄工作流列：顶部标题，中央空态建议，底部小输入框。
- 右侧是几乎全屏点阵画布，画布底部悬浮工具条。
- 视觉层级很明确：对话列宽度固定，画布宽度弹性最大。
- 空态不是营销页，而是立即给 prompt 快捷入口。
- 控件非常克制：缩放、选择/参考、展开等能力都悬浮在画布附近。

对 WePChat 来说，不需要复制 Grok 的品牌和项目体系；需要复制的是主次关系：画布第一，对话第二。

---

## 3. 现有实现盘点

已有基础足够，不建议推倒重写。

| 模块 | 当前能力 | 可复用程度 |
| --- | --- | --- |
| `ui/js/image-api.js` | OpenAI 兼容 images/generations、images/edits、chat fallback；Rust HTTP；图片 URL/base64 归一化 | 高 |
| `ui/js/image-mode.js` | 生图会话、模型选择、prompt、参考图、生成状态、保存图片、时间线、设置页、chat 工具 `image_go` | 高 |
| `ui/js/image-canvas.js` | 点阵画布、图片卡片、拖拽、平移、缩放、选择、用作参考、序列化/恢复 | 中高 |
| `ui/index.html` | 已有 image main view、composer、timeline、右侧 canvas tab | 中 |
| `ui/css/app.css` | 已有生图时间线、composer、canvas 样式 | 中 |
| SQLite 会话 | `mode: image`、`messages`、`imageCanvas` 通过 `meta_json/payload_json` 保存 | 高 |
| 工作区 FS | 图片保存到 `{sessionId}/images/...`，消息只存 path/mime/meta | 高 |

主要问题：

- 画布现在在右栏，生图模式进入后像「聊天 + 附属画布」，不是「画布工作台」。
- 时间线占据主区，图片结果同时出现在时间线和画布，主次重复。
- 左栏生图会话仍是早期原始实现：缺少标题搜索、更多菜单、任务状态、未读/运行中提示，也没有和普通聊天列表统一的会话管理手感。
- 生图聊天区域仍是旧 timeline + composer：没有复用普通聊天已经成熟的输入框增长、附件/参考图气泡、发送/停止状态、消息操作和错误呈现模式。
- 画布工具少：缺少适应视图、删除、复制路径/打开文件、下载/导出、从文件添加参考、重新生成/变体入口。
- `imageCanvas` 的保存依赖生成后的持久化，拖动画布变化目前只是更新内存，缺少节流落盘。
- 生图会话列表仍较简略，没有项目/画布语义。

---

## 4. 产品边界

符合 `docs/product-boundary.md`：

- 是：简易生图、图片工作区、快速验证图片模型可用性、参考图编辑、结果保存。
- 不是：专业设计软件、完整 Figma/Photoshop、复杂图层系统、真实多用户项目管理、视频时间线。

首版应控制范围：

- 不做多画板/多页面项目。
- 不做复杂连线、图层面板、批量标注。
- 不做无限 undo 栈，最多保留轻量撤销后置。
- 不做 Grok 账号/项目同步，只做本地会话式项目。

---

## 5. 目标信息架构

### 5.1 左侧列表栏

保留现有 app 轨道：

- 聊天
- 生图
- 设置

生图列表栏调整为：

- 顶部：`生图` 标题 + 新建按钮。
- 搜索：启用标题搜索，交互与普通聊天 `session-search` 一致；全局图片/消息搜索仍延后。
- 列表项：标题、最近模型、图片数、更新时间、任务状态。
- 更多菜单：重命名、复制会话、删除会话；行为和普通聊天列表一致，删除前确认。
- 任务状态：运行中显示脉冲/进度文案；后台完成时可显示未读/完成态；失败时显示错误态。
- 标题策略：首条 prompt 生成默认标题；只有附件/参考图时用 `生图：{参考文件名}` 之类短标题。
- 状态持久化：切换会话、重启后恢复最后活动的 image session；空会话也要立即落盘，避免新建后丢失。
- 后续可增加轻量“项目”分组，但首版不做真实项目表。

左栏应直接复用/靠拢普通聊天列表的视觉语言：

- `session-item` 的选中态、hover、more 菜单、危险确认沿用普通聊天。
- 不引入另一套大卡片 UI，避免聊天/生图两个模式手感割裂。
- 生图列表可以多一个图片区统计，但不要把缩略图塞满左栏；缩略图归生成对话列或画布。

### 5.2 生成对话列

放在 main 内左侧，宽度建议 360-430px，可拖拽但默认固定。

组成：

- 顶部标题行：会话标题、定制模型选择、更多菜单；模型选择应采用普通聊天顶部自绘下拉的同类体验，不回到系统 `<select>`。
- 空态 prompt chips：保留当前 `Create Worlds / Short Film / UGC Product Stories / Brand Identity` 这类提示，但用中文/可配置本地预设。
- 历史流：用户 prompt + 生成状态 + 小缩略图，不承担大图浏览；布局向普通聊天消息流靠拢，而不是旧版孤立 timeline。
- 底部 composer：参考图 chip、尺寸/数量/风格、输入框、生成/停止按钮。

生成对话列的基础链路必须完整：

- 输入框随文字行数自动增高，超过高度上限才滚动，和普通聊天 composer 保持一致。
- 参考图、工作区图片、上传图片都以 composer 上方 chip 表示；图片必须先进入当前会话工作区。
- 支持从画布选中项、工作区文件树、外部拖拽/粘贴进入参考图；LLM/API 看到工作区路径。
- 发送后立即插入 user prompt 消息和 pending assistant 任务消息。
- 生成中 send 按钮切换为 stop；任务状态留在对应 assistant 行，不用全局 toast 承担主要状态。
- 失败错误显示在该轮消息里，可重试；停止生成显示为已停止，不污染画布。
- 历史缩略图点击定位/选中画布 item；不要把大图浏览职责放回时间线。
- 每轮消息操作至少包括：复制 prompt、重新生成、设结果为参考、打开文件/定位工作区。
- 消息落盘规则继续复用普通聊天：图片 dataUrl 不进 SQLite，只保存 path/mime/meta。

### 5.3 大画布

占据右侧主区域，默认显示点阵背景。

能力：

- 平移、滚轮缩放、重置、适应全部。
- 图片卡片拖拽、选中、多选后置。
- 选中图片可：用作参考、打开文件、复制路径、删除画布项、从磁盘重新载入缩略图。
- 生成结果自动按批次落点，尽量不覆盖当前视口。
- 点击历史缩略图定位画布项。

---

## 6. 数据模型建议

继续使用现有会话存储，不新增 SQLite schema。

### 6.1 session

```js
{
  id,
  mode: 'image',
  title,
  providerId,
  model,
  messages: [],
  imageCanvas: {
    version: 2,
    zoom,
    panX,
    panY,
    selectedId,
    items: []
  },
  draft: {
    input,
    referencePath,
    size,
    count,
    stylePresetId
  }
}
```

### 6.2 canvas item

```js
{
  id,
  path,
  x,
  y,
  w,
  h,
  batchId,
  promptMessageId,
  imageIndex,
  prompt,
  revisedPrompt,
  model,
  providerId,
  createdAt
}
```

说明：

- `dataUrl` 只留内存，不进 SQLite。
- 图片本体仍在工作区 `images/`。
- `imageCanvas.version = 2` 兼容当前 v1 item（缺字段时默认补齐）。

---

## 7. 分阶段实施

### I0：基础链路向普通聊天对齐

目标：在动大布局前，先把生图模式的“会话、任务、composer、消息流”定义清楚，避免新画布挂在旧体验上。

- 左栏：
  - 启用生图会话标题搜索。
  - 列表项补图片数、最近模型、更新时间、运行中/失败/完成状态。
  - 更多菜单补重命名、复制、删除；交互与普通聊天一致。
  - 后台生成任务进入统一任务状态，不因切换模式/会话丢状态。
- 会话基础：
  - 新建 image session 立即持久化。
  - 恢复最后活动 image session。
  - 复制/删除同时处理 imageCanvas 与工作区文件边界。
- 生成对话列：
  - composer 自动增高、发送/停止按钮状态、参考图 chip。
  - 外部拖拽/粘贴/工作区引用全部先进入当前工作区。
  - user prompt、assistant pending/result/error 消息结构稳定落盘。
- API 链路：
  - generations、edits/reference、chat fallback 都从同一 `sendImagePrompt` 任务模型进入。
  - 生成任务携带 provider/model/size/count/referencePath/prompt/messageId/batchId。

验收：

- 不改成大画布布局时，左栏和生成对话链路也已接近普通聊天的稳定度。
- 切换聊天/生图/设置时，正在生成的任务状态不断、会话列表状态正确。
- 只发 prompt、带参考图、停止、失败、重试都能在对应消息行里表达。

### I1：布局改造

目标：先把形态变成小对话框 + 大画布。

- `ui/index.html`：把 image view 改为 `.image-studio`，内部两列：`.image-chat-panel` + `.image-canvas-main`。
- 移除生图模式默认打开右侧 canvas tab 的行为。
- `app.js`：`setMode('image')` 不再强制 `showImageCanvasPane()`；生图模式默认关闭右栏。
- `image-mode.js`：`enterImageMode()` 直接渲染主画布 host。
- `app.css`：画布区域全高，点阵背景占主视图；对话列固定宽度；composer 固定在对话列底部。

验收：

- 点击生图后第一屏就是大画布。
- 左栏仍是完整生图会话管理，不因 studio 布局缩水。
- 小对话列保留 I0 的消息流、任务状态和 composer 手感。
- 普通聊天右栏 Browser/Files 逻辑不受影响。
- 窗口缩小时对话列不挤爆，画布仍可操作。

### I2：画布交互补强

目标：让画布成为可工作的资产板。

- `image-canvas.js` 增加：
  - fit all
  - delete selected
  - copy path
  - open file / reveal in files
  - double click preview
  - selected item details callback
- 画布变化节流保存 `session.imageCanvas`。
- 生成批次落点策略：新图放在当前视口中心或右侧空位。

验收：

- 拖动图片、缩放、重启应用后位置恢复。
- 删除画布项只从画布移除，不删除磁盘图片，除非未来显式加“删除文件”。
- 选中图片可立即作为参考图。

### I3：生成控制台精简

目标：小对话框只保留生成所需信息。

- 历史流缩略图从 148px 改为更小的横向/网格缩略。
- 用户 prompt 卡片展示简短文本和参数摘要。
- 空态 chips 改成场景模板，点击只填入输入框，不自动生成。
- composer 支持：
  - 风格 preset
  - 尺寸
  - 数量
  - 参考图 chip
  - Enter 生成，Shift+Enter 换行
- composer 继续采用普通聊天的自动增高策略，底部不显示说明性提示文案。
- 生成中状态固定在当前 assistant 行，不滚动抢焦点。

验收：

- 一次生成多张时，对话列不挤占主工作区。
- 历史点击能定位到画布对应图。
- 生成失败时错误留在对应轮次，不污染画布。

### I4：会话列表和恢复

目标：让生图会话像本地项目一样可恢复。

- 生图列表项显示图片数量、最近模型、更新时间。
- 新建生图会话后立即持久化空 `imageCanvas`。
- 恢复最后活动 image session。
- 加标题搜索，和聊天标题搜索一致。
- 会话更多菜单与普通聊天一致：重命名、复制、删除；复制后复制画布状态与消息元数据，工作区复制沿用现有 session copy 边界。
- 运行中/失败任务状态要显示在左栏列表项，后台任务完成后可提示用户返回查看。

验收：

- 重启后进入上次生图会话，画布、参考图、输入草稿恢复。
- 切换会话不会显示上一会话图片缓存。

### I5：质量与回归

目标：把生图模式拉到普通聊天同等级稳定性。

- `node --check` 覆盖 image modules。
- 加一个 `ui/dev/image-mode-test.html` 或轻量浏览器冒烟页。
- 用 Playwright 检查：
  - desktop 1440x900
  - compact 1024x720
  - mobile-ish narrow fallback
  - canvas 非空、点阵可见、工具条不遮挡 composer
- 手工实测：
  - 生成
  - 参考图编辑
  - 拖动画布保存/恢复
  - 切换聊天/生图/设置

---

## 8. 文件级改造清单

| 文件 | 改造 |
| --- | --- |
| `ui/index.html` | 重排 image view：生成面板 + 主画布 |
| `ui/css/app.css` | 新增 image studio layout；弱化时间线，强化画布 |
| `ui/js/app.js` | 生图模式不再使用右栏 canvas；右栏逻辑只服务 chat/files/browser |
| `ui/js/image-mode.js` | 拆分 renderImageStudio/renderImageHistory/renderImageComposer/renderImageCanvas |
| `ui/js/image-canvas.js` | 增强 fit/delete/copy/open/定位/落点/节流保存 hook |
| `ui/js/app-core.js` | 增加 image 搜索 query、image 任务状态、image 面板宽度等 state |
| `docs/HANDOFF.md` | 实施完成后同步状态 |

建议顺手做的模块化：

- 从 `image-mode.js` 拆 `image-session.js`：会话创建、标题、列表过滤、hydrate。
- 从 `image-mode.js` 拆 `image-studio-view.js`：DOM 渲染和事件绑定。
- 从 `image-mode.js` 拆 `image-task.js`：生成任务状态、停止、失败、后台完成/未读。
- 从普通聊天抽出可复用 composer/附件 chip 逻辑时要谨慎，先复制小范围模式，确认稳定后再抽公共模块。
- 保留 `image-api.js` 不动，除非接口实测发现兼容问题。

---

## 9. 风险与保护

### 9.1 不要误删用户图片

画布删除首版只移除 canvas item，不删除工作区文件。真正删除图片文件必须走单独确认，并遵守现有 `delete_files` 权限边界。

### 9.2 不要把 base64 写入 SQLite

沿用当前规则：

- live UI 可保留 `dataUrl`。
- 保存前必须剥离，只存 path/mime/meta。

### 9.3 避免右栏回归

生图主画布不再走 `rightTabs`，但聊天里的 Browser/Files/Runner 不能被影响。`setMode` 和 `renderRightPane` 的职责要分清。

### 9.4 画布事件泄漏

当前 `image-canvas.js` 每次 render 会重绑 window mousemove/mouseup，已有 remove 逻辑但比较脆。改造时建议提供 `destroy(host)` 或在 render 前清理，避免切会话/切模式后旧 handler 残留。

### 9.5 小窗口适配

低宽度下建议：

- 小于 900px：生成面板覆盖/抽屉化，画布保留主视图。
- 不要让画布和对话列 1:1 挤压。

---

## 10. 首版验收标准

- 生图模式默认看到：左侧生图会话列表 + 窄生成对话列 + 大点阵画布。
- 无图片时空态居于生成列，画布仍为空点阵。
- 生成图片后：
  - 图片保存到当前会话工作区；
  - 历史列出现缩略图；
  - 画布出现可拖拽图片卡片；
  - 点击缩略图定位/选中画布项。
- 选中画布图片后可设为参考图，再次生成走 edit/reference 流程。
- 重启应用后：生图会话、历史、图片、画布位置都恢复。
- 普通聊天模式现有能力不回退：SQLite 分页、滚动、预览、文件栏都保持可用。

---

## 11. 暂不做

- 全局图片搜索。
- 项目数据库表。
- 多画板。
- 图层面板。
- 图片内局部涂抹/inpaint mask。
- 视频/短片时间线。
- 截图能力（用户已确认可延后）。
