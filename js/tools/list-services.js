/* WepChat Tool - list_services */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { ensureWorkspace } = T.workspace;

  function fListServices(session) {
    ensureWorkspace(session);
    if (!session.services.length) return '(没有服务)';
    return session.services.map(s => [
      s.id,
      s.status || 'stopped',
      s.name,
      'entry=' + s.entry
    ].join('\t')).join('\n');
  }

  T.register({
    name: 'list_services',
    execute(args, ctx) {
      return fListServices(ctx.session);
    }
  });
})();
