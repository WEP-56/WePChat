/* WepChat - 服务预览与数据管理 */
'use strict';

(() => {
  const { nextTick, clone, cleanTitle, normalizeSession, newProvider, parseModels, modelsText, imageModelsText, providerModelMeta, tokenMessageText, imageExtForMime, imageFileName, attachmentFileName, fileSafeName, normalizeWorkspacePath, parentFolder, ensureParentFolders, workspaceMime, workspaceExt, isHtmlName, isMarkdownName, isImageName, isJsName, RELEASES_URL, LATEST_RELEASE_API, normalizeAppVersion, appTag, parseReleaseTag, compareReleaseTags, formatReleaseDate, fetchLatestRelease, plusRuntimeVersion, manifestVersion, normalizeStylePreset, isEditableName, languageForName, resolveWorkspaceRef, dataUrlDownload, readPickedFile, escapeScriptEnd, isExternalRef, externalWebUrl, normalizeRef, htmlAttr, TextTargets, TextTimers, TextResolvers, resolveTyping, smoothText, waitSmoothText, streamToolKey, findToolDisplay, syncStreamToolCalls, clearStreamState, finalizeStreamToolCalls, discardStreamToolCalls, cancelStreamToolCalls } = window.WepChatAppHelpers;
  window.WepChatAppMethodsPreview = {
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
          const stamp = new Date().toISOString();
          const name = 'wepchat-backup-' + stamp.slice(0, 10) + '.wepchat';
          const manifest = {
            format: 'wepchat-backup',
            version: 1,
            createdAt: stamp,
            appVersion: this.appVersion || ''
          };
          const saved = await U.exportFilesAsZip([
            { path: 'manifest.json', content: JSON.stringify(manifest, null, 2), mime: 'application/json' },
            { path: 'data.json', content: JSON.stringify(data), mime: 'application/json' }
          ], name, { mime: 'application/zip', picker: true });
          this.toastExportResult(saved, '已导出全部数据');
        } catch (e) {
          this.toastExportError(e);
        }
      },
      async openExportFiles() {
        const info = await U.openExportDirectory();
        if (info && info.opened) return;
        const path = info && info.path || '应用数据目录/Download/wepchat';
        const action = await this.dialog({
          title: '导出文件位置',
          msg: (info && info.isApp
            ? '系统文件管理器无法直接打开此目录。你可以复制下面的路径，在文件管理器中手动查找：\n\n'
            : '网页导出的文件由浏览器管理。你可以打开浏览器的下载记录，或复制下面的位置说明：\n\n') + path,
          buttons: [
            { text: '关闭', value: null },
            { text: '复制路径', value: 'copy', style: 'primary' }
          ]
        });
        if (action === 'copy') {
          const ok = await U.copyText(path);
          U.toast(ok ? '路径已复制' : '复制失败');
        }
      },
      async importData() {
        const f = await U.pickFile('.wepchat', true);
        if (!f) return;
        if (!/\.wepchat$/i.test(f.name || '')) {
          U.toast('请选择 .wepchat 备份文件');
          return;
        }
        let data;
        try {
          const files = await U.readZipTextFiles(U.dataUrlToBlob(f.content), ['manifest.json', 'data.json']);
          if (!files['manifest.json'] || !files['data.json']) throw new Error('备份包缺少 manifest.json 或 data.json');
          const manifest = JSON.parse(files['manifest.json']);
          if (!manifest || manifest.format !== 'wepchat-backup') throw new Error('不是 WepChat 备份包');
          if (manifest.version !== 1) throw new Error('暂不支持此备份版本：' + manifest.version);
          data = JSON.parse(files['data.json']);
        }
        catch (e) {
          U.toast('备份包读取失败：' + (e && e.message || String(e)), 4000);
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
          this.storageUsed = Store.usage();
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
  };
})();
