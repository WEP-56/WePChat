/* WepChat Tool - run_service */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { ensureWorkspace, safeName, serviceName, findService } = T.workspace;
  const { MAX_SERVICES } = T;

  function fRunService(session, args, ctx) {
    ensureWorkspace(session);
    const entry = safeName(args.entry || 'index.html');
    if (!session.files[entry]) throw new Error('入口文件不存在: ' + entry + '。请先 write_file 创建它。');
    let svc = findService(session, args);
    if (!svc) {
      if (session.services.length >= MAX_SERVICES) throw new Error('会话静态预览数已达上限');
      svc = { id: U.uuid(), name: serviceName(args.name), entry, status: 'stopped', createdAt: U.now(), updatedAt: U.now() };
      session.services.push(svc);
    }
    svc.name = serviceName(args.name || svc.name);
    svc.entry = entry;
    svc.status = 'running';
    svc.updatedAt = U.now();
    svc.lastStartedAt = U.now();
    if (ctx.openService) ctx.openService(svc.id);
    return '静态预览已启动：' + svc.name + '\n入口：' + svc.entry + '\n内部地址：wepchat://service/' + svc.id +
      '\n当前版本不会启动后台进程或 localhost 端口；用户可以在会话工作区里停止、重新启动或进入预览。';
  }

  T.register({
    name: 'run_service',
    execute(args, ctx) {
      return fRunService(ctx.session, args, ctx);
    }
  });
})();
