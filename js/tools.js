/* WepChat - Agent 工具集与 JS 沙盒
 * 工具：run_js / preview_html / read_file / write_file / list_files / web_fetch
 * 安全：Worker 隔离执行 + 超时熔断 + 输出截断；文件仅限当前会话工作区；网络需授权 */
'use strict';

const Tools = (() => {

  const MAX_OUTPUT = 16 * 1024;      // 工具输出上限（字符）
  const MAX_FILE = 512 * 1024;       // 单文件上限
  const MAX_FILES = 50;              // 会话文件数上限
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
  function fReadFile(session, args) {
    const name = safeName(args.path);
    const f = session.files[name];
    if (!f) throw new Error('文件不存在: ' + name + '。可用文件: ' + (Object.keys(session.files).join(', ') || '(空)'));
    if (f.dataUrl && !f.content) throw new Error('该文件是二进制文件，无法以文本读取');
    return f.content || '';
  }
  function fWriteFile(session, args) {
    const name = safeName(args.path);
    const content = String(args.content == null ? '' : args.content);
    if (content.length > MAX_FILE) throw new Error('内容超过 ' + U.fmtSize(MAX_FILE) + ' 上限');
    if (!session.files[name] && Object.keys(session.files).length >= MAX_FILES) throw new Error('会话文件数已达上限');
    session.files[name] = { content, mime: 'text/plain', size: content.length, mtime: U.now() };
    return '已写入 ' + name + '（' + U.fmtSize(content.length) + '）';
  }
  function fListFiles(session) {
    const names = Object.keys(session.files);
    if (!names.length) return '(工作区为空)';
    return names.map(n => n + '\t' + U.fmtSize(session.files[n].size)).join('\n');
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
      name: 'web_fetch',
      description: '抓取一个网页/接口的文本内容（GET）。HTML 会转为纯文本。需要用户授权。',
      parameters: { type: 'object', properties: { url: { type: 'string', description: '完整的 http/https 地址' } }, required: ['url'] }
    }
  ];

  const SYSTEM_HINT = [
    '你可以使用以下工具：run_js（沙盒执行 JavaScript，适合精确计算、数据转换、编码解码）、preview_html（生成可交互 HTML 页面展示给用户）、read_file/write_file/list_files（当前会话的文件工作区）、web_fetch(抓取网页文本)。',
    '简单问题直接回答；只在需要精确计算、验证、数据处理、生成可交互页面或操作文件时调用工具。',
    '不要在代码中包含任何 API Key 或用户隐私。制作页面类需求时优先调用 preview_html 而不是只贴代码。'
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

  return { DEFS, SYSTEM_HINT, execute, runJS, MAX_FILE, MAX_FILES };
})();

window.Tools = Tools;
