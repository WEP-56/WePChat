/* WepChat - Agent 工具集与 JS 沙盒
 * 工具：run_js / read_file / write_file / edit_file / delete_file / list_files / create_folder / move_path / path_exists / preview_file / web_fetch / image_go
 * 安全：Worker 隔离执行 + 超时熔断 + 输出截断；文件仅限当前会话工作区；网络需授权 */
'use strict';

const Tools = (() => {

  const MAX_OUTPUT = 16 * 1024;      // 工具输出上限（字符）
  const MAX_FILE = 512 * 1024;       // 单文件上限
  const MAX_FILES = 50;              // 会话文件数上限
  const MAX_SERVICES = 5;            // 会话服务数上限
  const JS_TIMEOUT = 8000;           // run_js 超时
  const RUN_JS_FS_LIMIT = 1024 * 1024;
  const WEB_FETCH_TIMEOUT = 20000;

  /* ---------- run_js：Worker 沙盒 ---------- */
  const WORKER_SRC = `
    self.onmessage = function (e) {
      var out = [], err = [];
      var LIMIT = ${MAX_OUTPUT};
      var inputFiles = e.data.files || {};
      var inputText = String(e.data.stdin == null ? '' : e.data.stdin);
      var inputArgs = Array.isArray(e.data.argv) ? e.data.argv.map(String) : [];
      var writtenFiles = {};
      var promptSeq = 0;
      var pendingPrompts = 0;
      var promptResolvers = {};
      self.onmessage = function (ev) {
        var msg = ev.data || {};
        if (msg.type !== 'prompt-response') return;
        var slot = promptResolvers[msg.id];
        if (!slot) return;
        delete promptResolvers[msg.id];
        pendingPrompts = Math.max(0, pendingPrompts - 1);
        if (msg.error) slot.reject(new Error(String(msg.error)));
        else slot.resolve(String(msg.value == null ? '' : msg.value));
      };
      function normalizePath(p) {
        p = String(p || '').trim().replace(/\\\\/g, '/').replace(/^\\/+/, '').replace(/\\/+/g, '/');
        if (p.indexOf('./') === 0) p = p.slice(2);
        p = p.split('/').filter(function (part) { return part && part !== '.'; }).join('/');
        return p;
      }
      function push(arr, args) {
        try {
          var s = Array.prototype.map.call(args, function (x) {
            if (typeof x === 'string') return x;
            try { return JSON.stringify(x, null, 0); } catch (_) { return String(x); }
          }).join(' ');
          arr.push(s.length > LIMIT ? s.slice(0, LIMIT) + '…[截断]' : s);
        } catch (_) {}
      }
      var SandboxFS = {
        readFile: function (path) {
          var name = normalizePath(path);
          if (!Object.prototype.hasOwnProperty.call(inputFiles, name)) {
            throw new Error('SandboxFS.readFile: 文件未提供、不是文本文件或超过挂载上限: ' + name);
          }
          return String(inputFiles[name] == null ? '' : inputFiles[name]);
        },
        writeFile: function (path, content) {
          var name = normalizePath(path);
          if (!name) throw new Error('SandboxFS.writeFile: 路径不能为空');
          writtenFiles[name] = String(content == null ? '' : content);
          return name;
        },
        listFiles: function () {
          return Object.keys(inputFiles).sort();
        }
      };
      console.log = console.info = console.debug = function () { push(out, arguments); };
      console.warn = console.error = function () { push(err, arguments); };
      function sandboxPrompt(question) {
        var id = 'p' + (++promptSeq);
        pendingPrompts++;
        self.postMessage({ type: 'prompt', id: id, question: String(question == null ? '' : question) });
        return new Promise(function (resolve, reject) {
          promptResolvers[id] = { resolve: resolve, reject: reject };
        });
      }
      function waitForInteractiveIdle() {
        return new Promise(function (resolve) {
          var quiet = 0;
          function check() {
            if (pendingPrompts > 0) {
              quiet = 0;
              setTimeout(check, 25);
              return;
            }
            quiet++;
            if (quiet >= 2) resolve();
            else setTimeout(check, 25);
          }
          check();
        });
      }
      /* 屏蔽网络与外部加载 */
      self.fetch = undefined; self.XMLHttpRequest = undefined;
      self.importScripts = undefined; self.WebSocket = undefined;
      self.input = inputText; self.stdin = inputText; self.argv = inputArgs;
      self.prompt = sandboxPrompt;
      Promise.resolve().then(function () {
        var fn = new Function('SandboxFS', 'prompt', '"use strict";' + e.data.code);
        return fn(SandboxFS, sandboxPrompt);
      }).then(function (result) {
        return Promise.resolve(result).then(function (value) {
          return waitForInteractiveIdle().then(function () { return value; });
        });
      }).then(function (result) {
        var r;
        if (result !== undefined) {
          try { r = JSON.stringify(result, null, 2); } catch (_) { r = String(result); }
          if (r && r.length > LIMIT) r = r.slice(0, LIMIT) + '…[截断]';
        }
        self.postMessage({ ok: true, stdout: out.join('\\n'), stderr: err.join('\\n'), result: r, files: writtenFiles });
      }).catch(function (ex) {
        err.push(String(ex && ex.stack || ex));
        self.postMessage({ ok: false, stdout: out.join('\\n'), stderr: err.join('\\n'), files: writtenFiles });
      });
    };
  `;

  function parseArgv(text) {
    const out = [];
    String(text || '').replace(/"([^"]*)"|'([^']*)'|[^\s]+/g, (m, d, s) => {
      out.push(d != null ? d : (s != null ? s : m));
      return m;
    });
    return out;
  }

  function runOptions(options) {
    options = options || {};
    const stdin = String(options.stdin == null ? '' : options.stdin);
    return {
      stdin,
      argv: Array.isArray(options.argv) ? options.argv.map(String) : parseArgv(stdin),
      onPrompt: typeof options.onPrompt === 'function' ? options.onPrompt : null
    };
  }

  function runJS(code, timeout, files, options) {
    const opts = runOptions(options);
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
        if (opts.onPrompt) return finish({ ok: false, stdout: '', stderr: '当前环境不支持交互输入：Worker 不可用', files: {} });
        return finish(runJSInline(code, files, opts)); // Worker 不可用时降级（无硬超时）
      }
      timer = setTimeout(() => finish({ ok: false, stdout: '', stderr: '执行超时（' + ((timeout || JS_TIMEOUT) / 1000) + 's），已中断', files: {} }), timeout || JS_TIMEOUT);
      worker.onmessage = e => {
        const data = e.data || {};
        if (data.type === 'prompt') {
          if (!opts.onPrompt) {
            worker.postMessage({ type: 'prompt-response', id: data.id, error: '当前环境不支持交互输入' });
            return;
          }
          Promise.resolve()
            .then(() => opts.onPrompt(String(data.question || '')))
            .then(value => worker.postMessage({ type: 'prompt-response', id: data.id, value: String(value == null ? '' : value) }))
            .catch(ex => worker.postMessage({ type: 'prompt-response', id: data.id, error: ex && ex.message || String(ex) }));
          return;
        }
        finish(data);
      };
      worker.onerror = e => finish({ ok: false, stdout: '', stderr: String(e.message || '执行出错'), files: {} });
      worker.postMessage({ code, files: files || {}, stdin: opts.stdin, argv: opts.argv });
    });
  }

  /* 降级方案：主线程独立作用域执行（仍捕获 console，但无法强杀死循环） */
  function runJSInline(code, files, options) {
    const opts = runOptions(options);
    const out = [], err = [], writtenFiles = {};
    const fake = {};
    ['log', 'info', 'debug'].forEach(k => fake[k] = (...a) => out.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')));
    ['warn', 'error'].forEach(k => fake[k] = (...a) => err.push(a.map(String).join(' ')));
    const normalize = p => String(p || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/').replace(/^\.\//, '');
    const sandboxFS = {
      readFile(path) {
        const name = normalize(path);
        if (!Object.prototype.hasOwnProperty.call(files || {}, name)) throw new Error('SandboxFS.readFile: 文件未提供、不是文本文件或超过挂载上限: ' + name);
        return String(files[name] == null ? '' : files[name]);
      },
      writeFile(path, content) {
        const name = normalize(path);
        if (!name) throw new Error('SandboxFS.writeFile: 路径不能为空');
        writtenFiles[name] = String(content == null ? '' : content);
        return name;
      },
      listFiles() {
        return Object.keys(files || {}).sort();
      }
    };
    const globalNames = ['input', 'stdin', 'argv'];
    const previousGlobals = globalNames.map(name => ({
      name,
      had: Object.prototype.hasOwnProperty.call(globalThis, name),
      value: globalThis[name]
    }));
    try {
      globalThis.input = opts.stdin;
      globalThis.stdin = opts.stdin;
      globalThis.argv = opts.argv;
      const fn = new Function('console', 'fetch', 'XMLHttpRequest', 'plus', 'localStorage', 'document', 'window', 'SandboxFS', '"use strict";' + code);
      const result = fn(fake, undefined, undefined, undefined, undefined, undefined, undefined, sandboxFS);
      let r;
      if (result !== undefined) { try { r = JSON.stringify(result, null, 2); } catch (e) { r = String(result); } }
      return { ok: true, stdout: out.join('\n'), stderr: err.join('\n'), result: r, files: writtenFiles };
    } catch (ex) {
      err.push(String(ex));
      return { ok: false, stdout: out.join('\n'), stderr: err.join('\n'), files: writtenFiles };
    } finally {
      previousGlobals.forEach(item => {
        if (item.had) globalThis[item.name] = item.value;
        else {
          try { delete globalThis[item.name]; } catch (e) {}
        }
      });
    }
  }

  /* ---------- 文件工作区 ---------- */
  function safeName(p, opts) {
    opts = opts || {};
    p = String(p || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
    if (p.indexOf('./') === 0) p = p.slice(2);
    if (p.endsWith('/')) p = p.slice(0, -1);
    const parts = p.split('/').filter(part => part && part !== '.');
    if (!parts.length) {
      if (opts.allowEmpty) return '';
      throw new Error('非法路径: ' + p);
    }
    parts.forEach(part => {
      if (part === '..' || /[\x00-\x1f]/.test(part)) throw new Error('非法路径: ' + p);
    });
    p = parts.join('/');
    if (p.length > 180) throw new Error('路径过长: ' + p);
    return p;
  }
  function ensureWorkspace(session) {
    session.files = session.files || {};
    session.folders = Array.isArray(session.folders) ? session.folders : [];
    session.services = Array.isArray(session.services) ? session.services : [];
  }
  function ensureParentFolders(session, path) {
    session.folders = Array.isArray(session.folders) ? session.folders : [];
    const parts = String(path || '').split('/');
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      if (folder && !session.folders.includes(folder)) session.folders.push(folder);
    }
  }
  function collectFolders(session) {
    ensureWorkspace(session);
    const out = new Set();
    (session.folders || []).forEach(path => {
      try {
        const p = safeName(path, { allowEmpty: true });
        if (p) out.add(p);
      } catch (e) {}
    });
    Object.keys(session.files || {}).forEach(name => {
      try {
        const parts = safeName(name).split('/');
        for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'));
      } catch (e) {}
    });
    return out;
  }
  function textMime(name) {
    if (/\.html?$/i.test(name)) return 'text/html';
    if (/\.css$/i.test(name)) return 'text/css';
    if (/\.m?js$/i.test(name)) return 'text/javascript';
    if (/\.json$/i.test(name)) return 'application/json';
    if (/\.md$/i.test(name)) return 'text/markdown';
    if (/\.csv$/i.test(name)) return 'text/csv';
    return 'text/plain';
  }
  function isTextFile(f) {
    return !!f && !f.dataUrl && typeof f.content === 'string';
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
  function fileHead(content) {
    const head = String(content || '').slice(0, 200);
    return head || '(空文件)';
  }
  function notFoundError(before) {
    return new Error('未找到匹配内容，当前文件前 200 字符为：\n' + fileHead(before));
  }
  function parseLineRange(spec, total) {
    const s = String(spec == null ? '' : spec).trim();
    if (!s) return null;
    let m;
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      return [n, n];
    }
    if ((m = s.match(/^(\d*)-(\d*)$/))) {
      if (!m[1] && !m[2]) throw new Error('lines 参数格式错误，示例：1-20、1-、-30');
      if (!m[1]) {
        const count = parseInt(m[2], 10);
        return [Math.max(1, total - count + 1), total];
      }
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : total;
      return [start, end];
    }
    throw new Error('lines 参数格式错误，示例：1-20、50-80、1-、-30');
  }
  function readLines(content, lines) {
    const arr = String(content || '').split(/\r?\n/);
    const range = parseLineRange(lines, arr.length);
    if (!range) return content;
    const start = Math.max(1, range[0]);
    const end = Math.min(arr.length, Math.max(start, range[1]));
    return arr.slice(start - 1, end).join('\n');
  }
  function regexReplace(before, find, replace, args) {
    let flags = String(args.flags || args.regexFlags || '').replace(/[^gimsuy]/g, '');
    flags = flags.replace(/g/g, '');
    if (args.all) flags += 'g';
    let re;
    try { re = new RegExp(find, flags); }
    catch (e) { throw new Error('正则表达式无效: ' + e.message); }
    if (!re.test(before)) throw notFoundError(before);
    re.lastIndex = 0;
    return before.replace(re, replace);
  }
  function whitespaceIndex(text) {
    const chars = [], map = [];
    String(text || '').split('').forEach((ch, i) => {
      if (!/\s/.test(ch)) {
        chars.push(ch);
        map.push(i);
      }
    });
    return { text: chars.join(''), map };
  }
  function replaceIgnoringWhitespace(before, find, replace, all) {
    const hay = whitespaceIndex(before);
    const needle = String(find || '').replace(/\s+/g, '');
    if (!needle) throw new Error('ignoreWhitespace 模式下 find 不能只包含空白字符');
    const spans = [];
    let pos = 0;
    while (pos <= hay.text.length) {
      const idx = hay.text.indexOf(needle, pos);
      if (idx < 0) break;
      spans.push([hay.map[idx], hay.map[idx + needle.length - 1] + 1]);
      if (!all) break;
      pos = idx + Math.max(needle.length, 1);
    }
    if (!spans.length) throw notFoundError(before);
    let out = '', last = 0;
    spans.forEach(span => {
      out += before.slice(last, span[0]) + replace;
      last = span[1];
    });
    return out + before.slice(last);
  }
  function openHtmlPreview(session, entry, args, ctx) {
    if (!ctx || !ctx.openService) return '预览未打开：当前环境没有预览面板。';
    if (!/\.html?$/i.test(entry)) return '预览未打开：preview 仅支持 HTML 文件。';
    let svc = (session.services || []).find(s => s.entry === entry);
    if (!svc) {
      if (session.services.length >= MAX_SERVICES) throw new Error('会话静态预览数已达上限');
      svc = { id: U.uuid(), name: serviceName(args.title || entry), entry, status: 'stopped', createdAt: U.now(), updatedAt: U.now() };
      session.services.push(svc);
    }
    svc.name = serviceName(args.title || svc.name || entry);
    svc.entry = entry;
    svc.status = 'running';
    svc.updatedAt = U.now();
    svc.lastStartedAt = U.now();
    if (ctx.createPreviewCard) {
      return ctx.createPreviewCard({
        serviceId: svc.id,
        entry: svc.entry,
        title: svc.name,
        updatedAt: svc.updatedAt
      });
    }
    if (ctx.openService) ctx.openService(svc.id);
    return '已打开 HTML 预览：' + entry + '（wepchat://service/' + svc.id + '）';
  }
  function fPreviewFile(session, args, ctx) {
    ensureWorkspace(session);
    const name = safeName(args.path || args.entry || 'index.html');
    if (!session.files[name]) throw new Error('文件不存在: ' + name + '。请先用 write_file 创建它。');
    if (/\.m?js$/i.test(name)) {
      if (!ctx || !ctx.createPreviewCard) return 'JS 运行卡片未生成：当前界面不支持卡片。';
      return ctx.createPreviewCard({
        entry: name,
        title: args.title || name,
        kind: 'js'
      });
    }
    if (!/\.html?$/i.test(name)) throw new Error('preview_file 只能用于 HTML 或 JS 文件: ' + name);
    return openHtmlPreview(session, name, args, ctx);
  }
  function fReadFile(session, args) {
    ensureWorkspace(session);
    const name = safeName(args.path);
    const f = session.files[name];
    if (!f) throw new Error('文件不存在: ' + name + '。可用文件: ' + (Object.keys(session.files).join(', ') || '(空)'));
    if (f.dataUrl && !f.content) throw new Error('该文件是二进制文件，无法以文本读取');
    return readLines(f.content || '', args.lines);
  }
  function fWriteFile(session, args) {
    ensureWorkspace(session);
    const name = safeName(args.path);
    const content = String(args.content == null ? '' : args.content);
    if (content.length > MAX_FILE) throw new Error('内容超过 ' + U.fmtSize(MAX_FILE) + ' 上限');
    if (!session.files[name] && Object.keys(session.files).length >= MAX_FILES) throw new Error('会话文件数已达上限');
    const before = session.files[name] && session.files[name].content || '';
    const existed = !!session.files[name];
    ensureParentFolders(session, name);
    session.files[name] = { content, mime: args.mime || textMime(name), size: content.length, mtime: U.now() };
    const d = diffText(name, before, content);
    return (existed ? '已更新 ' : '已创建 ') + name + '（' + U.fmtSize(content.length) + '）' +
      (d ? '\n\n' + d : '\n\n内容未变化。');
  }
  function fEditFile(session, args) {
    ensureWorkspace(session);
    const name = safeName(args.path);
    const f = session.files[name];
    if (!f) throw new Error('文件不存在: ' + name + '。请先 list_files 或 write_file。');
    if (f.dataUrl && !f.content) throw new Error('该文件是二进制文件，无法以文本修改');
    const find = String(args.find == null ? '' : args.find);
    const replace = String(args.replace == null ? '' : args.replace);
    if (!find) throw new Error('缺少 find 参数');
    if (args.useRegex && args.ignoreWhitespace) throw new Error('useRegex 和 ignoreWhitespace 不能同时使用，请二选一');
    const before = String(f.content || '');
    let after;
    if (args.useRegex) after = regexReplace(before, find, replace, args);
    else if (args.ignoreWhitespace) after = replaceIgnoringWhitespace(before, find, replace, !!args.all);
    else {
      if (!before.includes(find)) throw notFoundError(before);
      after = args.all ? before.split(find).join(replace) : before.replace(find, replace);
    }
    if (after.length > MAX_FILE) throw new Error('内容超过 ' + U.fmtSize(MAX_FILE) + ' 上限');
    f.content = after;
    f.size = after.length;
    f.mtime = U.now();
    f.mime = f.mime || textMime(name);
    const mode = args.useRegex ? '正则' : (args.ignoreWhitespace ? '忽略空白' : '精确');
    return '已修改 ' + name + '（' + mode + '，' + (args.all ? '全部匹配' : '首个匹配') + '）\n\n' + diffText(name, before, after);
  }
  function fCreateFolder(session, args) {
    ensureWorkspace(session);
    const path = safeName(args.path);
    if (session.files[path]) throw new Error('同名文件已存在，不能创建文件夹: ' + path);
    ensureParentFolders(session, path);
    if (!session.folders.includes(path)) session.folders.push(path);
    return '已创建文件夹 ' + path;
  }
  function deleteOnePath(session, rawPath, deletedFiles, deletedFolders, missing) {
    const name = safeName(rawPath);
    const prefix = name + '/';
    const folders = collectFolders(session);
    let found = false;
    if (session.files[name]) {
      delete session.files[name];
      deletedFiles.add(name);
      found = true;
    }
    Object.keys(session.files || {}).forEach(path => {
      if (path.startsWith(prefix)) {
        delete session.files[path];
        deletedFiles.add(path);
        found = true;
      }
    });
    if (folders.has(name)) {
      deletedFolders.add(name);
      found = true;
    }
    folders.forEach(path => {
      if (path.startsWith(prefix)) {
        deletedFolders.add(path);
        found = true;
      }
    });
    session.folders = (session.folders || []).filter(path => path !== name && !path.startsWith(prefix));
    if (!found) missing.push(name);
  }
  function fDeleteFile(session, args) {
    ensureWorkspace(session);
    const input = Array.isArray(args.paths) ? args.paths : [args.path];
    const paths = input.map(x => String(x || '').trim()).filter(Boolean);
    if (!paths.length) throw new Error('缺少 path 或 paths 参数');
    if (paths.length > 50) throw new Error('单次最多删除 50 个路径');
    const deletedFiles = new Set(), deletedFolders = new Set(), missing = [];
    paths.forEach(path => deleteOnePath(session, path, deletedFiles, deletedFolders, missing));
    if (!deletedFiles.size && !deletedFolders.size) throw new Error('未找到可删除路径: ' + missing.join(', '));
    const lines = ['已删除 ' + deletedFiles.size + ' 个文件、' + deletedFolders.size + ' 个文件夹。'];
    if (deletedFolders.size) lines.push('文件夹：' + Array.from(deletedFolders).sort().join(', '));
    if (deletedFiles.size) lines.push('文件：' + Array.from(deletedFiles).sort().join(', '));
    if (missing.length) lines.push('未找到：' + missing.join(', '));
    return lines.join('\n');
  }
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
  function fPathExists(session, args) {
    ensureWorkspace(session);
    const path = safeName(args.path);
    if (session.files[path]) {
      const f = session.files[path];
      return JSON.stringify({ path, exists: true, type: 'file', size: f.size || 0, mime: f.mime || textMime(path) }, null, 2);
    }
    const folders = collectFolders(session);
    if (folders.has(path) || Object.keys(session.files || {}).some(name => name.startsWith(path + '/'))) {
      const prefix = path + '/';
      return JSON.stringify({
        path,
        exists: true,
        type: 'folder',
        files: Object.keys(session.files || {}).filter(name => name.startsWith(prefix)).length,
        folders: Array.from(folders).filter(name => name.startsWith(prefix)).length
      }, null, 2);
    }
    return JSON.stringify({ path, exists: false, type: 'missing' }, null, 2);
  }
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
      '。这个工作区默认存在，可以继续使用 write_file/read_file/edit_file/delete_file/list_files/create_folder/move_path/path_exists。';
  }
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
  function fStopService(session, args) {
    const svc = findService(session, args);
    if (!svc) throw new Error('静态预览不存在');
    svc.status = 'stopped';
    svc.updatedAt = U.now();
    return '静态预览已停止：' + svc.name;
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

  function buildSandboxFiles(session, inputFiles) {
    ensureWorkspace(session);
    const files = {};
    let total = 0;
    const notes = [];
    const add = (alias, path) => {
      const src = safeName(path || alias);
      const key = safeName(alias || src);
      const f = session.files[src];
      if (!f) throw new Error('run_js inputFiles 文件不存在: ' + src);
      if (!isTextFile(f)) throw new Error('run_js inputFiles 只能挂载文本文件: ' + src);
      const content = String(f.content || '');
      total += content.length;
      if (total > RUN_JS_FS_LIMIT) throw new Error('run_js 挂载文件超过 ' + U.fmtSize(RUN_JS_FS_LIMIT) + ' 上限，请减少 inputFiles');
      files[key] = content;
      files[src] = content;
    };
    if (inputFiles && typeof inputFiles === 'object') {
      if (Array.isArray(inputFiles)) inputFiles.forEach(path => add(path, path));
      else Object.keys(inputFiles).forEach(alias => add(alias, inputFiles[alias] || alias));
    }
    return { files, notes };
  }
  function applySandboxWrites(session, writes) {
    ensureWorkspace(session);
    const saved = [];
    Object.keys(writes || {}).forEach(rawPath => {
      const path = safeName(rawPath);
      const content = String(writes[rawPath] == null ? '' : writes[rawPath]);
      if (content.length > MAX_FILE) throw new Error('SandboxFS.writeFile 内容超过 ' + U.fmtSize(MAX_FILE) + ' 上限: ' + path);
      if (!session.files[path] && Object.keys(session.files).length >= MAX_FILES) throw new Error('会话文件数已达上限');
      ensureParentFolders(session, path);
      session.files[path] = { content, mime: textMime(path), size: content.length, mtime: U.now() };
      saved.push(path);
    });
    return saved;
  }

  function extendSandboxFiles(sandbox, extraFiles) {
    if (!extraFiles || typeof extraFiles !== 'object') return sandbox;
    let total = Object.keys(sandbox.files || {}).reduce((sum, key) => sum + String(sandbox.files[key] || '').length, 0);
    Object.keys(extraFiles).forEach(alias => {
      const key = safeName(alias);
      const content = String(extraFiles[alias] == null ? '' : extraFiles[alias]);
      total += content.length;
      if (total > RUN_JS_FS_LIMIT) throw new Error('run_js 挂载文件超过 ' + U.fmtSize(RUN_JS_FS_LIMIT) + ' 上限，请减少 inputFiles');
      sandbox.files[key] = content;
    });
    return sandbox;
  }

  async function runWorkspaceJS(session, options) {
    options = options || {};
    const sandbox = extendSandboxFiles(buildSandboxFiles(session, options.inputFiles), options.files);
    const r = await runJS(options.code || '', options.timeout || JS_TIMEOUT, sandbox.files, {
      stdin: options.stdin || '',
      argv: options.argv,
      onPrompt: options.onPrompt
    });
    const saved = r.ok ? applySandboxWrites(session, r.files) : [];
    return Object.assign({}, r, {
      saved,
      notes: sandbox.notes || [],
      skippedWrites: !r.ok && r.files && Object.keys(r.files).length ? Object.keys(r.files) : []
    });
  }

  /* ---------- web_fetch ---------- */
  function normalizeMethod(method) {
    method = String(method || 'GET').trim().toUpperCase();
    if (!method) method = 'GET';
    if (!['GET', 'POST'].includes(method)) throw new Error('web_fetch 仅支持 GET/POST，当前 method=' + method);
    return method;
  }
  function buildRequestBody(args, headers) {
    if (args.json !== undefined) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      return JSON.stringify(args.json);
    }
    if (args.formData && typeof args.formData === 'object') {
      const fd = new FormData();
      Object.keys(args.formData).forEach(k => fd.append(k, args.formData[k]));
      return fd;
    }
    if (args.body !== undefined) return String(args.body);
    return null;
  }
  function headerString(xhr) {
    try { return xhr.getAllResponseHeaders() || ''; }
    catch (e) { return ''; }
  }
  function webFetch(args) {
    return new Promise((resolve, reject) => {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return reject(new Error('Invalid URL: 仅支持 http/https 地址'));
      let method;
      try { method = normalizeMethod(args.method); }
      catch (e) { return reject(e); }
      const headers = Object.assign({}, args.headers || {});
      const body = buildRequestBody(args, headers);
      if (method === 'GET' && body != null) return reject(new Error('GET 请求不能携带 body/json/formData；如需提交数据请使用 method: "POST"'));
      const xhr = new XMLHttpRequest();
      const started = Date.now();
      xhr.open(method, url, true);
      xhr.timeout = U.clamp(parseInt(args.timeoutMs || WEB_FETCH_TIMEOUT, 10) || WEB_FETCH_TIMEOUT, 3000, 60000);
      Object.keys(headers).forEach(k => {
        try { xhr.setRequestHeader(k, headers[k]); } catch (e) {}
      });
      xhr.onload = () => {
        const elapsed = Date.now() - started;
        const ct = xhr.getResponseHeader('Content-Type') || '';
        let text = xhr.responseText || '';
        const rawText = text;
        if (/html/i.test(ct)) text = htmlToText(text);
        if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n…[内容已截断]';
        const meta = [
          'HTTP ' + xhr.status + (xhr.statusText ? ' ' + xhr.statusText : ''),
          'URL: ' + url,
          'Method: ' + method,
          'Time: ' + elapsed + 'ms',
          'Content-Type: ' + (ct || '(unknown)')
        ].join('\n');
        if (xhr.status >= 200 && xhr.status < 400) {
          resolve(meta + '\n\n' + (text || '[空响应体]'));
        } else {
          const detail = (rawText || '').slice(0, 1200);
          reject(new Error('HTTP error ' + xhr.status + (xhr.statusText ? ' ' + xhr.statusText : '') +
            '\nURL: ' + url + '\nMethod: ' + method + '\nContent-Type: ' + (ct || '(unknown)') +
            (detail ? '\nResponse body:\n' + detail : '\nResponse body: [空]')));
        }
      };
      xhr.onerror = () => reject(new Error('Blocked by CORS or network error\nURL: ' + url + '\nMethod: ' + method + '\n说明：浏览器安全模型不会暴露 DNS/TLS/CORS 的精确原因。'));
      xhr.ontimeout = () => reject(new Error('Connection timeout after ' + xhr.timeout + 'ms\nURL: ' + url + '\nMethod: ' + method));
      xhr.onabort = () => reject(new Error('Request aborted\nURL: ' + url + '\nMethod: ' + method));
      xhr.send(method === 'GET' ? null : body);
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
      description: '在隔离沙盒中执行 JavaScript 代码，用于精确计算、文本/JSON/CSV 处理、编码解码、正则提取等。无网络、无 DOM。需要读取工作区文件时，必须先用 list_files 确认路径，再用 inputFiles 显式挂载；沙盒内只能用 SandboxFS 访问本次挂载的文本文件。可用 SandboxFS.writeFile(path, content) 在脚本成功结束后直接写回工作区文本文件。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '要执行的 JavaScript 代码。用 console.log 输出，或在末尾 return 结果。' },
          inputFiles: {
            type: 'object',
            description: '可选，显式挂载到 SandboxFS 的工作区文本文件。键是沙盒内路径，值是工作区路径，例如 {"data.json":"./data.json"}。省略时 SandboxFS.listFiles() 为空，readFile 不能读取工作区文件。',
            additionalProperties: { type: 'string' }
          }
        },
        required: ['code']
      }
    },
    {
      name: 'read_file',
      description: '读取当前会话工作区中的文本文件内容。路径可以包含文件夹，例如 demo/index.html。可用 lines 读取片段，避免大文件一次性读完。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '工作区文件路径' },
          lines: { type: 'string', description: '可选行号范围：1-20、50-80、1-、-30，省略则读取全文' }
        },
        required: ['path']
      }
    },
    {
      name: 'write_file',
      description: '把文本内容写入当前会话工作区（新建或覆盖）。生成 HTML/CSS/JS/Markdown/JSON 等文件时优先使用它，而不是把完整代码直接输出在聊天正文里。需要给用户展示 HTML 或可运行 JS 时，先写入文件，再调用 preview_file 生成对话内卡片。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '工作区文件路径，例如 index.html 或 demo/app.js' },
          content: { type: 'string', description: '完整文件内容' },
          mime: { type: 'string', description: '可选 MIME 类型' }
        },
        required: ['path', 'content']
      }
    },
    {
      name: 'edit_file',
      description: '修改当前会话工作区中的已有文本文件。先 read_file 获取最新内容，再用 find/replace 做小范围改动。默认精确匹配；匹配失败会返回文件前 200 字符帮助修正。可传 useRegex: true 使用正则，或 ignoreWhitespace: true 忽略空白差异。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '工作区文件路径' },
          find: { type: 'string', description: '要查找的原文片段。默认必须精确匹配；useRegex 为 true 时是 JavaScript 正则表达式；ignoreWhitespace 为 true 时会忽略空格、制表和换行差异。' },
          replace: { type: 'string', description: '替换后的文本' },
          all: { type: 'boolean', description: '是否替换全部匹配，默认 false' },
          useRegex: { type: 'boolean', description: '可选，true 时按 JavaScript 正则表达式匹配 find' },
          regexFlags: { type: 'string', description: '可选正则 flags，例如 i、m、s。all 为 true 时会自动使用 g。' },
          ignoreWhitespace: { type: 'boolean', description: '可选，true 时忽略 find 与文件内容之间的空白差异，适合缩进或换行不确定的小改动。不要和 useRegex 同时使用。' }
        },
        required: ['path', 'find', 'replace']
      }
    },
    {
      name: 'delete_file',
      description: '删除当前会话工作区中的文件或文件夹。支持 path 删除单个路径，或 paths 批量删除多个文件/文件夹。删除文件夹会级联删除内部文件。这个工具总是需要用户确认或被禁止，不提供静默永久允许。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要删除的工作区文件或文件夹路径' },
          paths: { type: 'array', items: { type: 'string' }, description: '可选，批量删除路径列表。传 paths 时可省略 path。' }
        }
      }
    },
    {
      name: 'list_files',
      description: '列出当前会话工作区中的文件和文件夹，返回树状结构，区分 [dir] 与 [file]。可指定 path 查看某个文件夹，可传 recursive: false 只看直属子项。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '可选，工作区文件夹路径。省略表示工作区根目录。' },
          recursive: { type: 'boolean', description: '可选，是否递归列出子目录，默认 true。false 只列出当前目录直属内容。' }
        }
      }
    },
    {
      name: 'create_folder',
      description: '在当前会话工作区中显式创建空文件夹。适合先搭目录结构，再写入文件。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '要创建的文件夹路径，例如 demo/assets' } },
        required: ['path']
      }
    },
    {
      name: 'move_path',
      description: '移动或重命名当前会话工作区中的文件或文件夹。移动文件夹会连同内部文件一起移动。',
      parameters: {
        type: 'object',
        properties: {
          from: { type: 'string', description: '源文件或文件夹路径' },
          to: { type: 'string', description: '目标文件或文件夹路径' },
          overwrite: { type: 'boolean', description: '目标已存在时是否覆盖/合并，默认 false' }
        },
        required: ['from', 'to']
      }
    },
    {
      name: 'path_exists',
      description: '检查当前会话工作区中某个文件或文件夹是否存在，返回 JSON，包括 type=file/folder/missing。',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string', description: '要检查的工作区路径' } },
        required: ['path']
      }
    },
    {
      name: 'preview_file',
      description: '为当前会话工作区中已有的 HTML 或 JS 文件生成对话内卡片。HTML 卡片是静态缩略预览，用户点击后进入完整 HTML 预览；JS 卡片是运行入口，用户点击后进入代码与终端运行器，不会自动执行。只能用于 .html/.htm/.js/.mjs 文件；不要用于 CSS/JSON/Markdown。写多页 HTML 项目时通常只预览入口页，例如 index.html。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '要展示的工作区文件路径，例如 index.html、demo/index.html 或 tools/sum.js。仅支持 HTML 或 JS 文件' },
          title: { type: 'string', description: '可选，卡片名称' }
        },
        required: ['path']
      }
    },
    {
      name: 'web_fetch',
      description: '抓取网页/接口文本内容。支持 GET 和 POST；HTML 会转为纯文本；成功结果包含 HTTP 状态码、耗时、Content-Type。POST 会额外请求用户确认。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '完整的 http/https 地址' },
          method: { type: 'string', enum: ['GET', 'POST'], description: '请求方法，默认 GET' },
          headers: { type: 'object', description: '可选请求头', additionalProperties: { type: 'string' } },
          body: { type: 'string', description: '可选 POST 原始请求体' },
          json: { description: '可选 POST JSON 请求体；传入后会自动设置 Content-Type: application/json' },
          formData: { type: 'object', description: '可选 POST 表单字段', additionalProperties: { type: 'string' } },
          timeoutMs: { type: 'integer', description: '可选超时时间，3000 到 60000 毫秒，默认 20000' }
        },
        required: ['url']
      }
    },
    {
      name: 'image_go',
      description: '当用户明确想生成或改图时，整理用户意图并交给图片模型。没有参考图时用 generate；用户上传/提到工作区图片并要求修改时用 edit，并把图片工作区路径填入 referenceFiles。不要用于单纯图片分析或提示词建议。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '完整图片提示词，保留用户关键要求并补充必要视觉细节' },
          mode: { type: 'string', enum: ['generate', 'edit'], description: 'generate 文生图；edit 基于 referenceFiles 中的工作区图片调用 /v1/images/edits。' },
          size: { type: 'string', description: '图片尺寸。优先使用明确尺寸，例如 1024x1024、1024x1536、1536x1024、1536x864、864x1536、2048x2048、2560x1440、1440x2560、3840x2160、2160x3840、2880x2880。未知时可以省略；只有用户明确要求自动尺寸时才传 auto。' },
          count: { type: 'integer', description: '生成数量，通常 1' },
          style: { type: 'string', description: '可选风格，例如 克制、写实、图标、海报、UI mockup' },
          referenceFiles: { type: 'array', items: { type: 'string' }, description: 'edit 时必填，当前工作区中的参考图片路径，例如 attachments/photo.png 或 images/result.png' },
          targetFile: { type: 'string', description: '可选，期望保存到工作区的文件名或路径' },
          reason: { type: 'string', description: '为什么判断需要生图' }
        },
        required: ['prompt']
      }
    }
  ];

  const SYSTEM_HINT = [
    '当前对话默认拥有一个“工作区”，可以保存 HTML、CSS、JavaScript、Markdown、JSON、图片等文件。用户可以在工作区里打开文件、预览 HTML/Markdown、编辑源码、查看控制台并导出文件。',
    '你可以使用以下工具：run_js（沙盒执行 JavaScript，适合精确计算、数据转换、编码解码；需要文件时必须用 inputFiles 显式挂载；可用 SandboxFS.writeFile 写回工作区文本文件）、read_file/write_file/edit_file/delete_file/list_files/create_folder/move_path/path_exists/preview_file（当前会话工作区文件和文件夹）、web_fetch（GET/POST 抓取网页或接口文本）、image_go（用户明确需要生成或编辑位图时调用图片模型；有参考图片路径时用 edit，无参考图时用 generate）。',
    '简单问题直接回答；只在需要精确计算、验证、数据处理、生成可交互页面、访问网页或操作文件时调用工具。',
    '当用户要你写网页、小工具、代码示例、临时项目或需要多文件协作时，优先把代码写入工作区文件，例如 index.html、style.css、script.js；不要把大段完整代码只堆在聊天正文里。',
    '查看工作区文件列表时只用 list_files。run_js 里的 SandboxFS.listFiles() 只列出本次 inputFiles 挂载进沙盒的文件，不等于工作区文件列表。',
    '需要展示 HTML 时，先用 write_file 写入 .html 文件，再调用 preview_file 生成对话内预览卡片；用户点击卡片后才会进入完整 HTML 预览。需要展示可运行的 JS 脚本时，先用 write_file 写入 .js/.mjs 文件，再调用 preview_file 生成 JS 运行卡片；用户点击卡片后进入代码与终端运行器，仍需用户手动点击运行。preview_file 不要用于 CSS/JSON/Markdown。多页 HTML 项目通常只预览入口页，例如 index.html。',
    '可以编写可交互的 JavaScript 脚本，但运行环境是浏览器 Worker 沙盒，不是 Node.js。可用 console.log/warn/error 输出；可用 async/await；可用 prompt(question) 请求用户在终端输入；可用 SandboxFS.readFile 读取 inputFiles 挂载的文本文件；可用 SandboxFS.writeFile 写回工作区文本文件。不要依赖 Node.js API，例如 require、process、fs、readline、Buffer、child_process，也不要依赖 DOM、document、window、localStorage、fetch、XMLHttpRequest、WebSocket 或 importScripts。',
    'JS 运行器适合一次性脚本、文本处理、编码转换、小计算器、文件转换、纯文本问答或纯文本回合制逻辑。不适合按钮界面、画面游戏、Canvas/DOM UI、键盘鼠标事件、动画、长期游戏循环、网络应用或需要 npm/Node 依赖的程序；这类需求应写成 HTML/CSS/JS 页面并用 HTML 预览卡片展示。',
    '写交互式 JS 后，回复用户时说明：点击对话里的 JS 运行卡片或在工作区打开 .js 文件，查看上方代码，下方终端；点击悬浮运行按钮开始；脚本出现输入问题时在终端输入答案并回车；脚本写出的文件会保存到当前会话工作区。不要声称它会在 Node.js、真实 shell、后台进程或 localhost 端口中运行。',
    '查看工作区时优先用 list_files；只查看大文件片段时用 read_file 的 lines 参数。创建空目录用 create_folder；移动或重命名用 move_path；删除多个文件或目录时用 delete_file 的 paths 批量参数。',
    '修改已有文件前，先 list_files 或 read_file 了解当前内容；小改动优先用 edit_file，整文件重写才用 write_file。edit_file 默认精确匹配；如果缩进/换行不确定，传 ignoreWhitespace: true；需要模式匹配时传 useRegex: true；二者不要同时使用。',
    'HTML 文件写入工作区后，告诉用户可以在会话工作区点击 .html 文件进入预览/源码/控制台；不要声称启动了真实后台进程、shell、Node/Python 服务或 localhost 端口。',
    '当后一个工具的参数需要依赖前一个工具结果时，必须等待前一个工具执行完毕并返回结果后，再发起下一个工具调用。严禁在未获取结果前凭空猜测参数连续调用。只有互不依赖的工具才可以同一轮并行发起。',
    '工具参数可以引用已经返回的上一个工具结果：{{prev.result}}。不要使用 $1、$2 表示工具结果；在 edit_file 的 replace 中，$1、$2 只按 JavaScript 正则替换的捕获组理解。',
    '不要在代码中包含任何 API Key 或用户隐私。'
  ].join('\n');

  function resolveToolReferences(value, ctx, toolName, key) {
    const results = (ctx && ctx.previousResults) || [];
    if (!results.length) return value;
    if (typeof value === 'string') {
      let out = value.replace(/\{\{\s*prev\.result\s*\}\}/g, String(results[results.length - 1].result || ''));
      return out;
    }
    if (Array.isArray(value)) return value.map(v => resolveToolReferences(v, ctx, toolName, key));
    if (value && typeof value === 'object') {
      const copy = {};
      Object.keys(value).forEach(k => { copy[k] = resolveToolReferences(value[k], ctx, toolName, k); });
      return copy;
    }
    return value;
  }

  /* ---------- 执行入口 ----------
   * ctx: { session, confirm(msg):Promise<bool>, openService(serviceId), webFetchMode, previousResults }
   * 返回字符串（作为 tool result 回传给模型） */
  async function execute(name, argsJson, ctx) {
    let args = {};
    try { args = typeof argsJson === 'string' ? (argsJson.trim() ? JSON.parse(argsJson) : {}) : (argsJson || {}); }
    catch (e) { return '错误：工具参数不是有效 JSON - ' + e.message; }
    args = resolveToolReferences(args, ctx || {}, name, '');

    try {
      switch (name) {
        case 'run_js': {
          if (!args.code) return '错误：缺少 code 参数';
          const r = await runWorkspaceJS(ctx.session, {
            code: args.code,
            inputFiles: args.inputFiles
          });
          const saved = r.saved || [];
          let s = '';
          if (r.notes && r.notes.length) s += r.notes.join('\n') + '\n';
          if (r.stdout) s += 'stdout:\n' + r.stdout + '\n';
          if (r.stderr) s += 'stderr:\n' + r.stderr + '\n';
          if (r.result !== undefined && r.result !== null && r.result !== '') s += 'return: ' + r.result + '\n';
          if (saved.length) s += '写入工作区文件：\n' + saved.map(path => '- ' + path).join('\n');
          if (r.skippedWrites && r.skippedWrites.length) s += '脚本执行失败，SandboxFS.writeFile 的写入未保存：\n' + r.skippedWrites.map(path => '- ' + path).join('\n');
          if (!r.ok) return '错误：JavaScript 执行失败\n' + (s.trim() || '(无输出)');
          return s.trim() || '(执行完成，无输出)';
        }
        case 'read_file': return fReadFile(ctx.session, args);
        case 'write_file': return fWriteFile(ctx.session, args);
        case 'edit_file': return fEditFile(ctx.session, args);
        case 'delete_file': return fDeleteFile(ctx.session, args);
        case 'list_files': return fListFiles(ctx.session, args);
        case 'create_folder': return fCreateFolder(ctx.session, args);
        case 'move_path': return fMovePath(ctx.session, args);
        case 'path_exists': return fPathExists(ctx.session, args);
        case 'preview_file': return fPreviewFile(ctx.session, args, ctx);
        case 'create_workspace': return fCreateWorkspace(ctx.session, args);
        case 'run_service': return fRunService(ctx.session, args, ctx);
        case 'stop_service': return fStopService(ctx.session, args);
        case 'list_services': return fListServices(ctx.session);
        case 'image_go':
        case 'image_generation': {
          if (!ctx.imageGo) return '错误：当前环境未启用图片生成';
          return await ctx.imageGo(args);
        }
        case 'web_fetch': {
          if (ctx.webFetchMode === 'never') return '错误：用户已禁止网络访问';
          const method = normalizeMethod(args.method);
          if (method !== 'GET') {
            const ok = await ctx.confirm('AI 请求发送 ' + method + ' 请求：\n' + U.truncate(args.url, 120) + '\n\n这可能会提交数据或触发远端操作。允许本次请求吗？');
            if (!ok) return '错误：用户拒绝了本次 ' + method + ' 网络请求';
          } else if (ctx.webFetchMode !== 'always') {
            const ok = await ctx.confirm('AI 请求访问网页：\n' + U.truncate(args.url, 120) + '\n\n允许本次访问吗？');
            if (!ok) return '错误：用户拒绝了本次网络访问';
          }
          return await webFetch(Object.assign({}, args, { method }));
        }
        default: return '错误：未知工具 ' + name;
      }
    } catch (e) {
      return '错误：' + (e && e.message || String(e));
    }
  }

  return { DEFS, SYSTEM_HINT, execute, runJS, runWorkspaceJS, applySandboxWrites, MAX_FILE, MAX_FILES, MAX_SERVICES };
})();

window.Tools = Tools;
