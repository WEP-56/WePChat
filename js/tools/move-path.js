/* WepChat Tool - move_path */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { ensureWorkspace, safeName, collectFolders, ensureParentFolders } = T.workspace;

  function fMovePath(session, args) {
    ensureWorkspace(session);
    const from = safeName(args.from || args.path);
    let to = safeName(args.to || args.target);
    if (from === to) return '路径未变化：' + from;
    if (to.startsWith(from + '/')) throw new Error('不能把文件夹移动到它自己的子目录中');
    const folders = collectFolders(session);
    const overwrite = !!args.overwrite;
    if (session.files[from]) {
      if (folders.has(to)) to = to + '/' + from.split('/').pop();
      if (session.files[to] && !overwrite) throw new Error('目标文件已存在: ' + to + '。如需覆盖，请传 overwrite: true');
      if (folders.has(to)) throw new Error('目标路径是文件夹: ' + to);
      const f = session.files[from];
      ensureParentFolders(session, to);
      session.files[to] = Object.assign({}, f, { mtime: U.now() });
      delete session.files[from];
      return '已移动文件 ' + from + ' -> ' + to;
    }
    const prefix = from + '/';
    const fileKeys = Object.keys(session.files || {}).filter(path => path.startsWith(prefix));
    const folderKeys = Array.from(folders).filter(path => path === from || path.startsWith(prefix));
    if (!fileKeys.length && !folderKeys.length) throw new Error('源路径不存在: ' + from);
    if ((folders.has(to) || Object.keys(session.files || {}).some(path => path.startsWith(to + '/'))) && !overwrite) {
      throw new Error('目标文件夹已存在: ' + to + '。如需合并/覆盖，请传 overwrite: true');
    }
    ensureParentFolders(session, to);
    fileKeys.forEach(path => {
      const next = to + path.slice(from.length);
      if (session.files[next] && !overwrite) throw new Error('目标文件已存在: ' + next);
    });
    fileKeys.forEach(path => {
      const next = to + path.slice(from.length);
      ensureParentFolders(session, next);
      session.files[next] = Object.assign({}, session.files[path], { mtime: U.now() });
      delete session.files[path];
    });
    session.folders = (session.folders || []).filter(path => path !== from && !path.startsWith(prefix));
    folderKeys.forEach(path => {
      const next = to + path.slice(from.length);
      if (next && !session.folders.includes(next)) session.folders.push(next);
    });
    if (!session.folders.includes(to)) session.folders.push(to);
    return '已移动文件夹 ' + from + ' -> ' + to + '（文件 ' + fileKeys.length + ' 个）';
  }

  T.register({
    name: 'move_path',
    definition: {
  "name": "move_path",
  "description": "移动或重命名当前会话工作区中的文件或文件夹。移动文件夹会连同内部文件一起移动。",
  "parameters": {
    "type": "object",
    "properties": {
      "from": {
        "type": "string",
        "description": "源文件或文件夹路径"
      },
      "to": {
        "type": "string",
        "description": "目标文件或文件夹路径"
      },
      "overwrite": {
        "type": "boolean",
        "description": "目标已存在时是否覆盖/合并，默认 false"
      }
    },
    "required": [
      "from",
      "to"
    ]
  }
},
    execute(args, ctx) {
      return fMovePath(ctx.session, args);
    }
  });
})();
