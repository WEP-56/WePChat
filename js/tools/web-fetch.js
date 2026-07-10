/* WepChat Tool - web_fetch */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { MAX_OUTPUT, WEB_FETCH_TIMEOUT } = T;

  function normalizeMethod(method) {
    method = String(method || 'GET').trim().toUpperCase();
    if (!method) method = 'GET';
    if (!['GET', 'POST'].includes(method)) throw new Error('web_fetch 仅支持 GET/POST，当前 method=' + method);
    return method;
  }
  
  function buildRequestBody(args, headers) {
    if (args.json !== undefined) {
      headers['Content-Type'] = headers['Content-Type'] || 'application/json';
      return JSON.stringify(args.json);
    }
    if (args.formData && typeof args.formData === 'object') {
      const fd = new FormData();
      Object.keys(args.formData).forEach(k => fd.append(k, args.formData[k]));
      return fd;
    }
    if (args.body !== undefined) return String(args.body);
    return null;
  }
  
  function headerString(xhr) {
    try { return xhr.getAllResponseHeaders() || ''; }
    catch (e) { return ''; }
  }
  
  function webFetch(args) {
    return new Promise((resolve, reject) => {
      const url = String(args.url || '').trim();
      if (!/^https?:\/\//i.test(url)) return reject(new Error('Invalid URL: 仅支持 http/https 地址'));
      let method;
      try { method = normalizeMethod(args.method); }
      catch (e) { return reject(e); }
      const headers = Object.assign({}, args.headers || {});
      const body = buildRequestBody(args, headers);
      if (method === 'GET' && body != null) return reject(new Error('GET 请求不能携带 body/json/formData；如需提交数据请使用 method: "POST"'));
      const xhr = new XMLHttpRequest();
      const started = Date.now();
      xhr.open(method, url, true);
      xhr.timeout = U.clamp(parseInt(args.timeoutMs || WEB_FETCH_TIMEOUT, 10) || WEB_FETCH_TIMEOUT, 3000, 60000);
      Object.keys(headers).forEach(k => {
        try { xhr.setRequestHeader(k, headers[k]); } catch (e) {}
      });
      xhr.onload = () => {
        const elapsed = Date.now() - started;
        const ct = xhr.getResponseHeader('Content-Type') || '';
        let text = xhr.responseText || '';
        const rawText = text;
        if (/html/i.test(ct)) text = htmlToText(text);
        if (text.length > MAX_OUTPUT) text = text.slice(0, MAX_OUTPUT) + '\n…[内容已截断]';
        const meta = [
          'HTTP ' + xhr.status + (xhr.statusText ? ' ' + xhr.statusText : ''),
          'URL: ' + url,
          'Method: ' + method,
          'Time: ' + elapsed + 'ms',
          'Content-Type: ' + (ct || '(unknown)')
        ].join('\n');
        if (xhr.status >= 200 && xhr.status < 400) {
          resolve(meta + '\n\n' + (text || '[空响应体]'));
        } else {
          const detail = (rawText || '').slice(0, 1200);
          reject(new Error('HTTP error ' + xhr.status + (xhr.statusText ? ' ' + xhr.statusText : '') +
            '\nURL: ' + url + '\nMethod: ' + method + '\nContent-Type: ' + (ct || '(unknown)') +
            (detail ? '\nResponse body:\n' + detail : '\nResponse body: [空]')));
        }
      };
      xhr.onerror = () => reject(new Error('Blocked by CORS or network error\nURL: ' + url + '\nMethod: ' + method + '\n说明：浏览器安全模型不会暴露 DNS/TLS/CORS 的精确原因。'));
      xhr.ontimeout = () => reject(new Error('Connection timeout after ' + xhr.timeout + 'ms\nURL: ' + url + '\nMethod: ' + method));
      xhr.onabort = () => reject(new Error('Request aborted\nURL: ' + url + '\nMethod: ' + method));
      xhr.send(method === 'GET' ? null : body);
    });
  }
  
  function htmlToText(html) {
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h[1-6]|li|tr)>/gi, '\n')
      .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n').trim();
  }
  
  /* ---------- 工具声明（发送给模型的 schema） ---------- */

  T.register({
    name: 'web_fetch',
    definition: {
  "name": "web_fetch",
  "description": "抓取网页/接口文本内容。支持 GET 和 POST；HTML 会转为纯文本；成功结果包含 HTTP 状态码、耗时、Content-Type。POST 会额外请求用户确认。",
  "parameters": {
    "type": "object",
    "properties": {
      "url": {
        "type": "string",
        "description": "完整的 http/https 地址"
      },
      "method": {
        "type": "string",
        "enum": [
          "GET",
          "POST"
        ],
        "description": "请求方法，默认 GET"
      },
      "headers": {
        "type": "object",
        "description": "可选请求头",
        "additionalProperties": {
          "type": "string"
        }
      },
      "body": {
        "type": "string",
        "description": "可选 POST 原始请求体"
      },
      "json": {
        "description": "可选 POST JSON 请求体；传入后会自动设置 Content-Type: application/json"
      },
      "formData": {
        "type": "object",
        "description": "可选 POST 表单字段",
        "additionalProperties": {
          "type": "string"
        }
      },
      "timeoutMs": {
        "type": "integer",
        "description": "可选超时时间，3000 到 60000 毫秒，默认 20000"
      }
    },
    "required": [
      "url"
    ]
  }
},
    async execute(args, ctx) {
      if (ctx.webFetchMode === 'never') return '错误：用户已禁止网络访问';
      const method = normalizeMethod(args.method);
      if (method !== 'GET') {
        const ok = await ctx.confirm('AI 请求发送 ' + method + ' 请求：\n' + U.truncate(args.url, 120) + '\n\n这可能会提交数据或触发远端操作。允许本次请求吗？');
        if (!ok) return '错误：用户拒绝了本次 ' + method + ' 网络请求';
      } else if (ctx.webFetchMode !== 'always') {
        const ok = await ctx.confirm('AI 请求访问网页：\n' + U.truncate(args.url, 120) + '\n\n允许本次访问吗？');
        if (!ok) return '错误：用户拒绝了本次网络访问';
      }
      return await webFetch(Object.assign({}, args, { method }));
    }
  });
})();
