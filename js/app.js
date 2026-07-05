/* WepChat - Vue 应用入口 */
'use strict';

(() => {
  const { createApp, nextTick } = Vue;

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
    });
    sess.files = sess.files || {};
    sess.services = Array.isArray(sess.services) ? sess.services : [];
    sess.createdAt = sess.createdAt || U.now();
    sess.updatedAt = sess.updatedAt || U.now();
    sess.title = sess.title || '';
    return sess;
  }

  function newProvider() {
    return {
      id: U.uuid(),
      name: 'OpenAI Compatible',
      api: 'openai-chat',
      baseUrl: '',
      apiKey: '',
      models: ['gpt-4o-mini'],
      extraHeaders: []
    };
  }

  function parseModels(text) {
    return String(text || '')
      .split(/\r?\n/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  function fileSafeName(name) {
    return String(name || 'untitled')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'untitled';
  }

  function dataUrlDownload(name, dataUrl) {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = name;
    a.click();
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

  createApp({
    data() {
      const settings = Store.loadSettings();
      const providers = Store.loadProviders();
      const index = Store.loadIndex();
      const first = index[0] && Store.loadSession(index[0].id);

      return {
        U,
        API,
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
        attachments: [],
        generating: false,
        abortCtl: null,
        stopRequested: false,
        showScrollDown: false,

        provForm: {
          isNew: true,
          data: null,
          modelsText: '',
          showKey: false,
          fetching: false,
          testing: false
        },

        viewer: {
          name: '',
          isImage: false,
          dataUrl: '',
          content: ''
        },

        preview: {
          title: 'HTML 预览',
          html: '',
          css: '',
          js: '',
          doc: '',
          tab: 'view',
          logs: [],
          serviceId: '',
          mode: 'html'
        },

        dlg: null,
        storageUsed: Store.usage(),

        suggestions: [
          { t: '算一下', q: '用工具精确计算 123456789 * 987654321，并解释结果。' },
          { t: '做个小工具', q: '做一个可以交互预览的 BMI 计算器，界面适合手机。' },
          { t: '处理文本', q: '把下面这段文本整理成 Markdown 表格：姓名 年龄 城市；张三 28 上海；李四 31 深圳。' }
        ]
      };
    },

    computed: {
      currentProvider() {
        const id = this.settings.activeProviderId || this.session.providerId;
        return this.providers.find(p => p.id === id) || this.providers[0] || null;
      },
      currentModelLabel() {
        if (!this.currentProvider) return '未配置模型';
        return this.settings.activeModel || this.session.model || this.currentProvider.models[0] || '默认模型';
      },
      fileCount() {
        return Object.keys(this.session.files || {}).length;
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
      canSend() {
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
    },

    methods: {
      persistSettings() {
        Store.saveSettings(this.settings);
        this.storageUsed = Store.usage();
        this.applyTheme();
      },
      persistProviders() {
        Store.saveProviders(this.providers);
        this.storageUsed = Store.usage();
      },
      persistSession() {
        this.session = normalizeSession(this.session);
        Store.saveSession(this.session);
        this.upsertIndex(this.session);
        this.storageUsed = Store.usage();
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
      toolPermissionKey(name) {
        if (name === 'run_js') return 'run_js';
        if (name === 'preview_html') return 'preview_html';
        if (name === 'web_fetch') return 'web_fetch';
        if (name === 'run_service' || name === 'stop_service' || name === 'list_services') return 'services';
        if (name === 'read_file' || name === 'write_file' || name === 'list_files' || name === 'create_workspace') return 'files';
        return 'files';
      },
      toolPermissionLabel(name) {
        const map = {
          run_js: 'JavaScript 沙盒',
          preview_html: 'HTML 预览',
          web_fetch: '网页访问',
          services: '工作区服务',
          files: '工作区文件'
        };
        return map[this.toolPermissionKey(name)] || this.toolLabel(name);
      },
      toolPermission(nameOrKey) {
        const key = ['run_js', 'preview_html', 'files', 'services', 'web_fetch'].includes(nameOrKey)
          ? nameOrKey
          : this.toolPermissionKey(nameOrKey);
        const perms = this.settings.toolPermissions || {};
        return perms[key] || (key === 'web_fetch' ? (this.settings.webFetch || 'ask') : 'ask');
      },
      setToolPermission(key, mode) {
        this.settings.toolPermissions = Object.assign({}, this.settings.toolPermissions || {}, { [key]: mode });
        if (key === 'web_fetch') this.settings.webFetch = mode;
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

      newSession() {
        this.stopGenerate();
        this.session = Store.newSession();
        this.session.providerId = this.settings.activeProviderId || '';
        this.session.model = this.settings.activeModel || '';
        this.persistSession();
        this.input = '';
        this.attachments = [];
        nextTick(() => this.scrollToBottom(true));
      },
      openSession(id) {
        const s = Store.loadSession(id);
        if (!s) {
          U.toast('会话不存在');
          return;
        }
        this.stopGenerate();
        this.session = normalizeSession(s);
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
        Store.deleteSession(it.id);
        this.index = this.index.filter(x => x.id !== it.id);
        Store.saveIndex(this.index);
        if (this.session.id === it.id) {
          const next = this.index[0] && Store.loadSession(this.index[0].id);
          this.session = normalizeSession(next || Store.newSession());
        }
        this.sheet = '';
      },
      exportSession(it) {
        const s = Store.loadSession(it.id) || this.session;
        const name = fileSafeName((s.title || 'wepchat-session') + '.json');
        U.saveTextFile(name, JSON.stringify(s, null, 2)).then(() => U.toast('已导出'));
        this.sheet = '';
      },

      addProvider() {
        const p = newProvider();
        this.provForm = {
          isNew: true,
          data: p,
          modelsText: p.models.join('\n'),
          showKey: false,
          fetching: false,
          testing: false
        };
        this.pushPage('provider');
      },
      editProvider(p) {
        const data = clone(p);
        data.extraHeaders = data.extraHeaders || [];
        this.provForm = {
          isNew: false,
          data,
          modelsText: (data.models || []).join('\n'),
          showKey: false,
          fetching: false,
          testing: false
        };
        this.pushPage('provider');
      },
      saveProvider() {
        const p = this.provForm.data;
        if (!p) return;
        p.name = String(p.name || '').trim() || '未命名提供商';
        p.baseUrl = String(p.baseUrl || '').trim();
        p.models = parseModels(this.provForm.modelsText);
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
          const models = await API.listModels(p);
          this.provForm.modelsText = models.join('\n');
          U.toast(models.length ? '已获取模型列表' : '接口返回空列表');
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
          preview_html: 'HTML 预览',
          read_file: '读取文件',
          write_file: '写入文件',
          list_files: '列出文件',
          create_workspace: '创建工作区',
          run_service: '启动服务',
          stop_service: '停止服务',
          list_services: '列出服务',
          web_fetch: '抓取网页'
        };
        return map[name] || name || '工具';
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
        const mode = this.toolPermission(t.name);
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
      async sendMessage() {
        if (!this.canSend) return;
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
        this.stopRequested = false;
        this.abortCtl = new AbortController();
        const maxToolRounds = U.clamp(parseInt(this.settings.maxToolRounds || 8, 10), 1, 32);
        const maxToolCalls = U.clamp(parseInt(this.settings.maxToolCalls || 24, 10), 1, 128);
        let totalToolCalls = 0;

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
                assistantMsg.status = 'streaming';
                nextTick(() => this.scrollToBottom(false));
              }
            });

            smoothText(this, assistantMsg, result.content || assistantMsg.content || '');
            assistantMsg.reasoning = result.reasoning || assistantMsg.reasoning || '';

            if (this.stopRequested || !tools.length || !result.toolCalls || !result.toolCalls.length) break;

            const rawCalls = result.toolCalls.filter(t => t && t.name);
            if (!rawCalls.length) break;
            if (step >= maxToolRounds) {
              assistantMsg.error = '已达到最大工具轮次（' + maxToolRounds + '）。可以在设置里调高“最大工具轮次”。';
              break;
            }
            if (totalToolCalls + rawCalls.length > maxToolCalls) {
              assistantMsg.error = '已达到最大工具调用数（' + maxToolCalls + '）。可以在设置里调高“最大工具调用数”。';
              break;
            }
            totalToolCalls += rawCalls.length;

            const callStart = assistantMsg.toolCalls.length;
            const displayCalls = rawCalls.map((t, idx) => ({
              id: t.id || ('call_' + step + '_' + idx),
              name: t.name,
              arguments: t.arguments || '{}',
              status: 'running',
              result: null,
              _open: false
            }));
            assistantMsg.toolCalls = assistantMsg.toolCalls.concat(displayCalls);
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
              const t = assistantMsg.toolCalls[callStart + ti] || displayCalls[ti];
              const denied = await this.authorizeToolCall(t);
              const out = denied || await Tools.execute(t.name, t.arguments, {
                session: this.session,
                webFetchMode: 'always',
                confirm: msg => this.confirm(msg, '工具授权'),
                openPreview: payload => this.openPreview(payload),
                openService: serviceId => this.openServicePreview(serviceId)
              });
              t.result = out;
              t.status = String(out).startsWith('错误：') ? 'error' : 'done';
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
          this.persistSession();
          nextTick(() => this.scrollToBottom(false));
        }
      },
      stopGenerate() {
        if (!this.generating) return;
        this.stopRequested = true;
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
        this.showScrollDown = el.scrollHeight - el.scrollTop - el.clientHeight > 160;
      },
      scrollToBottom(force) {
        const el = this.$refs.scroller;
        if (!el) return;
        const near = el.scrollHeight - el.scrollTop - el.clientHeight < 220;
        if (force || near) {
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
        this.attachments.push({ kind: 'image', name: f.name, size: f.size, mime: f.type, dataUrl: f.content });
        this.sheet = '';
      },
      async attachFile() {
        const f = await U.pickFile('.txt,.md,.json,.csv,.tsv,.html,.css,.js,.xml,.yml,.yaml,text/*,application/json', false);
        if (!f) return;
        if (!U.isTextFile(f.name, f.type)) {
          U.toast('当前只支持文本文件');
          return;
        }
        this.attachments.push({ kind: 'text', name: f.name, size: f.size, mime: f.type, content: String(f.content || '') });
        this.sheet = '';
      },
      async uploadToWorkspace() {
        const f = await readPickedFile();
        if (!f) return;
        const name = fileSafeName(f.name);
        if (Object.keys(this.session.files).length >= Tools.MAX_FILES && !this.session.files[name]) {
          U.toast('会话文件数已达上限');
          return;
        }
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
        U.toast('已加入工作区');
      },
      viewFile(name) {
        const f = this.session.files[name];
        if (!f) return;
        this.viewer = {
          name,
          isImage: !!f.dataUrl,
          dataUrl: f.dataUrl || '',
          content: f.content || ''
        };
        this.pushPage('viewer');
      },
      saveWorkspaceFile() {
        const f = this.session.files[this.viewer.name];
        if (!f) return;
        if (f.dataUrl) dataUrlDownload(this.viewer.name, f.dataUrl);
        else U.saveTextFile(this.viewer.name, f.content || '').then(() => U.toast('已导出'));
      },
      async deleteWorkspaceFile() {
        const ok = await this.confirm('删除文件：' + this.viewer.name, '删除文件');
        if (!ok) return;
        delete this.session.files[this.viewer.name];
        this.persistSession();
        this.closePage();
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
        this.preview.doc = this.buildServiceDoc(svc);
        this.pushPage('preview');
        nextTick(() => this.runPreview());
      },
      buildServiceDoc(svc) {
        const f = this.session.files[svc.entry];
        let html = f && f.content || '';
        const files = this.session.files || {};
        html = html.replace(/<link\b([^>]*?)href=["']([^"']+)["']([^>]*)>/gi, (m, a, href) => {
          if (isExternalRef(href)) return m;
          const name = normalizeRef(href);
          const dep = files[name];
          if (!dep || dep.dataUrl) return '<!-- missing stylesheet: ' + htmlAttr(name) + ' -->';
          return '<style data-wepchat-file="' + htmlAttr(name) + '">\n' + (dep.content || '') + '\n</style>';
        });
        html = html.replace(/<script\b([^>]*?)src=["']([^"']+)["']([^>]*)>\s*<\/script>/gi, (m, a, src) => {
          if (isExternalRef(src)) return m;
          const name = normalizeRef(src);
          const dep = files[name];
          if (!dep || dep.dataUrl) return '<script>console.error("missing script: ' + escapeScriptEnd(name) + '")<\/script>';
          return '<script data-wepchat-file="' + htmlAttr(name) + '">\n' + escapeScriptEnd(dep.content || '') + '\n<\/script>';
        });
        html = html.replace(/(<img\b[^>]*?\bsrc=["'])([^"']+)(["'][^>]*>)/gi, (m, pre, src, post) => {
          if (isExternalRef(src)) return m;
          const dep = files[normalizeRef(src)];
          return dep && dep.dataUrl ? pre + dep.dataUrl + post : m;
        });
        this.preview.html = html;
        this.preview.css = '';
        this.preview.js = '';
        return this.wrapPreviewDoc(html, '', '');
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
        this.preview.doc = this.buildPreviewDoc();
        this.pushPage('preview');
        nextTick(() => this.runPreview());
      },
      previewBridge() {
        const bridge = `
<script>
(function () {
  function send(level, args) {
    parent.postMessage({ source: 'wepchat-preview', level: level, text: Array.prototype.map.call(args, function (x) {
      if (typeof x === 'string') return x;
      try { return JSON.stringify(x); } catch (e) { return String(x); }
    }).join(' ') }, '*');
  }
  ['log','info','debug'].forEach(function (k) { console[k] = function () { send('log', arguments); }; });
  ['warn','error'].forEach(function (k) { console[k] = function () { send(k, arguments); }; });
  window.onerror = function (msg, src, line, col) { send('error', [msg + ' @ ' + line + ':' + col]); };
})();
<\/script>`;
        return bridge;
      },
      wrapPreviewDoc(sourceHtml, sourceCss, sourceJs) {
        const bridge = this.previewBridge();
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
        return this.wrapPreviewDoc(this.preview.html || '', this.preview.css || '', this.preview.js || '');
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
        this.preview.logs.push({
          level: data.level === 'error' || data.level === 'warn' ? data.level : 'log',
          text: String(data.text || '')
        });
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
      exportPreview() {
        U.saveTextFile(fileSafeName(this.preview.title || 'preview') + '.html', this.preview.doc).then(() => U.toast('已导出'));
      },

      async exportAll() {
        const data = Store.exportAll();
        await U.saveTextFile('wepchat-backup-' + new Date().toISOString().slice(0, 10) + '.json', JSON.stringify(data, null, 2));
        U.toast('已导出全部数据');
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
        try {
          const res = Store.importAll(data, 'merge');
          this.settings = Store.loadSettings();
          this.providers = Store.loadProviders();
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
