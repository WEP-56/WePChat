/* WepChat - 应用设置与远程配置 */
'use strict';

(() => {
  const { nextTick, clone, cleanTitle, normalizeSession, newProvider, parseModels, modelsText, imageModelsText, providerModelMeta, tokenMessageText, imageExtForMime, imageFileName, attachmentFileName, fileSafeName, normalizeWorkspacePath, parentFolder, ensureParentFolders, workspaceMime, workspaceExt, isHtmlName, isMarkdownName, isImageName, isJsName, RELEASES_URL, LATEST_RELEASE_API, normalizeAppVersion, appTag, parseReleaseTag, compareReleaseTags, formatReleaseDate, fetchLatestRelease, plusRuntimeVersion, manifestVersion, normalizeStylePreset, isEditableName, languageForName, resolveWorkspaceRef, dataUrlDownload, readPickedFile, escapeScriptEnd, isExternalRef, externalWebUrl, normalizeRef, htmlAttr, TextTargets, TextTimers, TextResolvers, resolveTyping, smoothText, waitSmoothText, streamToolKey, findToolDisplay, syncStreamToolCalls, clearStreamState, finalizeStreamToolCalls, discardStreamToolCalls, cancelStreamToolCalls } = window.WepChatAppHelpers;
  window.WepChatAppMethodsCore = {
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
        const client = this.remoteRuntime && this.remoteRuntime.client;
        if (this.generating && client && typeof client.ensureAlive === 'function') client.ensureAlive().catch(() => {});
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
  };
})();
