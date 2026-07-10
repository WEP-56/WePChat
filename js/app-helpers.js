/* WepChat - 应用共享函数 */
'use strict';

(() => {
  const { nextTick } = Vue;
  function clone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function cleanTitle(text) {
    return U.truncate(String(text || '').replace(/\s+/g, ' ').trim(), 28) || '新聊天';
  }

  function normalizeSession(sess) {
    sess = sess || Store.newSession();
    sess.messages = Array.isArray(sess.messages) ? sess.messages : [];
    sess.messages.forEach(m => {
      if (Array.isArray(m.toolCalls)) {
        m.toolCalls.forEach(t => { t._open = false; });
      }
      m.previews = Array.isArray(m.previews) ? m.previews : [];
    });
    sess.files = sess.files || {};
    sess.folders = Array.isArray(sess.folders) ? sess.folders : [];
    sess.services = Array.isArray(sess.services) ? sess.services : [];
    sess.mode = sess.mode === 'image' ? 'image' : (sess.mode === 'remote' ? 'remote' : 'chat');
    sess.remote = sess.remote || null;
    sess.createdAt = sess.createdAt || U.now();
    sess.updatedAt = sess.updatedAt || U.now();
    sess.title = sess.title || '';
    return sess;
  }

  function newProvider() {
    return MODEL_META.normalizeProvider({
      id: U.uuid(),
      name: 'OpenAI Compatible',
      api: 'openai-chat',
      baseUrl: '',
      apiKey: '',
      models: ['gpt-4o-mini'],
      imageModels: ['gpt-image-1', 'gpt-image-2'],
      modelMeta: {},
      imageModelMeta: {},
      imageBaseUrl: '',
      imageApiKey: '',
      imageEndpointPath: '',
      imageEditEndpointPath: '',
      extraHeaders: []
    });
  }

  function parseModels(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function modelsText(provider) {
    provider = MODEL_META.normalizeProvider(provider || {});
    return (provider.models || []).join('\n');
  }

  function imageModelsText(provider) {
    provider = MODEL_META.normalizeProvider(provider || {});
    return (provider.imageModels || []).join('\n');
  }

  function providerModelMeta(provider, id) {
    return MODEL_META.get(provider, id);
  }

  function tokenMessageText(m) {
    if (!m) return '';
    let text = [m.content || '', m.reasoning || ''].filter(Boolean).join('\n');
    (m.attachments || []).forEach(a => {
      if (a.kind === 'text') text += '\n\n' + (a.name || 'file') + '\n' + (a.content || '');
      else if (a.kind === 'image') text += '\n[image:' + (a.name || 'image') + ']';
    });
    (m.toolCalls || []).forEach(t => {
      text += '\n' + (t.name || 'tool') + '\n' + (t.arguments || '') + '\n' + (t.result || '');
    });
    (m.images || []).forEach(img => {
      text += '\n[generated-image:' + (img.path || img.name || 'image') + ']';
    });
    return text;
  }

  function imageExtForMime(mime) {
    if (/jpe?g/i.test(mime || '')) return 'jpg';
    if (/webp/i.test(mime || '')) return 'webp';
    return 'png';
  }

  function imageFileName(prompt, idx, mime) {
    const d = new Date();
    const pad = x => String(x).padStart(2, '0');
    const stamp = d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '_' + pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds());
    const title = fileSafeName(U.truncate(String(prompt || 'image').replace(/\s+/g, ' '), 24)).toLowerCase();
    const suffix = idx > 0 ? '_' + (idx + 1) : '';
    return 'images/' + stamp + '_' + title + suffix + '.' + imageExtForMime(mime);
  }

  function attachmentFileName(name) {
    return 'attachments/' + fileSafeName(name || 'attachment');
  }

  function fileSafeName(name) {
    return String(name || 'untitled')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'untitled';
  }

  function normalizeWorkspacePath(path, opts) {
    const allowEmpty = opts && opts.allowEmpty;
    const raw = String(path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
    const parts = [];
    raw.split('/').forEach(part => {
      part = part.trim();
      if (!part || part === '.') return;
      if (part === '..') throw new Error('路径不能包含 ..');
      if (/[<>:"|?*]/.test(part)) throw new Error('路径包含非法字符：' + part);
      parts.push(part);
    });
    const out = parts.join('/');
    if (!out && !allowEmpty) throw new Error('路径不能为空');
    if (out.length > 180) throw new Error('路径过长');
    return out;
  }

  function parentFolder(path) {
    const p = normalizeWorkspacePath(path, { allowEmpty: true });
    const i = p.lastIndexOf('/');
    return i >= 0 ? p.slice(0, i) : '';
  }

  function ensureParentFolders(sess, path) {
    sess.folders = Array.isArray(sess.folders) ? sess.folders : [];
    const parts = normalizeWorkspacePath(path).split('/');
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      if (!sess.folders.includes(folder)) sess.folders.push(folder);
    }
  }

  function workspaceMime(name) {
    if (/\.html?$/i.test(name)) return 'text/html';
    if (/\.css$/i.test(name)) return 'text/css';
    if (/\.m?js$/i.test(name)) return 'text/javascript';
    if (/\.json$/i.test(name)) return 'application/json';
    if (/\.md|\.markdown$/i.test(name)) return 'text/markdown';
    if (/\.svg$/i.test(name)) return 'image/svg+xml';
    return 'text/plain';
  }

  function workspaceExt(name) {
    const m = String(name || '').match(/\.([a-z0-9]+)$/i);
    return m ? m[1].slice(0, 4).toUpperCase() : 'TXT';
  }

  function isHtmlName(name) { return /\.html?$/i.test(name || ''); }
  function isMarkdownName(name) { return /\.(md|markdown)$/i.test(name || ''); }
  function isImageName(name) { return /\.(png|jpe?g|webp|gif|bmp)$/i.test(name || ''); }
  function isJsName(name) { return /\.m?js$/i.test(name || ''); }

  const RELEASES_URL = 'https://github.com/WEP-56/WePChat/releases';
  const LATEST_RELEASE_API = 'https://api.github.com/repos/WEP-56/WePChat/releases/latest';

  function normalizeAppVersion(value) {
    const text = String(value || '').trim().replace(/^v/i, '');
    const m = text.match(/^(\d+)\.(\d+)\.(\d+)/);
    return m ? (m[1] + '.' + m[2] + '.' + m[3]) : '';
  }

  function appTag(version) {
    const v = normalizeAppVersion(version);
    return v ? 'v' + v : '';
  }

  function parseReleaseTag(tag) {
    const m = String(tag || '').trim().match(/^v(\d+)\.(\d+)\.(\d+)$/i);
    return m ? [parseInt(m[1], 10), parseInt(m[2], 10), parseInt(m[3], 10)] : null;
  }

  function compareReleaseTags(a, b) {
    const va = parseReleaseTag(a);
    const vb = parseReleaseTag(b);
    if (!va || !vb) return 0;
    for (let i = 0; i < 3; i++) {
      if (va[i] !== vb[i]) return va[i] > vb[i] ? 1 : -1;
    }
    return 0;
  }

  function formatReleaseDate(value) {
    if (!value) return '';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '';
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function fetchLatestRelease() {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', LATEST_RELEASE_API, true);
      xhr.timeout = 12000;
      xhr.setRequestHeader('Accept', 'application/vnd.github+json');
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) return reject(new Error('HTTP ' + xhr.status));
        try { resolve(JSON.parse(xhr.responseText || '{}')); }
        catch (e) { reject(e); }
      };
      xhr.onerror = () => reject(new Error('network'));
      xhr.ontimeout = () => reject(new Error('timeout'));
      xhr.send();
    });
  }

  function plusRuntimeVersion() {
    return new Promise(resolve => {
      if (!window.plus || !plus.runtime) return resolve('');
      resolve(normalizeAppVersion(plus.runtime.version));
    });
  }

  function manifestVersion() {
    return new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', 'manifest.json', true);
      xhr.timeout = 5000;
      xhr.onload = () => {
        if (xhr.status < 200 || xhr.status >= 300) return resolve('');
        try {
          const data = JSON.parse(xhr.responseText || '{}');
          resolve(normalizeAppVersion(data && data.version && data.version.name));
        } catch (e) {
          resolve('');
        }
      };
      xhr.onerror = () => resolve('');
      xhr.ontimeout = () => resolve('');
      xhr.send();
    });
  }

  function normalizeStylePreset(p) {
    p = p || {};
    const id = String(p.id || '').trim() || ('style_' + U.uuid().slice(0, 8));
    const name = U.truncate(String(p.name || '').replace(/\s+/g, ' ').trim(), 32);
    const prompt = String(p.prompt || '').trim();
    return name && prompt ? { id, name, prompt } : null;
  }

  function isEditableName(name, file) {
    if (file && file.dataUrl && !file.content) return false;
    return U.isTextFile(name, file && file.mime);
  }

  function languageForName(name) {
    const ext = String(name || '').split('.').pop().toLowerCase();
    const map = {
      html: 'xml', htm: 'xml', vue: 'xml', svg: 'xml',
      js: 'javascript', mjs: 'javascript', json: 'json',
      css: 'css', md: 'markdown', markdown: 'markdown',
      py: 'python', sh: 'bash', bat: 'dos', xml: 'xml',
      yml: 'yaml', yaml: 'yaml', ts: 'typescript'
    };
    return map[ext] || ext || 'plaintext';
  }

  function resolveWorkspaceRef(ref, basePath) {
    let raw = String(ref || '').trim().replace(/\\/g, '/');
    if (!raw || isExternalRef(raw)) return '';
    raw = raw.replace(/[?#].*$/, '');
    if (!raw) return '';
    const seed = raw.startsWith('/') ? raw.replace(/^\/+/, '') : [parentFolder(basePath), raw].filter(Boolean).join('/');
    const out = [];
    for (const part of seed.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') {
        if (!out.length) return '';
        out.pop();
      } else {
        out.push(part);
      }
    }
    try { return normalizeWorkspacePath(out.join('/'), { allowEmpty: true }); }
    catch (e) { return ''; }
  }

  async function dataUrlDownload(name, dataUrl) {
    return await U.saveDataUrlFile(fileSafeName(name), dataUrl);
  }

  function readPickedFile() {
    return new Promise(resolve => {
      const input = document.createElement('input');
      input.type = 'file';
      input.style.display = 'none';
      document.body.appendChild(input);
      let done = false;
      input.onchange = () => {
        const f = input.files && input.files[0];
        document.body.removeChild(input);
        done = true;
        if (!f) return resolve(null);
        const asImage = U.isImageFile(f.name, f.type);
        const reader = new FileReader();
        reader.onload = () => resolve({
          name: f.name,
          size: f.size,
          type: f.type,
          asImage,
          content: reader.result
        });
        reader.onerror = () => resolve(null);
        if (asImage) reader.readAsDataURL(f);
        else reader.readAsText(f);
      };
      window.addEventListener('focus', function onFocus() {
        window.removeEventListener('focus', onFocus);
        setTimeout(() => {
          if (!done && input.parentNode) {
            document.body.removeChild(input);
            resolve(null);
          }
        }, 800);
      });
      input.click();
    });
  }

  function escapeScriptEnd(s) {
    return String(s || '').replace(/<\/script/gi, '<\\/script');
  }

  function isExternalRef(ref) {
    return /^(?:[a-z]+:|\/\/|#)/i.test(String(ref || '').trim());
  }

  function externalWebUrl(ref) {
    const raw = String(ref || '').trim();
    if (/^https?:\/\//i.test(raw)) return raw;
    if (/^\/\//.test(raw)) return 'https:' + raw;
    if (/^www\./i.test(raw)) return 'https://' + raw;
    return '';
  }

  function normalizeRef(ref) {
    return String(ref || '').trim().replace(/^\.?\//, '').replace(/\\/g, '/');
  }

  function htmlAttr(s) {
    return U.escapeHtml(String(s || ''));
  }

  const TextTargets = new Map();
  const TextTimers = new Map();
  const TextResolvers = new Map();

  function resolveTyping(id) {
    const list = TextResolvers.get(id) || [];
    TextResolvers.delete(id);
    list.forEach(fn => fn());
  }

  function smoothText(vm, msg, target) {
    if (!msg || !msg.id) return;
    const id = msg.id;
    const viewMsg = vm && vm.session && Array.isArray(vm.session.messages)
      ? (vm.session.messages.find(m => m && m.id === id) || msg)
      : msg;
    target = String(target || '');
    TextTargets.set(id, target);
    if (TextTimers.has(id)) return;
    const timer = setInterval(() => {
      const full = TextTargets.get(id) || '';
      let cur = viewMsg.content || '';
      if (!full.startsWith(cur)) {
        cur = '';
        viewMsg.content = '';
      }
      const rest = full.slice(cur.length);
      if (!rest) {
        clearInterval(timer);
        TextTimers.delete(id);
        TextTargets.delete(id);
        resolveTyping(id);
        return;
      }
      const step = rest.length > 6000 ? 12 : rest.length > 2500 ? 6 : rest.length > 900 ? 3 : rest.length > 240 ? 2 : 1;
      viewMsg.content = cur + rest.slice(0, step);
      if (vm && typeof vm.persistSessionSoon === 'function') vm.persistSessionSoon();
      nextTick(() => vm.scrollToBottom(false));
    }, 24);
    TextTimers.set(id, timer);
  }

  function waitSmoothText(msg) {
    if (!msg || !msg.id || !TextTimers.has(msg.id)) return Promise.resolve();
    return new Promise(resolve => {
      const list = TextResolvers.get(msg.id) || [];
      list.push(resolve);
      TextResolvers.set(msg.id, list);
    });
  }

  function streamToolKey(step, idx) {
    return 'step_' + step + '_' + idx;
  }

  function findToolDisplay(msg, src, key) {
    const calls = msg.toolCalls || (msg.toolCalls = []);
    return calls.find(t => t && t._streamKey === key)
      || (src && src.id ? calls.find(t => t && t.id === src.id) : null);
  }

  function syncStreamToolCalls(msg, tools, step) {
    if (!msg || !Array.isArray(tools) || !tools.length) return;
    const calls = msg.toolCalls || (msg.toolCalls = []);
    tools.filter(Boolean).forEach((src, idx) => {
      const key = streamToolKey(step, idx);
      let t = findToolDisplay(msg, src, key);
      if (!t) {
        t = {
          id: src.id || key,
          name: src.name || '',
          arguments: src.arguments || '',
          status: 'composing',
          result: null,
          _open: true,
          _streaming: true,
          _streamKey: key,
          _streamStep: step
        };
        calls.push(t);
      }
      if (src.id) t.id = src.id;
      if (src.name) t.name = src.name;
      if (src.arguments != null) t.arguments = src.arguments || '';
      if (t.status !== 'running' && t.status !== 'done' && t.status !== 'error') t.status = 'composing';
      if (typeof t._open !== 'boolean') t._open = true;
      t._streaming = true;
      t._streamKey = key;
      t._streamStep = step;
    });
  }

  function clearStreamState(t) {
    delete t._streaming;
    delete t._streamKey;
    delete t._streamStep;
    return t;
  }

  function finalizeStreamToolCalls(msg, rawCalls, step) {
    const calls = msg.toolCalls || (msg.toolCalls = []);
    const displayCalls = [];
    (rawCalls || []).forEach((src, idx) => {
      const key = streamToolKey(step, idx);
      const id = src.id || ('call_' + step + '_' + idx);
      let t = findToolDisplay(msg, src, key);
      if (!t) {
        t = {
          id,
          name: src.name || '',
          arguments: src.arguments || '{}',
          status: 'running',
          result: null,
          _open: false
        };
        calls.push(t);
      }
      t.id = id;
      t.name = src.name || t.name || '';
      t.arguments = src.arguments || t.arguments || '{}';
      t.status = 'running';
      if (t.result == null) t.result = null;
      if (typeof t._open !== 'boolean') t._open = false;
      displayCalls.push(clearStreamState(t));
    });
    for (let i = calls.length - 1; i >= 0; i--) {
      const t = calls[i];
      if (t && t._streaming && t._streamStep === step && !displayCalls.includes(t)) calls.splice(i, 1);
    }
    return displayCalls;
  }

  function discardStreamToolCalls(msg, step) {
    const calls = msg && msg.toolCalls || [];
    for (let i = calls.length - 1; i >= 0; i--) {
      const t = calls[i];
      if (t && t._streaming && t._streamStep === step) calls.splice(i, 1);
    }
  }

  function cancelStreamToolCalls(msg, step) {
    (msg && msg.toolCalls || []).forEach(t => {
      if (!t || !t._streaming || t._streamStep !== step) return;
      t.status = 'cancelled';
      t.result = '已停止。';
      clearStreamState(t);
    });
  }

  window.WepChatAppHelpers = {
    nextTick,
    clone,
    cleanTitle,
    normalizeSession,
    newProvider,
    parseModels,
    modelsText,
    imageModelsText,
    providerModelMeta,
    tokenMessageText,
    imageExtForMime,
    imageFileName,
    attachmentFileName,
    fileSafeName,
    normalizeWorkspacePath,
    parentFolder,
    ensureParentFolders,
    workspaceMime,
    workspaceExt,
    isHtmlName,
    isMarkdownName,
    isImageName,
    isJsName,
    RELEASES_URL,
    LATEST_RELEASE_API,
    normalizeAppVersion,
    appTag,
    parseReleaseTag,
    compareReleaseTags,
    formatReleaseDate,
    fetchLatestRelease,
    plusRuntimeVersion,
    manifestVersion,
    normalizeStylePreset,
    isEditableName,
    languageForName,
    resolveWorkspaceRef,
    dataUrlDownload,
    readPickedFile,
    escapeScriptEnd,
    isExternalRef,
    externalWebUrl,
    normalizeRef,
    htmlAttr,
    TextTargets,
    TextTimers,
    TextResolvers,
    resolveTyping,
    smoothText,
    waitSmoothText,
    streamToolKey,
    findToolDisplay,
    syncStreamToolCalls,
    clearStreamState,
    finalizeStreamToolCalls,
    discardStreamToolCalls,
    cancelStreamToolCalls
  };
})();
