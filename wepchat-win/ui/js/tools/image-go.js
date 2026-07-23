/* WePChat Tools — image_go (chat-mode image generation) */
'use strict';

(() => {
  const T = window.WepChatTools;

  T.register({
    name: 'image_go',
    aliases: ['image_generation'],
    definition: {
      name: 'image_go',
      description: '当用户明确想生成或改图时，整理用户意图并交给图片模型。没有参考图时用 generate；用户上传/提到工作区图片并要求修改时用 edit，并把图片工作区路径填入 referenceFiles。不要用于单纯图片分析或提示词建议。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '完整图片提示词，保留用户关键要求并补充必要视觉细节' },
          mode: { type: 'string', enum: ['generate', 'edit'], description: 'generate 文生图；edit 基于 referenceFiles 中的工作区图片。' },
          size: { type: 'string', description: '图片尺寸。优先使用明确尺寸。' },
          count: { type: 'integer', description: '生成数量，通常 1' },
          style: { type: 'string', description: '可选风格' },
          referenceFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'edit 时建议填写，当前工作区中的参考图片路径',
          },
          targetFile: { type: 'string', description: '可选，期望保存到工作区的文件名或路径' },
          reason: { type: 'string', description: '为什么判断需要生图' },
        },
        required: ['prompt'],
      },
    },
    async execute(args, ctx) {
      if (!window.ImageMode || typeof window.ImageMode.imageGoTool !== 'function') {
        return '错误：生图模块未加载';
      }
      return window.ImageMode.imageGoTool(args || {}, ctx || {});
    },
  });
})();
