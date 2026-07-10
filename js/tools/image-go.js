/* WepChat Tool - image_go */
'use strict';

(() => {

  const T = window.WepChatTools;

  T.register({
    name: 'image_go',
    aliases: ['image_generation'],
    definition: {
  "name": "image_go",
  "description": "当用户明确想生成或改图时，整理用户意图并交给图片模型。没有参考图时用 generate；用户上传/提到工作区图片并要求修改时用 edit，并把图片工作区路径填入 referenceFiles。不要用于单纯图片分析或提示词建议。",
  "parameters": {
    "type": "object",
    "properties": {
      "prompt": {
        "type": "string",
        "description": "完整图片提示词，保留用户关键要求并补充必要视觉细节"
      },
      "mode": {
        "type": "string",
        "enum": [
          "generate",
          "edit"
        ],
        "description": "generate 文生图；edit 基于 referenceFiles 中的工作区图片调用 /v1/images/edits。"
      },
      "size": {
        "type": "string",
        "description": "图片尺寸。优先使用明确尺寸，例如 1024x1024、1024x1536、1536x1024、1536x864、864x1536、2048x2048、2560x1440、1440x2560、3840x2160、2160x3840、2880x2880。未知时可以省略；只有用户明确要求自动尺寸时才传 auto。"
      },
      "count": {
        "type": "integer",
        "description": "生成数量，通常 1"
      },
      "style": {
        "type": "string",
        "description": "可选风格，例如 克制、写实、图标、海报、UI mockup"
      },
      "referenceFiles": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "edit 时必填，当前工作区中的参考图片路径，例如 attachments/photo.png 或 images/result.png"
      },
      "targetFile": {
        "type": "string",
        "description": "可选，期望保存到工作区的文件名或路径"
      },
      "reason": {
        "type": "string",
        "description": "为什么判断需要生图"
      }
    },
    "required": [
      "prompt"
    ]
  }
},
    async execute(args, ctx) {
      if (!ctx.imageGo) return '错误：当前环境未启用图片生成';
      return await ctx.imageGo(args);
    }
  });
})();
