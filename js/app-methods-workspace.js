/* WepChat - 工作区与文件查看器 */
'use strict';

(() => {
  const { nextTick, clone, cleanTitle, normalizeSession, newProvider, parseModels, modelsText, imageModelsText, providerModelMeta, tokenMessageText, imageExtForMime, imageFileName, attachmentFileName, fileSafeName, normalizeWorkspacePath, parentFolder, ensureParentFolders, workspaceMime, workspaceExt, isHtmlName, isMarkdownName, isImageName, isJsName, RELEASES_URL, LATEST_RELEASE_API, normalizeAppVersion, appTag, parseReleaseTag, compareReleaseTags, formatReleaseDate, fetchLatestRelease, plusRuntimeVersion, manifestVersion, normalizeStylePreset, isEditableName, languageForName, resolveWorkspaceRef, dataUrlDownload, readPickedFile, escapeScriptEnd, isExternalRef, externalWebUrl, normalizeRef, htmlAttr, TextTargets, TextTimers, TextResolvers, resolveTyping, smoothText, waitSmoothText, streamToolKey, findToolDisplay, syncStreamToolCalls, clearStreamState, finalizeStreamToolCalls, discardStreamToolCalls, cancelStreamToolCalls } = window.WepChatAppHelpers;
  window.WepChatAppMethodsWorkspace = {
      growInput() {
        const el = this.$refs.inputEl;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = Math.min(el.scrollHeight, 132) + 'px';
      },
      onScroll() {
        const el = this.$refs.scroller;
        if (!el) return;
        this.liquidScrolling = true;
        if (this.liquidScrollTimer) clearTimeout(this.liquidScrollTimer);
        this.liquidScrollTimer = setTimeout(() => {
          this.liquidScrolling = false;
          this.liquidScrollTimer = null;
        }, 120);
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
        const ok = await this.confirm('删除文件：' + this.viewer.name, '删除文件', { liquid: true });
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
        const ok = await this.confirm('删除文件：' + row.path, '删除文件', { liquid: true });
        if (!ok) return;
        delete this.session.files[row.path];
        this.persistSession();
      },
      async deleteWorkspaceFolder(path) {
        const prefix = path + '/';
        const files = Object.keys(this.session.files || {}).filter(name => name === path || name.startsWith(prefix));
        const ok = await this.confirm('删除文件夹：' + path + '\n包含 ' + files.length + ' 个文件。', '删除文件夹', { liquid: true });
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
  };
})();
