/* WepChat - Agent 工具集与 JS 沙盒
 * 工具：run_js / preview_html / read_file / write_file / list_files / create_workspace / run_service / stop_service / list_services / web_fetch
 * 安全：Worker 隔离执行 + 超时熔断 + 输出截断；文件仅限当前会话工作区；网络需授权 */
'use strict';

const Tools = (() => {

  const MAX_OUTPUT = 16 * 1024;      // 工具输出上限（字符）
  const MAX_FILE = 512 * 1024;       // 单文件上限
  const MAX_FILES = 50;              // 会话文件数上限
  const MAX_SERVICES = 5;            // 会话服务数上限
  const JS_TIMEOUT = 8000;           // run_js 超时

  /* ---------- run_js：Worker 沙盒 ---------- */
  const WORKER_SRC = `
    self.onmessage = function (e) {
      var out = [], err = [];
      var LIMIT = ${MAX_OUTPUT};
      function push(arr, args) {
        try {
          var s = Array.prototype.map.call(args, function (x) {
            if (typeof x === 'string') return x;
            try { return JSON.stringify(x, null, 0); } catch (_) { return String(x); }
          }).join(' ');
          arr.push(s.length > LIMIT ? s.slice(0, LIMIT) + '…[截断]' : s);
        } catch (_) {}
      }
      console.log = console.info = console.debug = function () { push(out, arguments); };
      console.warn = console.error = function () { push(err, arguments); };
      /* 屏蔽网络与外部加载 */
      self.fetch = undefined; self.XMLHttpRequest = undefined;
      self.importScripts = undefined; self.WebSocket = undefined;
      Promise.resolve().then(function () {
        var fn = new Function('"use strict";' + e.data.code);
        return fn();
      }).then(function (result) {
        var r;
        if (result !== undefined) {
          try { r = JSON.stringify(result, null, 2); } catch (_) { r = String(result); }
          if (r && r.length > LIMIT) r = r.slice(0, LIMIT) + '…[截断]';
        }
        self.postMessage({ ok: true, stdout: out.join('\\n'), stderr: err.join('\\n'), result: r });
      }).catch(function (ex) {
        err.push(String(ex && ex.stack || ex));
        self.postMessage({ ok: false, stdout: out.join('\\n'), stderr: err.join('\\n') });
      });
    };
  `;

  function runJS(code, timeout) {
    return new Promise((resolve) => {
      let worker, timer, blobUrl;
      const finish = (r) => {
        clearTimeout(timer);
        if (worker) try { worker.terminate(); } catch (e) {}
        if (blobUrl) try { URL.revokeObjectURL(blobUrl); } catch (e) {}
        resolve(r);
      };
      try {
        blobUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
        worker = new Worker(blobUrl);
      } catch (e) {
        return finish(runJSInline(code)); // Worker 不可用时降级（无硬超时）
      }
      timer = setTimeout(() => finish({ ok: false, stdout: '', stderr: '执行超时（' + ((timeout || JS_TIMEOUT) / 1000) + 's），已中断' }), timeout || JS_TIMEOUT);
      worker.onmessage = e => finish(e.data);
      worker.onerror = e => finish({ ok: false, stdout: '', stderr: String(e.message || '执行出错') });
      worker.postMessage({ code });
    });
  }

  /* 降级方案：主线程独立作用域执行（仍捕获 console，但无法强杀死循环） */
  function runJSInline(code) {
    const out = [], err = [];
    const fake = {};
    ['log', 'info', 'debug'].forEach(k => fake[k] = (...a) => out.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')));
    ['warn', 'error'].forEach(k => fake[k] = (...a) => err.push(a.map(String).join(' ')));
    try {
      const fn = new Function('console', 'fetch', 'XMLHttpRequest', 'plus', 'localStorage', 'document', 'window', '"use strict";' + code);
      const result = fn(fake, undefined, undefined, undefined, undefined, undefined, undefined);
      let r;
      if (result !== undefined) { try { r = JSON.stringify(result, null, 2); } catch (e) { r = String(result); } }
      return { ok: true, stdout: out.join('\n'), stderr: err.join('\n'), result: r };
    } catch (ex) {
      err.push(String(ex));
      return { ok: false, stdout: out.join('\n'), stderr: err.join('\n') };
    }
  }

  /* ---------- 文件工作区 ---------- */
  function safeName(p) {
    p = String(p || '').trim().replace(/^\/+/, '');
    if (!p || p.includes('..') || p.length > 128) throw new Error('非法文件名: ' + p);
    return p;
  }
  function ensureWorkspace(session) {
    session.files = session.files || {};
    session.services = Array.isArray(session.services) ? session.services : [];
  }
  function textMime(name) {
    if (/\.html?$/i.test(name)) return 'text/html';
    if (/\.css$/i.test(name)) return 'text/css';
    if (/\.m?js$/i.test(name)) return 'text/javascript';
    if (/\.json$/i.test(name)) return 'application/json';
    if (/\.md$/i.test(name)) return 'text/markdown';
    return 'text/plain';
  }
  function diffText(path, before, after) {
    before = String(before == null ? '' : before);
    after = String(after == null ? '' : after);
    if (before === after) return '';
    const a = before.split(/\r?\n/);
    const b = after.split(/\r?\n/);
    const max = Math.max(a.length, b.length);
    const lines = ['--- ' + path, '+++ ' + path, '@@'];
    for (let i = 0; i < max; i++) {
      if (a[i] === b[i]) {
        if (a[i] != null && lines.length < 180) lines.push(' ' + a[i]);
      } else {
        if (a[i] != null) lines.push('-' + a[i]);
        if (b[i] != null) lines.push('+' + b[i]);
      }
      if (lines.length >= 180) {
        lines.push('... diff 已截断');
        break;
      }
    }
    return lines.join('\n');
  }
  function fReadFile(session, args) {
    ensureWorkspace(session);
    const name = safeName(args.path);
    const f = session.files[name];
    if (!f) throw new Error('文件不存在: ' + name + '。可用文件: ' + (Object.keys(session.files).join(', ') || '(空)'));
    if (f.dataUrl && !f.content) throw new Error('该文件是二进制文件，无法以文本读取');
    return f.content || '';
  }
  function fWriteFile(session, args) {
    ensureWorkspace(session);
    const name = safeName(args.path);
    const content = String(args.content == null ? '' : args.content);
    if (content.length > MAX_FILE) throw new Error('内容超过 ' + U.fmtSize(MAX_FILE) + ' 上限');
    if (!session.files[name] && Object.keys(session.files).length >= MAX_FILES) throw new Error('会话文件数已达上限');
    const before = session.files[name] && session.files[name].content || '';
    const existed = !!session.files[name];
    session.files[name] = { content, mime: args.mime || textMime(name), size: content.length, mtime: U.now() };
    const d = diffText(name, before, content);
    return (existed ? '已更新 ' : '已创建 ') + name + '（' + U.fmtSize(content.length) + '）' +
      (d ? '\n\n' + d : '\n\n内容未变化。');
  }
  function fListFiles(session) {
    ensureWorkspace(session);
    const names = Object.keys(session.files);
    if (!names.length) return '(工作区为空)';
    return names.map(n => n + '\t' + U.fmtSize(session.files[n].size)).join('\n');
  }
  function serviceName(name) {
    return U.truncate(String(name || '本地服务').replace(/\s+/g, ' ').trim(), 32) || '本地服务';
  }
  function findService(session, args) {
    ensureWorkspace(session);
    const key = String(args.service_id || args.id || args.name || '').trim();
    if (!key && session.services.length === 1) return session.services[0];
    return session.services.find(s => s.id === key || s.name === key);
  }
  function fCreateWorkspace(session, args) {
    ensureWorkspace(session);
    return '会话工作区已准备好。当前文件数：' + Object.keys(session.files).length +
      '，服务数：' + session.services.length + '。可以继续使用 write_file/read_file/list_files/run_service。';
  }
  function fRunService(session, args, ctx) {
    ensureWorkspace(session);
    const entry = safeName(args.entry || 'index.html');
    if (!session.files[entry]) throw new Error('入口文件不存在: ' + entry + '。请先 write_file 创建它。');
    let svc = findService(session, args);
    if (!svc) {
      if (session.services.length >= MAX_SERVICES) throw new Error('会话服务数已达上限');
      svc = { id: U.uuid(), name: serviceName(args.name), entry, status: 'stopped', createdAt: U.now(), updatedAt: U.now() };
      session.services.push(svc);
    }
    svc.name = serviceName(args.name || svc.name);
    svc.entry = entry;
    svc.status = 'running';
    svc.updatedAt = U.now();
    svc.lastStartedAt = U.now();
    if (ctx.openService) ctx.openService(svc.id);
    return '服务已启动：' + svc.name + '\n入口：' + svc.entry + '\n预览：wepchat://service/' + svc.id +
      '\n用户可以在会话工作区里停止、重新启动或进入预览。';
  }
  function fStopService(session, args) {
    const svc = findService(session, args);
    if (!svc) throw new Error('服务不存在');
    svc.status = 'stopped';
    svc.updatedAt = U.now();
    return '服务已停止：' + svc.name;
  }
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

  /* ---------- web_fetch ---------- */
  function webFetch(url) {
    return new Promise((resolve, reject) => {
      if (!/^https?:\/\//i.test(url)) return reject(new Error('仅支持 http/https 地址'));
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.timeout = 20000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 400) {
          let text = xhr.responseText || '';
          const ct = xhr.getResponseHeader('Content-Type') || '';
          if (/html/i.test(ct)) text = htmlToText(text);
          resolve(text.length > MAX_OUTPUT ? text.slice(0, MAX_OUTPUT) + '\n…[内容已截断]' : text);
        } else reject(new Error('HTTP ' + xhr.status));
      };
      xhr.onerror = () => reject(new Error('请求失败（可能是网络或跨域限制）'));
      xhr.ontimeout = () => reject(new Error('请求超时'));
      xhr.send();
    });
  }
  function htmlToText(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n').trim();
  }

  /* ---------- 工具声明（发送给模型的 schema） ---------- */
  const DEFS = [
    {
      name: 'run_js',
      description: '在隔离沙盒中执行 JavaScript 代码，用于精确计算、文本/JSON/CSV 处理、编码解码、正则提取等。无网络、无 DOM。用 console.log 输出，或在末尾 return 结果。',
      parameters: { type: 'object', properties: { code: { type: 'string', description: '要执行的 JavaScript 代码' } }, required: ['code'] }
    },
    {
      name: 'preview_html',
      description: '把 HTML/CSS/JS 渲染为可交互页面展示给用户（计算器、图表、小工具、demo 等）。用户可在预览面板查看效果、源码与控制台。',
      parameters: {
        type: 'object',
        properties: {
          html: { type: 'string', description: 'HTML 内容（可以是完整文档或 body 片段）' },
          css: { type: 'string', description: '可选，附加 CSS' },
          js: { type: 'string', description: '可选，附加 JavaScript' },
          title: { type: 'string', description: '可选，页面标题' }
        },
        required: ['html']
      }
    },
    {
      name: 'read_file',
      description: '读取当前会话工作区中的文本文件内容。',
      parameters: { type: 'object', properties: { path: { type: 'string', description: '文件名' } }, required: ['path'] }
    },
    {
      name: 'write_file',
      description: '把文本内容写入当前会话工作区（新建或覆盖）。',
      parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] }
    },
    {
      name: 'list_files',
      description: '列出当前会话工作区中的所有文件。',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'create_workspace',
      description: '确保当前会话拥有一个文件工作区。需要创建多文件 HTML/JS 小工具或服务前先调用它。',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'run_service',
      description: '把会话工作区中的 HTML 入口文件作为一个持续服务启动，并打开内置预览。适合多文件小网页、demo、工具应用。静态原型中运行在隔离 iframe；原生版可映射为本地 HTTP 服务。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '服务名称，例如 Todo Demo' },
          entry: { type: 'string', description: '入口 HTML 文件，默认 index.html' },
          service_id: { type: 'string', description: '可选，已有服务 id，用于重新启动或切换入口' }
        },
        required: ['entry']
      }
    },
    {
      name: 'stop_service',
      description: '停止当前会话工作区中的一个服务。',
      parameters: {
        type: 'object',
        properties: {
          service_id: { type: 'string', description: '服务 id' },
          name: { type: 'string', description: '服务名称；只有一个服务时可省略' }
        }
      }
    },
    {
      name: 'list_services',
      description: '列出当前会话工作区中的服务及运行状态。',
      parameters: { type: 'object', properties: {} }
    },
    {
      name: 'web_fetch',
      description: '抓取一个网页/接口的文本内容（GET）。HTML 会转为纯文本。需要用户授权。',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '完整的 http/https 地址' } }, required: ['url'] }
    }
  ];

  const SYSTEM_HINT = [
    '你可以使用以下工具：run_js（沙盒执行 JavaScript，适合精确计算、数据转换、编码解码）、preview_html（生成一次性可交互 HTML 页面）、create_workspace/read_file/write_file/list_files（当前会话的文件工作区）、run_service/stop_service/list_services（启动或管理工作区中的持续预览服务）、web_fetch(抓取网页文本)。',
    '简单问题直接回答；只在需要精确计算、验证、数据处理、生成可交互页面或操作文件时调用工具。',
    '制作单文件临时页面时可用 preview_html；制作多文件或需要持续预览的小应用时，先 create_workspace，再 write_file 写入 index.html/css/js，最后 run_service。',
    '不要在代码中包含任何 API Key 或用户隐私。'
  ].join('\n');

  /* ---------- 执行入口 ----------
   * ctx: { session, confirm(msg):Promise<bool>, openPreview(payload), webFetchMode }
   * 返回字符串（作为 tool result 回传给模型） */
  async function execute(name, argsJson, ctx) {
    let args = {};
    try { args = typeof argsJson === 'string' ? (argsJson.trim() ? JSON.parse(argsJson) : {}) : (argsJson || {}); }
    catch (e) { return '错误：工具参数不是有效 JSON - ' + e.message; }

    try {
      switch (name) {
        case 'run_js': {
          if (!args.code) return '错误：缺少 code 参数';
          const r = await runJS(args.code);
          let s = '';
          if (r.stdout) s += 'stdout:\n' + r.stdout + '\n';
          if (r.stderr) s += 'stderr:\n' + r.stderr + '\n';
          if (r.result !== undefined && r.result !== null && r.result !== '') s += 'return: ' + r.result;
          return s.trim() || '(执行完成，无输出)';
        }
        case 'preview_html': {
          ctx.openPreview({ html: args.html || '', css: args.css || '', js: args.js || '', title: args.title || 'HTML 预览' });
          return '已在预览面板向用户展示页面「' + (args.title || 'HTML 预览') + '」。';
        }
        case 'read_file': return fReadFile(ctx.session, args);
        case 'write_file': return fWriteFile(ctx.session, args);
        case 'list_files': return fListFiles(ctx.session);
        case 'create_workspace': return fCreateWorkspace(ctx.session, args);
        case 'run_service': return fRunService(ctx.session, args, ctx);
        case 'stop_service': return fStopService(ctx.session, args);
        case 'list_services': return fListServices(ctx.session);
        case 'web_fetch': {
          if (ctx.webFetchMode === 'never') return '错误：用户已禁止网络访问';
          if (ctx.webFetchMode !== 'always') {
            const ok = await ctx.confirm('AI 请求访问网页：\n' + U.truncate(args.url, 120) + '\n\n允许本次访问吗？');
            if (!ok) return '错误：用户拒绝了本次网络访问';
          }
          return await webFetch(args.url);
        }
        default: return '错误：未知工具 ' + name;
      }
    } catch (e) {
      return '错误：' + (e && e.message || String(e));
    }
  }

  return { DEFS, SYSTEM_HINT, execute, runJS, MAX_FILE, MAX_FILES, MAX_SERVICES };
})();

window.Tools = Tools;
