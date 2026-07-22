/* WePChat Tools — facade */
'use strict';

(() => {
  const T = window.WepChatTools;
  if (!T) throw new Error('WepChat 工具模块未加载');
  window.Tools = {
    DEFS: T.definitions(),
    SYSTEM_HINT: T.SYSTEM_HINT,
    execute: T.execute.bind(T),
    fs: T.fs,
    MAX_FILE: T.MAX_FILE,
    MAX_OUTPUT: T.MAX_OUTPUT,
  };
})();
