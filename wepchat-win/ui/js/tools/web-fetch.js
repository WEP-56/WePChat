/* WePChat Tools — web_fetch via Rust http_request */
'use strict';

(() => {
  const T = window.WepChatTools;

  function tauriInvoke(cmd, args) {
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') {
      return Promise.reject(new Error('Tauri bridge unavailable'));
    }
    return core.invoke(cmd, { args });
  }

  function normalizeMethod(method) {
    method = String(method || 'GET').trim().toUpperCase();
    if (!method) method = 'GET';
    if (!['GET', 'POST'].includes(method)) {
      throw new Error('web_fetch 仅支持 GET/POST，当前 method=' + method);
    }
    return method;
  }

  function isBlockedHost(hostname) {
    const h = String(hostname || '').toLowerCase();
    if (!h) return true;
    if (h === 'localhost' || h === '127.0.0.1' || h === '0.0.0.0' || h === '::1' || h === '[::1]') return true;
    if (h.endsWith('.local') || h.endsWith('.localhost')) return true;
    // RFC1918 / link-local / cloud metadata
    if (/^10\./.test(h) || /^192\.168\./.test(h) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(h)) return true;
    if (/^169\.254\./.test(h) || h === 'metadata.google.internal') return true;
    return false;
  }

  function assertSafeUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      throw new Error('Invalid URL: 仅支持 http/https 地址');
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') {
      throw new Error('Invalid URL: 仅支持 http/https 地址');
    }
    if (isBlockedHost(u.hostname)) {
      throw new Error('已阻止访问本机/局域网/元数据地址: ' + u.hostname);
    }
    return u;
  }

  function buildBody(args, headers) {
    if (args.json !== undefined) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      return JSON.stringify(args.json);
    }
    if (args.formData && typeof args.formData === 'object') {
      headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded';
      return Object.keys(args.formData)
        .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(String(args.formData[k])))
        .join('&');
    }
    if (args.body !== undefined) return String(args.body);
    return null;
  }

  function htmlToText(html) {
    return String(html || '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  async function webFetch(args) {
    const url = String(args.url || '').trim();
    assertSafeUrl(url);
    const method = normalizeMethod(args.method);
    const headers = Object.assign({}, args.headers || {});
    const body = buildBody(args, headers);
    if (method === 'GET' && body != null) {
      throw new Error('GET 请求不能携带 body/json/formData；如需提交数据请使用 method: "POST"');
    }
    const timeoutMs = Math.max(3000, Math.min(60000, parseInt(args.timeoutMs || T.WEB_FETCH_TIMEOUT, 10) || T.WEB_FETCH_TIMEOUT));
    const started = Date.now();
    const res = await tauriInvoke('http_request', {
      method,
      url,
      headers,
      body: method === 'GET' ? null : body,
      timeoutMs,
    });
    const elapsed = Date.now() - started;
    const status = res && res.status != null ? res.status : 0;
    const ct = (res && res.headers && (res.headers['content-type'] || res.headers['Content-Type'])) || '';
    let text = (res && res.body) || '';
    const rawText = text;
    if (/html/i.test(ct)) text = htmlToText(text);
    if (text.length > T.MAX_OUTPUT) text = text.slice(0, T.MAX_OUTPUT) + '\n…[内容已截断]';
    const meta = [
      'HTTP ' + status,
      'URL: ' + url,
      'Method: ' + method,
      'Time: ' + elapsed + 'ms',
      'Content-Type: ' + (ct || '(unknown)'),
    ].join('\n');
    if (status >= 200 && status < 400) {
      return meta + '\n\n' + (text || '[空响应体]');
    }
    const detail = String(rawText || '').slice(0, 1200);
    throw new Error(
      'HTTP error ' + status +
      '\nURL: ' + url +
      '\nMethod: ' + method +
      '\nContent-Type: ' + (ct || '(unknown)') +
      (detail ? '\nResponse body:\n' + detail : '\nResponse body: [空]')
    );
  }

  T.register({
    name: 'web_fetch',
    definition: {
      name: 'web_fetch',
      description: '抓取网页/接口文本内容。支持 GET 和 POST；HTML 会转为纯文本；成功结果包含 HTTP 状态码、耗时、Content-Type。POST 会额外请求用户确认。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '完整的 http/https 地址' },
          method: { type: 'string', enum: ['GET', 'POST'], description: '请求方法，默认 GET' },
          headers: { type: 'object', description: '可选请求头', additionalProperties: { type: 'string' } },
          body: { type: 'string', description: '可选 POST 原始请求体' },
          json: { description: '可选 POST JSON 请求体；传入后会自动设置 Content-Type: application/json' },
          formData: { type: 'object', description: '可选 POST 表单字段', additionalProperties: { type: 'string' } },
          timeoutMs: { type: 'integer', description: '可选超时时间，3000 到 60000 毫秒，默认 20000' },
        },
        required: ['url'],
      },
    },
    async execute(args, ctx) {
      // Align with Android web-fetch.js: never blocks; non-GET always confirms;
      // GET confirms unless mode is always. authorizeToolCall may already gate
      // group-level ask; generation passes 'always' after group auth succeeds
      // so GET is not double-prompted in the normal tool loop.
      if (ctx.webFetchMode === 'never') return '错误：用户已禁止网络访问';
      const method = normalizeMethod(args.method);
      const trunc = (window.U && U.truncate) ? U.truncate(args.url, 120) : String(args.url || '').slice(0, 120);
      if (method !== 'GET') {
        const ok = ctx.confirm
          ? await ctx.confirm('AI 请求发送 ' + method + ' 请求：\n' + trunc + '\n\n这可能会提交数据或触发远端操作。允许本次请求吗？')
          : false;
        if (!ok) return '错误：用户拒绝了本次 ' + method + ' 网络请求';
      } else if (ctx.webFetchMode !== 'always') {
        const ok = ctx.confirm
          ? await ctx.confirm('AI 请求访问网页：\n' + trunc + '\n\n允许本次访问吗？')
          : false;
        if (!ok) return '错误：用户拒绝了本次网络访问';
      }
      return await webFetch(Object.assign({}, args, { method }));
    },
  });
})();
