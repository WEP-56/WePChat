/* WepChat Tool - run_js */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { MAX_OUTPUT, MAX_FILE, MAX_FILES, JS_TIMEOUT, RUN_JS_FS_LIMIT } = T;
  const { safeName, ensureWorkspace, ensureParentFolders, textMime, isTextFile } = T.workspace;

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

  T.runtime = { runJS, runWorkspaceJS, applySandboxWrites };
  T.register({
    name: 'run_js',
    definition: {
  "name": "run_js",
  "description": "在隔离沙盒中执行 JavaScript 代码，用于精确计算、文本/JSON/CSV 处理、编码解码、正则提取等。无网络、无 DOM。需要读取工作区文件时，必须先用 list_files 确认路径，再用 inputFiles 显式挂载；沙盒内只能用 SandboxFS 访问本次挂载的文本文件。可用 SandboxFS.writeFile(path, content) 在脚本成功结束后直接写回工作区文本文件。",
  "parameters": {
    "type": "object",
    "properties": {
      "code": {
        "type": "string",
        "description": "要执行的 JavaScript 代码。用 console.log 输出，或在末尾 return 结果。"
      },
      "inputFiles": {
        "type": "object",
        "description": "可选，显式挂载到 SandboxFS 的工作区文本文件。键是沙盒内路径，值是工作区路径，例如 {\"data.json\":\"./data.json\"}。省略时 SandboxFS.listFiles() 为空，readFile 不能读取工作区文件。",
        "additionalProperties": {
          "type": "string"
        }
      }
    },
    "required": [
      "code"
    ]
  }
},
    async execute(args, ctx) {
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
  });
})();
