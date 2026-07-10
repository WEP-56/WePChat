/* WepChat - image generation API adapter */
'use strict';

const ImageAPI = (() => {
  function normBase(base) {
    return String(base || '').trim().replace(/\/+$/, '');
  }

  function apiRoot(base, opts) {
    base = normBase(base);
    if (base.endsWith('#')) return base.slice(0, -1);
    try {
      const u = new URL(base);
      let p = u.pathname.replace(/\/+$/, '');
      p = p.replace(/\/(?:v\d+\/)?(?:images\/generations|images\/edits|chat\/completions|responses|models|completions|messages)$/i, m => {
        return m.toLowerCase().startsWith('/v') ? m.split('/').slice(0, 2).join('/') : '';
      });
      if ((p === '' || p === '/') && (opts && opts.autoV1)) p = '/v1';
      u.pathname = p || '/';
      u.search = '';
      u.hash = '';
      return u.toString().replace(/\/+$/, '');
    } catch (e) {}
    return base;
  }

  function joinUrl(base, path, opts) {
    return apiRoot(base, opts) + path;
  }

  function endpointUrl(ctx, path, key) {
    const settings = ctx.settings || {};
    const provider = ctx.provider || {};
    key = key || 'endpointPath';
    const providerOverride = key === 'editsEndpointPath'
      ? (provider.imageEditEndpointPath || '')
      : (provider.imageEndpointPath || '');
    const override = String(settings[key] || (key === 'imagesEndpointPath' ? settings.endpointPath : '') || providerOverride).trim();
    if (override) {
      if (/^https?:\/\//i.test(override)) return override.replace(/\/+$/, '');
      if (override.endsWith('#')) return override.slice(0, -1);
      if (/^\/v\d+\//i.test(override)) {
        try {
          const u = new URL(normBase(provider.baseUrl));
          u.pathname = override;
          u.search = '';
          u.hash = '';
          return u.toString().replace(/\/+$/, '');
        } catch (e) {}
      }
      return apiRoot(provider.baseUrl, { autoV1: true }) + (override.charAt(0) === '/' ? override : '/' + override);
    }
    return joinUrl(provider.baseUrl, path, { autoV1: true });
  }

  function authHeaders(provider) {
    const h = {};
    if (provider.apiKey) h.Authorization = 'Bearer ' + provider.apiKey;
    (provider.extraHeaders || []).forEach(x => { if (x.k) h[x.k] = x.v || ''; });
    return h;
  }

  function extractError(text, status) {
    let msg = 'HTTP ' + status;
    try {
      const j = JSON.parse(text);
      const detail = j.detail && typeof j.detail === 'object' ? j.detail : null;
      const code = (j.error && j.error.code) || (detail && detail.code) || j.code || '';
      msg = (j.error && (j.error.message || j.error.type)) ||
        (detail && (detail.message || detail.error || detail.code)) ||
        j.message || (typeof j.detail === 'string' ? j.detail : '') || msg;
      if (code === 'deactivated_workspace') {
        msg = '上游返回 deactivated_workspace：图片生成工作区/账号未启用或已停用。请检查反代上游账号、工作区状态或图片 API 权限。';
      }
    } catch (e) {
      if (text) msg += ' ' + U.truncate(text.replace(/<[^>]+>/g, ' ').trim(), 200);
    }
    return msg;
  }

  function responseMeta(xhr) {
    return {
      status: xhr.status,
      location: xhr.getResponseHeader('Location') || xhr.getResponseHeader('Content-Location') || '',
      requestId: xhr.getResponseHeader('x-request-id') || xhr.getResponseHeader('request-id') || ''
    };
  }

  function attachMeta(value, meta) {
    if (value && typeof value === 'object') {
      try { Object.defineProperty(value, '_wepchatMeta', { value: meta, enumerable: false }); } catch (e) { value._wepchatMeta = meta; }
    }
    return value;
  }

  function jsonRequest(method, url, headers, body, signal, options) {
    options = options || {};
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      Object.keys(headers || {}).forEach(k => { try { xhr.setRequestHeader(k, headers[k]); } catch (e) {} });
      xhr.timeout = options.timeout || 600000;
      if (options.requestKey) xhr.setRequestHeader('Idempotency-Key', options.requestKey);
      xhr.onprogress = ev => {
        if (options.onStatus && ev.loaded) options.onStatus({
          state: 'progress', source: '图片生成', code: 'IMAGE-WAITING', message: '正在接收图片任务结果',
          progress: ev.lengthComputable ? Math.round(ev.loaded / ev.total * 100) + '%' : U.fmtSize(ev.loaded)
        });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const meta = responseMeta(xhr);
          try { resolve(attachMeta(JSON.parse(xhr.responseText), meta)); } catch (e) { resolve(xhr.responseText); }
        } else {
          const err = new Error(extractError(xhr.responseText, xhr.status));
          err.code = xhr.status === 408 ? 'HTTP-408' : xhr.status === 429 ? 'HTTP-429' : xhr.status >= 500 ? 'HTTP-5XX' : 'HTTP-' + xhr.status;
          err.status = xhr.status;
          err.body = xhr.responseText;
          err.url = url;
          reject(err);
        }
      };
      xhr.onerror = () => {
        const err = options.safeRetry
          ? NetStability.createError('NET-CONNECT', '查询图片任务状态时连接失败')
          : NetStability.createError('IMAGE-SUBMIT-UNKNOWN', '图片任务可能已提交，但连接在返回结果前断开。为避免重复扣费，WepChat 不会自动重新创建任务。');
        err.url = url;
        reject(err);
      };
      xhr.ontimeout = () => {
        const err = options.safeRetry
          ? NetStability.createError('NET-TIMEOUT', '查询图片任务状态超时')
          : NetStability.createError('IMAGE-SUBMIT-UNKNOWN', '等待图片任务结果超过 10 分钟。任务可能已在提供商完成，为避免重复扣费，WepChat 不会自动重新创建任务。');
        err.url = url;
        reject(err);
      };
      xhr.onabort = () => resolve({ aborted: true });
      if (signal) {
        if (signal.aborted) { resolve({ aborted: true }); return; }
        signal.addEventListener('abort', () => { try { xhr.abort(); } catch (e) {} });
      }
      xhr.send(method === 'GET' ? null : JSON.stringify(body || {}));
    });
  }

  function formRequest(method, url, headers, form, signal, options) {
    options = options || {};
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      Object.keys(headers || {}).forEach(k => { try { xhr.setRequestHeader(k, headers[k]); } catch (e) {} });
      xhr.timeout = options.timeout || 600000;
      if (options.requestKey) xhr.setRequestHeader('Idempotency-Key', options.requestKey);
      xhr.onprogress = ev => {
        if (options.onStatus && ev.loaded) options.onStatus({
          state: 'progress', source: '图片生成', code: 'IMAGE-WAITING', message: '正在接收图片编辑结果',
          progress: ev.lengthComputable ? Math.round(ev.loaded / ev.total * 100) + '%' : U.fmtSize(ev.loaded)
        });
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const meta = responseMeta(xhr);
          try { resolve(attachMeta(JSON.parse(xhr.responseText), meta)); } catch (e) { resolve(xhr.responseText); }
        } else {
          const err = new Error(extractError(xhr.responseText, xhr.status));
          err.code = xhr.status === 408 ? 'HTTP-408' : xhr.status === 429 ? 'HTTP-429' : xhr.status >= 500 ? 'HTTP-5XX' : 'HTTP-' + xhr.status;
          err.status = xhr.status;
          err.body = xhr.responseText;
          err.url = url;
          reject(err);
        }
      };
      xhr.onerror = () => {
        const err = NetStability.createError('IMAGE-SUBMIT-UNKNOWN', '图片编辑任务可能已提交，但连接在返回结果前断开。为避免重复扣费，WepChat 不会自动重新创建任务。');
        err.url = url;
        reject(err);
      };
      xhr.ontimeout = () => {
        const err = NetStability.createError('IMAGE-SUBMIT-UNKNOWN', '等待图片编辑结果超过 10 分钟。任务可能已完成，为避免重复扣费，WepChat 不会自动重新创建任务。');
        err.url = url;
        reject(err);
      };
      xhr.onabort = () => resolve({ aborted: true });
      if (signal) {
        if (signal.aborted) { resolve({ aborted: true }); return; }
        signal.addEventListener('abort', () => { try { xhr.abort(); } catch (e) {} });
      }
      xhr.send(form);
    });
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(NetStability.createError('IMAGE-DOWNLOAD-DECODE', '图片下载完成，但读取结果失败'));
      reader.readAsDataURL(blob);
    });
  }

  function detectedImageMime(blob, bytes) {
    const declared = String(blob && blob.type || '').toLowerCase();
    if (/^image\/(png|jpeg|jpg|webp|gif)/.test(declared)) return declared.replace('image/jpg', 'image/jpeg');
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'image/png';
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
    if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && bytes[8] === 0x57) return 'image/webp';
    if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) return 'image/gif';
    return '';
  }

  function imageBlobRequest(url, ctx) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', url, true);
      xhr.responseType = 'blob';
      xhr.timeout = 180000;
      try {
        const imageOrigin = new URL(url).origin;
        const providerOrigin = new URL(ctx.provider && ctx.provider.baseUrl || '').origin;
        if (imageOrigin === providerOrigin) {
          Object.keys(authHeaders(ctx.provider)).forEach(k => xhr.setRequestHeader(k, authHeaders(ctx.provider)[k]));
        }
      } catch (e) {}
      xhr.onprogress = ev => {
        if (ev.loaded > 64 * 1024 * 1024) {
          try { xhr.abort(); } catch (e) {}
          reject(NetStability.createError('IMAGE-TOO-LARGE', '单张图片超过 64 MB 安全上限'));
          return;
        }
        if (ctx.onStatus) ctx.onStatus({
          state: 'progress', source: '图片下载', code: 'IMAGE-DOWNLOAD', message: '图片已生成，正在下载结果',
          progress: ev.lengthComputable ? Math.round(ev.loaded / ev.total * 100) + '%' : U.fmtSize(ev.loaded)
        });
      };
      xhr.onload = async () => {
        if (xhr.status < 200 || xhr.status >= 300) {
          return reject(NetStability.createError(xhr.status >= 500 ? 'HTTP-5XX' : 'HTTP-' + xhr.status, '图片下载失败：HTTP ' + xhr.status, { status: xhr.status, url }));
        }
        const blob = xhr.response;
        if (!blob || blob.size > 64 * 1024 * 1024) return reject(NetStability.createError('IMAGE-TOO-LARGE', '单张图片超过 64 MB 安全上限'));
        const head = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
        const mime = detectedImageMime(blob, head);
        if (!mime) return reject(NetStability.createError('IMAGE-DOWNLOAD-NOT-IMAGE', '结果地址没有返回有效图片'));
        resolve(blob.type === mime ? blob : new Blob([blob], { type: mime }));
      };
      xhr.onerror = () => reject(NetStability.createError('IMAGE-DOWNLOAD-CONNECT', '图片结果下载连接失败', { url }));
      xhr.ontimeout = () => reject(NetStability.createError('IMAGE-DOWNLOAD-TIMEOUT', '图片结果下载超过 3 分钟', { url }));
      xhr.onabort = () => {
        if (ctx.signal && ctx.signal.aborted) reject(NetStability.createError('NET-ABORTED', '用户已停止图片下载'));
      };
      if (ctx.signal) {
        if (ctx.signal.aborted) return reject(NetStability.createError('NET-ABORTED', '用户已停止图片下载'));
        ctx.signal.addEventListener('abort', () => { try { xhr.abort(); } catch (e) {} }, { once: true });
      }
      xhr.send();
    });
  }

  async function urlToDataUrl(url, ctx) {
    let retried = false;
    try {
      const blob = await NetStability.retry(() => imageBlobRequest(url, ctx), {
        retries: 5,
        signal: ctx.signal,
        fallbackCode: 'IMAGE-DOWNLOAD-CONNECT',
        shouldRetry: err => /^IMAGE-DOWNLOAD-|^HTTP-5XX$/.test(err.code) && err.code !== 'IMAGE-DOWNLOAD-NOT-IMAGE',
        onStatus: info => {
          retried = true;
          if (ctx.onStatus) ctx.onStatus(Object.assign({ source: '图片下载' }, info));
        }
      });
      if (retried && ctx.onStatus) ctx.onStatus({ state: 'recovered', source: '图片下载', code: 'IMAGE-DOWNLOAD-RECOVERED', message: '图片下载连接已恢复' });
      return await blobToDataUrl(blob);
    } catch (e) {
      e.resultUrl = url;
      throw e;
    }
  }

  function mimeForFormat(format) {
    format = String(format || 'png').toLowerCase();
    if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
    if (format === 'webp') return 'image/webp';
    return 'image/png';
  }

  function dataUrlFromB64(b64, format) {
    if (/^data:/i.test(String(b64 || ''))) return b64;
    return 'data:' + mimeForFormat(format) + ';base64,' + b64;
  }

  function dataUrlToBlob(dataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/i.exec(String(dataUrl || ''));
    if (!m) throw new Error('参考图片不是有效 data URL');
    const bin = atob(m[2]);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: m[1] || 'image/png' });
  }

  function extForMime(mime) {
    if (/jpe?g/i.test(mime || '')) return 'jpg';
    if (/webp/i.test(mime || '')) return 'webp';
    return 'png';
  }

  function isLikelyImageB64(s) {
    s = String(s || '').replace(/\s+/g, '');
    if (s.length < 120) return false;
    if (/^iVBORw0KGgo/i.test(s)) return true;      // png
    if (/^\/9j\//.test(s)) return true;           // jpeg
    if (/^UklGR/i.test(s)) return true;           // webp riff
    return /^[A-Za-z0-9+/=_-]{400,}$/.test(s);
  }

  function pushCandidate(candidates, val, format, raw) {
    if (!val) return;
    if (typeof val === 'string') {
      const s = val.trim();
      if (!s) return;
      if (/^data:image\//i.test(s)) candidates.push({ dataUrl: s, raw });
      else if (/^https?:\/\//i.test(s)) candidates.push({ url: s, raw });
      else if (isLikelyImageB64(s)) candidates.push({ dataUrl: dataUrlFromB64(s.replace(/\s+/g, ''), format), raw });
    } else if (val && typeof val === 'object') {
      collectImageCandidates(val, candidates, format, 0);
    }
  }

  function collectImageCandidates(obj, out, format, depth) {
    if (!obj || depth > 8) return;
    if (typeof obj === 'string') {
      const re = /https?:\/\/[^\s"'<>]+\.(?:png|jpe?g|webp)(?:\?[^\s"'<>]*)?/ig;
      let m;
      while ((m = re.exec(obj))) pushCandidate(out, m[0], format, obj);
      const md = /!\[[^\]]*\]\((https?:\/\/[^)]+)\)/ig;
      while ((m = md.exec(obj))) pushCandidate(out, m[1], format, obj);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach(x => collectImageCandidates(x, out, format, depth + 1));
      return;
    }
    if (typeof obj !== 'object') return;
    pushCandidate(out,
      obj.b64_json || obj.base64 || obj.image_base64 || obj.imageBase64 ||
      obj.base64_image || obj.base64Image || obj.image_data || obj.imageData ||
      obj.result || obj.image || obj.data,
      obj.output_format || obj.outputFormat || obj.mime_type || obj.mimeType || format,
      obj
    );
    pushCandidate(out, obj.data_url || obj.dataUrl, obj.output_format || format, obj);
    pushCandidate(out, obj.url || obj.uri || obj.src || obj.href || obj.file_url || obj.fileUrl ||
      obj.download_url || obj.downloadUrl || obj.output_url || obj.outputUrl || obj.result_url || obj.resultUrl, format, obj);
    if (obj.image_url) pushCandidate(out, typeof obj.image_url === 'string' ? obj.image_url : obj.image_url.url, format, obj);
    if (obj.imageUrl) pushCandidate(out, typeof obj.imageUrl === 'string' ? obj.imageUrl : obj.imageUrl.url, format, obj);
    if (obj.file && typeof obj.file === 'object') collectImageCandidates(obj.file, out, format, depth + 1);
    if (obj.artifact) collectImageCandidates(obj.artifact, out, format, depth + 1);
    if (obj.artifacts) collectImageCandidates(obj.artifacts, out, format, depth + 1);
    if (obj.images) collectImageCandidates(obj.images, out, format, depth + 1);
    if (obj.text) collectImageCandidates(obj.text, out, format, depth + 1);
    if (obj.content) collectImageCandidates(obj.content, out, format, depth + 1);
    if (obj.output) collectImageCandidates(obj.output, out, format, depth + 1);
    if (obj.data) collectImageCandidates(obj.data, out, format, depth + 1);
    if (obj.choices) collectImageCandidates(obj.choices, out, format, depth + 1);
    if (obj.message) collectImageCandidates(obj.message, out, format, depth + 1);
  }

  function rawPreview(raw) {
    try {
      const text = JSON.stringify(raw, (k, v) => {
        if (typeof v === 'string' && v.length > 180) {
          if (/^data:image\//i.test(v)) return v.slice(0, 80) + '…[data-url ' + v.length + ' chars]';
          if (isLikelyImageB64(v)) return v.slice(0, 60) + '…[base64 ' + v.length + ' chars]';
          return v.slice(0, 180) + '…[' + v.length + ' chars]';
        }
        return v;
      }, 2);
      return U.truncate(text, 900);
    } catch (e) {
      return U.truncate(String(raw || ''), 900);
    }
  }

  async function materialize(candidates, format, ctx) {
    const seen = new Set();
    const seenSources = new Set();
    const images = [];
    for (const c of candidates || []) {
      const sourceKey = c.dataUrl || c.url || '';
      if (sourceKey && seenSources.has(sourceKey)) continue;
      if (sourceKey) seenSources.add(sourceKey);
      let dataUrl = c.dataUrl || '';
      if (!dataUrl && c.url) dataUrl = await urlToDataUrl(c.url, ctx);
      if (!dataUrl || seen.has(dataUrl)) continue;
      const approxBytes = Math.ceil(Math.max(0, dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
      if (approxBytes > 64 * 1024 * 1024) throw NetStability.createError('IMAGE-TOO-LARGE', '单张图片超过 64 MB 安全上限');
      seen.add(dataUrl);
      images.push({
        dataUrl,
        mime: (dataUrl.match(/^data:([^;]+)/) || [])[1] || mimeForFormat(format),
        revisedPrompt: c.raw && (c.raw.revised_prompt || c.raw.revisedPrompt) || '',
        raw: c.raw
      });
    }
    return images;
  }

  function taskStatus(res) {
    const node = res && typeof res === 'object' ? (res.data && !Array.isArray(res.data) && typeof res.data === 'object' ? res.data : res) : {};
    return String(node.status || node.state || node.phase || '').toLowerCase();
  }

  function taskPollUrl(res, baseUrl) {
    if (!res || typeof res !== 'object') return '';
    const node = res.data && !Array.isArray(res.data) && typeof res.data === 'object' ? res.data : res;
    let value = node.status_url || node.statusUrl || node.poll_url || node.pollUrl ||
      (node.urls && (node.urls.status || node.urls.poll)) ||
      (res._wepchatMeta && res._wepchatMeta.location) || '';
    if (!value) return '';
    try { return new URL(String(value), baseUrl).toString(); }
    catch (e) { return ''; }
  }

  async function resolveImageResponse(ctx, initial, format, requestUrl) {
    let current = initial;
    let pollUrl = taskPollUrl(current, requestUrl || ctx.provider.baseUrl);
    const deadline = Date.now() + 10 * 60 * 1000;
    while (true) {
      const candidates = [];
      collectImageCandidates(current, candidates, format, 0);
      const images = await materialize(candidates.filter(c => !c.url || c.url !== pollUrl), format, ctx);
      if (images.length) return { images, raw: current, url: requestUrl };

      const status = taskStatus(current);
      if (/fail|error|cancel|reject/.test(status)) {
        throw NetStability.createError('IMAGE-TASK-FAILED', '提供商图片任务失败：' + (status || 'unknown'));
      }
      if (!pollUrl) return { images: [], raw: current, url: requestUrl, preview: rawPreview(current) };
      if (/complete|completed|success|succeeded|done/.test(status)) {
        throw NetStability.createError('IMAGE-RESULT-MISSING', '图片任务已完成，但状态接口没有返回可下载图片');
      }
      if (Date.now() >= deadline) {
        const err = NetStability.createError('IMAGE-SUBMIT-UNKNOWN', '轮询图片任务超过 10 分钟，任务可能仍在提供商处理中');
        err.pollUrl = pollUrl;
        throw err;
      }
      if (ctx.onStatus) ctx.onStatus({
        state: 'progress', source: '图片生成', code: 'IMAGE-TASK-POLLING',
        message: '图片任务已提交，正在等待提供商完成', progress: status || '处理中'
      });
      await NetStability.wait(2200, ctx.signal);
      try {
        current = await NetStability.retry(() => jsonRequest('GET', pollUrl, authHeaders(ctx.provider), null, ctx.signal, {
          timeout: 30000,
          safeRetry: true
        }), {
          retries: 5,
          signal: ctx.signal,
          onStatus: info => ctx.onStatus && ctx.onStatus(Object.assign({ source: '图片任务状态' }, info))
        });
      } catch (e) {
        e.pollUrl = pollUrl;
        throw e;
      }
      pollUrl = taskPollUrl(current, pollUrl) || pollUrl;
    }
  }

  async function recover(ctx) {
    const format = ctx.format || ctx.settings && ctx.settings.outputFormat || 'png';
    if (ctx.resultUrl) {
      const dataUrl = await urlToDataUrl(ctx.resultUrl, ctx);
      return { images: [{ dataUrl, mime: (dataUrl.match(/^data:([^;]+)/) || [])[1] || mimeForFormat(format) }] };
    }
    if (ctx.pollUrl) {
      const initial = await NetStability.retry(() => jsonRequest('GET', ctx.pollUrl, authHeaders(ctx.provider), null, ctx.signal, {
        timeout: 30000,
        safeRetry: true
      }), {
        retries: 5,
        signal: ctx.signal,
        onStatus: info => ctx.onStatus && ctx.onStatus(Object.assign({ source: '图片任务状态' }, info))
      });
      return resolveImageResponse(ctx, initial, format, ctx.pollUrl);
    }
    throw NetStability.createError('IMAGE-RECOVERY-UNAVAILABLE', '没有可用于续接的图片结果地址');
  }

  function requestBase(ctx) {
    const provider = ctx.provider;
    const model = ctx.model;
    const settings = ctx.settings || {};
    if (!provider) throw new Error('未配置图片提供商');
    if (!model) throw new Error('未配置图片生成模型');
    const prompt = String(ctx.prompt || '').trim();
    if (!prompt) throw new Error('缺少图片提示词');
    return { provider, model, settings, prompt, format: settings.outputFormat || 'png' };
  }

  function setIfConcrete(target, key, value) {
    value = String(value || '').trim();
    if (value && value !== 'auto') target[key] = value;
  }

  function appendIfConcrete(form, key, value) {
    value = String(value || '').trim();
    if (value && value !== 'auto') form.append(key, value);
  }

  function removeAdvancedOptions(body) {
    const out = Object.assign({}, body);
    delete out.quality;
    delete out.background;
    return out;
  }

  async function generateViaImages(ctx) {
    const { provider, model, settings, prompt, format } = requestBase(ctx);
    const baseBody = {
      model,
      prompt,
      n: Math.max(1, Math.min(8, parseInt(ctx.count || settings.count || 1, 10) || 1))
    };
    setIfConcrete(baseBody, 'size', ctx.size || settings.size);
    setIfConcrete(baseBody, 'quality', ctx.quality || settings.quality);
    setIfConcrete(baseBody, 'background', ctx.background || settings.background);
    const relaxedBody = (baseBody.quality || baseBody.background) ? removeAdvancedOptions(baseBody) : null;
    const variants = [];
    if (/^gpt-image/i.test(model)) {
      variants.push(Object.assign({}, baseBody, format ? { output_format: format } : {}));
      variants.push(Object.assign({}, baseBody));
      variants.push(Object.assign({}, baseBody, { response_format: 'b64_json' }));
      if (relaxedBody) {
        variants.push(Object.assign({}, relaxedBody, format ? { output_format: format } : {}));
        variants.push(Object.assign({}, relaxedBody));
        variants.push(Object.assign({}, relaxedBody, { response_format: 'b64_json' }));
      }
    } else {
      variants.push(Object.assign({}, baseBody, { response_format: 'b64_json' }));
      variants.push(Object.assign({}, baseBody));
      if (format) variants.push(Object.assign({}, baseBody, { output_format: format }));
      if (relaxedBody) {
        variants.push(Object.assign({}, relaxedBody, { response_format: 'b64_json' }));
        variants.push(Object.assign({}, relaxedBody));
        if (format) variants.push(Object.assign({}, relaxedBody, { output_format: format }));
      }
    }

    const url = endpointUrl(ctx, '/images/generations', 'imagesEndpointPath');
    const errors = [];
    for (let i = 0; i < variants.length; i++) {
      try {
        const res = await jsonRequest('POST', url, authHeaders(provider), variants[i], ctx.signal, {
          timeout: 600000,
          requestKey: (ctx.requestKey || NetStability.idempotencyKey('image')) + '-payload-' + i,
          onStatus: ctx.onStatus
        });
        if (res && res.aborted) return { images: [] };
        return await resolveImageResponse(ctx, res, format, url);
      } catch (e) {
        errors.push('payload' + (i + 1) + ': ' + (e && e.message || String(e)));
        if (ctx.signal && ctx.signal.aborted) throw e;
        if (e && e.code && e.code !== 'HTTP-400' && e.code !== 'HTTP-422') throw e;
        if (e && e.status && ![400, 422].includes(e.status)) throw e;
      }
    }
    const err = new Error(errors.join('\n'));
    err.url = url;
    throw err;
  }

  async function editViaImages(ctx) {
    const { provider, model, settings, prompt, format } = requestBase(ctx);
    const refs = (ctx.referenceImages || []).filter(x => x && x.dataUrl);
    if (!refs.length) throw new Error('图片编辑缺少参考图');
    const form = new FormData();
    form.append('model', model);
    form.append('prompt', prompt);
    form.append('n', String(Math.max(1, Math.min(8, parseInt(ctx.count || settings.count || 1, 10) || 1))));
    appendIfConcrete(form, 'size', ctx.size || settings.size);
    if (/^gpt-image/i.test(model)) {
      appendIfConcrete(form, 'quality', ctx.quality || settings.quality);
      appendIfConcrete(form, 'background', ctx.background || settings.background);
    }
    if (format && /^gpt-image/i.test(model)) form.append('output_format', format);
    else form.append('response_format', 'b64_json');
    refs.forEach((ref, idx) => {
      const blob = dataUrlToBlob(ref.dataUrl);
      const name = ref.name || ('reference_' + (idx + 1) + '.' + extForMime(blob.type));
      form.append('image', blob, name);
    });
    const url = endpointUrl(ctx, '/images/edits', 'editsEndpointPath');
    const res = await formRequest('POST', url, authHeaders(provider), form, ctx.signal, {
      timeout: 600000,
      requestKey: ctx.requestKey,
      onStatus: ctx.onStatus
    });
    if (res && res.aborted) return { images: [] };
    return await resolveImageResponse(ctx, res, format, url);
  }

  async function generateViaChat(ctx) {
    const { provider, model, settings, prompt, format } = requestBase(ctx);
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false
    };
    const res = await jsonRequest('POST', endpointUrl(ctx, '/chat/completions', 'chatEndpointPath'), authHeaders(provider), body, ctx.signal, {
      timeout: 600000,
      requestKey: ctx.requestKey,
      onStatus: ctx.onStatus
    });
    if (res && res.aborted) return { images: [] };
    return await resolveImageResponse(ctx, res, format, endpointUrl(ctx, '/chat/completions', 'chatEndpointPath'));
  }

  async function generateViaResponses(ctx) {
    const { provider, model, settings, prompt, format } = requestBase(ctx);
    const body = {
      model,
      input: prompt,
      tools: [{ type: 'image_generation' }]
    };
    const res = await jsonRequest('POST', endpointUrl(ctx, '/responses', 'responsesEndpointPath'), authHeaders(provider), body, ctx.signal, {
      timeout: 600000,
      requestKey: ctx.requestKey,
      onStatus: ctx.onStatus
    });
    if (res && res.aborted) return { images: [] };
    return await resolveImageResponse(ctx, res, format, endpointUrl(ctx, '/responses', 'responsesEndpointPath'));
  }

  async function generate(ctx) {
    const settings = ctx.settings || {};
    const mode = settings.apiMode || 'auto';
    if (ctx.mode === 'edit') {
      return await editViaImages(ctx);
    }
    const imageOnly = settings.imageOnly || /^gpt-image/i.test(ctx.model || '') || /(?:dall-e|imagen|qwen-image|flux|stable-diffusion|sdxl|seedream|jimeng|doubao.*image)/i.test(ctx.model || '');
    const order = mode === 'chat' ? ['chat'] :
      mode === 'responses' ? ['responses'] :
      mode === 'images' ? ['images'] :
      imageOnly ? ['images'] : ['images', 'chat', 'responses'];
    const errors = [];
    for (const step of order) {
      try {
        const res = step === 'chat' ? await generateViaChat(ctx) : step === 'responses' ? await generateViaResponses(ctx) : await generateViaImages(ctx);
        if (res.images && res.images.length) return res;
        errors.push(step + (res.url ? ' @ ' + res.url : '') + ': 接口未返回图片' + (res.preview ? '\n返回摘要：' + res.preview : ''));
      } catch (e) {
        const line = step + (e && e.url ? ' @ ' + e.url : '') + ': ' + (e && e.message || String(e));
        errors.push(line);
        if (e && /^(IMAGE-SUBMIT-UNKNOWN|IMAGE-TOO-LARGE|IMAGE-DOWNLOAD-|IMAGE-TASK-|NET-ABORTED)/.test(e.code || '')) throw e;
        if (mode !== 'auto') {
          const err = new Error('图片生成失败：' + line);
          err.code = e && e.code || 'IMAGE-GENERATION-FAILED';
          err.url = e && e.url;
          throw err;
        }
      }
    }
    const err = new Error('图片生成失败。已尝试 ' + order.join(' / ') + '：\n' + errors.join('\n'));
    err.code = 'IMAGE-GENERATION-FAILED';
    throw err;
  }

  return { generate, recover, generateViaImages, editViaImages, generateViaChat, generateViaResponses };
})();

window.ImageAPI = ImageAPI;
