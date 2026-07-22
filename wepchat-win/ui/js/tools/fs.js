/* WePChat Tools — filesystem via Rust IPC */
'use strict';

(() => {
  const T = window.WepChatTools;

  function tauriInvoke(cmd, args) {
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') {
      return Promise.reject(new Error('Tauri bridge unavailable'));
    }
    return core.invoke(cmd, { args });
  }

  function sessionId(ctx) {
    const id = (ctx && (ctx.sessionId || (ctx.session && ctx.session.id))) || '';
    if (!id) throw new Error('缺少会话 ID');
    return id;
  }

  async function callWs(cmd, payload, ctx) {
    const res = await tauriInvoke(cmd, payload);
    if (res && typeof res === 'object' && res.content != null) {
      if (res.changes && res.changes.length && ctx && typeof ctx.onWorkspaceChanged === 'function') {
        try { ctx.onWorkspaceChanged(res.changes); } catch (e) { /* ignore */ }
      }
      return String(res.content);
    }
    return typeof res === 'string' ? res : JSON.stringify(res);
  }

  T.register({
    name: 'read_file',
    definition: {
      name: 'read_file',
      description: '读取当前会话工作区中的文本文件内容。路径可以包含文件夹，例如 demo/index.html。可用 lines 读取片段，避免大文件一次性读完。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '工作区文件路径' },
          lines: { type: 'string', description: '可选行号范围：1-20、50-80、1-、-30，省略则读取全文' },
        },
        required: ['path'],
      },
    },
    async execute(args, ctx) {
      return callWs('ws_read', {
        sessionId: sessionId(ctx),
        path: args.path,
        lines: args.lines || null,
      }, ctx);
    },
  });

  T.register({
    name: 'write_file',
    definition: {
      name: 'write_file',
      description: '把文本内容写入当前会话工作区（新建或覆盖）。生成 HTML/CSS/JS/Markdown/JSON 等文件时优先使用它，而不是把完整代码直接输出在聊天正文里。需要给用户展示 HTML 或可运行 JS 时，先写入文件，再调用 preview_file 生成对话内卡片。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '工作区文件路径，例如 index.html 或 demo/app.js' },
          content: { type: 'string', description: '完整文件内容' },
          mime: { type: 'string', description: '可选 MIME 类型' },
        },
        required: ['path', 'content'],
      },
    },
    async execute(args, ctx) {
      return callWs('ws_write', {
        sessionId: sessionId(ctx),
        path: args.path,
        content: args.content == null ? '' : String(args.content),
        mime: args.mime || null,
      }, ctx);
    },
  });

  T.register({
    name: 'edit_file',
    definition: {
      name: 'edit_file',
      description: '修改当前会话工作区中的已有文本文件。先 read_file 获取最新内容，再用 find/replace 做小范围改动。默认精确匹配；匹配失败会返回文件前 200 字符帮助修正。可传 useRegex: true 使用正则，或 ignoreWhitespace: true 忽略空白差异。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '工作区文件路径' },
          find: { type: 'string', description: '要查找的原文片段。默认必须精确匹配；useRegex 为 true 时是正则表达式；ignoreWhitespace 为 true 时会忽略空格、制表和换行差异。' },
          replace: { type: 'string', description: '替换后的文本' },
          all: { type: 'boolean', description: '是否替换全部匹配，默认 false' },
          useRegex: { type: 'boolean', description: '可选，true 时按正则表达式匹配 find' },
          regexFlags: { type: 'string', description: '可选正则 flags，例如 i、m、s。all 为 true 时会自动使用 g。' },
          ignoreWhitespace: { type: 'boolean', description: '可选，true 时忽略 find 与文件内容之间的空白差异。不要和 useRegex 同时使用。' },
        },
        required: ['path', 'find', 'replace'],
      },
    },
    async execute(args, ctx) {
      return callWs('ws_edit', {
        sessionId: sessionId(ctx),
        path: args.path,
        find: args.find,
        replace: args.replace == null ? '' : String(args.replace),
        all: !!args.all,
        useRegex: !!args.useRegex,
        regexFlags: args.regexFlags || args.flags || null,
        ignoreWhitespace: !!args.ignoreWhitespace,
      }, ctx);
    },
  });

  T.register({
    name: 'delete_file',
    definition: {
      name: 'delete_file',
      description: '删除当前会话工作区中的文件或文件夹。支持 path 删除单个路径，或 paths 批量删除多个文件/文件夹。删除文件夹会级联删除内部文件。这个工具总是需要用户确认或被禁止，不提供静默永久允许。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要删除的工作区文件或文件夹路径' },
          paths: { type: 'array', items: { type: 'string' }, description: '可选，批量删除路径列表。传 paths 时可省略 path。' },
        },
      },
    },
    async execute(args, ctx) {
      return callWs('ws_delete', {
        sessionId: sessionId(ctx),
        path: args.path || null,
        paths: Array.isArray(args.paths) ? args.paths : null,
      }, ctx);
    },
  });

  T.register({
    name: 'list_files',
    definition: {
      name: 'list_files',
      description: '列出当前会话工作区中的文件和文件夹，返回树状结构，区分 [dir] 与 [file]。可指定 path 查看某个文件夹，可传 recursive: false 只看直属子项。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '可选，工作区文件夹路径。省略表示工作区根目录。' },
          recursive: { type: 'boolean', description: '可选，是否递归列出子目录，默认 true。false 只列出当前目录直属内容。' },
        },
      },
    },
    async execute(args, ctx) {
      return callWs('ws_list', {
        sessionId: sessionId(ctx),
        path: args.path || '',
        recursive: args.recursive !== false,
      }, ctx);
    },
  });

  T.register({
    name: 'create_folder',
    definition: {
      name: 'create_folder',
      description: '在当前会话工作区中显式创建空文件夹。适合先搭目录结构，再写入文件。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要创建的文件夹路径，例如 demo/assets' },
        },
        required: ['path'],
      },
    },
    async execute(args, ctx) {
      return callWs('ws_mkdir', {
        sessionId: sessionId(ctx),
        path: args.path,
      }, ctx);
    },
  });

  T.register({
    name: 'move_path',
    definition: {
      name: 'move_path',
      description: '移动或重命名当前会话工作区中的文件或文件夹。移动文件夹会连同内部文件一起移动。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '源文件或文件夹路径' },
          to: { type: 'string', description: '目标文件或文件夹路径' },
          overwrite: { type: 'boolean', description: '目标已存在时是否覆盖/合并，默认 false' },
        },
        required: ['from', 'to'],
      },
    },
    async execute(args, ctx) {
      return callWs('ws_move', {
        sessionId: sessionId(ctx),
        from: args.from || args.path,
        to: args.to || args.target,
        overwrite: !!args.overwrite,
      }, ctx);
    },
  });

  T.register({
    name: 'path_exists',
    definition: {
      name: 'path_exists',
      description: '检查当前会话工作区中某个文件或文件夹是否存在，返回 JSON，包括 type=file/folder/missing。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要检查的工作区路径' },
        },
        required: ['path'],
      },
    },
    async execute(args, ctx) {
      return callWs('ws_exists', {
        sessionId: sessionId(ctx),
        path: args.path,
      }, ctx);
    },
  });

  // Helpers for other tools / right pane
  T.fs = {
    invoke: tauriInvoke,
    sessionId,
    async read(sessionIdVal, path, lines) {
      const res = await tauriInvoke('ws_read', { sessionId: sessionIdVal, path, lines: lines || null });
      return res && res.content != null ? String(res.content) : '';
    },
    async write(sessionIdVal, path, content) {
      return tauriInvoke('ws_write', { sessionId: sessionIdVal, path, content: String(content || '') });
    },
    async statTree(sessionIdVal) {
      return tauriInvoke('ws_stat_tree', { sessionId: sessionIdVal });
    },
  };
})();
