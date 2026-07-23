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
})();
