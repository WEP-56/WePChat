/* WepChat Tool - list_files */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { ensureWorkspace, safeName, collectFolders, textMime } = T.workspace;

  function childItems(session, parent) {
    const folders = collectFolders(session);
    const out = [];
    folders.forEach(path => {
      const parts = path.split('/');
      const p = parts.slice(0, -1).join('/');
      if (p === parent) out.push({ type: 'folder', path, name: parts[parts.length - 1] });
    });
    Object.keys(session.files || {}).forEach(path => {
      const parts = path.split('/');
      const p = parts.slice(0, -1).join('/');
      if (p === parent) out.push({ type: 'file', path, name: parts[parts.length - 1], file: session.files[path] });
    });
    return out.sort((a, b) => a.type !== b.type ? (a.type === 'folder' ? -1 : 1) : a.name.localeCompare(b.name, 'zh-Hans'));
  }
  
  function fListFiles(session, args) {
    ensureWorkspace(session);
    args = args || {};
    const root = safeName(args.path || '', { allowEmpty: true });
    const folders = collectFolders(session);
    const fileNames = Object.keys(session.files || {});
    if (root && session.files[root]) {
      const f = session.files[root];
      return '[file] ' + root + '\t' + U.fmtSize(f.size || 0) + '\t' + (f.mime || textMime(root));
    }
    if (root && !folders.has(root) && !fileNames.some(name => name.startsWith(root + '/'))) {
      throw new Error('目录不存在: ' + root);
    }
    if (!folders.size && !fileNames.length) return '(工作区为空)';
    const recursive = args.recursive !== false;
    const lines = [
      'root: ' + (root || '/'),
      'folders: ' + Array.from(folders).filter(path => !root || path === root || path.startsWith(root + '/')).length +
        ', files: ' + fileNames.filter(path => !root || path === root || path.startsWith(root + '/')).length
    ];
    function walk(parent, depth) {
      const items = childItems(session, parent);
      items.forEach(item => {
        const indent = '  '.repeat(depth);
        if (item.type === 'folder') {
          lines.push(indent + '- [dir] ' + item.path + '/');
          if (recursive) walk(item.path, depth + 1);
        } else {
          const f = item.file || {};
          lines.push(indent + '- [file] ' + item.path + '\t' + U.fmtSize(f.size || 0) + '\t' + (f.mime || textMime(item.path)));
        }
      });
    }
    walk(root, 0);
    return lines.join('\n');
  }

  T.register({
    name: 'list_files',
    definition: {
  "name": "list_files",
  "description": "列出当前会话工作区中的文件和文件夹，返回树状结构，区分 [dir] 与 [file]。可指定 path 查看某个文件夹，可传 recursive: false 只看直属子项。",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "可选，工作区文件夹路径。省略表示工作区根目录。"
      },
      "recursive": {
        "type": "boolean",
        "description": "可选，是否递归列出子目录，默认 true。false 只列出当前目录直属内容。"
      }
    }
  }
},
    execute(args, ctx) {
      return fListFiles(ctx.session, args);
    }
  });
})();
