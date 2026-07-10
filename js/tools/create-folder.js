/* WepChat Tool - create_folder */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { ensureWorkspace, safeName, ensureParentFolders } = T.workspace;

  function fCreateFolder(session, args) {
    ensureWorkspace(session);
    const path = safeName(args.path);
    if (session.files[path]) throw new Error('同名文件已存在，不能创建文件夹: ' + path);
    ensureParentFolders(session, path);
    if (!session.folders.includes(path)) session.folders.push(path);
    return '已创建文件夹 ' + path;
  }

  T.register({
    name: 'create_folder',
    definition: {
  "name": "create_folder",
  "description": "在当前会话工作区中显式创建空文件夹。适合先搭目录结构，再写入文件。",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "要创建的文件夹路径，例如 demo/assets"
      }
    },
    "required": [
      "path"
    ]
  }
},
    execute(args, ctx) {
      return fCreateFolder(ctx.session, args);
    }
  });
})();
