/* WepChat Tool - stop_service */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { findService } = T.workspace;

  function fStopService(session, args) {
    const svc = findService(session, args);
    if (!svc) throw new Error('静态预览不存在');
    svc.status = 'stopped';
    svc.updatedAt = U.now();
    return '静态预览已停止：' + svc.name;
  }

  T.register({
    name: 'stop_service',
    execute(args, ctx) {
      return fStopService(ctx.session, args);
    }
  });
})();
