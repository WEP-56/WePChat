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

  function jsonRequest(method, url, headers, body, signal) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      Object.keys(headers || {}).forEach(k => { try { xhr.setRequestHeader(k, headers[k]); } catch (e) {} });
      xhr.timeout = 120000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve(xhr.responseText); }
        } else {
          const err = new Error(extractError(xhr.responseText, xhr.status));
          err.status = xhr.status;
          err.body = xhr.responseText;
          err.url = url;
          reject(err);
        }
      };
      xhr.onerror = () => {
        const err = new Error('图片生成请求失败，请检查网络与接口地址');
        err.url = url;
        reject(err);
      };
      xhr.ontimeout = () => {
        const err = new Error('图片生成请求超时');
        err.url = url;
        reject(err);
      };
      xhr.onabort = () => resolve({ aborted: true });
      if (signal) {
        if (signal.aborted) { resolve({ aborted: true }); return; }
        signal.addEventListener('abort', () => { try { xhr.abort(); } catch (e) {} });
      }
      xhr.send(JSON.stringify(body || {}));
    });
  }

  function formRequest(method, url, headers, form, signal) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      Object.keys(headers || {}).forEach(k => { try { xhr.setRequestHeader(k, headers[k]); } catch (e) {} });
      xhr.timeout = 120000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve(xhr.responseText); }
        } else {
          const err = new Error(extractError(xhr.responseText, xhr.status));
          err.status = xhr.status;
          err.body = xhr.responseText;
          err.url = url;
          reject(err);
        }
      };
      xhr.onerror = () => {
        const err = new Error('图片编辑请求失败，请检查网络与接口地址');
        err.url = url;
        reject(err);
      };
      xhr.ontimeout = () => {
        const err = new Error('图片编辑请求超时');
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
      reader.onerror = () => reject(new Error('图片读取失败'));
      reader.readAsDataURL(blob);
    });
  }

  async function urlToDataUrl(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('图片下载失败：HTTP ' + res.status);
    return await blobToDataUrl(await res.blob());
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
      obj.download_url || obj.downloadUrl || obj.output_url || obj.outputUrl, format, obj);
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

  async function materialize(candidates, format) {
    const seen = new Set();
    const images = [];
    for (const c of candidates || []) {
      let dataUrl = c.dataUrl || '';
      if (!dataUrl && c.url) dataUrl = await urlToDataUrl(c.url);
      if (!dataUrl || seen.has(dataUrl)) continue;
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
        const res = await jsonRequest('POST', url, authHeaders(provider), variants[i], ctx.signal);
        if (res && res.aborted) return { images: [] };
        const candidates = [];
        collectImageCandidates(res, candidates, format, 0);
        const images = await materialize(candidates, format);
        return { images, raw: res, url, preview: images.length ? '' : rawPreview(res) };
      } catch (e) {
        errors.push('payload' + (i + 1) + ': ' + (e && e.message || String(e)));
        if (ctx.signal && ctx.signal.aborted) throw e;
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
    const res = await formRequest('POST', url, authHeaders(provider), form, ctx.signal);
    if (res && res.aborted) return { images: [] };
    const candidates = [];
    collectImageCandidates(res, candidates, format, 0);
    const images = await materialize(candidates, format);
    return { images, raw: res, url, preview: images.length ? '' : rawPreview(res) };
  }

  async function generateViaChat(ctx) {
    const { provider, model, settings, prompt, format } = requestBase(ctx);
    const body = {
      model,
      messages: [{ role: 'user', content: prompt }],
      stream: false
    };
    const res = await jsonRequest('POST', endpointUrl(ctx, '/chat/completions', 'chatEndpointPath'), authHeaders(provider), body, ctx.signal);
    if (res && res.aborted) return { images: [] };
    const candidates = [];
    collectImageCandidates(res, candidates, format, 0);
    const images = await materialize(candidates, format);
    return { images, raw: res, preview: images.length ? '' : rawPreview(res) };
  }

  async function generateViaResponses(ctx) {
    const { provider, model, settings, prompt, format } = requestBase(ctx);
    const body = {
      model,
      input: prompt,
      tools: [{ type: 'image_generation' }]
    };
    const res = await jsonRequest('POST', endpointUrl(ctx, '/responses', 'responsesEndpointPath'), authHeaders(provider), body, ctx.signal);
    if (res && res.aborted) return { images: [] };
    const candidates = [];
    collectImageCandidates(res, candidates, format, 0);
    const images = await materialize(candidates, format);
    return { images, raw: res, preview: images.length ? '' : rawPreview(res) };
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
        if (mode !== 'auto') {
          const err = new Error('图片生成失败：' + line);
          err.url = e && e.url;
          throw err;
        }
      }
    }
    throw new Error('图片生成失败。已尝试 ' + order.join(' / ') + '：\n' + errors.join('\n'));
  }

  return { generate, generateViaImages, editViaImages, generateViaChat, generateViaResponses };
})();

window.ImageAPI = ImageAPI;
