/* WepChat Tool - create_workspace */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { ensureWorkspace } = T.workspace;

  function fCreateWorkspace(session, args) {
    ensureWorkspace(session);
    return '会话工作区已准备好。当前文件数：' + Object.keys(session.files).length +
      '。这个工作区默认存在，可以继续使用 write_file/read_file/edit_file/delete_file/list_files/create_folder/move_path/path_exists。';
  }

  T.register({
    name: 'create_workspace',
    execute(args, ctx) {
      return fCreateWorkspace(ctx.session, args);
    }
  });
})();
