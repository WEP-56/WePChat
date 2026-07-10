/* WepChat Tool - preview_file */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { ensureWorkspace, safeName, serviceName } = T.workspace;
  const { MAX_SERVICES } = T;

  function openHtmlPreview(session, entry, args, ctx) {
    if (!ctx || !ctx.openService) return '预览未打开：当前环境没有预览面板。';
    if (!/\.html?$/i.test(entry)) return '预览未打开：preview 仅支持 HTML 文件。';
    let svc = (session.services || []).find(s => s.entry === entry);
    if (!svc) {
      if (session.services.length >= MAX_SERVICES) throw new Error('会话静态预览数已达上限');
      svc = { id: U.uuid(), name: serviceName(args.title || entry), entry, status: 'stopped', createdAt: U.now(), updatedAt: U.now() };
      session.services.push(svc);
    }
    svc.name = serviceName(args.title || svc.name || entry);
    svc.entry = entry;
    svc.status = 'running';
    svc.updatedAt = U.now();
    svc.lastStartedAt = U.now();
    if (ctx.createPreviewCard) {
      return ctx.createPreviewCard({
        serviceId: svc.id,
        entry: svc.entry,
        title: svc.name,
        updatedAt: svc.updatedAt
      });
    }
    if (ctx.openService) ctx.openService(svc.id);
    return '已打开 HTML 预览：' + entry + '（wepchat://service/' + svc.id + '）';
  }
  
  function fPreviewFile(session, args, ctx) {
    ensureWorkspace(session);
    const name = safeName(args.path || args.entry || 'index.html');
    if (!session.files[name]) throw new Error('文件不存在: ' + name + '。请先用 write_file 创建它。');
    if (/\.m?js$/i.test(name)) {
      if (!ctx || !ctx.createPreviewCard) return 'JS 运行卡片未生成：当前界面不支持卡片。';
      return ctx.createPreviewCard({
        entry: name,
        title: args.title || name,
        kind: 'js'
      });
    }
    if (!/\.html?$/i.test(name)) throw new Error('preview_file 只能用于 HTML 或 JS 文件: ' + name);
    return openHtmlPreview(session, name, args, ctx);
  }

  T.register({
    name: 'preview_file',
    definition: {
  "name": "preview_file",
  "description": "为当前会话工作区中已有的 HTML 或 JS 文件生成对话内卡片。HTML 卡片是静态缩略预览，用户点击后进入完整 HTML 预览；JS 卡片是运行入口，用户点击后进入代码与终端运行器，不会自动执行。只能用于 .html/.htm/.js/.mjs 文件；不要用于 CSS/JSON/Markdown。写多页 HTML 项目时通常只预览入口页，例如 index.html。",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "要展示的工作区文件路径，例如 index.html、demo/index.html 或 tools/sum.js。仅支持 HTML 或 JS 文件"
      },
      "title": {
        "type": "string",
        "description": "可选，卡片名称"
      }
    },
    "required": [
      "path"
    ]
  }
},
    execute(args, ctx) {
      return fPreviewFile(ctx.session, args, ctx);
    }
  });
})();
