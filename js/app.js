/* WepChat - Vue 应用入口 */
'use strict';

(async () => {
  const { createApp, nextTick } = Vue;

  /* 存储层先就绪（IndexedDB 预热 + localStorage 旧数据迁移）再挂载应用 */
  await Store.init();

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

  createApp({
    data() {
      const settings = Store.loadSettings();
      const providers = Store.loadProviders().map(p => MODEL_META.normalizeProvider(p));
      Store.saveProviders(providers);
      const index = Store.loadIndex();
      const first = index[0] && Store.loadSession(index[0].id);

      return {
        U,
        API,
        RemoteAPI,
        RemoteScan,
        MODEL_META,
        appVersion: '',
        appTag: '',
        appVersionSource: '',
        appVersionLoaded: false,
        appVersionLoading: false,
        settings,
        providers,
        index,
        session: normalizeSession(first || Store.newSession()),

        drawerOpen: false,
        sheet: '',
        pages: [],
        searchQ: '',
        sessionMenuFor: null,

        input: '',
        imageWorkbenchPrompt: '',
        attachments: [],
        generating: false,
        abortCtl: null,
        remoteRuntime: {
          client: null,
          assistantId: '',
          messageIds: [],
          threadId: '',
          turnId: '',
          resolveTurn: null,
          rejectTurn: null
        },
        stopRequested: false,
        showScrollDown: false,
        autoFollow: true,
        lastBackAt: 0,
        plusReady: false,
        backHandler: null,

        provForm: {
          isNew: true,
          data: null,
          modelsText: '',
          imageModelsText: '',
          selectedModel: '',
          selectedImageModel: '',
          showKey: false,
          fetching: false,
          testing: false
        },
        remoteForm: {
          testingHostId: '',
          loadingHostId: '',
          workspacesHostId: '',
          workspaces: [],
          filesHostId: '',
          filesWorkspaceId: '',
          files: [],
          filesTruncated: false,
          loadingFiles: false
        },

        viewer: {
          name: '',
          isImage: false,
          dataUrl: '',
          mime: '',
          content: '',
          originalContent: '',
          tab: 'source',
          doc: '',
          logs: [],
          terminal: [],
          terminalInput: '',
          running: false,
          prompting: false,
          promptQuestion: '',
          editPrompt: '',
          dirty: false,
          address: '',
          currentPath: '',
          history: [],
          historyIndex: -1
        },
        openFolders: {},
        workspacePressTimer: null,
        workspacePressBlockTimer: null,
        workspacePressStart: null,
        workspaceLongPressFired: false,

        preview: {
          title: 'HTML 预览',
          html: '',
          css: '',
          js: '',
          doc: '',
          tab: 'view',
          logs: [],
          serviceId: '',
          mode: 'html',
          currentPath: '',
          address: '',
          history: [],
          historyIndex: -1
        },

        dlg: null,
        tokenPanelOpen: false,
        sessionManagerOpen: {},
        storageUsed: Store.usage(),
        updateCheck: {
          checking: false,
          checked: false,
          failed: false,
          latest: null,
          hasUpdate: false,
          lastCheckedAt: 0
        },
        persistTimer: null,
        lastStreamPersistAt: 0,
        runningNotifyShown: false,
        pushHandlerReady: false,
        notificationPermissionAsked: false
      };
    },

    computed: {
      currentProvider() {
        const id = this.settings.activeProviderId || this.session.providerId;
        return this.providers.find(p => p.id === id) || this.providers[0] || null;
      },
      currentModelId() {
        if (!this.currentProvider) return '';
        return this.settings.activeModel || this.session.model || this.currentProvider.models[0] || '';
      },
      currentModelLabel() {
        if (!this.currentProvider) return '未配置模型';
        return this.currentModelId || '默认模型';
      },
      remoteHosts() {
        return (Array.isArray(this.settings.remoteHosts) ? this.settings.remoteHosts : [])
          .map(h => RemoteAPI.normalizeHost(h))
          .filter(h => h.baseUrl);
      },
      activeRemoteHost() {
        const id = this.settings.activeRemoteHostId;
        return this.remoteHosts.find(h => h.id === id) || this.remoteHosts[0] || null;
      },
      remoteSessionHost() {
        const r = this.session && this.session.remote || {};
        return r.hostId ? (this.remoteHosts.find(h => h.id === r.hostId) || null) : this.activeRemoteHost;
      },
      remoteWorkspaceName() {
        const r = this.session && this.session.remote || {};
        return r.workspaceName || r.workspacePath || '未选择工作区';
      },
      topModelLabel() {
        if (this.appMode === 'image') return this.imageModelId || '未配置生图模型';
        if (this.appMode === 'remote') return this.remoteWorkspaceName;
        return this.currentModelLabel;
      },
      topProviderLabel() {
        if (this.appMode === 'image') return this.imageProvider && this.imageProvider.name || '图片生成';
        if (this.appMode === 'remote') {
          const h = this.remoteSessionHost;
          return h ? ('远程 Codex · ' + h.name) : '远程 Codex';
        }
        return this.currentProvider && this.currentProvider.name || '';
      },
      currentModelMeta() {
        return this.currentProvider ? providerModelMeta(this.currentProvider, this.currentModelId) : null;
      },
      currentModelCaps() {
        return MODEL_META.capLabels(this.currentModelMeta);
      },
      appMode() {
        if (this.session && this.session.mode === 'image') return 'image';
        if (this.session && this.session.mode === 'remote') return 'remote';
        return 'chat';
      },
      composerPlaceholder() {
        if (this.appMode === 'image') return '描述你想生成的图片';
        if (this.appMode === 'remote') return '让桌面 Codex 在当前项目里做什么';
        return '有问题，尽管问';
      },
      emptyTitle() {
        if (this.appMode === 'image') return '描述一张图片';
        if (this.appMode === 'remote') return '连接桌面 Codex';
        return '有问题，尽管问';
      },
      emptySub() {
        if (this.appMode === 'image') return this.imageModelId || '未配置生图模型';
        if (this.appMode === 'remote') {
          const r = this.session && this.session.remote || {};
          return r.workspacePath || r.workspaceName || '先在设置里添加 WepChat Host';
        }
        return this.currentModelLabel;
      },
      imageProvider() {
        const id = this.settings.imageProviderId || this.settings.activeProviderId;
        return this.providers.find(p => p.id === id) || this.currentProvider || this.providers[0] || null;
      },
      imageModelId() {
        const provider = this.imageProvider;
        if (!provider) return '';
        const imageModels = this.imageModelOptions;
        const preferred = this.settings.imageModel;
        if (preferred && imageModels.includes(preferred)) return preferred;
        const found = imageModels.find(id => {
          const meta = providerModelMeta(provider, id);
          const caps = meta && meta.capabilities || {};
          return caps.imageGeneration || (meta.image && meta.image.generation);
        });
        return found || imageModels[0] || '';
      },
      imageModelOptions() {
        const provider = this.imageProvider;
        if (!provider) return [];
        const out = [];
        (provider.imageModels || []).forEach(id => { if (id && !out.includes(id)) out.push(id); });
        (provider.models || []).forEach(id => {
          const meta = providerModelMeta(provider, id);
          if (MODEL_META.isImageGenerationMeta(meta) && !out.includes(id)) out.push(id);
        });
        return out;
      },
      imageSizeOptions() {
        return ['auto', '1024x1024', '1536x864', '864x1536', '2048x2048', '2560x1440', '1440x2560', '3840x2160', '2160x3840', '2880x2880'];
      },
      imageQualityOptions() {
        return [
          { value: 'auto', label: '自动' },
          { value: 'high', label: '高' },
          { value: 'medium', label: '中' },
          { value: 'low', label: '低' }
        ];
      },
      imageFormatOptions() {
        return [
          { value: 'png', label: 'PNG' },
          { value: 'webp', label: 'WebP' },
          { value: 'jpeg', label: 'JPEG' }
        ];
      },
      imageBackgroundOptions() {
        return [
          { value: 'auto', label: '自动' },
          { value: 'transparent', label: '透明' },
          { value: 'opaque', label: '不透明' }
        ];
      },
      imageStylePresets() {
        return (Array.isArray(this.settings.imageStylePresets) ? this.settings.imageStylePresets : [])
          .map(normalizeStylePreset)
          .filter(Boolean);
      },
      appVersionLabel() {
        return this.appVersion || '读取中';
      },
      appTagLabel() {
        return this.appTag || (this.appVersionLoading ? '读取版本中' : '版本未知');
      },
      latestRelease() {
        return this.updateCheck && this.updateCheck.latest || null;
      },
      updateStatusText() {
        if (this.updateCheck.checking) return '正在检查 GitHub Release';
        if (this.latestRelease && this.updateCheck.hasUpdate) return '发现新版本 ' + this.latestRelease.tag;
        if (this.latestRelease) return '已是最新版本';
        if (this.updateCheck.failed) return '暂时无法获取 Release 信息';
        return '未检查';
      },
      updateReleaseNote() {
        const body = this.latestRelease && this.latestRelease.body || '';
        return U.truncate(String(body).trim(), 2400);
      },
      selectedImageStylePreset() {
        return this.imageStylePresetById(this.settings.imageStylePresetId);
      },
      tokenStats() {
        const meta = this.currentModelMeta || {};
        const context = MODEL_META.toInt(meta.contextWindow) || MODEL_META.DEFAULT_CONTEXT;
        const maxOut = MODEL_META.toInt(this.settings.maxTokens) || MODEL_META.toInt(meta.maxOutputTokens) || MODEL_META.DEFAULT_MAX_OUTPUT;
        let input = MODEL_META.estimateTokens(this.settings.systemPrompt || '');
        (this.session.messages || []).forEach(m => { input += MODEL_META.estimateTokens(tokenMessageText(m)) + 4; });
        let pending = MODEL_META.estimateTokens(this.input || '');
        (this.attachments || []).forEach(a => {
          pending += a.kind === 'text' ? MODEL_META.estimateTokens((a.name || '') + '\n' + (a.content || '')) : 260;
        });
        const used = input + pending;
        const pct = context ? Math.min(100, Math.round(used / context * 100)) : 0;
        const remaining = Math.max(0, context - used);
        return {
          input,
          pending,
          used,
          context,
          maxOut,
          remaining,
          pct,
          warn: pct >= 85,
          danger: pct >= 95,
          source: meta.source || 'estimate'
        };
      },
      tokenRingStyle() {
        const p = this.tokenStats.pct;
        const fg = this.tokenStats.danger ? '#ff5449' : (this.tokenStats.warn ? '#f5a524' : 'var(--text)');
        return {
          background: 'conic-gradient(' + fg + ' ' + p + '%, var(--surface2) 0)'
        };
      },
      provSelectedMeta() {
        const p = this.provForm && this.provForm.data;
        const id = this.provForm && this.provForm.selectedModel;
        return p && id ? providerModelMeta(p, id) : null;
      },
      fileCount() {
        return Object.keys(this.session.files || {}).length;
      },
      remoteFileCount() {
        return (this.remoteForm.files || []).filter(x => x && x.type === 'file').length;
      },
      folderCount() {
        const files = this.session.files || {};
        const folders = new Set(this.session.folders || []);
        Object.keys(files).forEach(name => {
          const parts = String(name).split('/');
          for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
        });
        return folders.size;
      },
      sessionManagerItems() {
        return (this.index || []).map(meta => {
          const sess = Store.loadSession(meta.id);
          if (!sess) return null;
          const files = sess.files || {};
          const fileRows = Object.keys(files).sort((a, b) => a.localeCompare(b, 'zh-Hans')).map(path => {
            const f = files[path] || {};
            const size = Number(f.size) || (f.content ? String(f.content).length : 0) || (f.dataUrl ? Math.ceil(String(f.dataUrl).length * 0.75) : 0);
            return {
              path,
              name: path.split('/').pop() || path,
              kind: this.fileKind(path, f),
              size,
              mtime: f.mtime || sess.updatedAt || meta.updatedAt || 0,
              mime: f.mime || workspaceMime(path)
            };
          });
          const workspaceSize = fileRows.reduce((sum, f) => sum + (f.size || 0), 0);
          return {
            id: sess.id,
            title: sess.title || '新聊天',
            mode: sess.mode === 'image' ? 'image' : (sess.mode === 'remote' ? 'remote' : 'chat'),
            modeLabel: sess.mode === 'image' ? '生图' : (sess.mode === 'remote' ? '远程' : '常规'),
            updatedAt: sess.updatedAt || meta.updatedAt || sess.createdAt || 0,
            createdAt: sess.createdAt || meta.createdAt || 0,
            pinned: !!(sess.pinned || meta.pinned),
            messageCount: (sess.messages || []).length,
            fileCount: fileRows.length,
            folderCount: (sess.folders || []).length,
            workspaceSize,
            files: fileRows,
            isCurrent: sess.id === this.session.id
          };
        }).filter(Boolean).sort((a, b) => {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
      },
      serviceCount() {
        return (this.session.services || []).length;
      },
      runningServiceCount() {
        return (this.session.services || []).filter(s => s.status === 'running').length;
      },
      previewService() {
        return this.preview.serviceId ? ((this.session.services || []).find(s => s.id === this.preview.serviceId) || null) : null;
      },
      workspaceRows() {
        const files = this.session.files || {};
        const folderSet = new Set();
        (this.session.folders || []).forEach(path => {
          try {
            const p = normalizeWorkspacePath(path, { allowEmpty: true });
            if (p) folderSet.add(p);
          } catch (e) {}
        });
        Object.keys(files).forEach(name => {
          try {
            const parts = normalizeWorkspacePath(name).split('/');
            for (let i = 1; i < parts.length; i++) folderSet.add(parts.slice(0, i).join('/'));
          } catch (e) {}
        });

        const children = new Map();
        const push = (parent, item) => {
          const list = children.get(parent) || [];
          list.push(item);
          children.set(parent, list);
        };
        folderSet.forEach(path => {
          const parts = path.split('/');
          push(parts.slice(0, -1).join('/'), { type: 'folder', path, name: parts[parts.length - 1] });
        });
        Object.keys(files).forEach(path => {
          const parts = String(path).split('/');
          push(parts.slice(0, -1).join('/'), {
            type: 'file',
            path,
            name: parts[parts.length - 1],
            file: files[path],
            kind: this.fileKind(path, files[path])
          });
        });

        const rows = [];
        const walk = (parent, depth) => {
          const list = (children.get(parent) || []).slice().sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name, 'zh-Hans');
          });
          list.forEach(item => {
            if (item.type === 'folder') {
              const open = this.isFolderOpen(item.path);
              rows.push(Object.assign({}, item, {
                depth,
                open,
                childCount: (children.get(item.path) || []).length
              }));
              if (open) walk(item.path, depth + 1);
            } else {
              rows.push(Object.assign({}, item, { depth }));
            }
          });
        };
        walk('', 0);
        return rows;
      },
      remoteWorkspaceRows() {
        const entries = Array.isArray(this.remoteForm.files) ? this.remoteForm.files : [];
        const children = new Map();
        const push = (parent, item) => {
          const list = children.get(parent) || [];
          list.push(item);
          children.set(parent, list);
        };
        const folders = new Set();
        entries.forEach(item => {
          const rawPath = String(item && item.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
          if (!rawPath) return;
          const parts = rawPath.split('/');
          for (let i = 1; i < parts.length; i++) folders.add(parts.slice(0, i).join('/'));
          if (item.type === 'folder') folders.add(rawPath);
        });
        folders.forEach(path => {
          const parts = path.split('/');
          push(parts.slice(0, -1).join('/'), { type: 'folder', path, name: parts[parts.length - 1] });
        });
        entries.forEach(item => {
          if (!item || item.type !== 'file') return;
          const rawPath = String(item.path || '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
          if (!rawPath) return;
          const parts = rawPath.split('/');
          const file = { size: Number(item.size) || 0, mtime: Number(item.mtime) || 0, mime: workspaceMime(rawPath) };
          push(parts.slice(0, -1).join('/'), {
            type: 'file',
            path: rawPath,
            name: parts[parts.length - 1],
            file,
            kind: this.fileKind(rawPath, file)
          });
        });

        const rows = [];
        const walk = (parent, depth) => {
          const list = (children.get(parent) || []).slice().sort((a, b) => {
            if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
            return a.name.localeCompare(b.name, 'zh-Hans');
          });
          list.forEach(item => {
            if (item.type === 'folder') {
              const open = this.isFolderOpen(item.path);
              rows.push(Object.assign({}, item, { depth, open, childCount: (children.get(item.path) || []).length }));
              if (open) walk(item.path, depth + 1);
            } else {
              rows.push(Object.assign({}, item, { depth }));
            }
          });
        };
        walk('', 0);
        return rows;
      },
      viewerTabs() {
        if (!this.viewer.name) return [];
        if (this.viewer.isImage) return [{ id: 'view', label: '预览' }];
        if (isHtmlName(this.viewer.name)) return [
          { id: 'view', label: '预览' },
          { id: 'source', label: '源码' },
          { id: 'console', label: '控制台' + (this.viewer.logs.length ? ' (' + this.viewer.logs.length + ')' : '') }
        ];
        if (isMarkdownName(this.viewer.name)) return [
          { id: 'view', label: '预览' },
          { id: 'source', label: '源码' }
        ];
        return [{ id: 'source', label: '源码' }];
      },
      viewerIsHtml() {
        return isHtmlName(this.viewer.name);
      },
      viewerIsMarkdown() {
        return isMarkdownName(this.viewer.name);
      },
      viewerIsJs() {
        return isJsName(this.viewer.name) && !this.viewer.isImage;
      },
      viewerCanSave() {
        return !!this.viewer.name && !this.viewer.isImage;
      },
      canSend() {
        if (this.appMode === 'remote') {
          return !this.generating && (!!this.input.trim() || (this.attachments || []).some(a => a.kind === 'image'));
        }
        return !this.generating && (!!this.input.trim() || this.attachments.length > 0);
      },
      groupedIndex() {
        const q = this.searchQ.trim().toLowerCase();
        const rows = this.index
          .filter(it => !q || String(it.title || '新聊天').toLowerCase().includes(q))
          .slice()
          .sort((a, b) => {
            if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
            return (b.updatedAt || 0) - (a.updatedAt || 0);
          });
        const groups = [];
        rows.forEach(it => {
          const name = it.pinned ? '置顶' : U.timeGroup(it.updatedAt || it.createdAt || U.now());
          let g = groups.find(x => x.name === name);
          if (!g) {
            g = { name, items: [] };
            groups.push(g);
          }
          g.items.push(it);
        });
        return groups;
      }
    },

    mounted() {
      this.applyTheme();
      this.persistSettings();
      window.addEventListener('message', this.onPreviewMessage);
      window.addEventListener('pagehide', this.flushSessionPersist);
      document.addEventListener('visibilitychange', this.handleVisibilityPersist);
      document.addEventListener('pause', this.handleAppPause, false);
      document.addEventListener('resume', this.handleAppResume, false);
      document.addEventListener('plusready', this.initPlusApp, false);
      if (window.plus) this.initPlusApp();
      const mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
      if (mq) {
        const fn = () => this.applyTheme();
        if (mq.addEventListener) mq.addEventListener('change', fn);
        else if (mq.addListener) mq.addListener(fn);
      }
      nextTick(() => {
        this.growInput();
        this.scrollToBottom(true);
      });
      this.refreshAppVersion().then(() => {
        if (this.settings.updateAutoCheck) this.checkReleaseUpdate({ silent: true });
      });
    },

    methods: {
      initPlusApp() {
        if (this.plusReady || !window.plus) return;
        this.plusReady = true;
        document.documentElement.classList.add('plus-app');
        this.refreshAppVersion({ force: true });
        this.initPushHandlers();
        if (plus.key && !this.backHandler) {
          this.backHandler = () => this.handleBackButton();
          plus.key.addEventListener('backbutton', this.backHandler, false);
        }
      },
      async handleBackButton() {
        if (this.dlg) {
          this.lastBackAt = 0;
          this.dlgAnswer(null);
          return;
        }
        if (this.sheet) {
          this.lastBackAt = 0;
          this.sheet = '';
          return;
        }
        if (this.drawerOpen) {
          this.lastBackAt = 0;
          this.drawerOpen = false;
          return;
        }
        if (this.pages.length) {
          this.lastBackAt = 0;
          this.closePage();
          return;
        }
        const now = Date.now();
        if (now - this.lastBackAt < 1800) {
          await this.flushSessionPersist(900);
          if (window.plus && plus.runtime && plus.runtime.quit) plus.runtime.quit();
          return;
        }
        this.lastBackAt = now;
        U.toast('再次返回退出应用');
      },
      normalizeImageSettings() {
        const presets = this.imageStylePresets;
        this.settings.imageStylePresets = presets;
        if (this.settings.imageStylePresetId && !presets.some(p => p.id === this.settings.imageStylePresetId)) {
          this.settings.imageStylePresetId = '';
        }
        if (!this.imageSizeOptions.includes(this.settings.imageDefaultSize)) this.settings.imageDefaultSize = 'auto';
        if (!this.imageQualityOptions.some(x => x.value === this.settings.imageQuality)) this.settings.imageQuality = 'auto';
        if (!this.imageFormatOptions.some(x => x.value === this.settings.imageOutputFormat)) this.settings.imageOutputFormat = 'png';
        if (!this.imageBackgroundOptions.some(x => x.value === this.settings.imageBackground)) this.settings.imageBackground = 'auto';
      },
      normalizeRemoteSettings() {
        const seen = new Set();
        const hosts = (Array.isArray(this.settings.remoteHosts) ? this.settings.remoteHosts : [])
          .map(h => RemoteAPI.normalizeHost(h))
          .filter(h => h.baseUrl)
          .filter(h => {
            const key = h.id || h.baseUrl;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        this.settings.remoteHosts = hosts;
        if (this.settings.activeRemoteHostId && !hosts.some(h => h.id === this.settings.activeRemoteHostId)) {
          this.settings.activeRemoteHostId = '';
        }
        if (!this.settings.activeRemoteHostId && hosts[0]) this.settings.activeRemoteHostId = hosts[0].id;
      },
      persistSettings() {
        this.normalizeImageSettings();
        this.normalizeRemoteSettings();
        Store.saveSettings(this.settings);
        this.storageUsed = Store.usage();
        this.applyTheme();
      },
      refreshAppVersion(opts) {
        opts = opts || {};
        if (this.appVersionLoading && this._appVersionPromise) return this._appVersionPromise;
        if (this.appVersionLoaded && !opts.force) return Promise.resolve(this.appVersion);
        this.appVersionLoading = true;
        this._appVersionPromise = (async () => {
          const plusVersion = await plusRuntimeVersion();
          let version = plusVersion;
          let source = plusVersion ? 'app' : '';
          if (!version) {
            version = await manifestVersion();
            source = version ? 'manifest' : '';
          }
          if (version) {
            this.appVersion = version;
            this.appTag = appTag(version);
            this.appVersionSource = source;
          }
          this.appVersionLoaded = true;
          return this.appVersion;
        })().finally(() => {
          this.appVersionLoading = false;
          this._appVersionPromise = null;
        });
        return this._appVersionPromise;
      },
      setUpdateAutoCheck(on) {
        this.settings.updateAutoCheck = !!on;
        this.persistSettings();
      },
      async checkReleaseUpdate(opts) {
        opts = opts || {};
        if (this.updateCheck.checking) return;
        this.updateCheck.checking = true;
        this.updateCheck.failed = false;
        try {
          await this.refreshAppVersion();
          if (!this.appTag) throw new Error('version unavailable');
          const release = await fetchLatestRelease();
          const tag = String(release.tag_name || '').trim();
          const latest = {
            tag,
            name: String(release.name || tag || 'GitHub Release'),
            body: String(release.body || ''),
            url: String(release.html_url || RELEASES_URL),
            publishedAt: release.published_at || release.created_at || ''
          };
          const hasUpdate = compareReleaseTags(tag, this.appTag) > 0;
          this.updateCheck.latest = latest;
          this.updateCheck.hasUpdate = hasUpdate;
          this.updateCheck.checked = true;
          this.updateCheck.lastCheckedAt = Date.now();
          this.updateCheck.failed = false;
          if (!opts.silent && hasUpdate) U.toast('发现新版本 ' + tag);
        } catch (e) {
          this.updateCheck.failed = true;
          if (!opts.silent) this.updateCheck.checked = true;
        } finally {
          this.updateCheck.checking = false;
        }
      },
      openReleasePage(url) {
        U.openExternal(url || (this.latestRelease && this.latestRelease.url) || RELEASES_URL);
      },
      releaseDateText(value) {
        return formatReleaseDate(value);
      },
      persistProviders() {
        this.providers = this.providers.map(p => MODEL_META.normalizeProvider(p));
        Store.saveProviders(this.providers);
        this.storageUsed = Store.usage();
      },
      persistSession() {
        this.session = normalizeSession(this.session);
        Store.saveSession(this.session);
        this.upsertIndex(this.session);
        this.storageUsed = Store.usage();
      },
      persistSessionSoon() {
        if (this.persistTimer) return;
        const now = Date.now();
        const wait = Math.max(0, 900 - (now - (this.lastStreamPersistAt || 0)));
        this.persistTimer = setTimeout(() => {
          this.persistTimer = null;
          this.lastStreamPersistAt = Date.now();
          this.persistSession();
        }, wait);
      },
      async flushSessionPersist(timeoutMs) {
        const timeout = typeof timeoutMs === 'number' ? timeoutMs : 1200;
        if (this.persistTimer) {
          clearTimeout(this.persistTimer);
          this.persistTimer = null;
        }
        if (this.session && this.session.id) this.persistSession();
        if (Store.flush) await Store.flush(timeout);
      },
      handleVisibilityPersist() {
        if (document.visibilityState === 'hidden') {
          this.flushSessionPersist(1200);
          this.showRunningNotification();
        } else {
          this.clearRunningNotification();
        }
      },
      handleAppPause() {
        this.flushSessionPersist(1200);
        this.showRunningNotification();
      },
      handleAppResume() {
        this.clearRunningNotification();
      },
      initPushHandlers() {
        if (!window.plus || !plus.push || this.pushHandlerReady) return;
        this.pushHandlerReady = true;
        try {
          plus.push.addEventListener('click', () => {
            this.clearRunningNotification();
          }, false);
        } catch (e) {}
      },
      requestNotificationPermission() {
        if (this.notificationPermissionAsked || !window.plus || !plus.android || !plus.android.requestPermissions) return;
        const version = parseInt(plus.os && plus.os.version || '0', 10) || 0;
        if (version < 13) return;
        this.notificationPermissionAsked = true;
        try {
          plus.android.requestPermissions(['android.permission.POST_NOTIFICATIONS'], () => {}, () => {});
        } catch (e) {}
      },
      showRunningNotification() {
        if (!this.generating || this.runningNotifyShown || !window.plus || !plus.push || !plus.push.createMessage) return;
        try {
          plus.push.createMessage('正在生成回复，回到 WepChat 查看进度。', {
            type: 'generation',
            sessionId: this.session && this.session.id || ''
          }, {
            title: 'WepChat 正在运行',
            cover: false
          });
          this.runningNotifyShown = true;
        } catch (e) {}
      },
      clearRunningNotification() {
        if (!this.runningNotifyShown) return;
        try {
          if (window.plus && plus.push && plus.push.clear) plus.push.clear();
        } catch (e) {}
        this.runningNotifyShown = false;
      },
      upsertIndex(sess) {
        const meta = {
          id: sess.id,
          title: sess.title || '',
          createdAt: sess.createdAt,
          updatedAt: sess.updatedAt || U.now(),
          pinned: !!sess.pinned
        };
        const i = this.index.findIndex(x => x.id === sess.id);
        if (i >= 0) this.index[i] = Object.assign({}, this.index[i], meta);
        else this.index.unshift(meta);
        this.index.sort((a, b) => {
          if (!!a.pinned !== !!b.pinned) return a.pinned ? -1 : 1;
          return (b.updatedAt || 0) - (a.updatedAt || 0);
        });
        Store.saveIndex(this.index);
      },

      applyTheme() {
        const root = document.documentElement;
        const dark = this.settings.theme === 'dark' ||
          (this.settings.theme === 'auto' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
        root.classList.toggle('dark', !!dark);
        root.classList.toggle('fs-large', this.settings.fontSize === 'large');
      },
      setTheme(v) {
        this.settings.theme = v;
        this.persistSettings();
      },
      setFontSize(v) {
        this.settings.fontSize = v;
        this.persistSettings();
      },
      setTemp(v) {
        const s = String(v || '').trim();
        this.settings.temperature = s === '' ? null : U.clamp(Number(s), 0, 2);
        this.persistSettings();
      },
      setMaxTokens(v) {
        const n = parseInt(v, 10);
        this.settings.maxTokens = Number.isFinite(n) && n > 0 ? n : null;
        this.persistSettings();
      },
      setAppMode(mode) {
        this.session.mode = mode === 'image' ? 'image' : (mode === 'remote' ? 'remote' : 'chat');
        this.persistSession();
        nextTick(() => this.growInput());
      },
      setImageCount(v) {
        const n = parseInt(v, 10);
        this.settings.imageDefaultCount = Number.isFinite(n) ? U.clamp(n, 1, 8) : 1;
        this.persistSettings();
      },
      imageStylePresetById(id) {
        id = String(id || '');
        return this.imageStylePresets.find(p => p.id === id) || null;
      },
      async addImageStylePreset() {
        const name = await this.askText('新增风格预设', '', '预设名称');
        if (name == null) return;
        const cleanName = U.truncate(String(name || '').replace(/\s+/g, ' ').trim(), 32);
        if (!cleanName) {
          U.toast('请填写预设名称');
          return;
        }
        const prompt = await this.askText('预设提示词', '', '用英文描述图片风格、光线、构图等', true);
        if (prompt == null) return;
        const preset = normalizeStylePreset({
          id: 'style_' + U.uuid().slice(0, 8),
          name: cleanName,
          prompt
        });
        if (!preset) {
          U.toast('请填写预设提示词');
          return;
        }
        this.settings.imageStylePresets = this.imageStylePresets.concat([preset]);
        this.settings.imageStylePresetId = preset.id;
        this.persistSettings();
      },
      async editImageStylePreset(preset) {
        preset = preset && this.imageStylePresetById(preset.id);
        if (!preset) return;
        const name = await this.askText('编辑风格名称', preset.name, '预设名称');
        if (name == null) return;
        const cleanName = U.truncate(String(name || '').replace(/\s+/g, ' ').trim(), 32);
        if (!cleanName) {
          U.toast('请填写预设名称');
          return;
        }
        const prompt = await this.askText('编辑预设提示词', preset.prompt, '用英文描述图片风格、光线、构图等', true);
        if (prompt == null) return;
        const nextPreset = normalizeStylePreset({ id: preset.id, name: cleanName, prompt });
        if (!nextPreset) {
          U.toast('请填写预设提示词');
          return;
        }
        this.settings.imageStylePresets = this.imageStylePresets.map(p => p.id === preset.id ? nextPreset : p);
        this.persistSettings();
      },
      async deleteImageStylePreset(preset) {
        preset = preset && this.imageStylePresetById(preset.id);
        if (!preset) return;
        const ok = await this.confirm('删除风格预设：' + preset.name, '删除预设');
        if (!ok) return;
        this.settings.imageStylePresets = this.imageStylePresets.filter(p => p.id !== preset.id);
        if (this.settings.imageStylePresetId === preset.id) this.settings.imageStylePresetId = '';
        this.persistSettings();
      },
      modelMeta(provider, id) {
        return providerModelMeta(provider, id);
      },
      modelCapText(provider, id) {
        return MODEL_META.capLabels(this.modelMeta(provider, id)).join(' · ');
      },
      modelContextText(provider, id) {
        const meta = this.modelMeta(provider, id);
        return MODEL_META.fmtTokens(meta.contextWindow || MODEL_META.DEFAULT_CONTEXT) + ' ctx';
      },
      modelSummary(provider, id) {
        const meta = this.modelMeta(provider, id);
        return this.modelContextText(provider, id) + ' · ' + MODEL_META.capLabels(meta).join(' · ');
      },
      setMaxToolRounds(v) {
        const n = parseInt(v, 10);
        this.settings.maxToolRounds = Number.isFinite(n) ? U.clamp(n, 1, 32) : 8;
        this.persistSettings();
      },
      setMaxToolCalls(v) {
        const n = parseInt(v, 10);
        this.settings.maxToolCalls = Number.isFinite(n) ? U.clamp(n, 1, 128) : 24;
        this.persistSettings();
      },
      fileKind(name, file) {
        if (file && file.dataUrl && !file.content) return 'image';
        if (isHtmlName(name)) return 'html';
        if (isMarkdownName(name)) return 'md';
        if (/\.(js|mjs|ts|css|json|vue|svg|py|sh|bat|kt|java|go|rs|php|rb|xml|ya?ml)$/i.test(name || '')) return 'code';
        return 'text';
      },
      fileExt(name) {
        return workspaceExt(name);
      },
      isFolderOpen(path) {
        return this.openFolders[path] !== false;
      },
      toggleFolder(path) {
        this.openFolders[path] = !this.isFolderOpen(path);
      },
      openWorkspaceRow(row) {
        if (this.workspaceLongPressFired) {
          this.workspaceLongPressFired = false;
          return;
        }
        if (!row) return;
        if (row.type === 'folder') this.toggleFolder(row.path);
        else this.viewFile(row.path);
      },
      startWorkspaceFilePress(row, e) {
        this.cancelWorkspaceFilePress();
        if (!row || row.type !== 'file') return;
        const x = e && e.clientX || 0;
        const y = e && e.clientY || 0;
        this.workspacePressStart = { x, y, path: row.path };
        this.workspacePressTimer = setTimeout(() => {
          this.workspacePressTimer = null;
          this.markWorkspaceLongPressFired();
          U.vibrate(18);
          this.exportWorkspaceFileByName(row.path);
        }, 520);
      },
      moveWorkspaceFilePress(e) {
        if (!this.workspacePressTimer || !this.workspacePressStart || !e) return;
        const dx = Math.abs((e.clientX || 0) - this.workspacePressStart.x);
        const dy = Math.abs((e.clientY || 0) - this.workspacePressStart.y);
        if (dx > 10 || dy > 10) this.cancelWorkspaceFilePress();
      },
      cancelWorkspaceFilePress() {
        if (this.workspacePressTimer) clearTimeout(this.workspacePressTimer);
        this.workspacePressTimer = null;
        this.workspacePressStart = null;
      },
      markWorkspaceLongPressFired() {
        this.workspaceLongPressFired = true;
        if (this.workspacePressBlockTimer) clearTimeout(this.workspacePressBlockTimer);
        this.workspacePressBlockTimer = setTimeout(() => {
          this.workspaceLongPressFired = false;
          this.workspacePressBlockTimer = null;
        }, 900);
      },
      showWorkspaceFileContext(row) {
        if (!row || row.type !== 'file') return;
        this.cancelWorkspaceFilePress();
        this.markWorkspaceLongPressFired();
        this.exportWorkspaceFileByName(row.path);
      },
      toolPermissionKey(name) {
        if (name === 'run_js') return 'run_js';
        if (name === 'web_fetch') return 'web_fetch';
        if (name === 'image_go' || name === 'image_generation') return 'image_go';
        if (name === 'delete_file') return 'delete_files';
        if (name === 'run_service' || name === 'stop_service' || name === 'list_services') return 'services';
        if (name === 'read_file' || name === 'write_file' || name === 'edit_file' || name === 'list_files' ||
          name === 'create_folder' || name === 'move_path' || name === 'path_exists' || name === 'preview_file' || name === 'create_workspace') return 'files';
        return 'files';
      },
      toolPermissionLabel(name) {
        const map = {
          run_js: 'JavaScript 沙盒',
          web_fetch: '网页访问',
          image_go: '图片生成',
          delete_files: '删除工作区文件/文件夹',
          services: '工作区服务',
          files: '工作区文件'
        };
        return map[this.toolPermissionKey(name)] || this.toolLabel(name);
      },
      toolPermission(nameOrKey) {
        const key = ['run_js', 'files', 'delete_files', 'services', 'web_fetch', 'image_go'].includes(nameOrKey)
          ? nameOrKey
          : this.toolPermissionKey(nameOrKey);
        const perms = this.settings.toolPermissions || {};
        if (key === 'image_go') return perms[key] || this.settings.imagePermission || 'ask';
        return perms[key] || (key === 'web_fetch' ? (this.settings.webFetch || 'ask') : 'ask');
      },
      setToolPermission(key, mode) {
        if (key === 'delete_files' && mode === 'always') mode = 'ask';
        this.settings.toolPermissions = Object.assign({}, this.settings.toolPermissions || {}, { [key]: mode });
        if (key === 'web_fetch') this.settings.webFetch = mode;
        if (key === 'image_go') this.settings.imagePermission = mode;
        this.persistSettings();
      },

      pageIs(name) {
        return this.pages[this.pages.length - 1] === name;
      },
      pushPage(name) {
        this.sheet = '';
        this.pages.push(name);
      },
      closePage() {
        this.pages.pop();
      },
      openSettings() {
        this.pushPage('settings');
      },
      openModeSettings() {
        if (this.appMode === 'image') this.sheet = 'imageWorkbench';
        else if (this.appMode === 'remote') this.pushPage('settings-remote');
        else this.sheet = 'model';
      },
      async openFilesSheet() {
        if (this.appMode === 'remote') {
          await this.loadRemoteWorkspaceFiles(false);
        }
        this.sheet = 'files';
      },
      remoteHostById(id) {
        return this.remoteHosts.find(h => h.id === id) || null;
      },
      remoteHostStatus(host) {
        if (!host) return '';
        if (this.remoteForm.testingHostId === host.id) return '测试中';
        return host.lastStatus || '未测试';
      },
      remoteWorkspaceLabel(host) {
        host = host || this.activeRemoteHost;
        if (!host) return '未选择';
        const ws = (this.remoteForm.workspacesHostId === host.id ? this.remoteForm.workspaces : [])
          .find(x => x.id === host.lastWorkspaceId);
        if (ws) return ws.name || ws.path || ws.id;
        return host.lastWorkspaceId || '未选择';
      },
      upsertRemoteHost(host) {
        host = RemoteAPI.normalizeHost(host);
        if (!host.baseUrl) {
          U.toast('Host 地址不能为空');
          return null;
        }
        const list = this.remoteHosts.slice();
        const i = list.findIndex(h => h.id === host.id || h.baseUrl === host.baseUrl);
        let saved;
        if (i >= 0) {
          saved = Object.assign({}, list[i], host, { id: list[i].id });
          list[i] = saved;
        } else {
          saved = host;
          list.push(saved);
        }
        this.settings.remoteHosts = list;
        this.settings.activeRemoteHostId = saved.id;
        this.persistSettings();
        return saved;
      },
      patchRemoteHost(id, patch) {
        const list = this.remoteHosts.map(h => h.id === id ? Object.assign({}, h, patch) : h);
        this.settings.remoteHosts = list;
        this.persistSettings();
      },
      async addRemoteHost() {
        const text = await this.askText(
          '添加 WepChat Host',
          '',
          '粘贴配对文本，或输入 http://192.168.1.2:8797 token',
          true
        );
        if (text == null) return;
        let host;
        try {
          host = RemoteAPI.parsePairingText(text);
        } catch (e) {
          U.toast(e.message || '配对内容无效', 3500);
          return;
        }
        if (!host.token) {
          const token = await this.askText('Host Token', '', 'wepchat-host 显示的 token');
          if (token == null) return;
          host.token = String(token || '').trim();
        }
        const saved = this.upsertRemoteHost(host);
        if (saved) await this.testRemoteHost(saved);
      },
      async scanRemoteHost() {
        let text;
        try {
          text = await RemoteScan.scan();
        } catch (e) {
          U.toast(e.message || '扫码不可用', 3500);
          return;
        }
        let host;
        try {
          host = RemoteAPI.parsePairingText(text);
        } catch (e) {
          U.toast(e.message || '二维码内容无效', 3500);
          return;
        }
        const saved = this.upsertRemoteHost(host);
        if (saved) await this.testRemoteHost(saved);
      },
      async editRemoteHost(host) {
        if (!host) return;
        const text = await this.askText(
          '编辑 Host',
          (host.baseUrl || '') + (host.token ? '\n' + host.token : ''),
          '第一行 Host 地址，第二行 token',
          true
        );
        if (text == null) return;
        let next;
        try {
          const lines = String(text || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean);
          next = lines.length >= 2
            ? RemoteAPI.normalizeHost({ id: host.id, name: host.name, baseUrl: lines[0], token: lines.slice(1).join(' ') })
            : RemoteAPI.parsePairingText(text);
          next.id = host.id;
          next.name = host.name;
        } catch (e) {
          U.toast(e.message || 'Host 配置无效', 3500);
          return;
        }
        this.upsertRemoteHost(next);
      },
      async deleteRemoteHost(host) {
        if (!host) return;
        const ok = await this.confirm('删除远程 Host：\n' + host.name, '删除 Host');
        if (!ok) return;
        this.settings.remoteHosts = this.remoteHosts.filter(h => h.id !== host.id);
        if (this.settings.activeRemoteHostId === host.id) this.settings.activeRemoteHostId = '';
        if (this.remoteForm.workspacesHostId === host.id) {
          this.remoteForm.workspacesHostId = '';
          this.remoteForm.workspaces = [];
        }
        this.persistSettings();
      },
      async testRemoteHost(host) {
        host = host && this.remoteHostById(host.id) || host;
        if (!host) return false;
        this.remoteForm.testingHostId = host.id;
        try {
          const health = await RemoteAPI.health(host);
          const workspaces = await RemoteAPI.workspaces(host);
          const status = (health.codex ? 'Codex 就绪' : 'Host 在线，Codex 未就绪') + ' · ' + workspaces.length + ' 个工作区';
          this.patchRemoteHost(host.id, {
            lastConnectedAt: U.now(),
            lastStatus: status,
            lastWorkspaceId: host.lastWorkspaceId || (workspaces[0] && workspaces[0].id) || ''
          });
          this.remoteForm.workspacesHostId = host.id;
          this.remoteForm.workspaces = workspaces;
          U.toast('Host 连接正常');
          return true;
        } catch (e) {
          this.patchRemoteHost(host.id, { lastStatus: e.message || '连接失败' });
          U.toast(e.message || 'Host 连接失败', 3500);
          return false;
        } finally {
          this.remoteForm.testingHostId = '';
        }
      },
      async fetchRemoteWorkspaces(host) {
        host = host && this.remoteHostById(host.id) || host;
        if (!host) return [];
        this.remoteForm.loadingHostId = host.id;
        try {
          const workspaces = await RemoteAPI.workspaces(host);
          this.remoteForm.workspacesHostId = host.id;
          this.remoteForm.workspaces = workspaces;
          if (!host.lastWorkspaceId && workspaces[0]) this.patchRemoteHost(host.id, { lastWorkspaceId: workspaces[0].id });
          return workspaces;
        } catch (e) {
          U.toast(e.message || '读取工作区失败', 3500);
          return [];
        } finally {
          this.remoteForm.loadingHostId = '';
        }
      },
      async loadRemoteWorkspaces(host) {
        const rows = await this.fetchRemoteWorkspaces(host);
        if (rows.length) U.toast('已刷新工作区');
      },
      selectRemoteHost(host) {
        if (!host) return;
        this.settings.activeRemoteHostId = host.id;
        this.persistSettings();
      },
      selectRemoteWorkspace(host, ws) {
        if (!host || !ws) return;
        if (this.remoteForm.filesWorkspaceId && this.remoteForm.filesWorkspaceId !== ws.id) {
          this.remoteForm.filesHostId = '';
          this.remoteForm.filesWorkspaceId = '';
          this.remoteForm.files = [];
          this.remoteForm.filesTruncated = false;
        }
        this.patchRemoteHost(host.id, { lastWorkspaceId: ws.id });
      },
      async loadRemoteWorkspaceFiles(force) {
        const remote = this.session && this.session.remote || {};
        const host = this.remoteSessionHost;
        const workspaceId = remote.workspaceId || (host && host.lastWorkspaceId) || '';
        if (!host || !workspaceId) {
          U.toast('请先连接远程 Host 并选择工作区');
          return [];
        }
        if (!force && this.remoteForm.filesHostId === host.id && this.remoteForm.filesWorkspaceId === workspaceId && this.remoteForm.files.length) {
          return this.remoteForm.files;
        }
        this.remoteForm.loadingFiles = true;
        try {
          const result = await RemoteAPI.workspaceFiles(host, workspaceId);
          this.remoteForm.filesHostId = host.id;
          this.remoteForm.filesWorkspaceId = workspaceId;
          this.remoteForm.files = result.data || [];
          this.remoteForm.filesTruncated = !!result.truncated;
          return this.remoteForm.files;
        } catch (e) {
          U.toast(e.message || '读取远程工作区文件失败', 3500);
          return [];
        } finally {
          this.remoteForm.loadingFiles = false;
        }
      },
      openRemoteWorkspaceRow(row) {
        if (!row) return;
        if (row.type === 'folder') {
          this.toggleFolder(row.path);
          return;
        }
        this.insertRemotePath(row.path);
      },
      insertRemotePath(path) {
        path = String(path || '').trim();
        if (!path) return;
        const token = '`' + path.replace(/`/g, '\\`') + '`';
        const el = this.$refs.inputEl;
        const current = String(this.input || '');
        if (el && typeof el.selectionStart === 'number' && typeof el.selectionEnd === 'number') {
          const start = el.selectionStart;
          const end = el.selectionEnd;
          const left = current.slice(0, start);
          const right = current.slice(end);
          const prefix = left && !/\s$/.test(left) ? ' ' : '';
          const suffix = right && !/^\s/.test(right) ? ' ' : '';
          this.input = left + prefix + token + suffix + right;
          nextTick(() => {
            const pos = (left + prefix + token).length;
            if (el.setSelectionRange) el.setSelectionRange(pos, pos);
            if (el.focus) el.focus();
            this.growInput();
          });
        } else {
          this.input = current ? (current.replace(/\s*$/, ' ') + token) : token;
          nextTick(() => this.growInput());
        }
        this.sheet = '';
      },
      async chooseRemoteHost() {
        const hosts = this.remoteHosts;
        if (!hosts.length) {
          const ok = await this.confirm('需要先在设置里添加并测试 WepChat Host。', '远程 Codex');
          if (ok) {
            this.openSettings();
            this.pushPage('settings-remote');
          }
          return null;
        }
        if (hosts.length === 1) return hosts[0];
        const buttons = [{ text: '取消', value: null }];
        hosts.slice(0, 8).forEach(h => {
          buttons.push({ text: h.name, value: h.id, style: h.id === this.settings.activeRemoteHostId ? 'primary' : '' });
        });
        const id = await this.dialog({ title: '选择远程 Host', msg: '这次会话会连接到哪台桌面机器。', buttons });
        return id ? this.remoteHostById(id) : null;
      },
      async chooseRemoteWorkspace(host) {
        const workspaces = await this.fetchRemoteWorkspaces(host);
        if (!workspaces.length) {
          U.toast('Host 没有可用工作区');
          return null;
        }
        const preferred = workspaces.find(ws => ws.id === host.lastWorkspaceId);
        if (workspaces.length === 1) return workspaces[0];
        const buttons = [{ text: '取消', value: null }];
        workspaces.slice(0, 8).forEach(ws => {
          const label = U.truncate(ws.name || ws.path || ws.id, 18);
          buttons.push({ text: label, value: ws.id, style: preferred && preferred.id === ws.id ? 'primary' : '' });
        });
        const id = await this.dialog({
          title: '选择项目目录',
          msg: 'Codex 会在这个工作区里读取、修改和运行命令。',
          buttons
        });
        return id ? workspaces.find(ws => ws.id === id) : null;
      },
      async chooseRemoteThread(host, ws) {
        let threads = [];
        try {
          threads = await RemoteAPI.threads(host, ws.id);
        } catch (e) {
          U.toast(e.message || '读取 Codex 会话失败', 3500);
          return null;
        }
        threads = (threads || []).filter(t => t && t.id);
        if (!threads.length) {
          U.toast('这个工作区没有可续接的 Codex 会话');
          return null;
        }
        const shown = threads.slice(0, 5);
        const buttons = [{ text: '取消', value: null }];
        shown.forEach((t, i) => {
          buttons.push({ text: (i + 1) + '. ' + RemoteHistory.threadLabel(U, t), value: t.id, style: 'primary' });
        });
        const id = await this.dialog({
          title: '续接 Codex 会话',
          msg: shown.map((t, i) => {
            return (i + 1) + '. ' + RemoteHistory.threadLabel(U, t) + '\n' + (RemoteHistory.threadMeta(U, t) || t.id);
          }).join('\n\n'),
          buttons
        });
        return id ? threads.find(t => t.id === id) : null;
      },
      async resumeRemoteThread(host, ws, thread) {
        const client = RemoteAPI.createSession(host);
        try {
          await client.connect();
          const resumed = await client.request('remote.thread.resume', {
            workspaceId: ws.id,
            threadId: thread.id
          });
          let read = null;
          try {
            read = await client.request('remote.thread.read', {
              threadId: thread.id,
              includeTurns: true
            });
          } catch (e) {}
          return {
            resumed,
            read,
            historyMessages: RemoteHistory.messagesFromResult(U, { resumed, read })
          };
        } finally {
          client.close();
        }
      },
      async prepareRemoteSession(options) {
        options = options || {};
        const host = await this.chooseRemoteHost();
        if (!host) return null;
        const ws = await this.chooseRemoteWorkspace(host);
        if (!ws) return null;
        this.selectRemoteHost(host);
        this.selectRemoteWorkspace(host, ws);
        let mode = options.resumeOnly ? 'resume' : 'new';
        if (!options.resumeOnly && !options.newOnly) {
          mode = await this.dialog({
            title: '远程 Codex',
            msg: '新建一个 Codex 线程，或续接桌面上已有的线程。',
            buttons: [
              { text: '取消', value: null },
              { text: '新建', value: 'new', style: 'primary' },
              { text: '续接', value: 'resume', style: 'primary' }
            ]
          });
          if (!mode) return null;
        }
        let thread = null;
        let resumed = null;
        if (mode === 'resume') {
          thread = await this.chooseRemoteThread(host, ws);
          if (!thread) return null;
          try {
            resumed = await this.resumeRemoteThread(host, ws, thread);
          } catch (e) {
            U.toast(e.message || '续接 Codex 会话失败', 3500);
            return null;
          }
        }
        return {
          hostId: host.id,
          hostName: host.name,
          baseUrl: host.baseUrl,
          workspaceId: ws.id,
          workspaceName: ws.name || ws.path || ws.id,
          workspacePath: ws.path || '',
          codexThreadId: thread && thread.id || '',
          hostSessionId: resumed && resumed.resumed && resumed.resumed.hostSessionId || '',
          lastSeq: 0,
          _historyMessages: resumed && resumed.historyMessages || []
        };
      },
      async resumeRemoteThreadFromSettings() {
        const canLeave = await this.confirmStopRunning('续接 Codex 会话');
        if (!canLeave) return;
        const remote = await this.prepareRemoteSession({ resumeOnly: true });
        if (!remote) return;
        const historyMessages = remote._historyMessages || [];
        delete remote._historyMessages;
        this.session = Store.newSession();
        this.session.mode = 'remote';
        this.session.remote = remote;
        this.session.messages = historyMessages;
        this.session.title = '远程：' + (remote.workspaceName || 'Codex');
        this.session.providerId = this.settings.activeProviderId || '';
        this.session.model = this.settings.activeModel || '';
        this.input = '';
        this.attachments = [];
        this.pages = [];
        this.drawerOpen = false;
        this.persistSession();
        U.toast(historyMessages.length ? ('已同步 ' + historyMessages.length + ' 条历史消息') : '已续接，未读取到可显示历史');
        nextTick(() => this.scrollToBottom(true));
      },

      async dialog(opts) {
        return new Promise(resolve => {
          this.dlg = Object.assign({}, opts, { _resolve: resolve });
          nextTick(() => {
            const el = this.$refs.dlgInput;
            if (el && el.focus) el.focus();
          });
        });
      },
      dlgAnswer(value) {
        const d = this.dlg;
        this.dlg = null;
        if (d && d._resolve) d._resolve(value);
      },
      confirm(msg, title) {
        return this.dialog({
          title: title || '确认',
          msg,
          buttons: [
            { text: '取消', value: false },
            { text: '确定', value: true, style: 'primary' }
          ]
        });
      },
      async confirmStopRunning(actionText) {
        if (!this.generating) return true;
        const ok = await this.dialog({
          title: '任务正在运行',
          msg: '当前会话正在生成回复。' + (actionText || '继续操作') + '会停止当前任务。',
          buttons: [
            { text: '继续等待', value: false },
            { text: '停止并继续', value: true, style: 'primary' }
          ]
        });
        if (!ok) return false;
        this.stopGenerate();
        await this.flushSessionPersist(900);
        return true;
      },
      async askText(title, value, placeholder, textarea) {
        return new Promise(resolve => {
          const dlg = {
            title,
            value: value || '',
            placeholder: placeholder || '',
            input: textarea ? null : '',
            textarea: !!textarea,
            buttons: [
              { text: '取消', value: null },
              { text: '确定', value: 'ok', style: 'primary' }
            ],
            _resolve: v => resolve(v === 'ok' ? dlg.value : null)
          };
          this.dlg = dlg;
          nextTick(() => {
            const el = this.$refs.dlgInput;
            if (el && el.focus) el.focus();
          });
        });
      },

      async newSession() {
        const canLeave = await this.confirmStopRunning('新建会话');
        if (!canLeave) return;
        const mode = await this.dialog({
          title: '新建会话',
          msg: '选择这次会话的模式。创建后不可修改。',
          buttons: [
            { text: '取消', value: null },
            { text: '常规', value: 'chat', style: 'primary' },
            { text: '生图', value: 'image', style: 'primary' },
            { text: '远程', value: 'remote', style: 'primary' }
          ]
        });
        if (!mode) return;
        const remote = mode === 'remote' ? await this.prepareRemoteSession() : null;
        if (mode === 'remote' && !remote) return;
        const historyMessages = remote && remote._historyMessages || [];
        if (remote) delete remote._historyMessages;
        this.session = Store.newSession();
        this.session.mode = mode === 'image' ? 'image' : (mode === 'remote' ? 'remote' : 'chat');
        this.session.remote = remote;
        if (historyMessages.length) this.session.messages = historyMessages;
        if (remote) this.session.title = '远程：' + (remote.workspaceName || 'Codex');
        this.session.providerId = this.settings.activeProviderId || '';
        this.session.model = this.settings.activeModel || '';
        this.persistSession();
        this.input = '';
        this.attachments = [];
        this.drawerOpen = false;
        nextTick(() => this.scrollToBottom(true));
      },
      async openSession(id) {
        if (id === this.session.id) {
          this.drawerOpen = false;
          return;
        }
        const s = Store.loadSession(id);
        if (!s) {
          U.toast('会话不存在');
          return;
        }
        const canLeave = await this.confirmStopRunning('切换会话');
        if (!canLeave) return;
        this.session = normalizeSession(s);
        this.drawerOpen = false;
        nextTick(() => this.scrollToBottom(true));
      },
      async renameSession(it) {
        const name = await this.askText('重命名会话', it.title || '新聊天', '会话名称');
        if (name == null) return;
        it.title = cleanTitle(name);
        if (this.session.id === it.id) this.session.title = it.title;
        const s = Store.loadSession(it.id);
        if (s) {
          s.title = it.title;
          Store.saveSession(s);
        }
        Store.saveIndex(this.index);
        this.sheet = '';
      },
      togglePin(it) {
        it.pinned = !it.pinned;
        if (this.session.id === it.id) {
          this.session.pinned = it.pinned;
          Store.saveSession(this.session);
        } else {
          const s = Store.loadSession(it.id);
          if (s) {
            s.pinned = it.pinned;
            Store.saveSession(s);
          }
        }
        Store.saveIndex(this.index);
        this.sheet = '';
      },
      async deleteSessionAsk(it) {
        const ok = await this.confirm('删除后无法恢复：\n' + (it.title || '新聊天'), '删除会话');
        if (!ok) return;
        if (it && this.session.id === it.id) {
          const canLeave = await this.confirmStopRunning('删除当前会话');
          if (!canLeave) return;
        }
        Store.deleteSession(it.id);
        this.index = this.index.filter(x => x.id !== it.id);
        Store.saveIndex(this.index);
        if (this.session.id === it.id) {
          const next = this.index[0] && Store.loadSession(this.index[0].id);
          this.session = normalizeSession(next || Store.newSession());
        }
        this.sheet = '';
      },
      toggleManagedSession(id) {
        this.sessionManagerOpen = Object.assign({}, this.sessionManagerOpen, {
          [id]: !this.sessionManagerOpen[id]
        });
      },
      async renameManagedSession(item) {
        if (!item) return;
        const name = await this.askText('重命名会话', item.title || '新聊天', '会话名称');
        if (name == null) return;
        const title = cleanTitle(name);
        const s = Store.loadSession(item.id);
        if (!s) {
          U.toast('会话不存在');
          this.index = Store.loadIndex();
          return;
        }
        s.title = title;
        Store.saveSession(s);
        const i = this.index.findIndex(x => x.id === item.id);
        if (i >= 0) this.index[i] = Object.assign({}, this.index[i], {
          title,
          updatedAt: s.updatedAt
        });
        if (this.session.id === item.id) this.session.title = title;
        Store.saveIndex(this.index);
        this.storageUsed = Store.usage();
        U.toast('已重命名');
      },
      async clearManagedSessionFiles(item) {
        if (!item) return;
        if (!item.fileCount) {
          U.toast('这个会话没有工作区文件');
          return;
        }
        const ok = await this.confirm(
          '这会真正删除该会话工作区内的 ' + item.fileCount + ' 个文件，无法恢复。\n\n会话消息、名称和模型配置会保留。\n\n会话：' + item.title,
          '删除工作区文件'
        );
        if (!ok) return;
        const s = Store.loadSession(item.id);
        if (!s) {
          U.toast('会话不存在');
          this.index = Store.loadIndex();
          return;
        }
        s.files = {};
        s.folders = [];
        Store.saveSession(s);
        const i = this.index.findIndex(x => x.id === item.id);
        if (i >= 0) this.index[i] = Object.assign({}, this.index[i], { updatedAt: s.updatedAt });
        Store.saveIndex(this.index);
        if (this.session.id === item.id) {
          this.session.files = {};
          this.session.folders = [];
          this.session.updatedAt = s.updatedAt;
        }
        this.storageUsed = Store.usage();
        U.toast('已删除工作区文件');
      },
      async deleteManagedSession(item) {
        if (!item) return;
        const ok = await this.confirm(
          '这会真正删除该会话、全部消息和它的工作区文件，无法恢复。\n\n会话：' + item.title + '\n工作区：' + item.fileCount + ' 个文件，约 ' + U.fmtSize(item.workspaceSize),
          '真正删除会话'
        );
        if (!ok) return;
        if (this.session.id === item.id) {
          const canLeave = await this.confirmStopRunning('删除当前会话');
          if (!canLeave) return;
        }
        Store.deleteSession(item.id);
        this.index = this.index.filter(x => x.id !== item.id);
        Store.saveIndex(this.index);
        delete this.sessionManagerOpen[item.id];
        this.sessionManagerOpen = Object.assign({}, this.sessionManagerOpen);
        if (this.session.id === item.id) {
          const next = this.index[0] && Store.loadSession(this.index[0].id);
          this.session = normalizeSession(next || Store.newSession());
        }
        this.storageUsed = Store.usage();
        U.toast('会话已删除');
      },
      toastExportResult(result, fallback) {
        if (!result) return;
        if (typeof result === 'string') U.toast((fallback || '已导出') + '：' + result, 3200);
        else if (result.path === '系统分享面板' || result.path === '系统相册') U.toast((fallback || '已完成') + '：' + result.path, 3200);
        else if (result.path) U.toast((fallback || '已导出') + '到 ' + result.path, 3200);
        else U.toast(fallback || '已导出');
      },
      toastExportError(e) {
        if (e && e.name === 'AbortError') return;
        U.toast('导出失败：' + (e && e.message || String(e)), 3600);
      },
      async exportSession(it) {
        const s = Store.loadSession(it.id) || this.session;
        const name = fileSafeName((s.title || 'wepchat-session') + '.json');
        try {
          const saved = await U.saveTextFile(name, JSON.stringify(s, null, 2));
          this.toastExportResult(saved, '已导出会话');
        } catch (e) {
          this.toastExportError(e);
        }
        this.sheet = '';
      },

      addProvider() {
        const p = newProvider();
        this.provForm = {
          isNew: true,
          data: p,
          modelsText: modelsText(p),
          imageModelsText: imageModelsText(p),
          selectedModel: p.models[0] || '',
          selectedImageModel: p.imageModels && p.imageModels[0] || '',
          showKey: false,
          fetching: false,
          testing: false
        };
        this.pushPage('provider');
      },
      editProvider(p) {
        const data = MODEL_META.normalizeProvider(clone(p));
        data.extraHeaders = data.extraHeaders || [];
        this.provForm = {
          isNew: false,
          data,
          modelsText: modelsText(data),
          imageModelsText: imageModelsText(data),
          selectedModel: data.models[0] || '',
          selectedImageModel: data.imageModels && data.imageModels[0] || '',
          showKey: false,
          fetching: false,
          testing: false
        };
        this.pushPage('provider');
      },
      syncProvModelsFromText() {
        const p = this.provForm.data;
        if (!p) return;
        p.models = parseModels(this.provForm.modelsText);
        p.modelMeta = p.modelMeta || {};
        p.models.forEach(id => {
          p.modelMeta[id] = MODEL_META.mergeMeta(providerModelMeta(p, id), p.modelMeta[id]);
        });
        Object.keys(p.modelMeta).forEach(id => {
          if (!p.models.includes(id)) delete p.modelMeta[id];
        });
        if (!this.provForm.selectedModel || !p.models.includes(this.provForm.selectedModel)) {
          this.provForm.selectedModel = p.models[0] || '';
        }
      },
      syncProvImageModelsFromText() {
        const p = this.provForm.data;
        if (!p) return;
        p.imageModels = parseModels(this.provForm.imageModelsText);
        p.imageModelMeta = p.imageModelMeta || {};
        p.imageModels.forEach(id => {
          p.imageModelMeta[id] = MODEL_META.mergeMeta(providerModelMeta(p, id), p.imageModelMeta[id]);
          p.imageModelMeta[id].capabilities = Object.assign({}, p.imageModelMeta[id].capabilities || {}, {
            imageGeneration: true,
            tools: false,
            structuredOutput: false
          });
        });
        Object.keys(p.imageModelMeta).forEach(id => {
          if (!p.imageModels.includes(id)) delete p.imageModelMeta[id];
        });
        if (!this.provForm.selectedImageModel || !p.imageModels.includes(this.provForm.selectedImageModel)) {
          this.provForm.selectedImageModel = p.imageModels[0] || '';
        }
      },
      selectedProvModelMeta() {
        const p = this.provForm.data;
        const id = this.provForm.selectedModel;
        if (!p || !id) return null;
        this.syncProvModelsFromText();
        p.modelMeta = p.modelMeta || {};
        p.modelMeta[id] = MODEL_META.mergeMeta(providerModelMeta(p, id), p.modelMeta[id]);
        return p.modelMeta[id];
      },
      setSelectedModelNumber(key, val) {
        const meta = this.selectedProvModelMeta();
        if (!meta) return;
        const n = MODEL_META.toInt(val);
        meta[key] = n == null ? 0 : n;
      },
      toggleSelectedModelCap(key) {
        const meta = this.selectedProvModelMeta();
        if (!meta) return;
        meta.capabilities = meta.capabilities || {};
        meta.capabilities[key] = !meta.capabilities[key];
      },
      saveProvider() {
        const p = this.provForm.data;
        if (!p) return;
        p.name = String(p.name || '').trim() || '未命名提供商';
        p.baseUrl = String(p.baseUrl || '').trim();
        p.imageBaseUrl = String(p.imageBaseUrl || '').trim();
        p.imageApiKey = String(p.imageApiKey || '').trim();
        p.imageEndpointPath = String(p.imageEndpointPath || '').trim();
        p.imageEditEndpointPath = String(p.imageEditEndpointPath || '').trim();
        this.syncProvModelsFromText();
        this.syncProvImageModelsFromText();
        MODEL_META.normalizeProvider(p);
        if (!p.baseUrl) {
          U.toast('请填写 API 地址');
          return;
        }
        const i = this.providers.findIndex(x => x.id === p.id);
        if (i >= 0) this.providers[i] = p;
        else this.providers.push(p);
        if (!this.settings.activeProviderId) {
          this.settings.activeProviderId = p.id;
          this.settings.activeModel = p.models[0] || '';
        }
        if (this.settings.activeProviderId === p.id && this.settings.activeModel && !p.models.includes(this.settings.activeModel)) {
          this.settings.activeModel = p.models[0] || '';
          if (this.session.providerId === p.id) this.session.model = this.settings.activeModel;
        }
        if (this.settings.imageProviderId === p.id && this.settings.imageModel && !(p.imageModels || []).includes(this.settings.imageModel)) {
          this.settings.imageModel = p.imageModels && p.imageModels[0] || '';
        }
        this.persistProviders();
        this.persistSettings();
        this.closePage();
        U.toast('已保存');
      },
      async deleteProviderAsk() {
        const p = this.provForm.data;
        if (!p) return;
        const ok = await this.confirm('删除提供商：' + p.name, '删除提供商');
        if (!ok) return;
        this.providers = this.providers.filter(x => x.id !== p.id);
        if (this.settings.activeProviderId === p.id) {
          const next = this.providers[0];
          this.settings.activeProviderId = next ? next.id : '';
          this.settings.activeModel = next && next.models[0] || '';
        }
        this.persistProviders();
        this.persistSettings();
        this.closePage();
      },
      pickModel(p, md) {
        const oldModel = this.settings.activeModel || this.session.model || '';
        const oldProvider = this.settings.activeProviderId || this.session.providerId || '';
        if ((oldModel || oldProvider) && this.session.messages.length && (oldModel !== (md || p.models[0] || '') || oldProvider !== p.id)) {
          U.toast('当前会话中途切换模型可能导致上下文风格和工具能力不一致', 3600);
        }
        this.settings.activeProviderId = p.id;
        this.settings.activeModel = md || p.models[0] || '';
        this.session.providerId = p.id;
        this.session.model = this.settings.activeModel;
        this.persistSettings();
        this.persistSession();
        this.sheet = '';
      },
      apiTypeLabel(api) {
        const t = API.API_TYPES.find(x => x.value === api);
        return t ? t.label : api;
      },
      async fetchModels() {
        const p = this.provForm.data;
        if (!p || !p.baseUrl) {
          U.toast('请先填写 API 地址');
          return;
        }
        this.provForm.fetching = true;
        try {
          const rawModels = API.listModelsDetailed ? await API.listModelsDetailed(p) : await API.listModels(p);
          MODEL_META.applyApiModels(p, rawModels);
          this.provForm.modelsText = modelsText(p);
          this.provForm.imageModelsText = imageModelsText(p);
          this.provForm.selectedModel = p.models[0] || '';
          this.provForm.selectedImageModel = p.imageModels && p.imageModels[0] || '';
          U.toast((p.models.length || (p.imageModels && p.imageModels.length)) ? '已获取模型列表和元数据' : '接口返回空列表');
        } catch (e) {
          U.toast(e.message || '获取失败', 3500);
        } finally {
          this.provForm.fetching = false;
        }
      },
      async testProvider() {
        const p = this.provForm.data;
        if (!p || !p.baseUrl) {
          U.toast('请先填写 API 地址');
          return;
        }
        this.provForm.testing = true;
        try {
          await API.listModels(p);
          U.toast('连接正常');
        } catch (e) {
          U.toast(e.message || '连接失败', 3500);
        } finally {
          this.provForm.testing = false;
        }
      },

      renderMd(m) {
        return m.status === 'streaming' ? MD.renderStreaming(m.content || '') : MD.render(m.content || '');
      },
      toolLabel(name) {
        const map = {
          run_js: 'JavaScript 沙盒',
          read_file: '读取文件',
          write_file: '写入文件',
          edit_file: '修改文件',
          delete_file: '删除文件',
          list_files: '列出文件',
          create_folder: '创建文件夹',
          move_path: '移动路径',
          path_exists: '检查路径',
          preview_file: '预览文件',
          create_workspace: '创建工作区',
          run_service: '启动预览',
          stop_service: '停止预览',
          list_services: '列出预览',
          web_fetch: '抓取网页',
          image_go: '图片生成',
          image_generation: '图片生成',
          codex_command: 'Codex 命令',
          codex_file_change: 'Codex 文件变更',
          codex_reasoning: 'Codex 思考',
          codex_approval: 'Codex 授权',
          codex_item: 'Codex 事件'
        };
        return map[name] || name || '工具';
      },
      toolArgObject(t) {
        if (!t || t.arguments == null) return {};
        try {
          return typeof t.arguments === 'string' ? JSON.parse(t.arguments) : (t.arguments || {});
        } catch (e) {
          return {};
        }
      },
      isRemoteTool(t) {
        return /^codex_/i.test(String(t && t.name || ''));
      },
      shouldDisplayToolCall(t) {
        if (!t) return false;
        const name = String(t.name || '');
        if (name === 'codex_item' || name === 'codex_reasoning') return false;
        if (name === 'codex_file_change') {
          const args = this.toolArgObject(t);
          return !!(t.result || args.path || args.file || args.summary || args.files || args.changes || args.diff);
        }
        return true;
      },
      displayToolCalls(m) {
        return (m && m.toolCalls || []).filter(t => this.shouldDisplayToolCall(t));
      },
      toolTitle(t) {
        const name = String(t && t.name || '');
        const args = this.toolArgObject(t);
        if (name === 'codex_command') {
          const cmd = String(args.command || args.cmd || args.commandLine || '').replace(/\s+/g, ' ').trim();
          return cmd ? ('命令 · ' + U.truncate(cmd, 34)) : 'Codex 命令';
        }
        if (name === 'codex_file_change') {
          const firstFile = Array.isArray(args.files) ? args.files[0] : '';
          const label = String(args.path || args.file || firstFile || args.summary || '').trim();
          return label ? ('文件变更 · ' + U.truncate(label, 32)) : 'Codex 文件变更';
        }
        if (name === 'codex_approval') {
          const subject = String(args.command || args.path || args.kind || '').replace(/\s+/g, ' ').trim();
          return subject ? ('授权 · ' + U.truncate(subject, 34)) : 'Codex 授权';
        }
        return this.toolLabel(name);
      },
      prettyJson(v) {
        if (v == null) return '';
        try {
          const obj = typeof v === 'string' ? JSON.parse(v) : v;
          return JSON.stringify(obj, null, 2);
        } catch (e) {
          return String(v);
        }
      },
      isDiffResult(text) {
        return /(^|\n)--- .+\n\+\+\+ .+\n@@/.test(String(text || ''));
      },
      renderDiff(text) {
        const lines = String(text || '').split('\n');
        const html = lines.map(line => {
          let cls = 'ctx';
          if (/^--- |^\+\+\+ |^@@/.test(line)) cls = 'meta';
          else if (line.startsWith('+')) cls = 'add';
          else if (line.startsWith('-')) cls = 'del';
          return '<div class="df-line ' + cls + '">' + U.escapeHtml(line || ' ') + '</div>';
        }).join('');
        return '<div class="diff-view">' + html + '</div>';
      },
      async authorizeToolCall(t) {
        const key = this.toolPermissionKey(t.name);
        let mode = this.toolPermission(t.name);
        if (key === 'delete_files' && mode === 'always') mode = 'ask';
        const label = this.toolPermissionLabel(t.name);
        if (mode === 'never') return '错误：用户已禁止工具：' + label;
        if (mode === 'always') return '';
        const ok = await this.confirm(
          'AI 请求使用工具：' + label + '\n\n' +
          '工具名：' + t.name + '\n' +
          '参数：\n' + U.truncate(this.prettyJson(t.arguments), 900),
          '工具授权'
        );
        return ok ? '' : '错误：用户拒绝了工具调用：' + label;
      },
      async copyMsg(m) {
        const ok = await U.copyText(m.content || '');
        U.toast(ok ? '已复制' : '复制失败');
      },
      editMsg(i) {
        const m = this.session.messages[i];
        if (!m || m.role !== 'user') return;
        this.input = m.content || '';
        this.attachments = clone(m.attachments || []);
        this.session.messages.splice(i);
        this.persistSession();
        nextTick(() => this.growInput());
      },
      deleteMsg(i) {
        this.session.messages.splice(i, 1);
        this.persistSession();
      },
      async regenerate(i) {
        if (this.generating) return;
        if (this.appMode === 'remote') {
          U.toast('远程会话暂不支持重新生成');
          return;
        }
        const m = this.session.messages[i];
        if (!m || m.role !== 'assistant') return;
        this.session.messages.splice(i);
        this.persistSession();
        await this.generateAssistant();
      },

      settingsForRequest(tools) {
        const s = Object.assign({}, this.settings);
        if (tools && tools.length) {
          s.systemPrompt = [this.settings.systemPrompt, Tools.SYSTEM_HINT].filter(Boolean).join('\n\n');
        }
        return s;
      },
      apiBaseMessages() {
        return this.session.messages
          .filter(m => m.role === 'user' || m.role === 'assistant')
          .map(m => {
            if (m.role === 'assistant') {
              return { role: 'assistant', content: m.content || '', reasoning: m.reasoning || '' };
            }
            return clone(m);
          });
      },
      imageRequestModel() {
        const provider = this.imageProvider;
        const model = this.imageModelId;
        if (!provider) throw new Error('请先添加图片提供商');
        if (!provider.baseUrl) throw new Error('请先填写图片提供商 API 地址');
        if (!model) throw new Error('请先在图片生成设置中选择模型');
        const imageProvider = Object.assign({}, provider, {
          baseUrl: String(provider.imageBaseUrl || provider.baseUrl || '').trim(),
          apiKey: provider.imageApiKey || provider.apiKey || '',
          imageEndpointPath: String(this.settings.imageEndpointPath || provider.imageEndpointPath || '').trim(),
          imageEditEndpointPath: String(this.settings.imageEditEndpointPath || provider.imageEditEndpointPath || '').trim()
        });
        return { provider: imageProvider, model };
      },
      imagePromptFromArgs(args) {
        const parts = [String(args.prompt || '').trim()];
        const presetId = Object.prototype.hasOwnProperty.call(args, 'stylePresetId')
          ? args.stylePresetId
          : this.settings.imageStylePresetId;
        const preset = this.imageStylePresetById(presetId);
        if (preset) parts.push('风格预设（' + preset.name + '）：' + preset.prompt);
        if (args.style) parts.push('风格：' + args.style);
        return parts.filter(Boolean).join('\n');
      },
      imageReferencesFromArgs(args) {
        const refs = [];
        const names = []
          .concat(args.parentFile ? [args.parentFile] : [])
          .concat(Array.isArray(args.referenceFiles) ? args.referenceFiles : []);
        names.forEach(name => {
          try {
            const path = normalizeWorkspacePath(name);
            const f = this.session.files && this.session.files[path];
            if (f && f.dataUrl) refs.push({ name: path.split('/').pop() || 'reference.png', path, dataUrl: f.dataUrl, mime: f.mime || '' });
          } catch (e) {}
        });
        (args.referenceImages || []).forEach((img, idx) => {
          if (img && img.dataUrl) refs.push({ name: img.name || ('reference_' + (idx + 1) + '.png'), dataUrl: img.dataUrl, mime: img.mime || '' });
        });
        return refs;
      },
      recentImageReferencePaths() {
        const out = [];
        const msgs = (this.session.messages || []).slice().reverse();
        for (const m of msgs) {
          (m.attachments || []).forEach(a => {
            if (a.kind === 'image' && a.path && !out.includes(a.path)) out.push(a.path);
          });
          if (out.length) break;
        }
        return out;
      },
      saveGeneratedImages(images, args, provider, model) {
        const saved = [];
        this.session.files = this.session.files || {};
        (images || []).forEach((img, idx) => {
          if (!img || !img.dataUrl) return;
          if (Object.keys(this.session.files).length >= Tools.MAX_FILES) throw new Error('会话文件数已达上限');
          let path = args.targetFile && images.length === 1 ? args.targetFile : imageFileName(args.prompt, idx, img.mime);
          try { path = normalizeWorkspacePath(path); }
          catch (e) { path = imageFileName(args.prompt, idx, img.mime); }
          if (!isImageName(path)) path += '.' + imageExtForMime(img.mime);
          if (this.session.files[path]) {
            const ext = '.' + imageExtForMime(img.mime);
            path = path.replace(/\.[a-z0-9]+$/i, '') + '_' + U.uuid().slice(0, 4) + ext;
          }
          ensureParentFolders(this.session, path);
          const size = Math.ceil(String(img.dataUrl).length * 0.75);
          this.session.files[path] = {
            dataUrl: img.dataUrl,
            mime: img.mime || 'image/png',
            size,
            mtime: U.now(),
            source: args.source || 'image_mode',
            imageMeta: {
              prompt: args.prompt || '',
              revisedPrompt: img.revisedPrompt || '',
              model,
              providerId: provider.id,
              mode: args.mode || 'generate',
              size: args.size || this.settings.imageDefaultSize || 'auto',
              count: args.count || 1,
              quality: args.quality || this.settings.imageQuality || 'auto',
              background: args.background || this.settings.imageBackground || 'auto',
              outputFormat: args.outputFormat || this.settings.imageOutputFormat || 'png',
              style: args.style || '',
              stylePresetId: args.stylePresetId || '',
              stylePresetName: args.stylePresetName || '',
              referenceFiles: args.referenceFiles || [],
              parentFile: args.parentFile || ''
            }
          };
          saved.push({ path, dataUrl: img.dataUrl, mime: img.mime || 'image/png', prompt: args.prompt || '' });
        });
        if (saved.length) this.openFolders.images = true;
        return saved;
      },
      async runImageRequest(rawArgs, targetMsg) {
        const args = Object.assign({}, rawArgs || {});
        if (!Object.prototype.hasOwnProperty.call(args, 'stylePresetId')) {
          args.stylePresetId = this.settings.imageStylePresetId || '';
        }
        const preset = this.imageStylePresetById(args.stylePresetId);
        args.stylePresetName = preset ? preset.name : '';
        args.prompt = this.imagePromptFromArgs(args);
        if (!args.prompt) throw new Error('缺少图片提示词');
        args.size = args.size || this.settings.imageDefaultSize || 'auto';
        args.quality = args.quality || this.settings.imageQuality || 'auto';
        args.background = args.background || this.settings.imageBackground || 'auto';
        args.outputFormat = args.outputFormat || this.settings.imageOutputFormat || 'png';
        args.count = U.clamp(parseInt(args.count || 1, 10) || 1, 1, 8);
        const { provider, model } = this.imageRequestModel();
        const meta = providerModelMeta(provider, model);
        const caps = meta && meta.capabilities || {};
        if (!(caps.imageGeneration || (meta.image && meta.image.generation))) {
          U.toast('当前图片模型元数据未标记生图能力，仍尝试调用接口', 3200);
        }
        const referenceImages = this.imageReferencesFromArgs(args);
        if (args.mode === 'edit' && !referenceImages.length) {
          throw new Error('图片编辑需要至少一张参考图');
        }
        const result = await ImageAPI.generate({
          provider,
          model,
          prompt: args.prompt,
          mode: args.mode || (referenceImages.length ? 'edit' : 'generate'),
          referenceImages,
          size: args.size,
          count: args.count,
          settings: {
            size: args.size,
            count: args.count,
            quality: args.quality,
            background: args.background,
            outputFormat: args.outputFormat,
            apiMode: this.settings.imageApiMode || 'images',
            endpointPath: this.settings.imageEndpointPath || provider.imageEndpointPath || '',
            editsEndpointPath: this.settings.imageEditEndpointPath || provider.imageEditEndpointPath || '',
            imageOnly: !!(caps.imageGeneration || (meta.image && meta.image.generation))
          },
          signal: this.abortCtl && this.abortCtl.signal
        });
        const saved = this.saveGeneratedImages(result.images || [], args, provider, model);
        if (!saved.length) throw new Error('接口未返回可用图片');
        if (targetMsg) {
          targetMsg.images = (targetMsg.images || []).concat(saved);
          targetMsg.content = targetMsg.content || ('已生成 ' + saved.length + ' 张图片，已保存到工作区 images/。');
        }
        this.persistSession();
        return saved;
      },
      async imageGoTool(args, targetMsg) {
        args = Object.assign({}, args || {});
        const refs = []
          .concat(args.parentFile ? [args.parentFile] : [])
          .concat(Array.isArray(args.referenceFiles) ? args.referenceFiles : []);
        if (!refs.length && (args.mode === 'edit' || this.recentImageReferencePaths().length)) {
          args.referenceFiles = this.recentImageReferencePaths();
          if (args.referenceFiles.length) args.mode = 'edit';
        }
        const saved = await this.runImageRequest(Object.assign({}, args, { source: 'image_go' }), targetMsg);
        return '已生成 ' + saved.length + ' 张图片并写入当前会话工作区：\n' + saved.map(x => '- ' + x.path).join('\n');
      },
      async sendWorkbenchImageMessage() {
        const content = String(this.imageWorkbenchPrompt || '').trim();
        if (!content) {
          U.toast('请先描述你想生成的图片');
          return;
        }
        this.sheet = '';
        await this.sendImageMessage(content);
      },
      async sendImageMessage(promptOverride) {
        const usingOverride = promptOverride != null;
        const content = String(usingOverride ? promptOverride : this.input).trim();
        if (!content) {
          U.toast('请先描述你想生成的图片');
          return;
        }
        try { this.imageRequestModel(); }
        catch (e) {
          U.toast(e.message || '请先配置图片生成模型', 3200);
          this.openSettings();
          return;
        }
        const user = {
          id: U.uuid(),
          role: 'user',
          content,
          attachments: clone(this.attachments),
          createdAt: U.now()
        };
        const referenceFiles = (this.attachments || [])
          .filter(a => a.kind === 'image' && a.path)
          .map(a => a.path);
        this.session.messages.push(user);
        if (!this.session.title && content) this.session.title = cleanTitle(content);
        const assistant = {
          id: U.uuid(),
          role: 'assistant',
          content: '',
          images: [],
          status: 'streaming',
          model: this.imageModelId,
          createdAt: U.now()
        };
        this.session.messages.push(assistant);
        const assistantMsg = this.session.messages[this.session.messages.length - 1];
        if (usingOverride) this.imageWorkbenchPrompt = '';
        else this.input = '';
        this.attachments = [];
        this.generating = true;
        this.requestNotificationPermission();
        this.stopRequested = false;
        this.abortCtl = new AbortController();
        this.persistSession();
        nextTick(() => {
          this.growInput();
          this.scrollToBottom(true);
        });
        try {
          await this.runImageRequest({
            prompt: content,
            source: 'image_mode',
            mode: referenceFiles.length ? 'edit' : 'generate',
            referenceFiles
          }, assistantMsg);
          assistantMsg.status = 'done';
        } catch (e) {
          assistantMsg.status = 'done';
          assistantMsg.error = e && e.message || String(e);
        } finally {
          this.generating = false;
          this.abortCtl = null;
          this.stopRequested = false;
          this.clearRunningNotification();
          await this.flushSessionPersist(1200);
          nextTick(() => this.scrollToBottom(false));
        }
      },
      remoteEventApplies(ev) {
        const r = this.session && this.session.remote || {};
        const rt = this.remoteRuntime || {};
        const threadId = rt.threadId || r.codexThreadId || '';
        return !(ev && ev.threadId && threadId && ev.threadId !== threadId);
      },
      remoteAssistantMsg(id) {
        const targetId = id || this.remoteRuntime && this.remoteRuntime.assistantId;
        return targetId ? (this.session.messages || []).find(m => m.id === targetId) : null;
      },
      remoteTurnMessages() {
        const rt = this.remoteRuntime || {};
        const ids = new Set((rt.messageIds || []).concat(rt.assistantId ? [rt.assistantId] : []));
        return (this.session.messages || []).filter(m => ids.has(m.id));
      },
      remoteFindToolMessage(toolId) {
        if (!toolId) return null;
        return this.remoteTurnMessages().find(m => (m.toolCalls || []).some(t => t.id === toolId)) || null;
      },
      remoteMessageHasText(msg) {
        return !!(msg && (String(msg.content || '').trim() || String(msg._remoteContent || '').trim() || String(msg.reasoning || '').trim()));
      },
      remoteNewSegment(kind) {
        const msg = {
          id: U.uuid(),
          role: 'assistant',
          content: '',
          reasoning: '',
          toolCalls: [],
          previews: [],
          status: 'streaming',
          model: 'Codex',
          createdAt: U.now(),
          _remoteSegment: kind || 'text'
        };
        this.session.messages.push(msg);
        this.remoteRuntime.assistantId = msg.id;
        this.remoteRuntime.messageIds = (this.remoteRuntime.messageIds || []).concat(msg.id);
        return msg;
      },
      remoteEnsureSegment(kind, toolId) {
        const rt = this.remoteRuntime || {};
        if (toolId) {
          const existing = this.remoteFindToolMessage(toolId);
          if (existing) {
            rt.assistantId = existing.id;
            return existing;
          }
        }

        let msg = this.remoteAssistantMsg();
        if (!msg && (rt.messageIds || []).length) msg = this.remoteAssistantMsg(rt.messageIds[rt.messageIds.length - 1]);
        if (msg) {
          const hasTools = !!((msg.toolCalls || []).length);
          const hasText = this.remoteMessageHasText(msg);
          if (kind === 'text' && !hasTools) return msg;
          if (kind === 'tool' && !hasText) return msg;
        }
        return this.remoteNewSegment(kind);
      },
      remoteMarkTurnDone() {
        this.remoteTurnMessages().forEach(m => {
          (m.toolCalls || []).forEach(t => {
            if (t.status === 'running') t.status = 'done';
          });
          m.status = 'done';
        });
      },
      remotePruneEmptySegments() {
        const rt = this.remoteRuntime || {};
        const ids = new Set(rt.messageIds || []);
        if (!ids.size) return;
        this.session.messages = (this.session.messages || []).filter(m => {
          if (!ids.has(m.id)) return true;
          if (this.remoteMessageHasText(m) || m.error) return true;
          if ((m.toolCalls || []).some(t => this.shouldDisplayToolCall(t))) return true;
          if ((m.images && m.images.length) || (m.previews && m.previews.length)) return true;
          return false;
        });
        rt.messageIds = (rt.messageIds || []).filter(id => (this.session.messages || []).some(m => m.id === id));
        if (rt.assistantId && !rt.messageIds.includes(rt.assistantId)) {
          rt.assistantId = rt.messageIds[rt.messageIds.length - 1] || '';
        }
      },
      remoteWaitTurnText() {
        return Promise.all(this.remoteTurnMessages().map(m => waitSmoothText(m)));
      },
      resetRemoteRuntime() {
        this.remoteRuntime.client = null;
        this.remoteRuntime.assistantId = '';
        this.remoteRuntime.messageIds = [];
        this.remoteRuntime.threadId = '';
        this.remoteRuntime.turnId = '';
        this.remoteRuntime.resolveTurn = null;
        this.remoteRuntime.rejectTurn = null;
      },
      async createRemoteClient(host, assistantId) {
        const client = RemoteAPI.createSession(host, {
          onEvent: ev => this.handleRemoteEvent(ev),
          onClose: () => this.handleRemoteClose()
        });
        this.remoteRuntime.client = client;
        this.remoteRuntime.assistantId = assistantId;
        this.remoteRuntime.messageIds = assistantId ? [assistantId] : [];
        await client.connect();
        return client;
      },
      handleRemoteClose() {
        const rt = this.remoteRuntime || {};
        if (this.generating && rt.rejectTurn) {
          const reject = rt.rejectTurn;
          rt.resolveTurn = null;
          rt.rejectTurn = null;
          reject(new Error('Host 连接已断开'));
        }
      },
      resolveRemoteTurn(value) {
        const rt = this.remoteRuntime || {};
        if (!rt.resolveTurn) return;
        const resolve = rt.resolveTurn;
        rt.resolveTurn = null;
        rt.rejectTurn = null;
        resolve(value || {});
      },
      rejectRemoteTurn(err) {
        const rt = this.remoteRuntime || {};
        if (!rt.rejectTurn) return;
        const reject = rt.rejectTurn;
        rt.resolveTurn = null;
        rt.rejectTurn = null;
        reject(err instanceof Error ? err : new Error(String(err || '远程任务失败')));
      },
      remoteItemKind(item) {
        item = item || {};
        return String(item.type || item.kind || item.name || item.itemType || '').toLowerCase();
      },
      remoteItemCommand(item) {
        item = item || {};
        const cmd = item.command || item.cmd || item.commandLine || item.shellCommand;
        if (Array.isArray(cmd)) return cmd.join(' ');
        return String(cmd || '').trim();
      },
      remoteItemFiles(item) {
        item = item || {};
        const files = [];
        if (item.path) files.push(item.path);
        if (item.file) files.push(item.file);
        if (Array.isArray(item.files)) item.files.forEach(f => files.push(typeof f === 'string' ? f : (f && (f.path || f.file || f.name))));
        if (Array.isArray(item.paths)) item.paths.forEach(f => files.push(f));
        return files.filter(Boolean).map(String);
      },
      remoteItemIsCommand(item) {
        const kind = this.remoteItemKind(item);
        return !!(this.remoteItemCommand(item) || /command|exec|shell|bash|terminal|process/.test(kind));
      },
      remoteItemIsFileChange(item) {
        const kind = this.remoteItemKind(item);
        return !!(this.remoteItemFiles(item).length || item && (item.diff || item.patch || item.unifiedDiff) || /file|patch|diff|edit|write/.test(kind));
      },
      remoteShouldDisplayItem(item) {
        if (!item) return false;
        if (item.error) return true;
        return this.remoteItemIsCommand(item) || this.remoteItemIsFileChange(item);
      },
      remoteToolNameForItem(item) {
        if (!this.remoteShouldDisplayItem(item)) return '';
        if (this.remoteItemIsCommand(item)) return 'codex_command';
        if (this.remoteItemIsFileChange(item)) return 'codex_file_change';
        return 'codex_item';
      },
      remoteToolArgs(item, extra) {
        const body = Object.assign({}, extra || {});
        item = item || {};
        const command = this.remoteItemCommand(item);
        const files = this.remoteItemFiles(item);
        if (command) body.command = command;
        if (files.length) body.files = files;
        ['type', 'kind', 'status', 'cwd', 'path', 'title', 'summary'].forEach(k => {
          if (item[k] != null && item[k] !== '') body[k] = item[k];
        });
        return JSON.stringify(body, null, 2);
      },
      mergeRemoteToolArgs(oldArgs, nextArgs) {
        if (nextArgs == null || nextArgs === '') return oldArgs;
        try {
          const oldObj = typeof oldArgs === 'string' ? JSON.parse(oldArgs || '{}') : (oldArgs || {});
          const nextObj = typeof nextArgs === 'string' ? JSON.parse(nextArgs || '{}') : (nextArgs || {});
          if (oldObj && typeof oldObj === 'object' && nextObj && typeof nextObj === 'object' && !Array.isArray(oldObj) && !Array.isArray(nextObj)) {
            return JSON.stringify(Object.assign({}, oldObj, nextObj), null, 2);
          }
        } catch (e) {}
        return nextArgs;
      },
      remoteUpsertTool(msg, id, name, args) {
        if (!msg) return null;
        const calls = msg.toolCalls || (msg.toolCalls = []);
        let t = calls.find(x => x.id === id);
        if (!t) {
          t = { id, name, arguments: args || '{}', status: 'running', result: '', _open: false };
          calls.push(t);
        }
        t.name = name || t.name;
        if (args != null && args !== '') t.arguments = this.mergeRemoteToolArgs(t.arguments, args);
        if (t.status !== 'done' && t.status !== 'error' && t.status !== 'cancelled') t.status = 'running';
        return t;
      },
      handleRemoteEvent(ev) {
        if (!ev || !ev.type || ev.type === 'hello') return;
        if (!this.remoteEventApplies(ev)) return;
        if (this.session.remote && ev.seq) this.session.remote.lastSeq = Math.max(this.session.remote.lastSeq || 0, ev.seq);

        if (ev.type === 'remote.turn.started') {
          const turnId = ev.turn && ev.turn.id || ev.turnId || '';
          if (ev.threadId) this.remoteRuntime.threadId = ev.threadId;
          if (turnId) this.remoteRuntime.turnId = turnId;
          return;
        }
        if (ev.type === 'remote.message.delta') {
          const msg = this.remoteEnsureSegment('text');
          if (!msg) return;
          msg._remoteContent = (msg._remoteContent || msg.content || '') + String(ev.delta || '');
          smoothText(this, msg, msg._remoteContent);
          msg.status = 'streaming';
          this.persistSessionSoon();
          return;
        }
        if (ev.type === 'remote.item.started') {
          const item = ev.item || {};
          const id = ev.itemId || item.id || ('remote_item_' + (ev.seq || Date.now()));
          const name = this.remoteToolNameForItem(item);
          if (!name) return;
          const msg = this.remoteEnsureSegment('tool', id);
          this.remoteUpsertTool(msg, id, name, this.remoteToolArgs(item));
          this.persistSessionSoon();
          return;
        }
        if (ev.type === 'remote.command.output.delta') {
          const id = ev.itemId || ('remote_cmd_' + (ev.seq || Date.now()));
          const msg = this.remoteEnsureSegment('tool', id);
          const t = this.remoteUpsertTool(msg, id, 'codex_command');
          if (t) t.result = String(t.result || '') + String(ev.delta || '');
          this.persistSessionSoon();
          return;
        }
        if (ev.type === 'remote.item.completed') {
          const item = ev.item || {};
          const id = ev.itemId || item.id || ('remote_item_' + (ev.seq || Date.now()));
          const existingMsg = this.remoteFindToolMessage(id);
          const calls = existingMsg && existingMsg.toolCalls || [];
          const existing = calls.find(x => x.id === id);
          const name = this.remoteToolNameForItem(item) || (existing && existing.name);
          if (!name) return;
          const msg = existingMsg || this.remoteEnsureSegment('tool', id);
          const t = this.remoteUpsertTool(msg, id, name, this.remoteToolArgs(item));
          if (t) {
            t.status = item.error ? 'error' : 'done';
            const result = item.output || item.result || item.summary || item.error || '';
            if (result && !t.result) t.result = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
          }
          this.persistSessionSoon();
          return;
        }
        if (ev.type === 'remote.turn.diff.updated') {
          const diff = ev.diff || ev.patch || ev.unifiedDiff || ev.delta || '';
          const files = Array.isArray(ev.files) ? ev.files : [];
          if (!diff && !files.length) return;
          const args = {
            summary: '工作区文件变更',
            files: files.map(f => typeof f === 'string' ? f : (f && (f.path || f.file || f.name))).filter(Boolean)
          };
          const id = 'remote_diff_' + (ev.turnId || 'current');
          const msg = this.remoteEnsureSegment('tool', id);
          const t = this.remoteUpsertTool(msg, id, 'codex_file_change', JSON.stringify(args, null, 2));
          if (t) {
            t.result = typeof diff === 'string' ? diff : JSON.stringify(diff || ev, null, 2);
            t.status = 'running';
          }
          this.persistSessionSoon();
          return;
        }
        if (ev.type === 'remote.approval.required') {
          this.handleRemoteApproval(ev);
          return;
        }
        if (ev.type === 'remote.approval.resolved') {
          const msg = this.remoteFindToolMessage(ev.approvalId) || this.remoteAssistantMsg();
          const t = msg && (msg.toolCalls || []).find(x => x.id === ev.approvalId);
          if (t) {
            t.status = ev.decision && String(ev.decision).startsWith('accept') ? 'done' : 'cancelled';
            t.result = '决定：' + (ev.decision || 'decline');
          }
          this.persistSessionSoon();
          return;
        }
        if (ev.type === 'remote.turn.completed') {
          this.remoteMarkTurnDone();
          this.resolveRemoteTurn(ev);
          return;
        }
        if (/^remote\.codex\.(error|warning|configWarning)$/.test(ev.type) || ev.type === 'remote.serverRequest.unsupported') {
          const text = ev.error || ev.message || ev.method || 'Codex 远程错误';
          const msg = this.remoteEnsureSegment('text');
          if (msg) msg.error = text;
          this.rejectRemoteTurn(new Error(text));
        }
      },
      async handleRemoteApproval(ev) {
        const msg = this.remoteEnsureSegment('tool', ev.approvalId);
        const args = {
          kind: ev.kind,
          command: ev.command || '',
          cwd: ev.cwd || '',
          reason: ev.reason || '',
          grantRoot: ev.grantRoot || ''
        };
        const t = this.remoteUpsertTool(msg, ev.approvalId, 'codex_approval', JSON.stringify(args, null, 2));
        if (t) {
          t._open = true;
          t.result = '等待你在手机上授权。';
        }
        const decision = await this.dialog({
          title: 'Codex 请求授权',
          msg: [
            ev.command || ev.kind || '文件变更',
            ev.cwd ? '目录：' + ev.cwd : '',
            ev.reason ? '原因：' + ev.reason : ''
          ].filter(Boolean).join('\n'),
          buttons: [
            { text: '取消任务', value: 'cancel' },
            { text: '拒绝', value: 'decline' },
            { text: '允许', value: 'accept', style: 'primary' },
            { text: '本会话允许', value: 'acceptForSession', style: 'primary' }
          ]
        }) || 'decline';
        try {
          if (this.remoteRuntime.client) {
            await this.remoteRuntime.client.request('remote.approval.respond', {
              approvalId: ev.approvalId,
              decision
            });
          }
          if (t) {
            t.status = String(decision).startsWith('accept') ? 'done' : 'cancelled';
            t.result = '决定：' + decision;
          }
        } catch (e) {
          if (t) {
            t.status = 'error';
            t.result = e.message || '授权响应失败';
          }
          this.rejectRemoteTurn(e);
        } finally {
          this.persistSessionSoon();
        }
      },
      stopRemoteTurn() {
        const rt = this.remoteRuntime || {};
        const threadId = rt.threadId || this.session && this.session.remote && this.session.remote.codexThreadId;
        if (rt.client && threadId) {
          rt.client.request('remote.turn.interrupt', { threadId, turnId: rt.turnId || undefined }).catch(() => {});
        }
        this.resolveRemoteTurn({ interrupted: true });
      },
      async sendRemoteMessage() {
        const remoteImages = (this.attachments || []).filter(a => a.kind === 'image' && a.dataUrl);
        if ((this.attachments || []).some(a => a.kind !== 'image')) {
          U.toast('远程 Codex 模式目前只支持发送图片附件');
          return;
        }
        if (remoteImages.length > 4) {
          U.toast('一次最多发送 4 张图片');
          return;
        }
        let remote = this.session.remote;
        if (!remote) {
          remote = await this.prepareRemoteSession();
          if (!remote) return;
          const historyMessages = remote._historyMessages || [];
          delete remote._historyMessages;
          if (historyMessages.length && !this.session.messages.length) this.session.messages.push(...historyMessages);
          this.session.remote = remote;
        }
        const host = this.remoteHostById(remote.hostId);
        if (!host) {
          U.toast('远程 Host 不存在，请在设置中重新连接');
          this.pushPage('settings-remote');
          return;
        }
        const content = this.input.trim();
        if (!content && !remoteImages.length) return;
        const user = { id: U.uuid(), role: 'user', content, attachments: clone(this.attachments), createdAt: U.now() };
        const assistant = {
          id: U.uuid(),
          role: 'assistant',
          content: '',
          reasoning: '',
          toolCalls: [],
          previews: [],
          status: 'streaming',
          model: 'Codex',
          createdAt: U.now()
        };
        this.session.messages.push(user, assistant);
        if (!this.session.title) this.session.title = cleanTitle(content || (remoteImages[0] && remoteImages[0].name) || '图片');
        this.input = '';
        this.attachments = [];
        this.persistSession();
        nextTick(() => {
          this.growInput();
          this.scrollToBottom(true);
        });

        this.generating = true;
        this.requestNotificationPermission();
        this.stopRequested = false;

        const assistantMsg = this.session.messages[this.session.messages.length - 1];
        let client = null;
        try {
          client = await this.createRemoteClient(host, assistantMsg.id);
          if (this.stopRequested) {
            smoothText(this, assistantMsg, '已停止。');
            await waitSmoothText(assistantMsg);
            assistantMsg.status = 'done';
            return;
          }
          this.remoteRuntime.threadId = remote.codexThreadId || '';
          if (!remote.codexThreadId) {
            const started = await client.request('remote.thread.start', { workspaceId: remote.workspaceId });
            remote.hostSessionId = started.hostSessionId || '';
            remote.codexThreadId = started.thread && started.thread.id || '';
            this.remoteRuntime.threadId = remote.codexThreadId;
            if (started.codex && started.codex.model) assistantMsg.model = started.codex.model;
            this.persistSession();
          }
          if (!remote.codexThreadId) throw new Error('Host 未返回 Codex threadId');
          if (this.stopRequested) {
            const stopMsg = this.remoteEnsureSegment('text');
            smoothText(this, stopMsg, '已停止。');
            await waitSmoothText(stopMsg);
            this.remoteMarkTurnDone();
            return;
          }

          const turnDone = new Promise((resolve, reject) => {
            this.remoteRuntime.resolveTurn = resolve;
            this.remoteRuntime.rejectTurn = reject;
          });
          const result = await client.request('remote.turn.start', {
            workspaceId: remote.workspaceId,
            threadId: remote.codexThreadId,
            text: content,
            images: remoteImages.map(a => ({
              name: a.name || '',
              mime: a.mime || '',
              dataUrl: a.dataUrl
            })),
            clientUserMessageId: user.id
          });
          const turnId = result && result.turn && result.turn.id || result && result.turnId || '';
          if (turnId) this.remoteRuntime.turnId = turnId;
          await turnDone;
          const hasVisible = this.remoteTurnMessages().some(m => this.remoteMessageHasText(m) || (m.toolCalls || []).length);
          if (!hasVisible && this.stopRequested) smoothText(this, this.remoteEnsureSegment('text'), '已停止。');
          await this.remoteWaitTurnText();
          this.remoteMarkTurnDone();
        } catch (e) {
          const errMsg = this.remoteEnsureSegment('text');
          errMsg.status = 'done';
          errMsg.error = e && e.message || String(e);
        } finally {
          await this.remoteWaitTurnText();
          this.remotePruneEmptySegments();
          this.generating = false;
          this.abortCtl = null;
          this.stopRequested = false;
          this.clearRunningNotification();
          this.resetRemoteRuntime();
          if (client) client.close();
          await this.flushSessionPersist(1200);
          nextTick(() => this.scrollToBottom(false));
        }
      },
      async sendMessage() {
        if (!this.canSend) return;
        if (this.appMode === 'image') {
          await this.sendImageMessage();
          return;
        }
        if (this.appMode === 'remote') {
          await this.sendRemoteMessage();
          return;
        }
        const provider = this.currentProvider;
        if (!provider) {
          U.toast('请先添加模型提供商');
          this.openSettings();
          return;
        }
        const model = this.settings.activeModel || this.session.model || provider.models[0] || '';
        if (!model) {
          U.toast('请先选择或填写模型');
          this.sheet = 'model';
          return;
        }
        const meta = providerModelMeta(provider, model);
        if (this.attachments.some(a => a.kind === 'image') && !(meta.capabilities && meta.capabilities.vision)) {
          U.toast('当前模型元数据未开启视觉能力，图片可能无法被理解', 3600);
        }
        const content = this.input.trim();
        const user = {
          id: U.uuid(),
          role: 'user',
          content,
          attachments: clone(this.attachments),
          createdAt: U.now()
        };
        this.session.messages.push(user);
        if (!this.session.title && content) this.session.title = cleanTitle(content);
        this.session.providerId = provider.id;
        this.session.model = model;
        this.input = '';
        this.attachments = [];
        this.persistSession();
        nextTick(() => {
          this.growInput();
          this.scrollToBottom(true);
        });
        await this.generateAssistant();
      },
      async generateAssistant() {
        const provider = this.currentProvider;
        const model = this.settings.activeModel || this.session.model || provider && provider.models[0] || '';
        if (!provider || !model) return;

        const assistant = {
          id: U.uuid(),
          role: 'assistant',
          content: '',
          reasoning: '',
          toolCalls: [],
          previews: [],
          status: 'streaming',
          model,
          createdAt: U.now()
        };
        this.session.messages.push(assistant);
        const assistantMsg = this.session.messages[this.session.messages.length - 1];
        const workingMessages = this.session.messages
          .filter(m => m.id !== assistantMsg.id && (m.role === 'user' || m.role === 'assistant'))
          .map(m => {
            if (m.role === 'assistant') {
              return { role: 'assistant', content: m.content || '', reasoning: m.reasoning || '' };
            }
            return clone(m);
          });
        const tools = this.settings.agentEnabled && API.supportsTools(provider) ? Tools.DEFS : [];
        const reqSettings = this.settingsForRequest(tools);

        this.generating = true;
        this.requestNotificationPermission();
        this.stopRequested = false;
        this.abortCtl = new AbortController();
        const maxToolRounds = U.clamp(parseInt(this.settings.maxToolRounds || 8, 10), 1, 32);
        const maxToolCalls = U.clamp(parseInt(this.settings.maxToolCalls || 24, 10), 1, 128);
        let totalToolCalls = 0;
        const previousToolResults = [];

        try {
          for (let step = 0; step <= maxToolRounds; step++) {
            const result = await API.send({
              provider,
              model,
              messages: workingMessages,
              tools,
              settings: reqSettings,
              signal: this.abortCtl.signal,
              onUpdate: st => {
                smoothText(this, assistantMsg, st.content || '');
                assistantMsg.reasoning = st.reasoning || '';
                if (st.streamTools && st.streamTools.length) syncStreamToolCalls(assistantMsg, st.streamTools, step);
                assistantMsg.status = 'streaming';
                nextTick(() => this.scrollToBottom(false));
              }
            });

            smoothText(this, assistantMsg, result.content || assistantMsg.content || '');
            assistantMsg.reasoning = result.reasoning || assistantMsg.reasoning || '';

            if (this.stopRequested) {
              cancelStreamToolCalls(assistantMsg, step);
              break;
            }
            if (!tools.length || !result.toolCalls || !result.toolCalls.length) {
              discardStreamToolCalls(assistantMsg, step);
              break;
            }

            const rawCalls = result.toolCalls.filter(t => t && t.name);
            if (!rawCalls.length) {
              discardStreamToolCalls(assistantMsg, step);
              break;
            }
            if (step >= maxToolRounds) {
              discardStreamToolCalls(assistantMsg, step);
              assistantMsg.error = '已达到最大工具轮次（' + maxToolRounds + '）。可以在设置里调高“最大工具轮次”。';
              break;
            }
            if (totalToolCalls + rawCalls.length > maxToolCalls) {
              discardStreamToolCalls(assistantMsg, step);
              assistantMsg.error = '已达到最大工具调用数（' + maxToolCalls + '）。可以在设置里调高“最大工具调用数”。';
              break;
            }
            totalToolCalls += rawCalls.length;

            const displayCalls = finalizeStreamToolCalls(assistantMsg, rawCalls, step);
            workingMessages.push({
              role: 'assistant',
              content: result.content || '',
              toolCalls: rawCalls.map((t, idx) => ({
                id: t.id || displayCalls[idx].id,
                name: t.name,
                arguments: t.arguments || '{}'
              }))
            });
            this.persistSession();

            for (let ti = 0; ti < displayCalls.length; ti++) {
              const t = displayCalls[ti];
              const denied = await this.authorizeToolCall(t);
              const out = denied || await Tools.execute(t.name, t.arguments, {
                session: this.session,
                webFetchMode: 'always',
                previousResults: previousToolResults,
                confirm: msg => this.confirm(msg, '工具授权'),
                openPreview: payload => this.openPreview(payload),
                openService: serviceId => this.openServicePreview(serviceId),
                createPreviewCard: payload => this.createPreviewCard(payload, assistantMsg),
                imageGo: args => this.imageGoTool(args, assistantMsg)
              });
              t.result = out;
              t.status = String(out).startsWith('错误：') ? 'error' : 'done';
              previousToolResults.push({ name: t.name, result: out });
              workingMessages.push({ role: 'tool', toolCallId: t.id, content: out });
              this.persistSession();
              nextTick(() => this.scrollToBottom(false));
            }
          }
          if (!assistantMsg.content && !assistantMsg.toolCalls.length && this.stopRequested) smoothText(this, assistantMsg, '已停止。');
          await waitSmoothText(assistantMsg);
          assistantMsg.status = 'done';
        } catch (e) {
          assistantMsg.status = 'done';
          assistantMsg.error = e && e.message || String(e);
        } finally {
          await waitSmoothText(assistantMsg);
          this.generating = false;
          this.abortCtl = null;
          this.stopRequested = false;
          this.clearRunningNotification();
          await this.flushSessionPersist(1200);
          nextTick(() => this.scrollToBottom(false));
        }
      },
      stopGenerate() {
        if (!this.generating) return;
        this.stopRequested = true;
        if (this.appMode === 'remote') this.stopRemoteTurn();
        if (this.abortCtl) {
          try { this.abortCtl.abort(); } catch (e) {}
        }
      },

      growInput() {
        const el = this.$refs.inputEl;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 132) + 'px';
      },
      onScroll() {
        const el = this.$refs.scroller;
        if (!el) return;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        this.showScrollDown = distance > 160;
        this.autoFollow = distance < 80;
      },
      scrollToBottom(force) {
        const el = this.$refs.scroller;
        if (!el) return;
        if (force) this.autoFollow = true;
        if (force || this.autoFollow) {
          el.scrollTop = el.scrollHeight;
          this.showScrollDown = false;
        }
      },
      onContentClick(e) {
        const btn = e.target.closest && e.target.closest('.code-btn');
        if (btn) {
          const block = btn.closest('.code-block');
          const code = block && block.querySelector('code');
          const text = code ? code.innerText : '';
          if (btn.dataset.act === 'copy') {
            U.copyText(text).then(ok => U.toast(ok ? '已复制代码' : '复制失败'));
          } else if (btn.dataset.act === 'preview') {
            this.openPreview({ html: text, title: '代码预览' });
          }
          return;
        }
        const a = e.target.closest && e.target.closest('a.md-link');
        if (a) {
          e.preventDefault();
          U.openExternal(a.href);
        }
      },

      async attachImage() {
        const f = await U.pickFile('image/*', true);
        if (!f) return;
        let path;
        try {
          path = this.saveAttachmentToWorkspace({
            name: f.name,
            size: f.size,
            mime: f.type,
            dataUrl: f.content
          });
        } catch (e) {
          U.toast(e.message || '附件写入工作区失败');
          return;
        }
        this.attachments.push({ kind: 'image', name: f.name, path, size: f.size, mime: f.type, dataUrl: f.content });
        this.sheet = '';
      },
      async attachFile() {
        const f = await U.pickFile('.txt,.md,.json,.csv,.tsv,.html,.css,.js,.xml,.yml,.yaml,text/*,application/json', false);
        if (!f) return;
        if (!U.isTextFile(f.name, f.type)) {
          U.toast('当前只支持文本文件');
          return;
        }
        const content = String(f.content || '');
        let path;
        try {
          path = this.saveAttachmentToWorkspace({
            name: f.name,
            size: content.length,
            mime: f.type || 'text/plain',
            content
          });
        } catch (e) {
          U.toast(e.message || '附件写入工作区失败');
          return;
        }
        this.attachments.push({ kind: 'text', name: f.name, path, size: content.length, mime: f.type, content });
        this.sheet = '';
      },
      saveAttachmentToWorkspace(file) {
        this.session.files = this.session.files || {};
        if (Object.keys(this.session.files).length >= Tools.MAX_FILES) throw new Error('会话文件数已达上限');
        let path = attachmentFileName(file.name);
        try { path = normalizeWorkspacePath(path); }
        catch (e) { path = 'attachments/attachment'; }
        if (this.session.files[path]) {
          const dot = path.lastIndexOf('.');
          const base = dot > 0 ? path.slice(0, dot) : path;
          const ext = dot > 0 ? path.slice(dot) : '';
          path = base + '_' + U.uuid().slice(0, 4) + ext;
        }
        ensureParentFolders(this.session, path);
        if (file.dataUrl) {
          this.session.files[path] = { dataUrl: file.dataUrl, mime: file.mime || workspaceMime(path), size: file.size || 0, mtime: U.now(), source: 'attachment' };
        } else {
          const content = String(file.content || '');
          if (content.length > Tools.MAX_FILE) throw new Error('文件超过 ' + U.fmtSize(Tools.MAX_FILE));
          this.session.files[path] = { content, mime: file.mime || workspaceMime(path), size: content.length, mtime: U.now(), source: 'attachment' };
        }
        this.openFolders.attachments = true;
        this.persistSession();
        return path;
      },
      async uploadToWorkspace() {
        const f = await readPickedFile();
        if (!f) return;
        const inputName = await this.askText('保存到工作区', fileSafeName(f.name), '例如 index.html 或 assets/icon.png');
        if (inputName == null) return;
        let name;
        try { name = normalizeWorkspacePath(inputName); }
        catch (e) {
          U.toast(e.message || '路径无效');
          return;
        }
        if (Object.keys(this.session.files).length >= Tools.MAX_FILES && !this.session.files[name]) {
          U.toast('会话文件数已达上限');
          return;
        }
        if (this.session.files[name]) {
          const ok = await this.confirm('覆盖工作区文件：' + name, '覆盖文件');
          if (!ok) return;
        }
        ensureParentFolders(this.session, name);
        if (f.asImage) {
          this.session.files[name] = { dataUrl: f.content, mime: f.type, size: f.size, mtime: U.now() };
        } else {
          const text = String(f.content || '');
          if (text.length > Tools.MAX_FILE) {
            U.toast('文件超过 ' + U.fmtSize(Tools.MAX_FILE));
            return;
          }
          this.session.files[name] = { content: text, mime: f.type || 'text/plain', size: text.length, mtime: U.now() };
        }
        this.persistSession();
        const folder = parentFolder(name);
        if (folder) this.openFolders[folder] = true;
        U.toast('已加入工作区');
      },
      async newWorkspaceItem() {
        const type = await this.dialog({
          title: '新建',
          msg: '在当前会话工作区中新建文件或文件夹。',
          buttons: [
            { text: '取消', value: null },
            { text: '文件夹', value: 'folder' },
            { text: '文件', value: 'file', style: 'primary' }
          ]
        });
        if (!type) return;
        const raw = await this.askText(type === 'folder' ? '新建文件夹' : '新建文件', '', type === 'folder' ? '例如 demo/assets' : '例如 index.html 或 demo/app.js');
        if (raw == null) return;
        let path;
        try { path = normalizeWorkspacePath(raw); }
        catch (e) {
          U.toast(e.message || '路径无效');
          return;
        }
        if (type === 'folder') {
          this.session.folders = Array.isArray(this.session.folders) ? this.session.folders : [];
          if (!this.session.folders.includes(path)) this.session.folders.push(path);
          const parent = parentFolder(path);
          if (parent) this.openFolders[parent] = true;
          this.openFolders[path] = true;
          this.persistSession();
          U.toast('已新建文件夹');
          return;
        }
        if (Object.keys(this.session.files || {}).length >= Tools.MAX_FILES && !this.session.files[path]) {
          U.toast('会话文件数已达上限');
          return;
        }
        if (this.session.files[path]) {
          const ok = await this.confirm('覆盖工作区文件：' + path, '覆盖文件');
          if (!ok) return;
        }
        const content = this.defaultFileContent(path);
        ensureParentFolders(this.session, path);
        this.session.files[path] = { content, mime: workspaceMime(path), size: content.length, mtime: U.now() };
        const folder = parentFolder(path);
        if (folder) this.openFolders[folder] = true;
        this.persistSession();
        this.viewFile(path);
      },
      defaultFileContent(path) {
        if (isHtmlName(path)) {
          return '<!doctype html>\n<html>\n<head>\n  <meta charset="utf-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n  <title>Demo</title>\n</head>\n<body>\n\n</body>\n</html>\n';
        }
        if (isMarkdownName(path)) return '# Untitled\n';
        if (/\.json$/i.test(path)) return '{}\n';
        if (/\.css$/i.test(path)) return 'body {\n  margin: 0;\n}\n';
        if (/\.m?js$/i.test(path)) return '';
        return '';
      },
      loadViewerFile(name, opts) {
        const f = this.session.files[name];
        if (!f) return;
        opts = opts || {};
        const editable = isEditableName(name, f);
        const history = Array.isArray(opts.history) ? opts.history.slice() : [name];
        const historyIndex = Number.isInteger(opts.historyIndex) ? opts.historyIndex : history.length - 1;
        this.viewer = {
          name,
          isImage: !!f.dataUrl,
          dataUrl: f.dataUrl || '',
          mime: f.mime || workspaceMime(name),
          content: editable ? (f.content || '') : '',
          originalContent: editable ? (f.content || '') : '',
          tab: f.dataUrl ? 'view' : (isHtmlName(name) || isMarkdownName(name) ? 'view' : 'source'),
          doc: '',
          logs: [],
          terminal: [],
          terminalInput: '',
          running: false,
          prompting: false,
          promptQuestion: '',
          editPrompt: '',
          dirty: false,
          address: name,
          currentPath: name,
          history,
          historyIndex
        };
        if (opts.pushPage !== false) this.pushPage('viewer');
        if (isHtmlName(name) && editable) nextTick(() => this.runViewerPreview());
      },
      viewFile(name) {
        this.loadViewerFile(name, { pushPage: true });
      },
      onViewerInput() {
        this.viewer.dirty = this.viewer.content !== this.viewer.originalContent;
      },
      syncEditorScroll(e) {
        const pre = this.$refs.viewerHighlight;
        if (!pre || !e || !e.target) return;
        pre.scrollTop = e.target.scrollTop;
        pre.scrollLeft = e.target.scrollLeft;
      },
      setViewerTab(tab) {
        this.viewer.tab = tab;
        if (tab === 'view' && isHtmlName(this.viewer.name)) nextTick(() => this.runViewerPreview());
      },
      browserState(target) {
        return target === 'viewer' ? this.viewer : this.preview;
      },
      browserBasePath(target) {
        if (target === 'viewer') return this.viewer.currentPath || this.viewer.name || '';
        const svc = this.preview.serviceId && this.serviceById(this.preview.serviceId);
        return this.preview.currentPath || (svc && svc.entry) || '';
      },
      workspaceRoutePath(rawHref, basePath) {
        const files = this.session.files || {};
        const hrefText = String(rawHref || '').trim();
        if (/^\?/.test(hrefText) && basePath && files[basePath]) return basePath;
        const path = resolveWorkspaceRef(rawHref, basePath || '');
        const raw = String(rawHref || '').trim().replace(/[?#].*$/, '');
        const candidates = [];
        const add = p => { if (p && !candidates.includes(p)) candidates.push(p); };
        add(path);
        if (!path) add('index.html');
        if (path && (raw.endsWith('/') || !/\.[^/]+$/.test(path))) add(path + '/index.html');
        if (path && !/\.[^/]+$/.test(path)) add(path + '.html');
        return candidates.find(name => files[name]) || '';
      },
      nextBrowserHistory(state, path, replace) {
        let history = Array.isArray(state && state.history) ? state.history.slice() : [];
        let index = Number.isInteger(state && state.historyIndex) ? state.historyIndex : history.length - 1;
        if (replace && index >= 0) {
          history[index] = path;
        } else if (history[index] === path) {
          // keep current entry
        } else {
          history = index >= 0 ? history.slice(0, index + 1) : [];
          history.push(path);
          index = history.length - 1;
        }
        if (!history.length) {
          history = [path];
          index = 0;
        }
        return { history, historyIndex: index };
      },
      canBrowserBack(target) {
        const state = this.browserState(target);
        return !!state && (state.historyIndex || 0) > 0;
      },
      canBrowserForward(target) {
        const state = this.browserState(target);
        return !!state && Array.isArray(state.history) && state.historyIndex >= 0 && state.historyIndex < state.history.length - 1;
      },
      async applyBrowserPath(target, path, navState) {
        if (target === 'viewer') {
          this.loadViewerFile(path, {
            pushPage: false,
            history: navState.history,
            historyIndex: navState.historyIndex
          });
          return;
        }
        this.preview.currentPath = path;
        this.preview.address = path;
        this.preview.history = navState.history;
        this.preview.historyIndex = navState.historyIndex;
        this.preview.tab = 'view';
        this.runPreview();
      },
      async navigateBrowser(target, rawHref, opts) {
        opts = opts || {};
        const href = String(rawHref || '').trim();
        if (!href || href.charAt(0) === '#') return;
        const external = externalWebUrl(href);
        if (external) {
          U.openExternal(external);
          const state = this.browserState(target);
          if (state) state.address = this.browserBasePath(target);
          return;
        }
        if (/^[a-z][a-z0-9+.-]*:/i.test(href)) {
          U.toast('无法打开此链接：' + href);
          return;
        }
        const basePath = opts.basePath || this.browserBasePath(target);
        const path = this.workspaceRoutePath(href, basePath);
        if (!path) {
          U.toast('工作区文件不存在：' + href);
          return;
        }
        if (target === 'viewer' && this.viewer.dirty && path !== this.viewer.name) {
          const ok = await this.confirm('当前文件有未保存修改，跳转会离开此文件。', '离开文件');
          if (!ok) return;
        }
        if (target === 'viewer' && path === this.viewer.name) {
          this.viewer.currentPath = path;
          this.viewer.address = path;
          this.runViewerPreview();
          return;
        }
        if (!isHtmlName(path)) {
          this.viewFile(path);
          return;
        }
        const state = this.browserState(target);
        const navState = opts.navState || this.nextBrowserHistory(state, path, !!opts.replace);
        await this.applyBrowserPath(target, path, navState);
      },
      async goBrowserAddress(target) {
        const state = this.browserState(target);
        if (!state) return;
        await this.navigateBrowser(target, state.address, { basePath: this.browserBasePath(target) });
      },
      async goBrowserHistory(target, delta) {
        const state = this.browserState(target);
        if (!state || !Array.isArray(state.history)) return;
        const nextIndex = state.historyIndex + delta;
        if (nextIndex < 0 || nextIndex >= state.history.length) return;
        const path = state.history[nextIndex];
        if (target === 'viewer' && this.viewer.dirty && path !== this.viewer.name) {
          const ok = await this.confirm('当前文件有未保存修改，跳转会离开此文件。', '离开文件');
          if (!ok) return;
        }
        await this.applyBrowserPath(target, path, {
          history: state.history.slice(),
          historyIndex: nextIndex
        });
      },
      browserBack(target) {
        return this.goBrowserHistory(target, -1);
      },
      browserForward(target) {
        return this.goBrowserHistory(target, 1);
      },
      reloadBrowser(target) {
        if (target === 'viewer') {
          this.runViewerPreview();
          return;
        }
        this.runPreview();
      },
      growViewerEdit(e) {
        const el = e && e.target;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 112) + 'px';
      },
      async sendViewerImageEdit() {
        const prompt = String(this.viewer.editPrompt || '').trim();
        if (!this.viewer.isImage || !this.viewer.name || !prompt || this.generating) return;
        try { this.imageRequestModel(); }
        catch (e) {
          U.toast(e.message || '请先配置图片生成模型', 3200);
          return;
        }
        const user = {
          id: U.uuid(),
          role: 'user',
          content: prompt,
          attachments: [{
            kind: 'image',
            name: this.viewer.name.split('/').pop() || this.viewer.name,
            path: this.viewer.name,
            mime: this.viewer.mime,
            dataUrl: this.viewer.dataUrl
          }],
          createdAt: U.now()
        };
        const assistant = {
          id: U.uuid(),
          role: 'assistant',
          content: '',
          images: [],
          status: 'streaming',
          model: this.imageModelId,
          createdAt: U.now()
        };
        this.session.messages.push(user, assistant);
        const assistantMsg = this.session.messages[this.session.messages.length - 1];
        this.viewer.editPrompt = '';
        this.generating = true;
        this.requestNotificationPermission();
        this.stopRequested = false;
        this.abortCtl = new AbortController();
        this.persistSession();
        try {
          await this.runImageRequest({
            prompt,
            source: 'image_edit',
            mode: 'edit',
            parentFile: this.viewer.name
          }, assistantMsg);
          assistantMsg.status = 'done';
          if (assistantMsg.images && assistantMsg.images[0]) {
            const nextPath = assistantMsg.images[0].path;
            const f = this.session.files && this.session.files[nextPath];
            if (f && f.dataUrl) {
              this.viewer.name = nextPath;
              this.viewer.dataUrl = f.dataUrl;
              this.viewer.mime = f.mime || workspaceMime(nextPath);
              this.viewer.editPrompt = '';
            }
          }
        } catch (e) {
          assistantMsg.status = 'done';
          assistantMsg.error = e && e.message || String(e);
        } finally {
          this.generating = false;
          this.abortCtl = null;
          this.stopRequested = false;
          this.clearRunningNotification();
          this.persistSession();
        }
      },
      saveViewerFile() {
        if (!this.viewerCanSave) return;
        const f = this.session.files[this.viewer.name];
        if (!f) return;
        const content = String(this.viewer.content || '');
        if (content.length > Tools.MAX_FILE) {
          U.toast('文件超过 ' + U.fmtSize(Tools.MAX_FILE));
          return;
        }
        f.content = content;
        f.mime = f.mime || workspaceMime(this.viewer.name);
        f.size = content.length;
        f.mtime = U.now();
        delete f.dataUrl;
        this.viewer.originalContent = content;
        this.viewer.dirty = false;
        this.persistSession();
        if (isHtmlName(this.viewer.name)) this.runViewerPreview();
        U.toast('已保存');
      },
      async exportViewerFile() {
        await this.exportWorkspaceFileByName(this.viewer.name, {
          content: this.viewer.content,
          mime: this.viewer.mime
        });
      },
      async exportWorkspaceFileByName(path, opts) {
        const f = this.session.files[path];
        if (!f) return;
        const name = fileSafeName(path);
        const content = opts && Object.prototype.hasOwnProperty.call(opts, 'content') ? opts.content : f.content;
        const mime = opts && opts.mime || f.mime;
        const isImage = f.dataUrl && !content;
        const canShare = U.canShare && U.canShare();
        const canSaveAlbum = U.isPlus() && plus.gallery && plus.gallery.save;
        const buttons = [{ text: '取消', value: null }];
        if (isImage) {
          if (canSaveAlbum) buttons.push({ text: '存相册', value: 'album' });
          if (canShare) buttons.push({ text: '分享', value: 'share' });
          buttons.push({ text: U.isPlus() ? '下载目录' : '下载', value: 'download', style: 'primary' });
        } else {
          if (canShare && U.isTextFile(path, mime)) buttons.push({ text: '分享文本', value: 'share' });
          buttons.push({ text: U.isPlus() ? '下载目录' : '下载', value: 'download', style: 'primary' });
        }
        const action = await this.dialog({
          title: '导出文件',
          msg: (isImage ? '选择图片导出方式：' : '选择文件导出方式：') + path,
          buttons
        });
        if (!action) return;
        try {
          let saved;
          if (isImage) {
            if (action === 'album') saved = await U.saveImageToGallery(name, f.dataUrl);
            else if (action === 'share') saved = await U.shareImageFile(name, f.dataUrl);
            else saved = await dataUrlDownload(name, f.dataUrl);
          } else {
            const text = content || '';
            if (action === 'share') saved = await U.shareText(name, text);
            else saved = await U.saveTextFile(name, text, { mime });
          }
          this.toastExportResult(saved, action === 'share' ? '已分享文件' : (action === 'album' ? '已保存图片' : '已导出文件'));
        } catch (e) {
          this.toastExportError(e);
        }
      },
      async deleteWorkspaceFile() {
        if (!this.viewer.name) return;
        const ok = await this.confirm('删除文件：' + this.viewer.name, '删除文件');
        if (!ok) return;
        delete this.session.files[this.viewer.name];
        this.persistSession();
        this.closePage();
      },
      async deleteWorkspacePath(row) {
        if (!row) return;
        if (row.type === 'folder') {
          await this.deleteWorkspaceFolder(row.path);
          return;
        }
        const ok = await this.confirm('删除文件：' + row.path, '删除文件');
        if (!ok) return;
        delete this.session.files[row.path];
        this.persistSession();
      },
      async deleteWorkspaceFolder(path) {
        const prefix = path + '/';
        const files = Object.keys(this.session.files || {}).filter(name => name === path || name.startsWith(prefix));
        const ok = await this.confirm('删除文件夹：' + path + '\n包含 ' + files.length + ' 个文件。', '删除文件夹');
        if (!ok) return;
        files.forEach(name => delete this.session.files[name]);
        this.session.folders = (this.session.folders || []).filter(name => name !== path && !name.startsWith(prefix));
        delete this.openFolders[path];
        this.persistSession();
      },
      async exportWorkspace() {
        const names = Object.keys(this.session.files || {}).sort((a, b) => a.localeCompare(b, 'zh-Hans'));
        if (!names.length) {
          U.toast('工作区没有可导出的文件');
          return;
        }
        const choice = await this.dialog({
          title: '导出工作区',
          msg: U.isPlus()
            ? 'Android 会写入公共下载目录。整工作区建议打包 ZIP；JSON 适合备份或导入回 WepChat。'
            : '整工作区建议打包 ZIP；JSON 适合备份或导入回 WepChat。',
          buttons: [
            { text: '取消', value: null },
            { text: 'JSON 备份', value: 'bundle' },
            { text: '选择文件', value: 'pick' },
            { text: '下载 ZIP', value: 'zip', style: 'primary' }
          ]
        });
        if (!choice) return;
        if (choice === 'zip') {
          await this.exportWorkspaceZip(names);
          return;
        }
        if (choice === 'bundle') {
          const data = {
            app: 'wepchat-workspace',
            version: 1,
            title: this.session.title || '',
            exportedAt: U.now(),
            folders: this.session.folders || [],
            files: this.session.files || {}
          };
          const name = fileSafeName((this.session.title || 'workspace') + '-' + new Date().toISOString().slice(0, 10) + '.json');
          try {
            const saved = await U.saveTextFile(name, JSON.stringify(data, null, 2), { mime: 'application/json' });
            this.toastExportResult(saved, '已导出工作区包');
          } catch (e) {
            this.toastExportError(e);
          }
          return;
        }
        const picked = await this.askText('选择导出文件', names.join('\n'), '每行一个文件路径', true);
        if (picked == null) return;
        const selected = picked.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
        const missing = selected.filter(name => !this.session.files[name]);
        if (missing.length) {
          U.toast('文件不存在：' + missing[0]);
          return;
        }
        await this.exportWorkspaceFiles(selected);
      },
      workspaceExportFiles(names) {
        return names.map(name => {
          const f = this.session.files[name];
          if (!f) return null;
          return {
            path: name,
            content: f.content || '',
            dataUrl: f.dataUrl || '',
            mime: f.mime || workspaceMime(name)
          };
        }).filter(Boolean);
      },
      async exportWorkspaceZip(names) {
        const files = this.workspaceExportFiles(names);
        const zipName = fileSafeName((this.session.title || 'workspace') + '-' + new Date().toISOString().slice(0, 10) + '.zip');
        try {
          const result = await U.exportFilesAsZip(files, zipName);
          this.toastExportResult(result, '已导出工作区 ZIP');
        } catch (e) {
          this.toastExportError(e);
        }
      },
      async exportWorkspaceFiles(names) {
        const files = this.workspaceExportFiles(names);
        try {
          const result = await U.exportFilesToDirectory(files, {
            baseDir: fileSafeName(this.session.title || 'workspace')
          });
          if (result) U.toast('已导出 ' + result.count + ' 个文件到 ' + result.path, 3600);
        } catch (e) {
          this.toastExportError(e);
        }
      },
      renderViewerMarkdown() {
        return MD.render(this.viewer.content || '');
      },
      highlightSource(text, name) {
        const code = String(text == null ? '' : text);
        const withTail = code.endsWith('\n') ? code : code + '\n';
        try {
          if (window.hljs) {
            const lang = languageForName(name);
            if (hljs.getLanguage && hljs.getLanguage(lang)) {
              return hljs.highlight(withTail, { language: lang, ignoreIllegals: true }).value;
            }
            return hljs.highlightAuto(withTail).value;
          }
        } catch (e) {}
        return U.escapeHtml(withTail);
      },
      viewerSandboxFiles() {
        const files = {};
        const name = normalizeWorkspacePath(this.viewer.name || '', { allowEmpty: true });
        if (!name) return files;
        files[name] = this.viewer.content || '';
        const base = name.split('/').pop();
        if (base && base !== name) files[base] = this.viewer.content || '';
        return files;
      },
      pushViewerTerminal(level, text) {
        this.viewer.terminal = Array.isArray(this.viewer.terminal) ? this.viewer.terminal : [];
        this.viewer.terminal.push({
          level: level || 'log',
          text: String(text == null ? '' : text),
          at: U.now()
        });
        if (this.viewer.terminal.length > 120) this.viewer.terminal.splice(0, this.viewer.terminal.length - 120);
        nextTick(() => {
          const el = this.$refs.viewerTerminalBody;
          if (el) el.scrollTop = el.scrollHeight;
        });
      },
      clearViewerTerminal() {
        this.viewer.terminal = [];
      },
      async submitViewerTerminal() {
        const raw = String(this.viewer.terminalInput || '');
        const cmd = raw.trim();
        if (this.viewer.running && this._viewerPromptResolve) {
          this.viewer.terminalInput = '';
          this.pushViewerTerminal('input', raw);
          const resolve = this._viewerPromptResolve;
          this._viewerPromptResolve = null;
          this.viewer.prompting = false;
          this.viewer.promptQuestion = '';
          resolve(raw);
          return;
        }
        if (!cmd) return;
        this.viewer.terminalInput = '';
        if (cmd === 'clear') {
          this.clearViewerTerminal();
          return;
        }
        if (this.viewer.running) {
          this.pushViewerTerminal('warn', '程序正在运行，等待脚本请求输入');
          return;
        }
        if (cmd === 'run') {
          await this.runViewerJs('');
          return;
        }
        await this.runViewerJs(raw);
      },
      waitViewerPrompt(question) {
        return new Promise(resolve => {
          this.viewer.prompting = true;
          this.viewer.promptQuestion = String(question || '');
          this.pushViewerTerminal('prompt', this.viewer.promptQuestion || '请输入：');
          this._viewerPromptResolve = resolve;
          nextTick(() => {
            const input = this.$refs.viewerTerminalInput;
            if (input && input.focus) input.focus();
          });
        });
      },
      async runViewerJs(stdin) {
        if (!this.viewerIsJs || this.viewer.running) return;
        const inputText = stdin == null ? String(this.viewer.terminalInput || '') : String(stdin || '');
        if (stdin == null) this.viewer.terminalInput = '';
        const started = Date.now();
        this.viewer.running = true;
        this.viewer.prompting = false;
        this.viewer.promptQuestion = '';
        this._viewerPromptResolve = null;
        this.pushViewerTerminal('cmd', '$ run ' + (this.viewer.name || 'script.js'));
        if (inputText) this.pushViewerTerminal('input', inputText);
        try {
          const r = await Tools.runWorkspaceJS(this.session, {
            code: this.viewer.content || '',
            files: this.viewerSandboxFiles(),
            stdin: inputText,
            timeout: 5 * 60 * 1000,
            onPrompt: question => this.waitViewerPrompt(question)
          });
          if (r.stdout) this.pushViewerTerminal('log', r.stdout);
          if (r.stderr) this.pushViewerTerminal(r.ok ? 'warn' : 'error', r.stderr);
          if (r.result !== undefined && r.result !== null && r.result !== '') this.pushViewerTerminal('return', r.result);
          if (r.saved && r.saved.length) {
            r.saved.forEach(path => {
              const folder = parentFolder(path);
              if (folder) this.openFolders[folder] = true;
            });
            this.pushViewerTerminal('write', '写入工作区文件：\n' + r.saved.map(path => '- ' + path).join('\n'));
            if (r.saved.includes(this.viewer.name)) {
              const f = this.session.files[this.viewer.name];
              if (f && !f.dataUrl) {
                this.viewer.content = String(f.content || '');
                this.viewer.originalContent = this.viewer.content;
                this.viewer.dirty = false;
              }
            }
            this.persistSession();
          }
          if (r.skippedWrites && r.skippedWrites.length) {
            this.pushViewerTerminal('warn', '脚本执行失败，以下写入未保存：\n' + r.skippedWrites.map(path => '- ' + path).join('\n'));
          }
          if (!r.stdout && !r.stderr && (r.result === undefined || r.result === null || r.result === '') && !(r.saved && r.saved.length)) {
            this.pushViewerTerminal(r.ok ? 'muted' : 'error', r.ok ? '执行完成（无输出）' : '执行失败（无输出）');
          }
          this.pushViewerTerminal(r.ok ? 'muted' : 'error', (r.ok ? '退出码 0' : '执行失败') + ' · ' + (Date.now() - started) + 'ms');
        } catch (e) {
          this.pushViewerTerminal('error', e && e.message || String(e));
        } finally {
          if (this._viewerPromptResolve) {
            const resolve = this._viewerPromptResolve;
            this._viewerPromptResolve = null;
            resolve('');
          }
          this.viewer.prompting = false;
          this.viewer.promptQuestion = '';
          this.viewer.running = false;
        }
      },
      runViewerPreview() {
        if (!isHtmlName(this.viewer.name)) return;
        this.viewer.logs = [];
        this.viewer.doc = this.buildWorkspaceHtml(this.viewer.name, this.viewer.content, 'viewer');
        nextTick(() => {
          const frame = this.$refs.viewerFrame;
          if (frame) frame.srcdoc = this.viewer.doc;
        });
      },

      serviceById(id) {
        return (this.session.services || []).find(s => s.id === id) || null;
      },
      startService(svc) {
        if (!svc) return;
        if (!this.session.files[svc.entry]) {
          U.toast('入口文件不存在：' + svc.entry);
          return;
        }
        svc.status = 'running';
        svc.updatedAt = U.now();
        svc.lastStartedAt = U.now();
        this.persistSession();
        if (this.preview.serviceId === svc.id) this.runPreview();
        U.toast('服务已启动');
      },
      stopService(svc) {
        if (!svc) return;
        svc.status = 'stopped';
        svc.updatedAt = U.now();
        this.persistSession();
        if (this.preview.serviceId === svc.id) {
          const frame = this.$refs.pvFrame;
          if (frame) frame.srcdoc = '';
          this.preview.logs = [];
        }
        U.toast('服务已停止');
      },
      async deleteService(svc) {
        if (!svc) return;
        const ok = await this.confirm('删除服务：' + svc.name + '\n不会删除工作区文件。', '删除服务');
        if (!ok) return;
        this.session.services = (this.session.services || []).filter(s => s.id !== svc.id);
        this.persistSession();
      },
      openServicePreview(serviceId) {
        const svc = this.serviceById(serviceId);
        if (!svc) {
          U.toast('服务不存在');
          return;
        }
        if (!this.session.files[svc.entry]) {
          U.toast('入口文件不存在：' + svc.entry);
          return;
        }
        if (svc.status !== 'running') this.startService(svc);
        this.preview.title = svc.name || '工作区服务';
        this.preview.html = '';
        this.preview.css = '';
        this.preview.js = '';
        this.preview.tab = 'view';
        this.preview.logs = [];
        this.preview.serviceId = svc.id;
        this.preview.mode = 'service';
        this.preview.currentPath = svc.entry;
        this.preview.address = svc.entry;
        this.preview.history = [svc.entry];
        this.preview.historyIndex = 0;
        this.preview.doc = this.buildServiceDoc(svc);
        this.pushPage('preview');
        nextTick(() => this.runPreview());
      },
      createPreviewCard(payload, targetMsg) {
        payload = payload || {};
        const svc = this.serviceById(payload.serviceId);
        const entry = payload.entry || (svc && svc.entry) || '';
        const kind = payload.kind === 'js' || isJsName(entry) ? 'js' : 'html';
        if (!entry || !this.session.files[entry]) return kind === 'js' ? '错误：JS 文件不存在' : '错误：HTML 预览入口不存在';
        const card = {
          id: U.uuid(),
          kind,
          serviceId: payload.serviceId || (svc && svc.id) || '',
          path: entry,
          title: payload.title || (svc && svc.name) || entry,
          doc: kind === 'html' ? this.buildWorkspaceHtml(entry, null, 'preview-card-' + U.uuid()) : '',
          createdAt: U.now()
        };
        if (targetMsg) {
          targetMsg.previews = Array.isArray(targetMsg.previews) ? targetMsg.previews : [];
          targetMsg.previews.push(card);
        }
        if (kind === 'js') return '已生成 JS 运行卡片：' + entry + '。用户点击卡片后会打开代码与终端运行器。';
        return '已生成 HTML 预览卡片：' + entry + '。用户点击卡片后会打开完整预览。';
      },
      openPreviewCard(card) {
        if (!card) return;
        if (card.kind === 'js' || isJsName(card.path || '')) {
          if (!card.path || !this.session.files[card.path]) {
            U.toast('JS 文件不存在：' + (card.path || ''));
            return;
          }
          this.viewFile(card.path);
          return;
        }
        let svc = card.serviceId && this.serviceById(card.serviceId);
        const path = card.path || (svc && svc.entry) || '';
        if (!svc && path) {
          if (!this.session.files[path]) {
            U.toast('入口文件不存在：' + path);
            return;
          }
          this.session.services = Array.isArray(this.session.services) ? this.session.services : [];
          svc = this.session.services.find(s => s.entry === path);
          if (!svc) {
            svc = { id: U.uuid(), name: card.title || path, entry: path, status: 'stopped', createdAt: U.now(), updatedAt: U.now() };
            this.session.services.push(svc);
            this.persistSession();
          }
        }
        if (svc) this.openServicePreview(svc.id);
      },
      buildServiceDoc(svc) {
        const path = this.preview.currentPath && this.session.files[this.preview.currentPath]
          ? this.preview.currentPath
          : svc.entry;
        this.preview.currentPath = path;
        this.preview.address = path;
        return this.buildWorkspaceHtml(path, null, 'preview');
      },
      buildWorkspaceHtml(entry, contentOverride, target) {
        const f = this.session.files[entry];
        let html = contentOverride != null ? String(contentOverride) : (f && f.content || '');
        const files = this.session.files || {};
        html = html.replace(/<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (m, a, href) => {
          if (isExternalRef(href)) return m;
          const name = resolveWorkspaceRef(href, entry);
          const dep = files[name];
          if (!dep || dep.dataUrl) return '<!-- missing stylesheet: ' + htmlAttr(name) + ' -->';
          return '<style data-wepchat-file="' + htmlAttr(name) + '">\n' + (dep.content || '') + '\n</style>';
        });
        html = html.replace(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, a, src) => {
          if (isExternalRef(src)) return m;
          const name = resolveWorkspaceRef(src, entry);
          const dep = files[name];
          if (!dep || dep.dataUrl) return '<script>console.error("missing script: ' + escapeScriptEnd(name) + '")<\/script>';
          return '<script data-wepchat-file="' + htmlAttr(name) + '">\n' + escapeScriptEnd(dep.content || '') + '\n<\/script>';
        });
        html = html.replace(/(<img\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (m, pre, src, post) => {
          if (isExternalRef(src)) return m;
          const dep = files[resolveWorkspaceRef(src, entry)];
          return dep && dep.dataUrl ? pre + dep.dataUrl + post : m;
        });
        return this.wrapPreviewDoc(html, '', '', target || 'preview');
      },

      openPreview(payload) {
        this.preview.title = payload.title || 'HTML 预览';
        this.preview.html = payload.html || '';
        this.preview.css = payload.css || '';
        this.preview.js = payload.js || '';
        this.preview.tab = 'view';
        this.preview.logs = [];
        this.preview.serviceId = '';
        this.preview.mode = 'html';
        this.preview.currentPath = '';
        this.preview.address = '';
        this.preview.history = [];
        this.preview.historyIndex = -1;
        this.preview.doc = this.buildPreviewDoc();
        this.pushPage('preview');
        nextTick(() => this.runPreview());
      },
      previewBridge(target) {
        const channel = target || 'preview';
        const bridge = `
<script>
(function () {
  function send(level, args) {
    parent.postMessage({ source: 'wepchat-preview', target: ${JSON.stringify(channel)}, level: level, text: Array.prototype.map.call(args, function (x) {
      if (typeof x === 'string') return x;
      try { return JSON.stringify(x); } catch (e) { return String(x); }
    }).join(' ') }, '*');
  }
  ['log','info','debug'].forEach(function (k) { console[k] = function () { send('log', arguments); }; });
  ['warn','error'].forEach(function (k) { console[k] = function () { send(k, arguments); }; });
  window.onerror = function (msg, src, line, col) { send('error', [msg + ' @ ' + line + ':' + col]); };
  function nav(href) {
    parent.postMessage({ source: 'wepchat-preview', target: ${JSON.stringify(channel)}, type: 'navigate', href: String(href || '') }, '*');
  }
  document.addEventListener('click', function (ev) {
    if (ev.defaultPrevented || ev.button !== 0 || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return;
    var el = ev.target;
    while (el && el !== document && !(el.tagName && String(el.tagName).toLowerCase() === 'a')) el = el.parentNode;
    if (!el || el === document) return;
    var href = el.getAttribute('href') || '';
    if (!href || /^\\s*#/.test(href) || /^\\s*javascript:/i.test(href) || el.hasAttribute('download')) return;
    ev.preventDefault();
    nav(href);
  }, true);
  var nativeOpen = window.open;
  window.open = function (url) {
    if (url) nav(url);
    else if (nativeOpen) return nativeOpen.apply(window, arguments);
    return null;
  };
})();
<\/script>`;
        return bridge;
      },
      wrapPreviewDoc(sourceHtml, sourceCss, sourceJs, target) {
        const bridge = this.previewBridge(target || 'preview');
        const css = sourceCss ? '<style>\n' + sourceCss + '\n</style>' : '';
        const js = sourceJs ? '<script>\n' + escapeScriptEnd(sourceJs) + '\n<\/script>' : '';
        let html = sourceHtml || '';
        if (!/<html[\s>]/i.test(html)) {
          return '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
            css + '</head><body>' + html + bridge + js + '</body></html>';
        }
        if (css) html = /<\/head>/i.test(html) ? html.replace(/<\/head>/i, css + '</head>') : css + html;
        if (/<head(\s[^>]*)?>/i.test(html)) html = html.replace(/<head(\s[^>]*)?>/i, m => m + bridge);
        else html = bridge + html;
        if (js) html = /<\/body>/i.test(html) ? html.replace(/<\/body>/i, js + '</body>') : html + js;
        return html;
      },
      buildPreviewDoc() {
        return this.wrapPreviewDoc(this.preview.html || '', this.preview.css || '', this.preview.js || '', 'preview');
      },
      runPreview() {
        this.preview.logs = [];
        const svc = this.preview.serviceId && this.serviceById(this.preview.serviceId);
        this.preview.doc = svc ? this.buildServiceDoc(svc) : this.buildPreviewDoc();
        nextTick(() => {
          const frame = this.$refs.pvFrame;
          if (frame) frame.srcdoc = this.preview.doc;
        });
      },
      onPreviewMessage(e) {
        const data = e.data || {};
        if (data.source !== 'wepchat-preview') return;
        if (/^preview-card-/.test(String(data.target || ''))) return;
        if (data.type === 'navigate') {
          this.navigateBrowser(data.target === 'viewer' ? 'viewer' : 'preview', data.href);
          return;
        }
        const row = {
          level: data.level === 'error' || data.level === 'warn' ? data.level : 'log',
          text: String(data.text || '')
        };
        if (data.target === 'viewer') this.viewer.logs.push(row);
        else this.preview.logs.push(row);
      },
      savePreviewToWorkspace() {
        const name = fileSafeName(this.preview.title || 'preview') + '.html';
        this.session.files[name] = {
          content: this.preview.doc,
          mime: 'text/html',
          size: this.preview.doc.length,
          mtime: U.now()
        };
        this.persistSession();
        U.toast('已保存到会话文件');
      },
      async exportPreview() {
        try {
          const saved = await U.saveTextFile(fileSafeName(this.preview.title || 'preview') + '.html', this.preview.doc, { mime: 'text/html' });
          this.toastExportResult(saved, '已导出预览');
        } catch (e) {
          this.toastExportError(e);
        }
      },

      async exportAll() {
        const data = Store.exportAll();
        try {
          const saved = await U.saveTextFile('wepchat-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 2), { mime: 'application/json' });
          this.toastExportResult(saved, '已导出全部数据');
        } catch (e) {
          this.toastExportError(e);
        }
      },
      async importData() {
        const f = await U.pickFile('.json,application/json', false);
        if (!f) return;
        let data;
        try { data = JSON.parse(f.content); }
        catch (e) {
          U.toast('JSON 解析失败');
          return;
        }
        const replace = await this.confirm('确定导入备份？\n\n选择“确定”将合并数据；如需覆盖，先清空全部数据。', '导入数据');
        if (!replace) return;
        const canLeave = await this.confirmStopRunning('导入数据');
        if (!canLeave) return;
        try {
          const res = Store.importAll(data, 'merge');
          this.settings = Store.loadSettings();
          this.providers = Store.loadProviders().map(p => MODEL_META.normalizeProvider(p));
          Store.saveProviders(this.providers);
          this.index = Store.loadIndex();
          const first = this.index[0] && Store.loadSession(this.index[0].id);
          this.session = normalizeSession(first || Store.newSession());
          U.toast('已导入 ' + res.sessions + ' 个会话');
        } catch (e) {
          U.toast(e.message || '导入失败', 3500);
        }
      },
      async clearAllAsk() {
        const ok = await this.confirm('这会删除本地所有会话、提供商和设置，无法恢复。', '清空全部数据');
        if (!ok) return;
        const canLeave = await this.confirmStopRunning('清空全部数据');
        if (!canLeave) return;
        Store.clearAll();
        this.settings = Store.loadSettings();
        this.providers = [];
        this.index = [];
        this.session = Store.newSession();
        this.storageUsed = Store.usage();
        U.toast('已清空');
      }
    }
  }).mount('#app');
})();
