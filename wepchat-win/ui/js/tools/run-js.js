/* WePChat Tools — run_js Worker sandbox (Android-compatible API surface) */
'use strict';

(() => {
  const T = window.WepChatTools;
  const { MAX_OUTPUT, MAX_FILE, JS_TIMEOUT, RUN_JS_FS_LIMIT } = T;

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

  function runJS(code, timeout, files) {
    return new Promise((resolve) => {
      let worker;
      let timer;
      let blobUrl;
      const finish = (r) => {
        clearTimeout(timer);
        if (worker) try { worker.terminate(); } catch (e) { /* ignore */ }
        if (blobUrl) try { URL.revokeObjectURL(blobUrl); } catch (e) { /* ignore */ }
        resolve(r);
      };
      try {
        blobUrl = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'application/javascript' }));
        worker = new Worker(blobUrl);
      } catch (e) {
        return finish({ ok: false, stdout: '', stderr: 'Worker 不可用: ' + (e && e.message || e), files: {} });
      }
      timer = setTimeout(
        () => finish({ ok: false, stdout: '', stderr: '执行超时（' + ((timeout || JS_TIMEOUT) / 1000) + 's），已中断', files: {} }),
        timeout || JS_TIMEOUT
      );
      worker.onmessage = (e) => {
        const data = e.data || {};
        if (data.type === 'prompt') {
          worker.postMessage({ type: 'prompt-response', id: data.id, error: '当前环境不支持交互输入' });
          return;
        }
        finish(data);
      };
      worker.onerror = (e) => finish({ ok: false, stdout: '', stderr: String(e.message || '执行出错'), files: {} });
      worker.postMessage({ code, files: files || {}, stdin: '', argv: [] });
    });
  }

  async function loadInputFiles(ctx, inputFiles) {
    const files = {};
    if (!inputFiles || typeof inputFiles !== 'object') return files;
    const sid = T.fs.sessionId(ctx);
    let total = 0;
    const entries = Array.isArray(inputFiles)
      ? inputFiles.map((p) => [p, p])
      : Object.keys(inputFiles).map((alias) => [alias, inputFiles[alias] || alias]);
    for (const [alias, path] of entries) {
      const key = String(alias || path).replace(/\\/g, '/').replace(/^\/+/, '');
      const src = String(path || alias).replace(/\\/g, '/').replace(/^\/+/, '');
      const content = await T.fs.read(sid, src);
      if (String(content).startsWith('错误：')) throw new Error(content.replace(/^错误：/, ''));
      total += content.length;
      if (total > RUN_JS_FS_LIMIT) throw new Error('run_js 挂载文件超过上限，请减少 inputFiles');
      files[key] = content;
      files[src] = content;
    }
    return files;
  }

  async function applyWrites(ctx, writes) {
    const saved = [];
    const sid = T.fs.sessionId(ctx);
    for (const rawPath of Object.keys(writes || {})) {
      const path = String(rawPath || '').replace(/\\/g, '/').replace(/^\/+/, '');
      const content = String(writes[rawPath] == null ? '' : writes[rawPath]);
      if (content.length > MAX_FILE) throw new Error('SandboxFS.writeFile 内容超过上限: ' + path);
      const res = await T.fs.write(sid, path, content);
      if (res && res.ok === false) throw new Error(String(res.content || '写入失败'));
      saved.push(path);
      if (res && res.changes && ctx && typeof ctx.onWorkspaceChanged === 'function') {
        try { ctx.onWorkspaceChanged(res.changes); } catch (e) { /* ignore */ }
      }
    }
    return saved;
  }

  T.runtime = { runJS };

  T.register({
    name: 'run_js',
    definition: {
      name: 'run_js',
      description: '在隔离沙盒中执行 JavaScript 代码，用于精确计算、文本/JSON/CSV 处理、编码解码、正则提取等。无网络、无 DOM。需要读取工作区文件时，必须先用 list_files 确认路径，再用 inputFiles 显式挂载；沙盒内只能用 SandboxFS 访问本次挂载的文本文件。可用 SandboxFS.writeFile(path, content) 在脚本成功结束后直接写回工作区文本文件。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: '要执行的 JavaScript 代码。用 console.log 输出，或在末尾 return 结果。' },
          inputFiles: {
            type: 'object',
            description: '可选，显式挂载到 SandboxFS 的工作区文本文件。键是沙盒内路径，值是工作区路径，例如 {"data.json":"./data.json"}。',
            additionalProperties: { type: 'string' },
          },
        },
        required: ['code'],
      },
    },
    async execute(args, ctx) {
      if (!args.code) return '错误：缺少 code 参数';
      const files = await loadInputFiles(ctx, args.inputFiles);
      const r = await runJS(args.code, JS_TIMEOUT, files);
      let saved = [];
      if (r.ok && r.files && Object.keys(r.files).length) {
        saved = await applyWrites(ctx, r.files);
      }
      if (ctx && typeof ctx.onRunJs === 'function') {
        try { ctx.onRunJs({ ok: r.ok, stdout: r.stdout, stderr: r.stderr, result: r.result, saved }); } catch (e) { /* ignore */ }
      }
      let s = '';
      if (r.stdout) s += 'stdout:\n' + r.stdout + '\n';
      if (r.stderr) s += 'stderr:\n' + r.stderr + '\n';
      if (r.result !== undefined && r.result !== null && r.result !== '') s += 'return: ' + r.result + '\n';
      if (saved.length) s += '写入工作区文件：\n' + saved.map((p) => '- ' + p).join('\n');
      if (!r.ok) return '错误：JavaScript 执行失败\n' + (s.trim() || '(无输出)');
      return s.trim() || '(执行完成，无输出)';
    },
  });
})();
