/* WepChat - Agent 工具兼容门面 */
'use strict';

const Tools = (() => {
  const T = window.WepChatTools;
  if (!T || !T.workspace || !T.runtime) throw new Error('WepChat 工具模块未完整加载');
  return {
    DEFS: T.definitions(),
    SYSTEM_HINT: T.SYSTEM_HINT,
    execute: T.execute,
    runJS: T.runtime.runJS,
    runWorkspaceJS: T.runtime.runWorkspaceJS,
    applySandboxWrites: T.runtime.applySandboxWrites,
    MAX_FILE: T.MAX_FILE,
    MAX_FILES: T.MAX_FILES,
    MAX_SERVICES: T.MAX_SERVICES
  };
})();

window.Tools = Tools;
