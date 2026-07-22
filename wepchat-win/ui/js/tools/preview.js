/* WePChat Tools — preview_file (right Browser tab via srcdoc) */
'use strict';

(() => {
  const T = window.WepChatTools;

  T.register({
    name: 'preview_file',
    definition: {
      name: 'preview_file',
      description: '为当前会话工作区中的 HTML 或 JS 文件打开右侧预览。HTML 进入浏览器标签；JS 进入运行标签。写多页 HTML 项目时通常只预览入口页，例如 index.html。文件尚未生成时也可以先打开等待标签。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要展示的工作区文件路径，例如 index.html、demo/index.html 或 tools/sum.js。仅支持 HTML 或 JS 文件' },
          title: { type: 'string', description: '可选，标签名称' },
        },
        required: ['path'],
      },
    },
    async execute(args, ctx) {
      const path = String(args.path || args.entry || 'index.html').replace(/\\/g, '/').replace(/^\/+/, '');
      if (!path) return '错误：缺少 path 参数';
      const isHtml = /\.html?$/i.test(path);
      const isJs = /\.m?js$/i.test(path);
      if (!isHtml && !isJs) {
        return '错误：preview_file 只能用于 HTML 或 JS 文件: ' + path;
      }
      if (!ctx || typeof ctx.openPreview !== 'function') {
        return '预览未打开：当前环境没有预览面板。';
      }
      const title = args.title || path;
      ctx.openPreview({ path, title, kind: isJs ? 'js' : 'html' });
      if (isJs) return '已打开 JS 运行标签：' + path;
      return '已打开 HTML 预览：' + path;
    },
  });

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
          referenceFiles: { type: 'array', items: { type: 'string' }, description: 'edit 时必填，当前工作区中的参考图片路径' },
          targetFile: { type: 'string', description: '可选，期望保存到工作区的文件名或路径' },
          reason: { type: 'string', description: '为什么判断需要生图' },
        },
        required: ['prompt'],
      },
    },
    async execute(args) {
      const mode = args.mode || 'generate';
      return (
        'image_go 尚未在 Windows 端接入真实生图（stub）。\n' +
        'mode: ' + mode + '\n' +
        'prompt: ' + String(args.prompt || '').slice(0, 500) + '\n' +
        (args.targetFile ? 'targetFile: ' + args.targetFile + '\n' : '') +
        '请在聊天中直接说明生图需求，或等待后续版本。'
      );
    },
  });
})();
