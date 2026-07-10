/* WepChat Tool - read_file */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { ensureWorkspace, safeName, readLines } = T.workspace;

  function fReadFile(session, args) {
    ensureWorkspace(session);
    const name = safeName(args.path);
    const f = session.files[name];
    if (!f) throw new Error('文件不存在: ' + name + '。可用文件: ' + (Object.keys(session.files).join(', ') || '(空)'));
    if (f.dataUrl && !f.content) throw new Error('该文件是二进制文件，无法以文本读取');
    return readLines(f.content || '', args.lines);
  }

  T.register({
    name: 'read_file',
    definition: {
  "name": "read_file",
  "description": "读取当前会话工作区中的文本文件内容。路径可以包含文件夹，例如 demo/index.html。可用 lines 读取片段，避免大文件一次性读完。",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "工作区文件路径"
      },
      "lines": {
        "type": "string",
        "description": "可选行号范围：1-20、50-80、1-、-30，省略则读取全文"
      }
    },
    "required": [
      "path"
    ]
  }
},
    execute(args, ctx) {
      return fReadFile(ctx.session, args);
    }
  });
})();
