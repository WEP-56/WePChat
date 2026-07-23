/* WePChat Windows — image generation API (ported from Android image-api.js)
 * All outbound HTTP goes through Tauri http_request (no WebView CORS).
 * Supports JSON /images/generations and multipart /images/edits.
 */
'use strict';

(() => {
  function tauriInvoke(cmd, args) {
    const core = window.__TAURI__ && window.__TAURI__.core;
    if (!core || typeof core.invoke !== 'function') {
      return Promise.reject(new Error('Tauri bridge unavailable'));
    }
    return core.invoke(cmd, args);
  }

  function normBase(base) {
    return String(base || '').trim().replace(/\/+$/, '');
  }

  function apiRoot(base, opts) {
    base = normBase(base);
    if (base.endsWith('#')) return base.slice(0, -1);
    try {
      const u = new URL(base);
      let p = u.pathname.replace(/\/+$/, '');
      p = p.replace(/\/(?:v\d+\/)?(?:images\/generations|images\/edits|chat\/completions|responses|models|completions|messages)$/i, (m) => {
        return m.toLowerCase().startsWith('/v') ? m.split('/').slice(0, 2).join('/') : '';
      });
      if ((p === '' || p === '/') && opts && opts.autoV1) p = '/v1';
      u.pathname = p || '/';
      u.search = '';
      u.hash = '';
      return u.toString().replace(/\/+$/, '');
    } catch {
      return base;
    }
  }

  function joinUrl(base, path, opts) {
    return apiRoot(base, opts) + path;
  }

  function endpointUrl(ctx, path, key) {
    const settings = ctx.settings || {};
    const provider = ctx.provider || {};
    key = key || 'imageEndpointPath';
    const isEdit = key === 'imageEditEndpointPath' || key === 'editsEndpointPath';
    const providerOverride = isEdit
      ? (provider.imageEditEndpointPath || '')
      : (provider.imageEndpointPath || '');
    const override = String(
      settings[key] ||
      (isEdit
        ? settings.editsEndpointPath || settings.imageEditEndpointPath
        : settings.endpointPath || settings.imagesEndpointPath || settings.imageEndpointPath) ||
      providerOverride
    ).trim();
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
        } catch { /* fall through */ }
      }
      return apiRoot(provider.baseUrl, { autoV1: true }) + (override.charAt(0) === '/' ? override : '/' + override);
    }
    return joinUrl(provider.baseUrl, path, { autoV1: true });
  }

  function authHeaders(provider) {
    const h = {};
    if (provider.apiKey) h.Authorization = 'Bearer ' + provider.apiKey;
    (provider.extraHeaders || []).forEach((x) => {
      if (x && x.k) h[x.k] = x.v || '';
    });
    return h;
  }

  function extractError(text, status) {
    let msg = 'HTTP ' + status;
    try {
      const j = JSON.parse(text);
      const detail = j.detail && typeof j.detail === 'object' ? j.detail : null;
      msg = (j.error && (j.error.message || j.error.type)) ||
        (detail && (detail.message || detail.error || detail.code)) ||
        j.message || (typeof j.detail === 'string' ? j.detail : '') || msg;
    } catch {
      if (text) {
        const t = String(text).replace(/<[^>]+>/g, ' ').trim();
        if (t) msg += ' ' + t.slice(0, 200);
      }
    }
    return msg;
  }

  function netError(code, message, meta) {
    const err = new Error(String(message || '请求失败'));
    err.code = code || 'NET-CONNECT';
    if (meta) Object.assign(err, meta);
    return err;
  }

  async function jsonRequest(method, url, headers, body, signal, options) {
    options = options || {};
    if (signal && signal.aborted) return { aborted: true };
    const hdrs = Object.assign({}, headers || {});
    if (body != null) hdrs['Content-Type'] = hdrs['Content-Type'] || 'application/json';
    try {
      const res = await tauriInvoke('http_request', {
        args: {
          method: method || 'GET',
          url,
          headers: hdrs,
          body: body != null ? JSON.stringify(body) : null,
          timeoutMs: options.timeout || 600000,
          responseEncoding: 'text',
        },
      });
      if (signal && signal.aborted) return { aborted: true };
      if (res.status >= 200 && res.status < 300) {
        try {
          return JSON.parse(res.body);
        } catch {
          return res.body;
        }
      }
      const err = netError(
        res.status === 408 ? 'HTTP-408' : res.status === 429 ? 'HTTP-429' : res.status >= 500 ? 'HTTP-5XX' : 'HTTP-' + res.status,
        extractError(res.body, res.status),
        { status: res.status, body: res.body, url }
      );
      throw err;
    } catch (e) {
      if (e && e.code) throw e;
      throw netError('NET-CONNECT', e && e.message || String(e), { url });
    }
  }

  function dataUrlBytes(dataUrl) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/i.exec(String(dataUrl || ''));
    if (!match) throw netError('IMAGE-REFERENCE-INVALID', '参考图片不是有效的 base64 图片');
    let binary;
    try {
      binary = atob(match[2].replace(/\s+/g, ''));
    } catch {
      throw netError('IMAGE-REFERENCE-INVALID', '参考图片的 base64 数据无效');
    }
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { mime: match[1].toLowerCase(), bytes };
  }

  function utf8Bytes(value) {
    return new TextEncoder().encode(String(value));
  }

  function concatBytes(chunks) {
    const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const out = new Uint8Array(size);
    let offset = 0;
    chunks.forEach((chunk) => {
      out.set(chunk, offset);
      offset += chunk.length;
    });
    return out;
  }

  function bytesToBase64(bytes) {
    const chunkSize = 0x8000;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
    }
    return btoa(binary);
  }

  function safeMultipartToken(value, fallback) {
    const clean = String(value || '').replace(/[\r\n"\\]/g, '_').trim();
    return clean || fallback;
  }

  function multipartBody(fields, files) {
    const boundary = '----WePChat' + Date.now().toString(36) + Math.random().toString(36).slice(2);
    const chunks = [];
    Object.entries(fields || {}).forEach(([name, value]) => {
      if (value == null || value === '') return;
      chunks.push(utf8Bytes(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="' + safeMultipartToken(name, 'field') + '"\r\n\r\n' +
        String(value) + '\r\n'
      ));
    });
    (files || []).forEach((file) => {
      const decoded = dataUrlBytes(file.dataUrl);
      chunks.push(utf8Bytes(
        '--' + boundary + '\r\n' +
        'Content-Disposition: form-data; name="' + safeMultipartToken(file.field, 'image') +
        '"; filename="' + safeMultipartToken(file.filename, 'reference.png') + '"\r\n' +
        'Content-Type: ' + (file.mime || decoded.mime || 'image/png') + '\r\n\r\n'
      ));
      chunks.push(decoded.bytes);
      chunks.push(utf8Bytes('\r\n'));
    });
    chunks.push(utf8Bytes('--' + boundary + '--\r\n'));
    return {
      contentType: 'multipart/form-data; boundary=' + boundary,
      bodyBase64: bytesToBase64(concatBytes(chunks)),
    };
  }

  async function multipartRequest(url, headers, fields, files, signal) {
    if (signal && signal.aborted) return { aborted: true };
    const multipart = multipartBody(fields, files);
    const hdrs = Object.assign({}, headers || {}, { 'Content-Type': multipart.contentType });
    try {
      const res = await tauriInvoke('http_request', {
        args: {
          method: 'POST',
          url,
          headers: hdrs,
          body: null,
          bodyBase64: multipart.bodyBase64,
          timeoutMs: 600000,
          responseEncoding: 'text',
        },
      });
      if (signal && signal.aborted) return { aborted: true };
      if (res.status >= 200 && res.status < 300) {
        try {
          return JSON.parse(res.body);
        } catch {
          return res.body;
        }
      }
      throw netError(
        res.status === 408 ? 'HTTP-408' : res.status === 429 ? 'HTTP-429' : res.status >= 500 ? 'HTTP-5XX' : 'HTTP-' + res.status,
        extractError(res.body, res.status),
        { status: res.status, body: res.body, url }
      );
    } catch (e) {
      if (e && e.code) throw e;
      throw netError('NET-CONNECT', e && e.message || String(e), { url });
    }
  }

  async function downloadImageAsDataUrl(url, ctx) {
    const headers = {};
    try {
      const imageOrigin = new URL(url).origin;
      const providerOrigin = new URL(ctx.provider && ctx.provider.baseUrl || '').origin;
      if (imageOrigin === providerOrigin) Object.assign(headers, authHeaders(ctx.provider));
    } catch { /* ignore */ }
    if (ctx.onStatus) {
      ctx.onStatus({
        state: 'progress',
        source: '图片下载',
        code: 'IMAGE-DOWNLOAD',
        message: '图片已生成，正在下载结果',
      });
    }
    const res = await tauriInvoke('http_request', {
      args: {
        method: 'GET',
        url,
        headers,
        body: null,
        timeoutMs: 180000,
        responseEncoding: 'base64',
      },
    });
    if (res.status < 200 || res.status >= 300) {
      throw netError('HTTP-' + res.status, '图片下载失败：HTTP ' + res.status, { status: res.status, url });
    }
    const b64 = res.bodyBase64 || res.body_base64 || '';
    if (!b64) throw netError('IMAGE-DOWNLOAD-NOT-IMAGE', '结果地址没有返回有效图片', { url });
    if (b64.length > 90 * 1024 * 1024) {
      throw netError('IMAGE-TOO-LARGE', '单张图片超过 64 MB 安全上限', { url });
    }
    let mime = String(res.contentType || res.content_type || '').split(';')[0].trim().toLowerCase();
    if (!/^image\//.test(mime)) {
      // sniff from base64 prefix
      if (b64.startsWith('iVBOR')) mime = 'image/png';
      else if (b64.startsWith('/9j/')) mime = 'image/jpeg';
      else if (b64.startsWith('UklGR')) mime = 'image/webp';
      else if (b64.startsWith('R0lGOD')) mime = 'image/gif';
      else mime = 'image/png';
    }
    return 'data:' + mime + ';base64,' + b64;
  }

  function mimeForFormat(format) {
    format = String(format || 'png').toLowerCase();
    if (format === 'jpg' || format === 'jpeg') return 'image/jpeg';
    if (format === 'webp') return 'image/webp';
    return 'image/png';
  }

  function dataUrlFromB64(b64, format) {
    if (/^data:/i.test(String(b64 || ''))) return b64;
    return 'data:' + mimeForFormat(format) + ';base64,' + String(b64 || '').replace(/\s+/g, '');
  }

  function isLikelyImageB64(s) {
    s = String(s || '').replace(/\s+/g, '');
    if (s.length < 120) return false;
    if (/^iVBORw0KGgo/i.test(s)) return true;
    if (/^\/9j\//.test(s)) return true;
    if (/^UklGR/i.test(s)) return true;
    return /^[A-Za-z0-9+/=_-]{400,}$/.test(s);
  }

  function pushCandidate(candidates, val, format, raw) {
    if (!val) return;
    if (typeof val === 'string') {
      const s = val.trim();
      if (!s) return;
      if (/^data:image\//i.test(s)) candidates.push({ dataUrl: s, raw });
      else if (/^https?:\/\//i.test(s)) candidates.push({ url: s, raw });
      else if (isLikelyImageB64(s)) candidates.push({ dataUrl: dataUrlFromB64(s, format), raw });
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
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((x) => collectImageCandidates(x, out, format, depth + 1));
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
    if (obj.images) collectImageCandidates(obj.images, out, format, depth + 1);
    if (obj.data) collectImageCandidates(obj.data, out, format, depth + 1);
    if (obj.choices) collectImageCandidates(obj.choices, out, format, depth + 1);
    if (obj.output) collectImageCandidates(obj.output, out, format, depth + 1);
  }

  async function materialize(candidates, format, ctx) {
    const seen = new Set();
    const images = [];
    for (const c of candidates || []) {
      let dataUrl = c.dataUrl || '';
      if (!dataUrl && c.url) dataUrl = await downloadImageAsDataUrl(c.url, ctx);
      if (!dataUrl || seen.has(dataUrl)) continue;
      seen.add(dataUrl);
      images.push({
        dataUrl,
        mime: (dataUrl.match(/^data:([^;]+)/) || [])[1] || mimeForFormat(format),
        revisedPrompt: (c.raw && (c.raw.revised_prompt || c.raw.revisedPrompt)) || '',
      });
    }
    return images;
  }

  function setIfConcrete(target, key, value) {
    value = String(value || '').trim();
    if (value && value !== 'auto') target[key] = value;
  }

  function removeAdvancedOptions(body) {
    const out = Object.assign({}, body);
    delete out.quality;
    delete out.background;
    return out;
  }

  function requestBase(ctx) {
    const provider = ctx.provider;
    const model = ctx.model;
    const settings = ctx.settings || {};
    if (!provider) throw new Error('未配置图片提供商');
    if (!model) throw new Error('未配置图片生成模型');
    const prompt = String(ctx.prompt || '').trim();
    if (!prompt) throw new Error('缺少图片提示词');
    return { provider, model, settings, prompt, format: settings.outputFormat || settings.imageOutputFormat || 'png' };
  }

  async function generateViaImages(ctx) {
    const { provider, model, settings, prompt, format } = requestBase(ctx);
    const baseBody = {
      model,
      prompt,
      n: Math.max(1, Math.min(8, parseInt(ctx.count || settings.count || settings.imageDefaultCount || 1, 10) || 1)),
    };
    setIfConcrete(baseBody, 'size', ctx.size || settings.size || settings.imageDefaultSize);
    setIfConcrete(baseBody, 'quality', ctx.quality || settings.quality || settings.imageQuality);
    setIfConcrete(baseBody, 'background', ctx.background || settings.background || settings.imageBackground);
    const relaxedBody = (baseBody.quality || baseBody.background) ? removeAdvancedOptions(baseBody) : null;
    const variants = [];
    if (/^gpt-image/i.test(model)) {
      variants.push(Object.assign({}, baseBody, format ? { output_format: format } : {}));
      variants.push(Object.assign({}, baseBody));
      variants.push(Object.assign({}, baseBody, { response_format: 'b64_json' }));
      if (relaxedBody) {
        variants.push(Object.assign({}, relaxedBody, format ? { output_format: format } : {}));
        variants.push(Object.assign({}, relaxedBody, { response_format: 'b64_json' }));
      }
    } else {
      variants.push(Object.assign({}, baseBody, { response_format: 'b64_json' }));
      variants.push(Object.assign({}, baseBody));
      if (format) variants.push(Object.assign({}, baseBody, { output_format: format }));
      if (relaxedBody) {
        variants.push(Object.assign({}, relaxedBody, { response_format: 'b64_json' }));
        variants.push(Object.assign({}, relaxedBody));
      }
    }

    const url = endpointUrl(ctx, '/images/generations', 'imagesEndpointPath');
    const errors = [];
    for (let i = 0; i < variants.length; i++) {
      try {
        if (ctx.onStatus) {
          ctx.onStatus({
            state: 'progress',
            source: '图片生成',
            code: 'IMAGE-WAITING',
            message: '正在请求图片生成接口…',
          });
        }
        const res = await jsonRequest('POST', url, authHeaders(provider), variants[i], ctx.signal, {
          timeout: 600000,
        });
        if (res && res.aborted) return { images: [] };
        const candidates = [];
        collectImageCandidates(res, candidates, format, 0);
        const images = await materialize(candidates, format, ctx);
        if (images.length) return { images, raw: res, url };
        errors.push('payload' + (i + 1) + ': 接口未返回图片');
      } catch (e) {
        errors.push('payload' + (i + 1) + ': ' + (e && e.message || String(e)));
        if (ctx.signal && ctx.signal.aborted) throw e;
        if (e && e.code && e.code !== 'HTTP-400' && e.code !== 'HTTP-422') throw e;
        if (e && e.status && ![400, 422].includes(e.status)) throw e;
      }
    }
    const err = new Error(errors.join('\n') || '图片生成失败');
    err.url = url;
    err.code = 'IMAGE-GENERATION-FAILED';
    throw err;
  }

  async function editViaImages(ctx) {
    const { provider, model, settings, prompt, format } = requestBase(ctx);
    const references = (ctx.referenceImages || []).filter((image) => image && image.dataUrl);
    if (!references.length) {
      throw netError('IMAGE-REFERENCE-MISSING', '图片编辑需要至少一张参考图片');
    }
    const baseFields = {
      model,
      prompt,
      n: Math.max(1, Math.min(8, parseInt(ctx.count || settings.count || settings.imageDefaultCount || 1, 10) || 1)),
    };
    setIfConcrete(baseFields, 'size', ctx.size || settings.size || settings.imageDefaultSize);
    const modernFields = Object.assign({}, baseFields);
    if (/^gpt-image/i.test(model)) {
      setIfConcrete(modernFields, 'quality', ctx.quality || settings.quality || settings.imageQuality);
      setIfConcrete(modernFields, 'background', ctx.background || settings.background || settings.imageBackground);
      if (format) modernFields.output_format = format;
    } else if (format) {
      modernFields.output_format = format;
    }
    const legacyFields = Object.assign({}, baseFields, { response_format: 'b64_json' });
    const preferredFields = /^gpt-image/i.test(model) ? modernFields : legacyFields;
    const variants = [
      { fields: preferredFields, fieldName: 'image' },
      { fields: baseFields, fieldName: 'image' },
      { fields: /^gpt-image/i.test(model) ? legacyFields : modernFields, fieldName: 'image' },
      { fields: preferredFields, fieldName: 'image[]' },
      { fields: baseFields, fieldName: 'image[]' },
    ];
    const url = endpointUrl(ctx, '/images/edits', 'imageEditEndpointPath');
    const errors = [];
    for (let i = 0; i < variants.length; i++) {
      const variant = variants[i];
      const files = references.map((reference, index) => ({
        field: variant.fieldName,
        filename: reference.filename || reference.path?.split(/[\\/]/).pop() || ('reference-' + (index + 1) + '.png'),
        mime: reference.mime || '',
        dataUrl: reference.dataUrl,
      }));
      try {
        if (ctx.onStatus) {
          ctx.onStatus({
            state: 'progress',
            source: '图片编辑',
            code: 'IMAGE-EDIT-WAITING',
            message: '正在上传参考图片并请求编辑接口…',
          });
        }
        const res = await multipartRequest(url, authHeaders(provider), variant.fields, files, ctx.signal);
        if (res && res.aborted) return { images: [] };
        const candidates = [];
        collectImageCandidates(res, candidates, format, 0);
        const images = await materialize(candidates, format, ctx);
        if (images.length) return { images, raw: res, url };
        errors.push('payload' + (i + 1) + ': 接口未返回图片');
      } catch (e) {
        errors.push('payload' + (i + 1) + ': ' + (e && e.message || String(e)));
        if (ctx.signal && ctx.signal.aborted) throw e;
        if (e && e.code && e.code !== 'HTTP-400' && e.code !== 'HTTP-422') throw e;
        if (e && e.status && ![400, 422].includes(e.status)) throw e;
      }
    }
    const err = new Error(errors.join('\n') || '图片编辑失败');
    err.url = url;
    err.code = 'IMAGE-EDIT-FAILED';
    throw err;
  }

  async function generateViaChat(ctx) {
    const { provider, model, prompt, format } = requestBase(ctx);
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
    };
    const url = endpointUrl(ctx, '/chat/completions', 'chatEndpointPath');
    const res = await jsonRequest('POST', url, authHeaders(provider), body, ctx.signal, { timeout: 600000 });
    if (res && res.aborted) return { images: [] };
    const candidates = [];
    collectImageCandidates(res, candidates, format, 0);
    const images = await materialize(candidates, format, ctx);
    return { images, raw: res, url };
  }

  async function generate(ctx) {
    const settings = ctx.settings || {};
    const mode = settings.apiMode || settings.imageApiMode || 'images';
    if (ctx.mode === 'edit' && (ctx.referenceImages || []).length) {
      return editViaImages(ctx);
    }
    const imageOnly = settings.imageOnly ||
      /^gpt-image/i.test(ctx.model || '') ||
      /(?:dall-e|imagen|qwen-image|flux|stable-diffusion|sdxl|seedream|jimeng|doubao.*image|grok-imagine)/i.test(ctx.model || '');
    const order = mode === 'chat' ? ['chat']
      : mode === 'images' ? ['images']
      : imageOnly ? ['images'] : ['images', 'chat'];
    const errors = [];
    for (const step of order) {
      try {
        const res = step === 'chat' ? await generateViaChat(ctx) : await generateViaImages(ctx);
        if (res.images && res.images.length) return res;
        errors.push(step + ': 接口未返回图片');
      } catch (e) {
        errors.push(step + ': ' + (e && e.message || String(e)));
        if (e && /^(IMAGE-SUBMIT-UNKNOWN|IMAGE-TOO-LARGE|IMAGE-DOWNLOAD-|NET-ABORTED)/.test(e.code || '')) throw e;
        if (mode !== 'auto') {
          const err = new Error('图片生成失败：' + (e && e.message || String(e)));
          err.code = e && e.code || 'IMAGE-GENERATION-FAILED';
          throw err;
        }
      }
    }
    const err = new Error('图片生成失败。已尝试 ' + order.join(' / ') + '：\n' + errors.join('\n'));
    err.code = 'IMAGE-GENERATION-FAILED';
    throw err;
  }

  window.ImageAPI = {
    generate,
    generateViaImages,
    editViaImages,
    generateViaChat,
    downloadImageAsDataUrl,
    endpointUrl,
    mimeForFormat,
  };
})();
