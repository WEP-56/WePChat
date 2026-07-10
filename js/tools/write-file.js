/* WepChat Tool - write_file */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { ensureWorkspace, safeName, ensureParentFolders, textMime, diffText } = T.workspace;
  const { MAX_FILE, MAX_FILES } = T;

  function fWriteFile(session, args) {
    ensureWorkspace(session);
    const name = safeName(args.path);
    const content = String(args.content == null ? '' : args.content);
    if (content.length > MAX_FILE) throw new Error('内容超过 ' + U.fmtSize(MAX_FILE) + ' 上限');
    if (!session.files[name] && Object.keys(session.files).length >= MAX_FILES) throw new Error('会话文件数已达上限');
    const before = session.files[name] && session.files[name].content || '';
    const existed = !!session.files[name];
    ensureParentFolders(session, name);
    session.files[name] = { content, mime: args.mime || textMime(name), size: content.length, mtime: U.now() };
    const d = diffText(name, before, content);
    return (existed ? '已更新 ' : '已创建 ') + name + '（' + U.fmtSize(content.length) + '）' +
      (d ? '\n\n' + d : '\n\n内容未变化。');
  }

  T.register({
    name: 'write_file',
    definition: {
  "name": "write_file",
  "description": "把文本内容写入当前会话工作区（新建或覆盖）。生成 HTML/CSS/JS/Markdown/JSON 等文件时优先使用它，而不是把完整代码直接输出在聊天正文里。需要给用户展示 HTML 或可运行 JS 时，先写入文件，再调用 preview_file 生成对话内卡片。",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "工作区文件路径，例如 index.html 或 demo/app.js"
      },
      "content": {
        "type": "string",
        "description": "完整文件内容"
      },
      "mime": {
        "type": "string",
        "description": "可选 MIME 类型"
      }
    },
    "required": [
      "path",
      "content"
    ]
  }
},
    execute(args, ctx) {
      return fWriteFile(ctx.session, args);
    }
  });
})();
