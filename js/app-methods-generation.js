/* WepChat - 消息生成与远程事件 */
'use strict';

(() => {
  const { nextTick, clone, cleanTitle, normalizeSession, newProvider, parseModels, modelsText, imageModelsText, providerModelMeta, tokenMessageText, imageExtForMime, imageFileName, attachmentFileName, fileSafeName, normalizeWorkspacePath, parentFolder, ensureParentFolders, workspaceMime, workspaceExt, isHtmlName, isMarkdownName, isImageName, isJsName, RELEASES_URL, LATEST_RELEASE_API, normalizeAppVersion, appTag, parseReleaseTag, compareReleaseTags, formatReleaseDate, fetchLatestRelease, plusRuntimeVersion, manifestVersion, normalizeStylePreset, isEditableName, languageForName, resolveWorkspaceRef, dataUrlDownload, readPickedFile, escapeScriptEnd, isExternalRef, externalWebUrl, normalizeRef, htmlAttr, TextTargets, TextTimers, TextResolvers, resolveTyping, smoothText, waitSmoothText, streamToolKey, findToolDisplay, syncStreamToolCalls, clearStreamState, finalizeStreamToolCalls, discardStreamToolCalls, cancelStreamToolCalls } = window.WepChatAppHelpers;
  window.WepChatAppMethodsGeneration = {
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
      imageRequestModel(mode) {
        const provider = this.imageProvider;
        let model = this.imageModelId;
        if (mode === 'edit' && this.settings.imageEditModel && this.imageEditModelOptions.includes(this.settings.imageEditModel)) {
          model = this.settings.imageEditModel;
        }
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
          saved.push({ path, mime: img.mime || 'image/png', prompt: args.prompt || '' });
        });
        if (saved.length) this.openFolders.images = true;
        return saved;
      },
      generatedImageSrc(img) {
        if (!img) return '';
        return img.dataUrl || (this.session.files && this.session.files[img.path] && this.session.files[img.path].dataUrl) || '';
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
        const referenceImages = this.imageReferencesFromArgs(args);
        const requestMode = args.mode || (referenceImages.length ? 'edit' : 'generate');
        const { provider, model } = this.imageRequestModel(requestMode);
        const meta = providerModelMeta(provider, model);
        const caps = meta && meta.capabilities || {};
        if (!(caps.imageGeneration || (meta.image && meta.image.generation))) {
          U.toast('当前图片模型元数据未标记生图能力，仍尝试调用接口', 3200);
        }
        if (requestMode === 'edit' && !referenceImages.length) {
          throw new Error('图片编辑需要至少一张参考图');
        }
        let result;
        try {
          result = await ImageAPI.generate({
            provider,
            model,
            prompt: args.prompt,
            mode: requestMode,
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
            signal: this.abortCtl && this.abortCtl.signal,
            requestKey: args.requestKey || NetStability.idempotencyKey('image-' + (targetMsg && targetMsg.id || U.uuid())),
            onStatus: info => this.connectionStatus(Object.assign({ source: '图片生成' }, info || {}))
          });
        } catch (e) {
          if (targetMsg && (e && e.resultUrl || e && e.pollUrl)) {
            targetMsg.imageRecovery = {
              resultUrl: e.resultUrl || '',
              pollUrl: e.pollUrl || '',
              providerId: provider.id,
              model,
              format: args.outputFormat || 'png',
              args: Object.assign({}, args)
            };
            this.persistSession();
          }
          if (this.stopRequested || e && e.code === 'NET-ABORTED') throw e;
          throw this.connectionError(e, '图片生成', e && e.code || 'IMAGE-SUBMIT-UNKNOWN');
        }
        const saved = this.saveGeneratedImages(result.images || [], args, provider, model);
        if (!saved.length) throw NetStability.createError('IMAGE-RESULT-MISSING', '接口已返回，但没有可用图片结果');
        this.connectionStatus({ state: 'recovered', source: '图片生成', code: 'IMAGE-READY', message: '图片结果已完整接收并保存' });
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
          if (this.stopRequested || e && e.code === 'NET-ABORTED') {
            assistantMsg.content = assistantMsg.content || '已停止。';
          } else {
            const networkError = this.connectionError(e, '图片生成', e && e.code || 'IMAGE-SUBMIT-UNKNOWN');
            assistantMsg.error = this.connectionErrorText(networkError);
          }
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
          onStatus: info => {
            if (!info || info.silent) return;
            this.connectionStatus(Object.assign({}, info, { source: '远程 Host' }));
          },
          onClose: info => this.handleRemoteClose(info)
        });
        this.remoteRuntime.client = client;
        this.remoteRuntime.assistantId = assistantId;
        this.remoteRuntime.messageIds = assistantId ? [assistantId] : [];
        await client.connect();
        return client;
      },
      handleRemoteClose(info) {
        if (!info || !info.final) return;
        const rt = this.remoteRuntime || {};
        if (this.generating && rt.rejectTurn) {
          const reject = rt.rejectTurn;
          rt.resolveTurn = null;
          rt.rejectTurn = null;
          reject(info.error || NetStability.createError('REMOTE-RECONNECT-EXHAUSTED', 'Host 五次重连均失败'));
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
          const networkError = this.connectionError(e, '远程 Host', e && e.code || 'REMOTE-TURN-FAILED');
          errMsg.error = this.connectionErrorText(networkError);
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
              requestKey: NetStability.idempotencyKey('chat-' + assistantMsg.id + '-' + step),
              onStatus: info => this.connectionStatus(Object.assign({ source: '模型提供商' }, info || {})),
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
          if (this.stopRequested || e && e.code === 'NET-ABORTED') {
            if (!assistantMsg.content && !assistantMsg.toolCalls.length) assistantMsg.content = '已停止。';
          } else {
            const networkError = this.connectionError(e, '模型提供商');
            assistantMsg.error = this.connectionErrorText(networkError);
          }
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
  };
})();
