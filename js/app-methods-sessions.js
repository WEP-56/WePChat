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
  };
})();
