/* WepChat - 本地存储层（localStorage，按会话分键存储） */
'use strict';

const Store = {
  KEY_SETTINGS: 'wc.settings',
  KEY_PROVIDERS: 'wc.providers',
  KEY_INDEX: 'wc.sessions',
  KEY_SESSION: id => 'wc.session.' + id,

  defaultSettings() {
    return {
      theme: 'auto',                 // auto | light | dark
      activeProviderId: '',
      activeModel: '',
      agentEnabled: true,            // 是否给模型配置工具
      webFetch: 'ask',               // ask | always | never
      toolPermissions: {
        run_js: 'ask',
        preview_html: 'ask',
        files: 'ask',
        delete_files: 'ask',
        services: 'ask',
        web_fetch: 'ask'
      },
      imageProviderId: '',
      imageModel: '',
      imageEditModel: '',
      imageDefaultSize: '1024x1024',
      imageDefaultCount: 1,
      imagePermission: 'ask',        // ask | always | never
      imageOutputFormat: 'png',
      imageApiMode: 'images',        // images | auto | chat | responses
      imageEndpointPath: '',         // optional override, e.g. /v1/images/generations
      imageEditEndpointPath: '',     // optional override, e.g. /v1/images/edits
      appMode: 'chat',               // chat | image
      maxToolRounds: 8,
      maxToolCalls: 24,
      systemPrompt: '',
      temperature: null,             // null = 不传
      maxTokens: null,
      fontSize: 'normal'             // normal | large
    };
  },

  _get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  },

  _set(key, val) {
    try {
      localStorage.setItem(key, JSON.stringify(val));
      return true;
    } catch (e) {
      U.toast('存储空间不足，写入失败');
      return false;
    }
  },

  loadSettings() {
    const d = this.defaultSettings();
    const saved = this._get(this.KEY_SETTINGS, {});
    const out = Object.assign(d, saved);
    out.toolPermissions = Object.assign({}, d.toolPermissions, saved.toolPermissions || {});
    if (saved.webFetch && !(saved.toolPermissions && saved.toolPermissions.web_fetch)) {
      out.toolPermissions.web_fetch = saved.webFetch;
    }
    out.webFetch = out.toolPermissions.web_fetch;
    return out;
  },
  saveSettings(s) { this._set(this.KEY_SETTINGS, s); },

  loadProviders() { return this._get(this.KEY_PROVIDERS, []); },
  saveProviders(list) { this._set(this.KEY_PROVIDERS, list); },

  /* 会话索引：[{id,title,updatedAt,createdAt,pinned}] */
  loadIndex() { return this._get(this.KEY_INDEX, []); },
  saveIndex(idx) { this._set(this.KEY_INDEX, idx); },

  loadSession(id) { return this._get(this.KEY_SESSION(id), null); },
  saveSession(sess) {
    sess.updatedAt = U.now();
    return this._set(this.KEY_SESSION(sess.id), sess);
  },
  deleteSession(id) {
    try { localStorage.removeItem(this.KEY_SESSION(id)); } catch (e) {}
  },

  newSession() {
    return {
      id: U.uuid(),
      title: '',
      createdAt: U.now(),
      updatedAt: U.now(),
      mode: 'chat',    // chat | image
      providerId: '',
      model: '',
      messages: [],
      files: {},       // name -> {content, mime, size, mtime, dataUrl?}
      folders: [],     // empty folders and user-created folder paths
      services: []     // {id,name,entry,status,createdAt,updatedAt,lastStartedAt?}
    };
  },

  /* ---- 导入 / 导出 ---- */
  exportAll() {
    const idx = this.loadIndex();
    const sessions = idx.map(m => this.loadSession(m.id)).filter(Boolean);
    return {
      app: 'wepchat',
      version: 1,
      exportedAt: U.now(),
      settings: this.loadSettings(),
      providers: this.loadProviders(),
      sessions
    };
  },

  /* mode: 'merge' 合并 | 'replace' 覆盖 */
  importAll(data, mode) {
    if (!data || data.app !== 'wepchat' || !Array.isArray(data.sessions)) {
      throw new Error('不是有效的 WepChat 备份文件');
    }
    if (mode === 'replace') {
      this.loadIndex().forEach(m => this.deleteSession(m.id));
      this.saveIndex([]);
      this.saveProviders([]);
    }
    const idx = this.loadIndex();
    const provs = this.loadProviders();

    (data.providers || []).forEach(p => {
      const i = provs.findIndex(x => x.id === p.id);
      if (i >= 0) provs[i] = p; else provs.push(p);
    });
    this.saveProviders(provs);

    let count = 0;
    data.sessions.forEach(s => {
      if (!s || !s.id) return;
      this._set(this.KEY_SESSION(s.id), s);
      const i = idx.findIndex(x => x.id === s.id);
      const meta = { id: s.id, title: s.title || '', createdAt: s.createdAt, updatedAt: s.updatedAt, pinned: !!s.pinned };
      if (i >= 0) idx[i] = meta; else idx.unshift(meta);
      count++;
    });
    idx.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    this.saveIndex(idx);

    if (data.settings && mode === 'replace') this.saveSettings(Object.assign(this.defaultSettings(), data.settings));
    return { sessions: count, providers: (data.providers || []).length };
  },

  clearAll() {
    this.loadIndex().forEach(m => this.deleteSession(m.id));
    localStorage.removeItem(this.KEY_INDEX);
    localStorage.removeItem(this.KEY_PROVIDERS);
    localStorage.removeItem(this.KEY_SETTINGS);
  },

  usage() {
    let total = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('wc.')) total += (localStorage.getItem(k) || '').length * 2;
      }
    } catch (e) {}
    return total;
  }
};

window.Store = Store;
