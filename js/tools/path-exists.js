/* WepChat Tool - path_exists */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { ensureWorkspace, safeName, collectFolders, textMime } = T.workspace;

  function fPathExists(session, args) {
    ensureWorkspace(session);
    const path = safeName(args.path);
    if (session.files[path]) {
      const f = session.files[path];
      return JSON.stringify({ path, exists: true, type: 'file', size: f.size || 0, mime: f.mime || textMime(path) }, null, 2);
    }
    const folders = collectFolders(session);
    if (folders.has(path) || Object.keys(session.files || {}).some(name => name.startsWith(path + '/'))) {
      const prefix = path + '/';
      return JSON.stringify({
        path,
        exists: true,
        type: 'folder',
        files: Object.keys(session.files || {}).filter(name => name.startsWith(prefix)).length,
        folders: Array.from(folders).filter(name => name.startsWith(prefix)).length
      }, null, 2);
    }
    return JSON.stringify({ path, exists: false, type: 'missing' }, null, 2);
  }

  T.register({
    name: 'path_exists',
    definition: {
  "name": "path_exists",
  "description": "检查当前会话工作区中某个文件或文件夹是否存在，返回 JSON，包括 type=file/folder/missing。",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "要检查的工作区路径"
      }
    },
    "required": [
      "path"
    ]
  }
},
    execute(args, ctx) {
      return fPathExists(ctx.session, args);
    }
  });
})();
