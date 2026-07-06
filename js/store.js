/* WepChat - 本地存储层（IndexedDB + 内存缓存，按会话分键存储；旧 localStorage 数据自动迁移） */
'use strict';

const Store = {
  KEY_SETTINGS: 'wc.settings',
  KEY_PROVIDERS: 'wc.providers',
  KEY_INDEX: 'wc.sessions',
  KEY_SESSION: id => 'wc.session.' + id,

  /* 内存缓存：key -> 原始 JSON 字符串。读取全部走缓存，保证同步 API 不变 */
  _cache: new Map(),
  _db: null,

  /* 应用挂载前必须 await：打开 IndexedDB、预热缓存、迁移 localStorage 旧数据。
     localStorage 在 Android WebView 只有约 5MB 配额，存 base64 图片很容易触发
     QuotaExceededError；IndexedDB 配额按设备磁盘计算，足够存放工作区图片。 */
  async init() {
    try {
      /* 个别 ROM 上 IndexedDB open 可能长时间不回调，超时则降级回 localStorage */
      this._db = await Promise.race([
        this._openDb(),
        new Promise(resolve => setTimeout(() => resolve(null), 3000))
      ]);
    } catch (e) { this._db = null; }
    if (this._db) {
      try {
        const rows = await this._idbAll();
        rows.forEach(r => this._cache.set(r.key, r.value));
      } catch (e) {}
    }
    this._migrateFromLocalStorage();
  },

  /* localStorage 里的 wc.* 键迁入 IndexedDB；迁移成功后删除原键释放配额。
     若某键两边都有，以 localStorage 为准（可能是旧版本更近一次写入的）。 */
  _migrateFromLocalStorage() {
    const keys = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('wc.')) keys.push(k);
      }
    } catch (e) { return; }
    keys.forEach(k => {
      let raw = null;
      try { raw = localStorage.getItem(k); } catch (e) {}
      if (raw == null) return;
      this._cache.set(k, raw);
      if (this._db) {
        this._idbPut(k, raw).then(() => {
          try { localStorage.removeItem(k); } catch (e) {}
        }, () => {});
      }
    });
  },

  _openDb() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return resolve(null);
      let req;
      try { req = indexedDB.open('wepchat', 1); } catch (e) { return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error('IndexedDB 打开失败'));
      req.onblocked = () => resolve(null);
    });
  },

  _idbAll() {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('kv', 'readonly');
      const os = tx.objectStore('kv');
      const keysReq = os.getAllKeys();
      const valsReq = os.getAll();
      tx.oncomplete = () => {
        const keys = keysReq.result || [];
        const vals = valsReq.result || [];
        resolve(keys.map((k, i) => ({ key: String(k), value: vals[i] })));
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('读取中止'));
    });
  },

  _idbPut(key, raw) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(raw, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('写入中止'));
    });
  },

  _idbDelete(key) {
    return new Promise((resolve, reject) => {
      const tx = this._db.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('删除中止'));
    });
  },

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
      let raw = this._cache.has(key) ? this._cache.get(key) : null;
      if (raw == null) {
        try { raw = localStorage.getItem(key); } catch (e) {}
      }
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  },

  _set(key, val) {
    let raw;
    try { raw = JSON.stringify(val); } catch (e) { return false; }
    this._cache.set(key, raw);
    if (this._db) {
      this._idbPut(key, raw).catch(() => {
        U.toast('保存失败：应用存储写入异常');
      });
      return true;
    }
    /* IndexedDB 不可用时的降级路径 */
    try {
      localStorage.setItem(key, raw);
      return true;
    } catch (e) {
      U.toast('应用本地存储已满，写入失败');
      return false;
    }
  },

  _remove(key) {
    this._cache.delete(key);
    if (this._db) this._idbDelete(key).catch(() => {});
    try { localStorage.removeItem(key); } catch (e) {}
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
    this._remove(this.KEY_SESSION(id));
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
    this._remove(this.KEY_INDEX);
    this._remove(this.KEY_PROVIDERS);
    this._remove(this.KEY_SETTINGS);
  },

  usage() {
    let total = 0;
    this._cache.forEach((raw, k) => {
      if (k && k.startsWith('wc.')) total += (raw || '').length * 2;
    });
    return total;
  }
};

window.Store = Store;
