/* WepChat - Vue 状态、计算属性与生命周期 */
'use strict';

(() => {
  const { nextTick, clone, cleanTitle, normalizeSession, newProvider, parseModels, modelsText, imageModelsText, providerModelMeta, tokenMessageText, imageExtForMime, imageFileName, attachmentFileName, fileSafeName, normalizeWorkspacePath, parentFolder, ensureParentFolders, workspaceMime, workspaceExt, isHtmlName, isMarkdownName, isImageName, isJsName, RELEASES_URL, LATEST_RELEASE_API, normalizeAppVersion, appTag, parseReleaseTag, compareReleaseTags, formatReleaseDate, fetchLatestRelease, plusRuntimeVersion, manifestVersion, normalizeStylePreset, isEditableName, languageForName, resolveWorkspaceRef, dataUrlDownload, readPickedFile, escapeScriptEnd, isExternalRef, externalWebUrl, normalizeRef, htmlAttr, TextTargets, TextTimers, TextResolvers, resolveTyping, smoothText, waitSmoothText, streamToolKey, findToolDisplay, syncStreamToolCalls, clearStreamState, finalizeStreamToolCalls, discardStreamToolCalls, cancelStreamToolCalls } = window.WepChatAppHelpers;
  window.WepChatAppOptions = {
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
        connectionNotice: {
          visible: false,
          level: 'error',
          source: '',
          code: '',
          message: '',
          attempt: 0,
          max: 0,
          progress: ''
        },
        connectionNoticeTimer: null,
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
      window.addEventListener('offline', this.handleNetworkOffline);
      window.addEventListener('online', this.handleNetworkOnline);
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
  };
})();
