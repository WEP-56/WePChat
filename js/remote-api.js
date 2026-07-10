/* WepChat - LAN Codex host client */
'use strict';

(function () {
  function trimSlash(s) {
    return String(s || '').trim().replace(/\/+$/, '');
  }

  function withHttp(url) {
    url = String(url || '').trim();
    if (!url) return '';
    if (/^wss?:\/\//i.test(url)) return url.replace(/^ws/i, 'http');
    if (!/^https?:\/\//i.test(url)) return 'http://' + url;
    return url;
  }

  function normalizeHost(host) {
    host = host || {};
    const baseUrl = trimSlash(withHttp(host.baseUrl || host.url || host.host));
    const util = window.U || {};
    return {
      id: host.id || (util.uuid ? util.uuid() : String(Date.now())),
      name: String(host.name || host.label || '').trim() || baseUrl.replace(/^https?:\/\//i, '') || 'WepChat Host',
      baseUrl,
      token: String(host.token || '').trim(),
      lastConnectedAt: host.lastConnectedAt || 0,
      lastStatus: host.lastStatus || '',
      lastWorkspaceId: host.lastWorkspaceId || ''
    };
  }

  function normalizeWorkspace(ws) {
    ws = ws || {};
    return {
      id: String(ws.id || ''),
      name: String(ws.name || ws.label || ws.path || ''),
      path: String(ws.path || '')
    };
  }

  function ipv4Parts(host) {
    const parts = String(host || '').trim().split('.');
    if (parts.length !== 4) return null;
    const nums = parts.map(n => Number(n));
    if (nums.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return nums;
  }

  function hostRank(host) {
    host = String(host || '').trim().toLowerCase().replace(/^\[|\]$/g, '');
    if (!host) return 9;
    if (host === 'localhost' || host === '::1') return 8;
    if (host === '0.0.0.0') return 7;
    if (/^(fc|fd)/i.test(host)) return 0;
    if (/^fe80:/i.test(host)) return 6;

    const p = ipv4Parts(host);
    if (!p) return 2;
    if (p[0] === 192 && p[1] === 168) return 0;
    if (p[0] === 10) return 0;
    if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return 0;
    if (p[0] === 127) return 8;
    if (p[0] === 198 && (p[1] === 18 || p[1] === 19)) return 7;
    if (p[0] === 169 && p[1] === 254) return 6;
    if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return 5;
    return 2;
  }

  function urlRank(rawUrl) {
    try {
      return hostRank(new URL(withHttp(rawUrl)).hostname);
    } catch (e) {
      return 9;
    }
  }

  function sortPairingUrls(urls) {
    return urls.slice().sort((a, b) => urlRank(a) - urlRank(b) || String(a).localeCompare(String(b)));
  }

  function authHeaders(host) {
    host = normalizeHost(host);
    return host.token ? { Authorization: 'Bearer ' + host.token } : {};
  }

  function urlFor(host, path, query) {
    host = normalizeHost(host);
    if (!host.baseUrl) throw new Error('请填写 Host 地址');
    const url = new URL(path, host.baseUrl + '/');
    Object.keys(query || {}).forEach(k => {
      const v = query[k];
      if (v != null && v !== '') url.searchParams.set(k, v);
    });
    return url.toString();
  }

  async function requestJson(host, path, query, auth) {
    const res = await fetch(urlFor(host, path, query), {
      method: 'GET',
      headers: auth === false ? {} : authHeaders(host)
    });
    let body = null;
    try { body = await res.json(); } catch (e) {}
    if (!res.ok || body && body.ok === false) {
      throw new Error(body && body.error || ('HTTP ' + res.status));
    }
    return body || {};
  }

  function parsePairingText(text) {
    const raw = String(text || '').trim();
    if (!raw) throw new Error('配对内容为空');

    if (/^\{/.test(raw)) {
      const obj = JSON.parse(raw);
      const rawUrl = obj.baseUrl || obj.url || obj.host || obj.pairingUrl || obj.remoteUrl;
      const host = normalizeHost({
        name: obj.name || obj.hostName,
        baseUrl: rawUrl,
        token: obj.token
      });
      if (!host.token && /[?&]token=/i.test(String(rawUrl || ''))) return parsePairingText(rawUrl);
      return host;
    }

    const urls = raw.match(/(?:https?|wss?):\/\/[^\s]+/ig) || [];
    if (urls.length) {
      const cleanUrls = urls.map(s => s.replace(/[),，。]+$/, ''));
      const sortedUrls = sortPairingUrls(cleanUrls);
      const withToken = sortPairingUrls(cleanUrls.filter(s => /[?&]token=/i.test(s)));
      const isLan = s => !/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/i.test(withHttp(s));
      const picked = withToken.find(isLan) || withToken[0] || sortedUrls.find(isLan) || sortedUrls[0];
      const u = new URL(withHttp(picked));
      const tokenLine = raw.match(/(?:^|\n)\s*token\s*[:=]\s*([^\s]+)/i);
      const token = u.searchParams.get('token') || (tokenLine && tokenLine[1]) || '';
      u.searchParams.delete('token');
      const baseUrl = u.origin + (u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/(?:pairing|session|workspaces|threads)$/i, '') : '');
      return normalizeHost({ baseUrl, token });
    }

    const parts = raw.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return normalizeHost({ baseUrl: parts[0], token: parts.slice(1).join(' ') });
    return normalizeHost({ baseUrl: raw });
  }

  class RemoteSession {
    constructor(host, handlers) {
      this.host = normalizeHost(host);
      this.handlers = handlers || {};
      this.ws = null;
      this.seq = 0;
      this.pending = {};
      this.openPromise = null;
      this.reconnectPromise = null;
      this.manualClose = false;
      this.lastSeq = 0;
      this.heartbeatTimer = null;
    }

    wsUrl() {
      const base = this.host.baseUrl.replace(/^http/i, 'ws');
      const url = new URL('/session', base + '/');
      if (this.host.token) url.searchParams.set('token', this.host.token);
      return url.toString();
    }

    status(info) {
      if (this.handlers.onStatus) this.handlers.onStatus(Object.assign({ source: 'remote' }, info || {}));
    }

    _connectOnce() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return Promise.resolve(this);
      if (this.openPromise) return this.openPromise;
      this.manualClose = false;
      this.openPromise = new Promise((resolve, reject) => {
        let ws;
        let opened = false;
        let settled = false;
        try { ws = new WebSocket(this.wsUrl()); }
        catch (e) { reject(NetStability.normalizeError(e, 'REMOTE-WS-CONNECT')); return; }
        this.ws = ws;
        const timeout = setTimeout(() => {
          this.openPromise = null;
          if (!settled) {
            settled = true;
            reject(NetStability.createError('REMOTE-WS-TIMEOUT', '连接 Host 超时'));
          }
          try { ws.close(); } catch (e) {}
        }, 10000);
        ws.onopen = () => {
          clearTimeout(timeout);
          opened = true;
          settled = true;
          this.openPromise = null;
          this._startHeartbeat();
          resolve(this);
        };
        ws.onerror = () => {
          if (opened || settled) return;
          clearTimeout(timeout);
          settled = true;
          this.openPromise = null;
          reject(NetStability.createError('REMOTE-WS-CONNECT', '无法连接 Host WebSocket'));
        };
        ws.onmessage = ev => this.onMessage(ev.data);
        ws.onclose = ev => {
          clearTimeout(timeout);
          if (this.ws === ws) this.ws = null;
          this._stopHeartbeat();
          this.openPromise = null;
          if (!opened) {
            if (!settled) {
              settled = true;
              reject(NetStability.createError('REMOTE-WS-CLOSED', 'Host 在连接建立前关闭'));
            }
            return;
          }
          if (!this.manualClose) this._beginReconnect(ev);
        };
      });
      return this.openPromise;
    }

    async connect() {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) return this;
      if (this.reconnectPromise) return this.reconnectPromise;
      let retried = false;
      await NetStability.retry(() => this._connectOnce(), {
        retries: 5,
        fallbackCode: 'REMOTE-WS-CONNECT',
        onStatus: info => {
          retried = true;
          this.status(info);
        }
      });
      if (retried) this.status({ state: 'recovered', code: 'REMOTE-RECOVERED', message: 'Host 连接已恢复' });
      return this;
    }

    onMessage(data) {
      let msg;
      try { msg = JSON.parse(data); } catch (e) { return; }
      if (msg.seq) this.lastSeq = Math.max(this.lastSeq, Number(msg.seq) || 0);
      if (msg.type === 'response' && msg.id && this.pending[msg.id]) {
        const p = this.pending[msg.id];
        delete this.pending[msg.id];
        if (msg.ok) p.resolve(msg.result);
        else p.reject(new Error(msg.error || 'Host 请求失败'));
        return;
      }
      if (this.handlers.onEvent) this.handlers.onEvent(msg);
    }

    _failPending(err) {
      Object.keys(this.pending).forEach(id => {
        this.pending[id].reject(err);
        delete this.pending[id];
      });
    }

    _stopHeartbeat() {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    _startHeartbeat() {
      this._stopHeartbeat();
      this.heartbeatTimer = setInterval(() => {
        if (this.manualClose || this.reconnectPromise || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
        this.ensureAlive().catch(() => {});
      }, 20000);
    }

    async ensureAlive() {
      try {
        await this.request('remote.ping', {}, { timeout: 10000 });
        return true;
      } catch (e) {
        if (this.manualClose) throw e;
        const ws = this.ws;
        try { if (ws) ws.close(); } catch (closeError) {}
        if (!this.reconnectPromise) this._beginReconnect({ code: 1006 });
        if (this.reconnectPromise) await this.reconnectPromise;
        return true;
      }
    }

    async _replayAndResend() {
      const replay = await this._requestConnected('remote.events.replay', { afterSeq: this.lastSeq }, {
        timeout: 20000,
        timeoutCode: 'REMOTE-WS-TIMEOUT',
        internal: true
      });
      (replay && replay.events || []).forEach(ev => this.onMessage(JSON.stringify(ev)));
      Object.keys(this.pending).forEach(id => {
        const p = this.pending[id];
        if (!p || p.internal) return;
        try { this.ws.send(JSON.stringify(p.message)); }
        catch (e) { throw NetStability.normalizeError(e, 'REMOTE-WS-CLOSED'); }
      });
    }

    _beginReconnect(closeEvent) {
      if (this.manualClose || this.reconnectPromise) return this.reconnectPromise;
      this.status({
        state: 'disconnected',
        code: 'REMOTE-WS-CLOSED',
        message: 'Host 连接已断开，正在续接',
        closeCode: closeEvent && closeEvent.code
      });
      this.reconnectPromise = NetStability.retry(async () => {
        await this._connectOnce();
        await this._replayAndResend();
        return this;
      }, {
        retries: 5,
        fallbackCode: 'REMOTE-WS-CLOSED',
        onStatus: info => this.status(info)
      }).then(() => {
        this.status({ state: 'recovered', code: 'REMOTE-RECOVERED', message: 'Host 已重连，远程任务已续接' });
        return this;
      }).catch(err => {
        const finalError = NetStability.createError('REMOTE-RECONNECT-EXHAUSTED', 'Host 五次重连均失败', {
          cause: err,
          attempt: 5,
          max: 5
        });
        this.status({ state: 'error', code: finalError.code, message: finalError.message, attempt: 5, max: 5 });
        this._failPending(finalError);
        if (this.handlers.onClose) this.handlers.onClose({ final: true, error: finalError });
        throw finalError;
      }).finally(() => {
        this.reconnectPromise = null;
      });
      this.reconnectPromise.catch(() => {});
      return this.reconnectPromise;
    }

    _requestConnected(type, payload, options) {
      options = options || {};
      const id = 'r' + (++this.seq);
      const requestKey = options.requestKey || NetStability.idempotencyKey('remote');
      const msg = Object.assign({ type, id, requestKey }, payload || {});
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          delete this.pending[id];
          reject(NetStability.createError(options.timeoutCode || 'REMOTE-REQUEST-TIMEOUT', 'Host 请求超时：' + type));
        }, options.timeout || 120000);
        this.pending[id] = {
          message: msg,
          internal: !!options.internal,
          resolve: value => {
            clearTimeout(timer);
            resolve(value);
          },
          reject: err => {
            clearTimeout(timer);
            reject(err);
          }
        };
        try { this.ws.send(JSON.stringify(msg)); }
        catch (e) {
          clearTimeout(timer);
          delete this.pending[id];
          reject(NetStability.normalizeError(e, 'REMOTE-WS-CLOSED'));
        }
      });
    }

    async request(type, payload, options) {
      await this.connect();
      return this._requestConnected(type, payload, options);
    }

    send(type, payload) {
      return this.request(type, payload);
    }

    close() {
      this.manualClose = true;
      this._stopHeartbeat();
      this._failPending(NetStability.createError('NET-ABORTED', '连接已由用户关闭'));
      try { if (this.ws) this.ws.close(); } catch (e) {}
      this.ws = null;
    }
  }

  window.RemoteAPI = {
    normalizeHost,
    normalizeWorkspace,
    parsePairingText,
    hostBaseUrl(host) {
      return normalizeHost(host).baseUrl;
    },
    async health(host) {
      return requestJson(host, '/health', null, false);
    },
    async pairing(host) {
      return requestJson(host, '/pairing');
    },
    async workspaces(host) {
      const body = await requestJson(host, '/workspaces');
      return (body.data || body.workspaces || []).map(normalizeWorkspace);
    },
    async workspaceFiles(host, workspaceId) {
      const body = await requestJson(host, '/workspace-files', { workspaceId, limit: 800 });
      return {
        data: body.data || body.files || [],
        truncated: !!body.truncated
      };
    },
    async threads(host, workspaceId) {
      const body = await requestJson(host, '/threads', { workspaceId, limit: 30 });
      return body.data || [];
    },
    createSession(host, handlers) {
      return new RemoteSession(host, handlers);
    }
  };
})();
