/* WepChat - 会话与模型提供商 */
'use strict';

(() => {
  const { nextTick, clone, cleanTitle, normalizeSession, newProvider, parseModels, modelsText, imageModelsText, providerModelMeta, tokenMessageText, imageExtForMime, imageFileName, attachmentFileName, fileSafeName, normalizeWorkspacePath, parentFolder, ensureParentFolders, workspaceMime, workspaceExt, isHtmlName, isMarkdownName, isImageName, isJsName, RELEASES_URL, LATEST_RELEASE_API, normalizeAppVersion, appTag, parseReleaseTag, compareReleaseTags, formatReleaseDate, fetchLatestRelease, plusRuntimeVersion, manifestVersion, normalizeStylePreset, isEditableName, languageForName, resolveWorkspaceRef, dataUrlDownload, readPickedFile, escapeScriptEnd, isExternalRef, externalWebUrl, normalizeRef, htmlAttr, TextTargets, TextTimers, TextResolvers, resolveTyping, smoothText, waitSmoothText, streamToolKey, findToolDisplay, syncStreamToolCalls, clearStreamState, finalizeStreamToolCalls, discardStreamToolCalls, cancelStreamToolCalls } = window.WepChatAppHelpers;
  window.WepChatAppMethodsSessions = {
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
      confirm(msg, title, opts) {
        return this.dialog({
          title: title || '确认',
          msg,
          liquid: !!(opts && opts.liquid),
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

      captureCurrentDraft() {
        if (!this.session) return;
        this.session.draft = {
          input: String(this.input || ''),
          attachments: clone(this.attachments || [])
        };
      },
      restoreSessionDraft() {
        const draft = this.session && this.session.draft || {};
        this.input = String(draft.input || '');
        this.attachments = clone(Array.isArray(draft.attachments) ? draft.attachments : []);
        nextTick(() => this.growInput());
      },
      scheduleDraftSave() {
        if (this.draftSaveTimer) clearTimeout(this.draftSaveTimer);
        this.draftSaveTimer = setTimeout(() => {
          this.draftSaveTimer = null;
          this.captureCurrentDraft();
          if (this.session && this.session.id) this.persistSession();
        }, 320);
      },
      clearCurrentDraft() {
        if (this.draftSaveTimer) clearTimeout(this.draftSaveTimer);
        this.draftSaveTimer = null;
        this.input = '';
        this.attachments = [];
        if (this.session) this.session.draft = { input: '', attachments: [] };
      },
      toggleGlobalSearch() {
        this.globalSearchOpen = !this.globalSearchOpen;
        if (this.globalSearchOpen) nextTick(() => {
          const el = this.$refs.globalSearchInput;
          if (el && el.focus) el.focus();
        });
      },
      async openGlobalSearchResult(row) {
        if (!row) return;
        await this.openSession(row.sessionId);
        this.globalSearchOpen = false;
        this.globalSearchQ = '';
        this.drawerOpen = false;
        if (!row.messageId) return;
        this.globalSearchHighlightId = row.messageId;
        nextTick(() => {
          const el = document.querySelector('[data-message-id="' + row.messageId + '"]');
          if (el && el.scrollIntoView) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
          setTimeout(() => { if (this.globalSearchHighlightId === row.messageId) this.globalSearchHighlightId = ''; }, 1900);
        });
      },

      async newSession() {
        const canLeave = await this.confirmStopRunning('新建会话');
        if (!canLeave) return;
        this.captureCurrentDraft();
        if (this.session && this.session.id) this.persistSession();
        const mode = await this.dialog({
          title: '新建会话',
          msg: '选择这次会话的模式。创建后不可修改。',
          liquid: true,
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
        this.restoreSessionDraft();
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
        this.captureCurrentDraft();
        this.persistSession();
        this.session = normalizeSession(s);
        this.restoreSessionDraft();
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
        const ok = await this.confirm('删除后无法恢复：\n' + (it.title || '新聊天'), '删除会话', { liquid: true });
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
          this.restoreSessionDraft();
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
          '删除工作区文件',
          { liquid: true }
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
          '真正删除会话',
          { liquid: true }
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
          this.restoreSessionDraft();
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
          testing: false,
          modelTests: {},
          modelTestMessages: {}
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
          testing: false,
          modelTests: {},
          modelTestMessages: {}
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
        meta.source = 'user';
      },
      toggleSelectedModelCap(key) {
        const meta = this.selectedProvModelMeta();
        if (!meta) return;
        meta.capabilities = meta.capabilities || {};
        meta.capabilities[key] = !meta.capabilities[key];
        meta.source = 'user';
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
      openPicker(title, options, value, action, key) {
        this.picker = { title, options: options || [], value, action, key: key || '' };
        this.sheet = 'picker';
      },
      pickOption(option) {
        if (!option || option.disabled || !this.picker) return;
        const picker = this.picker;
        if (picker.action === 'provider-api' && this.provForm.data) {
          this.provForm.data.api = option.value;
        } else if (picker.action === 'image-provider') {
          this.settings.imageProviderId = option.value;
          this.settings.imageModel = '';
          this.settings.imageEditModel = '';
          this.persistSettings();
        } else if (picker.action === 'image-model') {
          this.settings.imageModel = option.value;
          if (this.settings.imageEditModel && !this.imageEditModelOptions.includes(this.settings.imageEditModel)) {
            this.settings.imageEditModel = '';
          }
          this.persistSettings();
        } else if (picker.action === 'image-edit-model') {
          this.settings.imageEditModel = option.value;
          this.persistSettings();
        } else if (picker.action === 'setting') {
          this.settings[picker.key] = option.value;
          this.persistSettings();
        }
        this.sheet = '';
        this.picker = null;
      },
      pickerValueLabel(options, value, fallback) {
        const got = (options || []).find(x => x.value === value);
        return got ? got.label : (fallback || value || '请选择');
      },
      openApiTypePicker() {
        this.openPicker('接口类型', API.API_TYPES.map(x => ({ value: x.value, label: x.label })), this.provForm.data && this.provForm.data.api, 'provider-api');
      },
      openImageProviderPicker() {
        this.openPicker('图片提供商', this.imageProviders.map(p => ({
          value: p.id,
          label: p.name,
          sub: this.providerImageModels(p).length + ' 个图片模型'
        })), this.imageProvider && this.imageProvider.id || '', 'image-provider');
      },
      openImageModelPicker(editing) {
        const ids = editing ? this.imageEditModelOptions : this.imageModelOptions;
        const options = [{ value: '', label: editing ? '跟随生成模型' : '自动选择' }].concat(ids.map(id => ({
          value: id,
          label: id,
          sub: this.modelSummary(this.imageProvider, id)
        })));
        this.openPicker(editing ? '图片编辑模型' : '图片生成模型', options,
          editing ? this.settings.imageEditModel : this.settings.imageModel,
          editing ? 'image-edit-model' : 'image-model');
      },
      openSettingPicker(key, title, options) {
        this.openPicker(title, options, this.settings[key], 'setting', key);
      },
      providerImageModels(provider) {
        if (!provider) return [];
        const out = [];
        (provider.imageModels || []).forEach(id => { if (id && !out.includes(id)) out.push(id); });
        (provider.models || []).forEach(id => {
          const caps = providerModelMeta(provider, id).capabilities || {};
          if ((caps.imageGeneration || caps.imageEdit) && !out.includes(id)) out.push(id);
        });
        return out;
      },
      providerModelIds(provider) {
        if (!provider) return [];
        return (provider.models || []).concat(provider.imageModels || []).filter((id, i, arr) => id && arr.indexOf(id) === i);
      },
      isProviderImageModel(provider, id) {
        return !!provider && (provider.imageModels || []).includes(id);
      },
      providerModelTestState(id) {
        return this.provForm.modelTests && this.provForm.modelTests[id] || '';
      },
      openProviderModelEditor(id) {
        const p = this.provForm.data;
        if (!p || !id) return;
        const stored = (p.modelMeta && p.modelMeta[id]) || (p.imageModelMeta && p.imageModelMeta[id]);
        const meta = MODEL_META.mergeMeta(MODEL_META.infer(id, p.name), stored);
        this.modelEditor = {
          originalId: id,
          id,
          contextWindow: String(meta.contextWindow || ''),
          maxOutputTokens: String(meta.maxOutputTokens || ''),
          capabilities: Object.assign({}, meta.capabilities || {})
        };
      },
      toggleModelEditorCap(key) {
        if (!this.modelEditor) return;
        this.modelEditor.capabilities[key] = !this.modelEditor.capabilities[key];
      },
      saveProviderModelEditor() {
        const p = this.provForm.data;
        const editor = this.modelEditor;
        if (!p || !editor) return;
        const id = String(editor.id || '').trim();
        if (!id) { U.toast('请填写模型名称'); return; }
        const duplicate = this.providerModelIds(p).some(x => x === id && x !== editor.originalId);
        if (duplicate) { U.toast('模型名称已存在'); return; }
        const remove = x => (x || []).filter(name => name !== editor.originalId && name !== id);
        p.models = remove(p.models);
        p.imageModels = remove(p.imageModels);
        p.modelMeta = p.modelMeta || {};
        p.imageModelMeta = p.imageModelMeta || {};
        delete p.modelMeta[editor.originalId];
        delete p.imageModelMeta[editor.originalId];
        const meta = MODEL_META.mergeMeta(MODEL_META.infer(id, p.name), {
          id,
          contextWindow: MODEL_META.toInt(editor.contextWindow) || 0,
          maxOutputTokens: MODEL_META.toInt(editor.maxOutputTokens) || 0,
          capabilities: Object.assign({}, editor.capabilities || {}),
          source: 'user'
        });
        const imageOnly = meta.capabilities.imageGeneration || meta.capabilities.imageEdit;
        if (imageOnly) {
          p.imageModels.push(id);
          p.imageModelMeta[id] = meta;
        } else {
          p.models.push(id);
          p.modelMeta[id] = meta;
        }
        this.provForm.modelsText = modelsText(p);
        this.provForm.imageModelsText = imageModelsText(p);
        this.modelEditor = null;
      },
      async addProviderModel() {
        const p = this.provForm.data;
        if (!p) return;
        const id = await this.askText('添加模型', '', '输入接口使用的完整模型名称');
        const cleanId = String(id || '').trim();
        if (!cleanId) return;
        if (this.providerModelIds(p).includes(cleanId)) { U.toast('模型已经存在'); return; }
        const meta = MODEL_META.infer(cleanId, p.name);
        p.modelMeta = p.modelMeta || {};
        p.imageModelMeta = p.imageModelMeta || {};
        if (MODEL_META.isImageGenerationMeta(meta) || meta.capabilities.imageEdit) {
          p.imageModels.push(cleanId);
          p.imageModelMeta[cleanId] = meta;
        } else {
          p.models.push(cleanId);
          p.modelMeta[cleanId] = meta;
        }
        this.provForm.modelsText = modelsText(p);
        this.provForm.imageModelsText = imageModelsText(p);
        this.openProviderModelEditor(cleanId);
      },
      async deleteProviderModel() {
        const p = this.provForm.data;
        const editor = this.modelEditor;
        if (!p || !editor) return;
        const ok = await this.confirm('删除模型：' + editor.originalId, '删除模型');
        if (!ok) return;
        p.models = (p.models || []).filter(id => id !== editor.originalId);
        p.imageModels = (p.imageModels || []).filter(id => id !== editor.originalId);
        if (p.modelMeta) delete p.modelMeta[editor.originalId];
        if (p.imageModelMeta) delete p.imageModelMeta[editor.originalId];
        this.provForm.modelsText = modelsText(p);
        this.provForm.imageModelsText = imageModelsText(p);
        this.modelEditor = null;
      },
      async testProviderModel(id) {
        const p = this.provForm.data;
        if (!p || !p.baseUrl) { U.toast('请先填写 API 地址'); return; }
        if (this.isProviderImageModel(p, id)) {
          U.toast('图片模型需要实际生成图片，请在图片生成页测试', 3600);
          return;
        }
        this.provForm.modelTests[id] = 'testing';
        this.provForm.modelTestMessages[id] = '';
        let answer = '';
        try {
          const result = await API.send({
            provider: p,
            model: id,
            messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
            tools: [],
            settings: { systemPrompt: '', temperature: 0, maxTokens: 16 },
            requestKey: NetStability.idempotencyKey('model-test-' + id),
            onStatus: info => this.connectionStatus(Object.assign({ source: '模型测试' }, info || {})),
            onUpdate: st => { answer = st && st.content || answer; }
          });
          answer = String(result && result.content || answer || '').trim();
          this.provForm.modelTests[id] = 'ok';
          this.provForm.modelTestMessages[id] = answer;
          U.toast('模型可达' + (answer ? ' · ' + U.truncate(answer, 36) : ''));
        } catch (e) {
          this.provForm.modelTests[id] = 'error';
          this.provForm.modelTestMessages[id] = e && e.message || String(e);
          U.toast('模型不可达：' + (e && e.message || String(e)), 4200);
        }
      },
      saveImageProviderField(key, value) {
        const p = this.imageProvider;
        if (!p) return;
        p[key] = String(value || '').trim();
        this.persistProviders();
      },
      setImageEndpointPath(key, value) {
        this.settings[key] = String(value || '').trim();
        this.persistSettings();
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
      snapshotAssistantVariant(m, id) {
        return {
          id: id || U.uuid(),
          content: String(m.content || ''),
          reasoning: String(m.reasoning || ''),
          toolCalls: clone(Array.isArray(m.toolCalls) ? m.toolCalls : []),
          previews: clone(Array.isArray(m.previews) ? m.previews : []),
          images: clone(Array.isArray(m.images) ? m.images : []),
          imageRecovery: m.imageRecovery ? clone(m.imageRecovery) : null,
          error: String(m.error || ''),
          usage: m.usage ? clone(m.usage) : null,
          model: m.model || '',
          createdAt: m.createdAt || U.now(),
          status: m.status || 'done'
        };
      },
      ensureAssistantVariants(m) {
        if (!m || m.role !== 'assistant') return [];
        m.variantBaseId = m.variantBaseId || (m.id + ':v1');
        if (!Array.isArray(m.variants) || !m.variants.length) {
          m.variants = [this.snapshotAssistantVariant(m, m.variantBaseId)];
          m.activeVariantIndex = 0;
        }
        return m.variants;
      },
      activeAssistantVariantId(m) {
        if (!m) return '';
        const variants = Array.isArray(m.variants) ? m.variants : [];
        const active = variants[m.activeVariantIndex || 0];
        return active && active.id || m.variantBaseId || (m.id + ':v1');
      },
      syncActiveAssistantVariant(m) {
        const variants = Array.isArray(m && m.variants) ? m.variants : [];
        const active = variants[m.activeVariantIndex || 0];
        if (!active) return;
        const fresh = this.snapshotAssistantVariant(m, active.id);
        Object.keys(fresh).forEach(k => { active[k] = fresh[k]; });
      },
      applyAssistantVariant(m, index) {
        const variants = Array.isArray(m && m.variants) ? m.variants : [];
        if (!variants.length) return;
        const idx = Math.max(0, Math.min(variants.length - 1, Number(index) || 0));
        const v = variants[idx];
        m.activeVariantIndex = idx;
        m.content = v.content || '';
        m.reasoning = v.reasoning || '';
        m.toolCalls = clone(v.toolCalls || []);
        m.previews = clone(v.previews || []);
        m.images = clone(v.images || []);
        m.imageRecovery = v.imageRecovery ? clone(v.imageRecovery) : null;
        m.error = v.error || '';
        m.usage = v.usage ? clone(v.usage) : null;
        m.model = v.model || m.model || '';
        m.createdAt = v.createdAt || m.createdAt;
        m.status = v.status === 'streaming' ? 'done' : (v.status || 'done');
      },
      switchAssistantVariant(m, delta) {
        if (this.generating || !m || !Array.isArray(m.variants) || m.variants.length < 2) return;
        const next = Math.max(0, Math.min(m.variants.length - 1, (m.activeVariantIndex || 0) + delta));
        if (next === (m.activeVariantIndex || 0)) return;
        this.applyAssistantVariant(m, next);
        this.persistSession();
      },
      assistantUsageText(m) {
        const usage = m && m.usage;
        if (!usage) return '';
        const count = Number(usage.outputTokens || usage.totalTokens) || 0;
        if (!count) return '';
        return (usage.source === 'api' ? '' : '≈') + MODEL_META.fmtTokens(count) + ' tokens';
      },
      canRegenerateMessage(i) {
        const m = this.session.messages[i];
        if (!m || m.role !== 'assistant' || this.appMode === 'remote') return false;
        const later = this.session.messages.slice(i + 1).some(x => x.role === 'user' || x.role === 'assistant');
        const count = Array.isArray(m.variants) && m.variants.length ? m.variants.length : 1;
        return !later && count < 6;
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
        const later = this.session.messages.slice(i + 1).some(x => x.role === 'user' || x.role === 'assistant');
        if (later) {
          U.toast('已有后续消息，只能查看这个回答的现有版本');
          return;
        }
        const count = Array.isArray(m.variants) && m.variants.length ? m.variants.length : 1;
        if (count >= 6) {
          U.toast('每条回复最多保留 6 个版本');
          return;
        }
        await this.generateAssistant({ targetIndex: i });
      },
  };
})();
