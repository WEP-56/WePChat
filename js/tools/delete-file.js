/* WepChat Tool - delete_file */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { ensureWorkspace, safeName, collectFolders } = T.workspace;

  function deleteOnePath(session, rawPath, deletedFiles, deletedFolders, missing) {
    const name = safeName(rawPath);
    const prefix = name + '/';
    const folders = collectFolders(session);
    let found = false;
    if (session.files[name]) {
      delete session.files[name];
      deletedFiles.add(name);
      found = true;
    }
    Object.keys(session.files || {}).forEach(path => {
      if (path.startsWith(prefix)) {
        delete session.files[path];
        deletedFiles.add(path);
        found = true;
      }
    });
    if (folders.has(name)) {
      deletedFolders.add(name);
      found = true;
    }
    folders.forEach(path => {
      if (path.startsWith(prefix)) {
        deletedFolders.add(path);
        found = true;
      }
    });
    session.folders = (session.folders || []).filter(path => path !== name && !path.startsWith(prefix));
    if (!found) missing.push(name);
  }
  
  function fDeleteFile(session, args) {
    ensureWorkspace(session);
    const input = Array.isArray(args.paths) ? args.paths : [args.path];
    const paths = input.map(x => String(x || '').trim()).filter(Boolean);
    if (!paths.length) throw new Error('缺少 path 或 paths 参数');
    if (paths.length > 50) throw new Error('单次最多删除 50 个路径');
    const deletedFiles = new Set(), deletedFolders = new Set(), missing = [];
    paths.forEach(path => deleteOnePath(session, path, deletedFiles, deletedFolders, missing));
    if (!deletedFiles.size && !deletedFolders.size) throw new Error('未找到可删除路径: ' + missing.join(', '));
    const lines = ['已删除 ' + deletedFiles.size + ' 个文件、' + deletedFolders.size + ' 个文件夹。'];
    if (deletedFolders.size) lines.push('文件夹：' + Array.from(deletedFolders).sort().join(', '));
    if (deletedFiles.size) lines.push('文件：' + Array.from(deletedFiles).sort().join(', '));
    if (missing.length) lines.push('未找到：' + missing.join(', '));
    return lines.join('\n');
  }

  T.register({
    name: 'delete_file',
    definition: {
  "name": "delete_file",
  "description": "删除当前会话工作区中的文件或文件夹。支持 path 删除单个路径，或 paths 批量删除多个文件/文件夹。删除文件夹会级联删除内部文件。这个工具总是需要用户确认或被禁止，不提供静默永久允许。",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "要删除的工作区文件或文件夹路径"
      },
      "paths": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "description": "可选，批量删除路径列表。传 paths 时可省略 path。"
      }
    }
  }
},
    execute(args, ctx) {
      return fDeleteFile(ctx.session, args);
    }
  });
})();
