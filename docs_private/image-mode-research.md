# WepChat 生图模式调研与方案草案

> 日期：2026-07-06
>
> 定位约束：WepChat 的核心风格是克制、轻量、快速。生图能力应服务于“随手生成、日常想法快速验证、对话中顺手改图”，不要做成 ComfyUI 式节点工作流、Midjourney 式社区图库，或重型 DAM/图库管理工具。

## 1. 目标定义

WepChat 应在现有常规对话模式上衍生出生图模式，而不是另做一个复杂图片工作站。

建议定义两个入口：

1. **常规模式**
   - 继续以文本对话为主。
   - 文本模型判断用户有生图意图时调用 `image_go` 工具。
   - `image_go` 将整理后的提示词、尺寸、参考图、风格等交给首选生图模型。
   - 生成图片进入当前会话工作区，并作为消息结果展示。

2. **生图模式**
   - 用户主动切换到生图模式。
   - 默认直接调用生图模型，不绕文本模型。
   - 保留一个轻量工作台抽屉，用于设置尺寸、比例、风格、参考图、种子、批量数、输出格式等。
   - 支持像普通对话一样直接输入自然语言生成。
   - 点击生成图片后进入“图片对话/编辑”视图：中心看图，底部对话输入，侧边是当前会话生成列表。

## 2. 竞品与产品形态观察

### ChatGPT / OpenAI

OpenAI 的 Images API 把图像能力拆成生成、编辑、变体/参考输入等 API 能力。ChatGPT 产品形态上，用户不需要手动选择“图片 API”，而是由对话模型判断意图后直接进入图片生成或图片编辑流程。

对 WepChat 的启发：

- 常规模式里的生图应由模型工具路由触发，而不是要求用户每次切换模式。
- 生图结果应回到会话，而不是跳到独立图库。
- 图片编辑应是“围绕当前图片继续说一句话”，而不是打开复杂修图软件。
- 需要保留成本/权限确认，尤其是常规模式自动路由到付费生图模型时。

参考：
- [OpenAI Images API](https://platform.openai.com/docs/guides/images)
- [OpenAI image generation model docs](https://platform.openai.com/docs/models/gpt-image-1)

### Gemini

Gemini API 文档将图像生成、图文输入、图像编辑/多轮图像对话作为多模态能力的一部分。Gemini 产品体验倾向于“同一个对话里理解图片、生成图片、继续编辑图片”。

对 WepChat 的启发：

- 生图模型元数据不能只有 `imageGeneration`，还要区分图生图、局部编辑、参考图、是否支持多轮上下文。
- 图片对话视图可以复用会话消息，但需要单独维护“当前图片上下文”和“编辑链路”。
- 常规模式上传图片后，如果用户说“把它改成……”，应优先走图片编辑能力，而不是纯文生图。

参考：
- [Gemini API image generation](https://ai.google.dev/gemini-api/docs/image-generation)
- [Gemini API models](https://ai.google.dev/gemini-api/docs/models)

### 开源图片工作站 / WebUI

开源生态常见两类：

- **重型工作流**：ComfyUI、Stable Diffusion WebUI 等，面向节点、采样器、ControlNet、LoRA、批量工作流。能力强但不符合 WepChat 的轻量移动端定位。
- **轻量 API Playground**：围绕 `gpt-image-*`、Gemini、Replicate、Fal、Stability 等 API 做 prompt、size、reference image、history grid。更接近 WepChat 可以借鉴的范围。

对 WepChat 的启发：

- 不做节点图、采样器大面板、模型市场、社区流、图库瀑布流。
- 只保留高频参数：比例/尺寸、数量、风格模板、参考图、种子、输出格式。
- 历史列表应限制在当前会话，作为工作区文件入口，不做全局图库。

参考：
- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- [gpt-image-1 playground examples](https://github.com/search?q=gpt-image-1+playground&type=repositories)
- [Open WebUI image generation docs](https://docs.openwebui.com/)

## 3. 生图模型元数据需要扩展

当前 `MODEL_META.capabilities` 已有：

- `imageGeneration`
- `imageEdit`
- `vision`
- `reasoning`
- `tools`
- `structuredOutput`

建议继续扩展图像专用字段，不要只塞 boolean：

```js
image: {
  generation: true,
  edit: true,
  imageToImage: true,
  inpainting: false,
  multiImageReference: true,
  transparentBackground: true,
  textRendering: "good",
  maxReferences: 4,
  sizes: ["1024x1024", "1024x1536", "1536x1024", "auto"],
  aspectRatios: ["1:1", "4:3", "3:4", "16:9", "9:16"],
  outputFormats: ["png", "jpeg", "webp"],
  maxBatch: 4,
  supportsSeed: false,
  supportsStylePreset: false,
  supportsNegativePrompt: false,
  costTier: "medium"
}
```

字段含义：

- `generation`：文生图。
- `edit`：基于图片继续编辑。
- `imageToImage`：参考图/图生图。
- `inpainting`：局部重绘或 mask。
- `multiImageReference`：多参考图。
- `transparentBackground`：透明背景。
- `textRendering`：文字渲染能力，可用于图标、海报、UI 生成提示。
- `sizes` / `aspectRatios`：UI 可选项。
- `maxBatch`：一次请求数量。
- `supportsSeed`：是否支持固定种子。
- `supportsNegativePrompt`：很多扩散模型支持，OpenAI/Gemini 类模型未必支持。
- `costTier`：用于常规模式自动路由前提示用户。

兼容策略：

- 如果 `/models` 返回 `capabilities`、`context_length`、`supported_parameters`，优先采用接口元数据。
- 内置元数据只作为默认值，必须允许用户覆盖。
- 对未知模型按名称推断，但 UI 应显示“推断/默认”，避免误导。

## 4. 常规模式：`image_go` 工具设计

### 4.1 工具职责

`image_go` 是文本模型调用的工具，职责是把用户意图转为结构化图片生成请求。

建议参数：

```json
{
  "prompt": "生成图片的完整提示词",
  "mode": "generate|edit",
  "size": "1024x1024|1024x1536|1536x1024|auto",
  "aspectRatio": "1:1|4:3|3:4|16:9|9:16|auto",
  "count": 1,
  "style": "auto",
  "referenceFiles": ["workspace/path.png"],
  "targetFile": "images/xxx.png",
  "reason": "为什么判断用户需要生图"
}
```

### 4.2 路由规则

常规模式中，文本模型可调用 `image_go` 的典型场景：

- “画一张……”
- “生成一张……图”
- “做一个 logo / icon / poster / banner”
- “把这张图改成……”
- “基于这个截图生成新版 UI”
- “给这个产品做一张宣传图”

不应调用的场景：

- 用户只是问“怎么画”或“提示词怎么写”。
- 用户要求分析图片内容。
- 用户要求写 HTML/CSS/SVG，除非明确要生成位图。
- 用户需要复杂设计稿，应优先建议分步骤生成。

### 4.3 权限与成本

默认建议：

- 首次常规模式自动生图：必须询问。
- 用户可在设置中改为“每次询问 / 始终允许 / 禁止”。
- 如果 `count > 1`、高分辨率、图像编辑或高成本模型，仍应提示。
- 工具卡片中显示“将使用：提供商 / 模型 / 数量 / 尺寸”。

## 5. 生图模式：轻量工作台设计

### 5.1 页面结构

移动端优先，建议三层结构：

1. **主画布区**
   - 空状态：提示输入一句话开始生成。
   - 有结果：展示最近生成图。
   - 点击图片进入图片对话/编辑视图。

2. **底部输入区**
   - 类似常规模式 composer。
   - placeholder：`描述你想生成的图片`
   - 支持附件/参考图。

3. **工作台抽屉**
   - 默认收起。
   - 打开后配置常用参数。
   - 不做复杂多标签参数面板。

### 5.2 工作台字段

首版建议只做：

- 模型
- 比例/尺寸
- 数量
- 风格模板
- 参考图
- 输出格式
- 保存位置

后续再做：

- 种子
- 负面提示词
- 局部重绘 mask
- 透明背景
- 品牌色/调色板
- 模板变量

### 5.3 图片对话/编辑视图

参考用户截图，但保持 WepChat 风格：

- 顶部：文件名 / 关闭 / 导出。
- 中心：当前图片。
- 左侧或底部：当前会话生成图列表，移动端可横向缩略条。
- 底部：对当前图片继续描述编辑。
- 输入默认模式是 edit，不是新生成。
- 编辑结果作为新文件保存，原图不覆盖。

建议状态结构：

```js
imageThread: {
  currentFile: "images/xxx.png",
  history: [
    {
      file: "images/xxx.png",
      prompt: "...",
      parentFile: "",
      model: "gpt-image-1",
      createdAt: 0
    }
  ]
}
```

## 6. 结果进入工作区

所有生图结果必须进入当前会话工作区。

建议路径：

```text
images/
  2026-07-06_104530_icon.png
  2026-07-06_104530_icon.meta.json
```

图片文件：

```js
{
  dataUrl,
  mime: "image/png",
  size,
  mtime,
  source: "image_go|image_mode",
  imageMeta: {
    prompt,
    model,
    providerId,
    mode,
    size,
    aspectRatio,
    seed,
    parentFile
  }
}
```

是否单独写 `.meta.json` 可以后置；首版直接写入文件对象即可。

## 7. 图片生成设置页

建议在设置中新增“图片生成”设置项。

首版字段：

- 生图首选提供商
- 生图首选模型
- 图片编辑首选模型
- 默认尺寸/比例
- 默认数量
- 常规模式自动生图权限：询问 / 允许 / 禁止
- 成本提示：始终显示 / 高成本显示 / 不显示
- 模板管理入口

模板建议结构：

```js
{
  id: "app-icon",
  name: "应用图标",
  prompt: "为 {{appName}} 生成现代、克制、可识别的应用图标，风格：{{style}}",
  defaults: {
    aspectRatio: "1:1",
    size: "1024x1024"
  }
}
```

模板应是“提示词捷径”，不是复杂工作流。

## 8. API 抽象建议

新增 `js/image-api.js`，不要把图片 API 写进现有 `js/api.js`。

接口：

```js
ImageAPI.generate({
  provider,
  model,
  prompt,
  size,
  count,
  references,
  settings,
  signal,
  onProgress
})

ImageAPI.edit({
  provider,
  model,
  prompt,
  sourceImage,
  mask,
  references,
  settings,
  signal,
  onProgress
})
```

输出统一：

```js
{
  images: [
    {
      dataUrl,
      mime,
      revisedPrompt,
      seed,
      raw
    }
  ]
}
```

首批适配顺序：

1. OpenAI Images API / OpenAI 兼容 Images API。
2. Gemini image generation。
3. Qwen Image / 通义万相一类接口。
4. 其他供应商后续扩展。

## 9. 分阶段实现建议

### Phase 1：模型与设置基础

- 扩展 `MODEL_META.image` 字段。
- 新增“图片生成”设置页。
- 支持选择生图首选模型和编辑首选模型。
- 工作区支持图片元数据。

### Phase 2：生图模式 MVP

- 新增常规/生图模式切换。
- 生图模式下直接调用首选生图模型。
- 支持 prompt、尺寸、比例、数量。
- 结果进入 `images/` 工作区。
- 消息中显示生成图网格。

### Phase 3：常规模式智能路由

- 新增 `image_go` 工具。
- 常规模式文本模型可请求生图。
- 首次和高成本请求弹确认。
- 工具卡显示生成参数和结果文件。

### Phase 4：图片对话/编辑视图

- 点击图片进入编辑视图。
- 底部对话框默认编辑当前图片。
- 左侧/底部缩略列表快速切换。
- 编辑生成新文件，保留父子关系。

### Phase 5：模板与工作台增强

- 模板管理。
- 参考图管理。
- 种子/负面提示词/透明背景。
- 简单批量变体。

## 10. 不做清单

为了保持 WepChat 克制、轻量、快速，短期明确不做：

- 节点工作流。
- LoRA/ControlNet/采样器大参数面板。
- 社区广场、点赞、公开图库。
- 全局素材库/DAM。
- 图层式专业修图。
- 复杂项目管理。
- 长时间后台队列。

## 11. 推荐结论

WepChat 的生图能力应被定义为“对话中的轻量图片生成与编辑”，而不是图片工作站。

最稳妥的实现顺序：

1. 先扩模型元数据和图片生成设置。
2. 再做生图模式 MVP。
3. 再加 `image_go` 让常规模式具备智能路由。
4. 最后做图片对话/编辑视图。

这样可以让用户最快获得可用生图能力，同时保留未来接入更多模型和编辑能力的空间。
