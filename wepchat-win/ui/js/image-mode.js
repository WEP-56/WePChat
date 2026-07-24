/* WePChat Windows — image mode: sessions, timeline, generate, canvas bridge */
'use strict';

(() => {
  const DEFAULT_STYLE_PRESETS = [
    { id: 'cinematic-realistic', name: '电影感写实', prompt: 'Cinematic realistic photography, natural light, subtle film grain, rich but controlled color grading, soft shadows, professional composition, high detail.' },
    { id: 'commerce-hero', name: '电商主图', prompt: 'Clean commercial product photography, premium studio lighting, crisp edges, realistic materials, neutral background, catalog-ready composition, high detail.' },
    { id: 'anime-illustration', name: '动漫插画', prompt: 'Polished anime illustration style, expressive character design, clean line art, soft cel shading, luminous color accents, detailed atmosphere.' },
    { id: 'flat-icon', name: '扁平图标', prompt: 'Modern flat vector icon style, geometric shapes, simple silhouette, balanced negative space, clean edges, limited color palette, app-icon ready.' },
    { id: 'minimal-ui', name: '极简 UI', prompt: 'Minimal modern UI visual style, clean hierarchy, generous spacing, precise alignment, neutral surfaces, subtle accents, crisp readable details.' },
    { id: 'watercolor', name: '水彩手绘', prompt: 'Soft watercolor illustration, gentle paper texture, translucent layered pigments, delicate brush edges, airy composition, calm natural color palette.' },
  ];

  const SIZE_OPTIONS = ['auto', '1024x1024', '1024x1536', '1536x1024', '512x512', '768x768', '1024x768', '768x1024'];
  const QUALITY_OPTIONS = ['auto', 'high', 'medium', 'low'];
  const FORMAT_OPTIONS = ['png', 'webp', 'jpeg'];

  let hooks = {
    getState: null,
    invoke: null,
    persistSession: null,
    refreshSessionList: null,
    toast: null,
    uid: null,
    nowIso: null,
  };

  let canvasState = null;
  let generating = false;
  let abortCtl = null;
  let referencePath = '';
  let referencePaths = [];
  let referenceMode = 'reference';
  let pendingCanvasItemId = '';
  let imageSessionSearchQuery = '';

  function bind(h) {
    hooks = Object.assign(hooks, h || {});
  }

  function S() {
    return hooks.getState ? hooks.getState() : null;
  }

  function toast(msg, kind) {
    if (hooks.toast) hooks.toast(msg, kind);
    else console.log('[image]', msg);
  }

  function uid(prefix) {
    return hooks.uid ? hooks.uid(prefix) : (prefix || 'id') + '_' + Date.now().toString(36);
  }

  function nowIso() {
    return hooks.nowIso ? hooks.nowIso() : new Date().toISOString();
  }

  function defaultImageSettings() {
    return {
      imageProviderId: '',
      imageModel: '',
      imageEditModel: '',
      imageDefaultSize: 'auto',
      imageQuality: 'auto',
      imageBackground: 'auto',
      imageDefaultCount: 1,
      imageOutputFormat: 'png',
      imageStylePresetId: '',
      imageStylePresets: DEFAULT_STYLE_PRESETS.slice(),
      imageApiMode: 'images',
      imageEndpointPath: '',
      imageEditEndpointPath: '',
    };
  }

  function mergeImageSettings(settings) {
    const d = defaultImageSettings();
    const s = settings || {};
    const presets = Array.isArray(s.imageStylePresets) && s.imageStylePresets.length
      ? s.imageStylePresets
      : d.imageStylePresets;
    return {
      ...d,
      imageProviderId: s.imageProviderId || '',
      imageModel: s.imageModel || '',
      imageEditModel: s.imageEditModel || '',
      imageDefaultSize: s.imageDefaultSize || d.imageDefaultSize,
      imageQuality: s.imageQuality || d.imageQuality,
      imageBackground: s.imageBackground || d.imageBackground,
      imageDefaultCount: Math.max(1, Math.min(8, Number(s.imageDefaultCount) || 1)),
      imageOutputFormat: s.imageOutputFormat || d.imageOutputFormat,
      imageStylePresetId: s.imageStylePresetId || '',
      imageStylePresets: presets,
      imageApiMode: s.imageApiMode || d.imageApiMode,
      imageEndpointPath: s.imageEndpointPath || '',
      imageEditEndpointPath: s.imageEditEndpointPath || '',
    };
  }

  function imageModelIds(provider) {
    if (!provider) return [];
    return [
      ...(provider.imageModels || []),
      ...(provider.models || []).filter((id) => {
        const meta = (provider.imageModelMeta && provider.imageModelMeta[id]) ||
          (provider.modelMeta && provider.modelMeta[id]) ||
          window.MODEL_META?.get?.(provider, id);
        return !!(meta?.capabilities?.imageGeneration || meta?.image?.generation);
      }),
    ].filter((id, index, list) => id && list.indexOf(id) === index);
  }

  function imageProviders() {
    const state = S();
    return (state?.providers || []).filter((provider) => imageModelIds(provider).length);
  }

  function resolveImageProvider() {
    const state = S();
    const settings = mergeImageSettings(state?.settings);
    const providers = state?.providers || [];
    let p = providers.find((x) => x.id === settings.imageProviderId);
    if (!p || !imageModelIds(p).length) p = imageProviders()[0] || null;
    return p;
  }

  function resolveImageModel(provider) {
    const state = S();
    const settings = mergeImageSettings(state?.settings);
    const ids = imageModelIds(provider);
    if (settings.imageModel && ids.includes(settings.imageModel)) return settings.imageModel;
    if (settings.imageModel && (provider?.imageModels || []).includes(settings.imageModel)) return settings.imageModel;
    return ids[0] || settings.imageModel || '';
  }

  function resolveSessionImageProvider() {
    const state = S();
    const selected = state?.session?.mode === 'image'
      ? state.providers?.find((provider) => provider.id === state.session.providerId)
      : null;
    return selected && imageModelIds(selected).length ? selected : resolveImageProvider();
  }

  function resolveSessionImageModel(provider) {
    const state = S();
    const selected = state?.session?.mode === 'image' ? state.session.model : '';
    return imageModelIds(provider).includes(selected) ? selected : resolveImageModel(provider);
  }

  function buildImageProviderCtx(provider) {
    if (!provider) return null;
    return Object.assign({}, provider, {
      baseUrl: String(provider.imageBaseUrl || provider.baseUrl || '').trim(),
      apiKey: provider.imageApiKey || provider.apiKey || '',
      imageEndpointPath: String(
        (S()?.settings?.imageEndpointPath) || provider.imageEndpointPath || ''
      ).trim(),
      imageEditEndpointPath: String(
        (S()?.settings?.imageEditEndpointPath) || provider.imageEditEndpointPath || ''
      ).trim(),
    });
  }

  function stylePresetById(id) {
    const settings = mergeImageSettings(S()?.settings);
    return (settings.imageStylePresets || []).find((p) => p.id === id) || null;
  }

  function enrichPrompt(prompt, stylePresetId) {
    const state = S();
    const settings = mergeImageSettings(state?.settings);
    const presetId = stylePresetId || settings.imageStylePresetId;
    const preset = stylePresetById(presetId);
    const base = String(prompt || '').trim();
    if (!preset || !preset.prompt) return base;
    return base + '\n\nStyle: ' + preset.prompt;
  }

  function imageFileName(prompt, index, mime) {
    const ext = /jpe?g/i.test(mime || '') ? 'jpg' : /webp/i.test(mime || '') ? 'webp' : 'png';
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      '_',
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds()),
    ].join('');
    let title = String(prompt || 'image')
      .replace(/[^\w一-鿿]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 24) || 'image';
    const suffix = index > 0 ? '_' + (index + 1) : '';
    return 'images/' + stamp + '_' + title + suffix + '.' + ext;
  }

  function uploadImageFileName(name, index, mime) {
    const extFromMime = /jpe?g/i.test(mime || '') ? 'jpg' : /webp/i.test(mime || '') ? 'webp' : /gif/i.test(mime || '') ? 'gif' : 'png';
    const cleanName = String(name || 'upload')
      .replace(/\.[^.]+$/, '')
      .replace(/[^\w一-鿿]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 32) || 'upload';
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    const stamp = [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
      '_',
      pad(d.getHours()),
      pad(d.getMinutes()),
      pad(d.getSeconds()),
    ].join('');
    const suffix = index > 0 ? '_' + (index + 1) : '';
    return 'images/uploads/' + stamp + '_' + cleanName + suffix + '.' + extFromMime;
  }

  function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
      reader.readAsDataURL(file);
    });
  }

  /** Persist session without embedding base64 image payloads in session.json. */
  async function persistImageSessionLightweight(session) {
    if (!session || !hooks.persistSession) return;
    const clone = JSON.parse(JSON.stringify(session));
    (clone.messages || []).forEach((m) => {
      if (Array.isArray(m.images)) {
        m.images = m.images.map((img) => ({
          path: img.path,
          mime: img.mime,
          prompt: img.prompt || '',
          revisedPrompt: img.revisedPrompt || '',
          imageMeta: img.imageMeta || undefined,
        }));
      }
    });
    // Keep live session with dataUrls for UI; save stripped clone
    const live = S()?.session;
    if (live && live.id === session.id) {
      const backup = live.messages;
      live.messages = clone.messages;
      try {
        await hooks.persistSession(live);
      } finally {
        live.messages = backup;
        live.workspacePath = live.workspacePath || session.workspacePath;
      }
      return;
    }
    await hooks.persistSession(clone);
  }

  async function hydrateTimelineThumbs() {
    const state = S();
    const session = state?.session;
    if (!session?.id || session.mode !== 'image') return;
    for (const m of session.messages || []) {
      if (!Array.isArray(m.images)) continue;
      for (const img of m.images) {
        if (img && img.path && !img.dataUrl) {
          img.dataUrl = await readBinaryDataUrl(session.id, img.path);
        }
      }
    }
  }

  async function writeBinary(sessionId, path, dataUrl, mime) {
    const m = /^data:([^;]+);base64,(.+)$/i.exec(String(dataUrl || ''));
    if (!m) throw new Error('无效的图片 data URL');
    const contentBase64 = m[2];
    const res = await hooks.invoke('ws_write', {
      args: {
        sessionId,
        path,
        content: contentBase64,
        encoding: 'base64',
        mime: mime || m[1] || 'image/png',
      },
    });
    if (res && res.ok === false) throw new Error(res.content || '写入失败');
    return path;
  }

  async function readBinaryDataUrl(sessionId, path) {
    try {
      const res = await hooks.invoke('ws_read_bytes', {
        args: { sessionId, path },
      });
      if (!res || !res.contentBase64) return '';
      return 'data:' + (res.mime || 'image/png') + ';base64,' + res.contentBase64;
    } catch {
      return '';
    }
  }

  async function readReferenceImages(sessionId, paths) {
    const references = [];
    const uniquePaths = [...new Set((paths || []).map((path) => String(path || '').trim()).filter(Boolean))];
    for (const path of uniquePaths.slice(0, 8)) {
      let res;
      try {
        res = await hooks.invoke('ws_read_bytes', {
          args: { sessionId, path },
        });
      } catch (err) {
        throw new Error('无法读取参考图片 ' + path + '：' + (err?.message || String(err)));
      }
      const mime = String(res?.mime || 'image/png').toLowerCase();
      if (!res?.contentBase64 || !/^image\//i.test(mime)) {
        throw new Error('参考文件不是支持的图片：' + path);
      }
      references.push({
        path,
        filename: path.split(/[\\/]/).pop() || 'reference.png',
        mime,
        dataUrl: 'data:' + mime + ';base64,' + res.contentBase64,
      });
    }
    return references;
  }

  async function saveGeneratedImages(images, args, provider, model) {
    const state = S();
    const session = state?.session;
    if (!session?.id) throw new Error('无活动会话');
    const saved = [];
    for (let idx = 0; idx < (images || []).length; idx++) {
      const img = images[idx];
      if (!img?.dataUrl) continue;
      let path = args.targetFile && images.length === 1
        ? String(args.targetFile).replace(/^\/+/, '')
        : imageFileName(args.prompt, idx, img.mime);
      if (!/\.(png|jpe?g|webp|gif)$/i.test(path)) {
        const ext = /jpe?g/i.test(img.mime || '') ? 'jpg' : /webp/i.test(img.mime || '') ? 'webp' : 'png';
        path += '.' + ext;
      }
      await writeBinary(session.id, path, img.dataUrl, img.mime);
      saved.push({
        path,
        mime: img.mime || 'image/png',
        prompt: args.prompt || '',
        dataUrl: img.dataUrl,
        revisedPrompt: img.revisedPrompt || '',
        imageMeta: {
          prompt: args.prompt || '',
          revisedPrompt: img.revisedPrompt || '',
          model,
          providerId: provider?.id || '',
          mode: args.mode || 'generate',
          size: args.size || '',
          count: args.count || 1,
          quality: args.quality || '',
          background: args.background || '',
          outputFormat: args.outputFormat || 'png',
          stylePresetId: args.stylePresetId || '',
          referenceFiles: args.referenceFiles || [],
          source: args.source || 'image_mode',
        },
      });
    }
    return saved;
  }

  async function runImageRequest(args) {
    const state = S();
    if (!state?.session?.id) throw new Error('无活动会话');
    const settings = mergeImageSettings(state.settings);
    const useSessionSelection = args.source !== 'image_go' && state.session.mode === 'image';
    const providerRaw = useSessionSelection ? resolveSessionImageProvider() : resolveImageProvider();
    if (!providerRaw) throw new Error('请先配置支持生图的供应商');
    const refs = (args.referenceFiles || []).filter(Boolean);
    const model = useSessionSelection
      ? resolveSessionImageModel(providerRaw)
      : (refs.length && settings.imageEditModel ? settings.imageEditModel : resolveImageModel(providerRaw));
    if (!model) throw new Error('请选择生图模型');
    const provider = buildImageProviderCtx(providerRaw);

    const prompt = enrichPrompt(args.prompt, args.stylePresetId);
    const size = args.size || settings.imageDefaultSize || 'auto';
    const quality = args.quality || settings.imageQuality || 'auto';
    const background = args.background || settings.imageBackground || 'auto';
    const count = args.count || settings.imageDefaultCount || 1;
    const outputFormat = args.outputFormat || settings.imageOutputFormat || 'png';
    const selectedReferenceMode = args.referenceMode || (args.source === 'image_mode' ? 'reference' : 'edit');

    const referenceImages = refs.length
      ? await readReferenceImages(state.session.id, refs)
      : [];

    const apiSettings = {
      size,
      quality,
      background,
      count,
      outputFormat,
      imageOutputFormat: outputFormat,
      imageDefaultSize: size,
      imageQuality: quality,
      imageBackground: background,
      imageDefaultCount: count,
      apiMode: settings.imageApiMode || 'images',
      imageApiMode: settings.imageApiMode || 'images',
      endpointPath: settings.imageEndpointPath,
      imageEndpointPath: settings.imageEndpointPath,
      imageEditEndpointPath: settings.imageEditEndpointPath,
    };

    if (!window.ImageAPI) throw new Error('ImageAPI 未加载');

    const result = await window.ImageAPI.generate({
      provider,
      model,
      prompt,
      count,
      size,
      quality,
      background,
      mode: refs.length ? (selectedReferenceMode === 'edit' ? 'edit' : 'reference') : 'generate',
      referenceImages,
      settings: apiSettings,
      signal: args.signal,
      onStatus: args.onStatus,
    });

    const saved = await saveGeneratedImages(result.images || [], {
      prompt: args.prompt,
      targetFile: args.targetFile,
      mode: refs.length ? (selectedReferenceMode === 'edit' ? 'edit' : 'reference') : 'generate',
      size,
      count,
      quality,
      background,
      outputFormat,
      stylePresetId: args.stylePresetId || settings.imageStylePresetId,
      referenceFiles: refs,
      source: args.source || 'image_mode',
    }, providerRaw, model);

    return { saved, model, providerId: providerRaw.id };
  }

  /* ---------- Session helpers ---------- */

  function isImageSession(sess) {
    return sess && sess.mode === 'image';
  }

  function filterImageSessions(list) {
    return (list || []).filter(isImageSession);
  }

  function filterChatSessions(list) {
    return (list || []).filter((s) => !isImageSession(s));
  }

  function createImageSession() {
    const provider = resolveImageProvider();
    const model = resolveImageModel(provider);
    return {
      id: uid('session'),
      title: '',
      createdAt: nowIso(),
      updatedAt: nowIso(),
      mode: 'image',
      providerId: provider?.id || '',
      model: model || '',
      messages: [],
      workspacePath: '',
      pinned: false,
      imageCanvas: null,
      draft: { input: '', referencePath: '', referencePaths: [], referenceMode: 'reference' },
    };
  }

  /* ---------- UI: list / timeline / composer ---------- */

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function renderImageSessionList() {
    const state = S();
    const listEl = $('#image-session-list');
    const empty = $('#image-list-empty');
    if (!listEl) return;
    const sessions = filterImageSessions(state?.sessions || [])
      .filter((s) => {
        const q = imageSessionSearchQuery.trim().toLowerCase();
        return !q || String(s.title || '未命名生图').toLowerCase().includes(q);
      })
      .slice()
      .sort((a, b) => {
        if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
        return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
      });
    if (!sessions.length) {
      listEl.hidden = true;
      if (empty) empty.hidden = false;
      listEl.innerHTML = '';
      return;
    }
    if (empty) empty.hidden = true;
    listEl.hidden = false;
    listEl.innerHTML = sessions.map((s) => {
      const active = state.session?.id === s.id ? ' is-active' : '';
      const title = s.title || '未命名生图';
      const meta = [
        s.model || '',
        imageCountOfSession(s) ? imageCountOfSession(s) + ' 张' : '',
      ].filter(Boolean).join(' · ');
      return `<li class="session-item${active}" data-id="${escapeAttr(s.id)}">
        <div class="session-item-row">
          <button type="button" class="session-item-btn" data-act="open-image-session">
            <span class="session-title">${escapeHtml(title)}</span>
            <span class="session-meta">${escapeHtml(meta.slice(0, 36))}</span>
          </button>
          <button type="button" class="session-item-more" data-act="image-session-menu" title="会话操作" aria-label="会话操作">⋯</button>
        </div>
        <div class="session-menu image-session-menu" hidden>
          <button type="button" class="session-menu-item" data-image-session-act="rename">重命名</button>
          <button type="button" class="session-menu-item" data-image-session-act="pin">${s.pinned ? '取消置顶' : '置顶'}</button>
          <button type="button" class="session-menu-item" data-image-session-act="copy">复制会话</button>
          <button type="button" class="session-menu-item is-danger" data-image-session-act="delete">删除</button>
        </div>
      </li>`;
    }).join('');
  }

  function imageCountOfSession(session) {
    const canvasCount = Array.isArray(session?.imageCanvas?.items) ? session.imageCanvas.items.length : 0;
    const messageCount = (session?.messages || []).reduce((sum, m) => sum + (Array.isArray(m.images) ? m.images.length : 0), 0);
    return Math.max(canvasCount, messageCount);
  }

  function closeImageSessionMenus() {
    document.querySelectorAll('.image-session-menu').forEach((menu) => { menu.hidden = true; });
  }

  function renderImageTimeline() {
    const state = S();
    const scroll = $('#image-timeline');
    if (!scroll) return;
    const session = state?.session;
    if (!session || session.mode !== 'image') {
      scroll.innerHTML = emptyWelcomeHtml();
      return;
    }
    const messages = session.messages || [];
    if (!messages.length) {
      scroll.innerHTML = emptyWelcomeHtml();
      return;
    }
    scroll.innerHTML = messages.map((m) => {
      if (m.role === 'user') {
        const refModeLabel = m.imageReferenceMode === 'edit' ? '编辑' : '参考';
        return `<div class="img-msg img-msg--user">
          <div class="img-msg-bubble">${escapeHtml(m.content || '')}</div>
          ${m.referenceFiles && m.referenceFiles.length
            ? `<div class="img-msg-ref">${refModeLabel}：${escapeHtml(m.referenceFiles.join(', '))}</div>`
            : ''}
        </div>`;
      }
      if (m.role === 'assistant') {
        const status = m.status === 'streaming' || m.status === 'running'
          ? `<div class="img-msg-status">${escapeHtml(m.statusText || '生成中…')}</div>`
          : '';
        const err = m.error ? `<div class="img-msg-error">${escapeHtml(m.error)}</div>` : '';
        const imgs = (m.images || []).map((img) => {
          const src = img.dataUrl || '';
          return `<button type="button" class="img-msg-thumb" data-path="${escapeAttr(img.path)}" title="${escapeAttr(img.path)}">
            ${src ? `<img src="${escapeAttr(src)}" alt="" />` : `<span>${escapeHtml(img.path)}</span>`}
          </button>`;
        }).join('');
        return `<div class="img-msg img-msg--assistant">
          ${status}
          ${err}
          ${m.content && !imgs ? `<div class="img-msg-text">${escapeHtml(m.content)}</div>` : ''}
          ${imgs ? `<div class="img-msg-grid">${imgs}</div>` : ''}
        </div>`;
      }
      return '';
    }).join('');
    scroll.scrollTop = scroll.scrollHeight;

    scroll.querySelectorAll('.img-msg-thumb').forEach((btn) => {
      btn.addEventListener('click', () => {
        const path = btn.getAttribute('data-path');
        if (path) focusImageOnCanvas(path);
      });
    });
  }

  function emptyWelcomeHtml() {
    return `<div class="img-welcome">
      <p class="img-welcome-title">您想要创建什么？</p>
      <div class="img-welcome-pills">
        <button type="button" class="img-pill" data-prompt="电影感写实，黄金时刻光线下的城市街景">城市街景</button>
        <button type="button" class="img-pill" data-prompt="极简电商主图，白色背景，产品居中">电商主图</button>
        <button type="button" class="img-pill" data-prompt="柔和水彩风格的山间小屋插画">水彩插画</button>
        <button type="button" class="img-pill" data-prompt="扁平矢量 App 图标，圆角，简洁">扁平图标</button>
      </div>
    </div>`;
  }

  function updateReferenceChip() {
    const chip = $('#image-ref-chip');
    const modeEl = $('#image-ref-mode');
    if (!chip) return;
    const paths = getReferencePaths();
    if (paths.length) {
      chip.hidden = false;
      if (modeEl) modeEl.hidden = false;
      chip.innerHTML = paths.map((path) => {
        const item = canvasState?.items?.find((it) => it.path === path);
        const name = path.split(/[\\/]/).pop() || path;
        return `<span class="img-ref-item" title="${escapeAttr(path)}">
          <span class="img-ref-preview">${item?.dataUrl ? `<img src="${escapeAttr(item.dataUrl)}" alt="" />` : ''}</span>
          <span>参考</span>
          <span class="img-ref-path">${escapeHtml(name)}</span>
          <button type="button" class="img-ref-clear" data-ref-remove="${escapeAttr(path)}" title="移除参考">×</button>
        </span>`;
      }).join('') + '<button type="button" class="img-ref-clear img-ref-clear-all" id="btn-image-ref-clear" title="清除全部参考">×</button>';
    } else {
      chip.hidden = true;
      if (modeEl) modeEl.hidden = true;
    }
    updateReferenceModeUi();
  }

  function normalizeReferencePath(path) {
    return path ? String(path).replace(/\\/g, '/').replace(/^\/+/, '') : '';
  }

  function getReferencePaths() {
    const paths = referencePaths.length ? referencePaths : (referencePath ? [referencePath] : []);
    return [...new Set(paths.map(normalizeReferencePath).filter(Boolean))];
  }

  function persistReferenceDraft() {
    const session = S()?.session;
    const paths = getReferencePaths();
    referencePaths = paths;
    referencePath = paths[0] || '';
    if (session && session.mode === 'image') {
      session.draft = session.draft || {};
      session.draft.referencePath = referencePath;
      session.draft.referencePaths = paths;
      session.draft.referenceMode = referenceMode;
    }
  }

  function setReferencePaths(paths) {
    referencePaths = [...new Set((paths || []).map(normalizeReferencePath).filter(Boolean))].slice(0, 8);
    referencePath = referencePaths[0] || '';
    persistReferenceDraft();
    updateReferenceChip();
  }

  function updateReferenceModeUi() {
    document.querySelectorAll('[data-ref-mode]').forEach((btn) => {
      btn.classList.toggle('is-active', btn.getAttribute('data-ref-mode') === referenceMode);
    });
  }

  function setReferenceMode(mode) {
    referenceMode = mode === 'edit' ? 'edit' : 'reference';
    const session = S()?.session;
    if (session && session.mode === 'image') {
      session.draft = session.draft || {};
      session.draft.referenceMode = referenceMode;
    }
    updateReferenceModeUi();
    renderCanvas();
  }

  function setReferencePath(path) {
    setReferencePaths(path ? [path] : []);
  }

  function addReferencePath(path) {
    const clean = normalizeReferencePath(path);
    if (!clean) return;
    setReferencePaths(getReferencePaths().concat(clean));
  }

  function removeReferencePath(path) {
    const clean = normalizeReferencePath(path);
    setReferencePaths(getReferencePaths().filter((item) => item !== clean));
  }

  function clearReferenceSelection() {
    referencePath = '';
    referencePaths = [];
    const session = S()?.session;
    if (session && session.mode === 'image') {
      session.draft = session.draft || {};
      session.draft.referencePath = '';
      session.draft.referencePaths = [];
    }
    const cs = ensureCanvasState();
    if (cs && window.ImageCanvas) {
      window.ImageCanvas.select(cs, null);
      if (session) session.imageCanvas = window.ImageCanvas.serialize(cs);
    }
    updateReferenceChip();
    renderCanvas();
  }

  function renderImageComposerMeta() {
    const state = S();
    const settings = mergeImageSettings(state?.settings);
    const provider = resolveSessionImageProvider();
    const model = resolveSessionImageModel(provider);
    const select = $('#image-model-select');
    if (select) {
      select.innerHTML = '<option value="">选择生图模型</option>';
      imageProviders().forEach((item) => {
        const group = document.createElement('optgroup');
        group.label = item.name;
        imageModelIds(item).forEach((id) => {
          const option = document.createElement('option');
          option.value = item.id + '\n' + id;
          option.textContent = id;
          option.selected = item.id === provider?.id && id === model;
          group.appendChild(option);
        });
        if (group.childElementCount) select.appendChild(group);
      });
      select.disabled = select.options.length <= 1;
    }
    const label = $('#image-model-label');
    if (label) {
      label.textContent = provider
        ? (provider.name + ' · ' + (model || '未选模型'))
        : '尚未配置生图模型';
    }
    const sizeSel = $('#image-size-select');
    if (sizeSel && !sizeSel.dataset.bound) {
      sizeSel.innerHTML = SIZE_OPTIONS.map((s) =>
        `<option value="${s}"${s === settings.imageDefaultSize ? ' selected' : ''}>${s}</option>`
      ).join('');
      sizeSel.dataset.bound = '1';
    }
    renderImageModelPicker();
    renderImageSizePicker();
  }

  function renderImageModelPicker() {
    const select = $('#image-model-select');
    const btn = $('#image-model-picker-btn');
    const title = $('#image-model-picker-title');
    const pop = $('#image-model-picker-popover');
    if (!select || !btn || !pop) return;
    const selected = select.selectedOptions?.[0];
    if (title) title.textContent = selected && selected.value ? selected.textContent : '选择生图模型';
    btn.disabled = select.disabled;
    const groups = [];
    [...select.children].forEach((node) => {
      if (node.tagName === 'OPTGROUP') {
        const opts = [...node.children].filter((opt) => opt.value);
        if (opts.length) groups.push({ label: node.label, options: opts });
      }
    });
    pop.innerHTML = groups.length ? groups.map((group) => `
      <div class="image-picker-group">
        <div class="image-picker-group-title">${escapeHtml(group.label)}</div>
        ${group.options.map((opt) => `
          <button type="button" class="image-picker-option${opt.selected ? ' is-active' : ''}" data-image-model-value="${escapeAttr(opt.value)}" role="option" aria-selected="${opt.selected ? 'true' : 'false'}">
            <span>${escapeHtml(opt.textContent || '')}</span>
          </button>
        `).join('')}
      </div>
    `).join('') : '<div class="image-picker-empty">暂无生图模型</div>';
  }

  function renderImageSizePicker() {
    const select = $('#image-size-select');
    const btn = $('#image-size-picker-btn');
    const pop = $('#image-size-picker-popover');
    if (!select || !btn || !pop) return;
    btn.textContent = select.value || 'auto';
    pop.innerHTML = [...select.options].map((opt) => `
      <button type="button" class="image-size-option${opt.selected ? ' is-active' : ''}" data-image-size-value="${escapeAttr(opt.value)}" role="option" aria-selected="${opt.selected ? 'true' : 'false'}">
        ${escapeHtml(opt.textContent || opt.value)}
      </button>
    `).join('');
  }

  function closeImagePickers(except) {
    const model = $('#image-model-picker-popover');
    const modelBtn = $('#image-model-picker-btn');
    const size = $('#image-size-picker-popover');
    const sizeBtn = $('#image-size-picker-btn');
    if (except !== 'model' && model && modelBtn) {
      model.hidden = true;
      modelBtn.setAttribute('aria-expanded', 'false');
    }
    if (except !== 'size' && size && sizeBtn) {
      size.hidden = true;
      sizeBtn.setAttribute('aria-expanded', 'false');
    }
  }

  /* ---------- Canvas ---------- */

  function ensureCanvasState() {
    if (!canvasState && window.ImageCanvas) {
      canvasState = window.ImageCanvas.createState();
      const session = S()?.session;
      if (session?.imageCanvas) {
        window.ImageCanvas.restore(canvasState, session.imageCanvas);
      }
    }
    return canvasState;
  }

  async function hydrateCanvasImages() {
    const state = S();
    const session = state?.session;
    const cs = ensureCanvasState();
    if (!session?.id || !cs || !window.ImageCanvas) return;
    for (const it of cs.items) {
      if (!it.dataUrl && it.path) {
        it.dataUrl = await readBinaryDataUrl(session.id, it.path);
      }
    }
  }

  function renderCanvas() {
    const host = $('#image-canvas-host');
    if (!host || !window.ImageCanvas) return;
    const cs = ensureCanvasState();
    window.ImageCanvas.render(host, cs, {
      onSelect(it) {
        if (it?.path) setReferencePath(it.path);
        else clearReferenceSelection();
      },
      onSelectMany(items) {
        const paths = (items || []).map((it) => it?.path).filter(Boolean);
        if (paths.length) setReferencePaths(paths);
        else clearReferenceSelection();
      },
      onUseReference(it) {
        if (it) {
          addReferencePath(it.path);
          toast('已设为参考：' + it.path, 'ok');
        }
      },
      onUpload() {
        uploadImagesToCanvas().catch((err) => {
          toast(err?.message || String(err), 'err');
        });
      },
      referenceMode,
      onReferenceModeChange(mode) {
        setReferenceMode(mode);
      },
      onEditPrompt(it, prompt, mode) {
        if (!it?.path || !prompt) return;
        setReferencePath(it.path);
        setReferenceMode(mode);
        const input = $('#image-composer-input');
        if (input) input.value = '';
        sendImagePrompt(prompt);
      },
      onChange(st) {
        const session = S()?.session;
        if (session && session.mode === 'image') {
          session.imageCanvas = window.ImageCanvas.serialize(st);
          // soft persist later
        }
      },
    });
  }

  async function uploadImagesToCanvas() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.multiple = true;
    const picked = await new Promise((resolve) => {
      input.addEventListener('change', () => resolve(Array.from(input.files || [])), { once: true });
      input.click();
    });
    const files = (picked || []).filter((file) => /^image\/(png|jpe?g|webp|gif)$/i.test(file.type || ''));
    if (!files.length) return;
    const state = S();
    if (!state) return;
    if (!state.session || state.session.mode !== 'image') {
      state.session = createImageSession();
      state.sessions = state.sessions || [];
      state.sessions.unshift(state.session);
    }
    const session = state.session;
    const saved = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const dataUrl = await readFileAsDataUrl(file);
      const mime = (dataUrl.match(/^data:([^;]+)/) || [])[1] || file.type || 'image/png';
      const path = uploadImageFileName(file.name, i, mime);
      await writeBinary(session.id, path, dataUrl, mime);
      saved.push({
        path,
        mime,
        dataUrl,
        prompt: '',
        imageMeta: {
          mode: 'upload',
          source: 'canvas_upload',
          originalName: file.name || '',
        },
      });
    }
    const cs = ensureCanvasState();
    const added = window.ImageCanvas?.addItems?.(cs, saved) || [];
    const last = added[added.length - 1];
    if (last) {
      window.ImageCanvas.select(cs, last.id);
      setReferencePaths(saved.map((item) => item.path));
    }
    session.imageCanvas = window.ImageCanvas.serialize(cs);
    session.updatedAt = nowIso();
    await persistImageSessionLightweight(session);
    renderImageSessionList();
    renderCanvas();
    toast('已上传到画布', 'ok');
  }

  function addCanvasTaskPlaceholder(prompt) {
    const cs = ensureCanvasState();
    if (!cs || !window.ImageCanvas?.addPending) return '';
    const item = window.ImageCanvas.addPending(cs, {
      label: 'Generating',
      prompt: String(prompt || '').slice(0, 120),
    });
    pendingCanvasItemId = item.id;
    renderCanvas();
    return item.id;
  }

  function removeCanvasTaskPlaceholder(id) {
    const cs = ensureCanvasState();
    const targetId = id || pendingCanvasItemId;
    if (!cs || !targetId || !window.ImageCanvas?.removeById) return;
    window.ImageCanvas.removeById(cs, targetId);
    if (pendingCanvasItemId === targetId) pendingCanvasItemId = '';
  }

  async function placeOnCanvas(saved) {
    const cs = ensureCanvasState();
    if (!cs || !window.ImageCanvas) return;
    window.ImageCanvas.addItems(cs, (saved || []).map((s) => ({
      path: s.path,
      dataUrl: s.dataUrl,
    })));
    const session = S()?.session;
    if (session) session.imageCanvas = window.ImageCanvas.serialize(cs);
    renderCanvas();
  }

  async function focusImageOnCanvas(path) {
    const cs = ensureCanvasState();
    if (!cs || !window.ImageCanvas) return;
    let it = cs.items.find((x) => x.path === path);
    if (!it) {
      const state = S();
      const dataUrl = state?.session?.id
        ? await readBinaryDataUrl(state.session.id, path)
        : '';
      window.ImageCanvas.addItems(cs, [{ path, dataUrl }]);
      it = cs.items.find((x) => x.path === path);
    }
    if (it) {
      window.ImageCanvas.select(cs, it.id);
      setReferencePath(path);
    }
    renderCanvas();
  }

  /* ---------- Generate flow ---------- */

  async function sendImagePrompt(text) {
    const state = S();
    if (!state) return;
    if (generating) {
      toast('正在生成，请稍候', 'warn');
      return;
    }
    const prompt = String(text || '').trim();
    if (!prompt) return;
    const activeReferencePaths = getReferencePaths();
    const composerInput = $('#image-composer-input');
    if (composerInput) {
      composerInput.value = '';
      autoResizeImageInput(composerInput);
    }

    if (!state.session || state.session.mode !== 'image') {
      state.session = createImageSession();
      state.sessions = state.sessions || [];
      state.sessions.unshift(state.session);
    }
    const session = state.session;
    const sizeSel = $('#image-size-select');
    const size = sizeSel?.value || mergeImageSettings(state.settings).imageDefaultSize;

    const userMsg = {
      id: uid('message'),
      role: 'user',
      content: prompt,
      createdAt: nowIso(),
      referenceFiles: activeReferencePaths,
      imageReferenceMode: activeReferencePaths.length ? referenceMode : '',
    };
    const assistantMsg = {
      id: uid('message'),
      role: 'assistant',
      content: '',
      createdAt: nowIso(),
      status: 'running',
      statusText: '生成中…',
      images: [],
    };
    session.messages = session.messages || [];
    session.messages.push(userMsg, assistantMsg);
    if (!session.title) session.title = prompt.slice(0, 32);
    session.updatedAt = nowIso();
    renderImageTimeline();
    renderImageSessionList();

    generating = true;
    abortCtl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const canvasTaskId = addCanvasTaskPlaceholder(prompt);
    setComposerBusy(true);

    try {
      const result = await runImageRequest({
        prompt,
        size,
        referenceFiles: activeReferencePaths,
        referenceMode: activeReferencePaths.length ? referenceMode : 'generate',
        source: 'image_mode',
        signal: abortCtl?.signal,
        onStatus(info) {
          assistantMsg.statusText = info.message || info.code || '生成中…';
          renderImageTimeline();
        },
      });
      assistantMsg.status = 'done';
      assistantMsg.statusText = '';
      // Keep dataUrl for in-memory timeline; strip before disk persist
      assistantMsg.images = result.saved.map((s) => ({
        path: s.path,
        mime: s.mime,
        prompt: s.prompt,
        revisedPrompt: s.revisedPrompt || '',
        imageMeta: s.imageMeta,
        dataUrl: s.dataUrl,
      }));
      assistantMsg.content = result.saved.length
        ? '已生成 ' + result.saved.length + ' 张图片'
        : '未返回图片';
      assistantMsg.model = result.model;
      removeCanvasTaskPlaceholder(canvasTaskId);
      await placeOnCanvas(result.saved);
      await persistImageSessionLightweight(session);
      if (hooks.refreshSessionList) await hooks.refreshSessionList();
      renderImageSessionList();
      renderImageTimeline();
      toast('生成完成', 'ok');
    } catch (err) {
      if (err && /abort|停止|cancel/i.test(err.message || err.code || '')) {
        assistantMsg.status = 'error';
        assistantMsg.error = '已停止';
      } else {
        assistantMsg.status = 'error';
        assistantMsg.error = err && err.message ? err.message : String(err);
        toast(assistantMsg.error, 'err');
      }
      renderImageTimeline();
      removeCanvasTaskPlaceholder(canvasTaskId);
      renderCanvas();
      await persistImageSessionLightweight(session);
    } finally {
      generating = false;
      abortCtl = null;
      setComposerBusy(false);
    }
  }

  function setComposerBusy(busy) {
    const input = $('#image-composer-input');
    const send = $('#btn-image-send');
    const stop = $('#btn-image-stop');
    if (input) input.disabled = !!busy;
    if (send) send.hidden = !!busy;
    if (stop) stop.hidden = !busy;
  }

  function autoResizeImageInput(input) {
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = Math.min(120, Math.max(34, input.scrollHeight)) + 'px';
    input.style.overflowY = input.scrollHeight > 120 ? 'auto' : 'hidden';
  }

  function stopGenerate() {
    try { abortCtl?.abort(); } catch { /* ignore */ }
  }

  /* ---------- Settings page helpers ---------- */

  function fillImageSettingsPage() {
    const state = S();
    const settings = mergeImageSettings(state?.settings);
    const providers = state?.providers || [];
    const pSel = $('#img-set-provider');
    const mSel = $('#img-set-model');
    if (pSel) {
      pSel.innerHTML = '<option value="">自动</option>' +
        providers.map((p) =>
          `<option value="${escapeAttr(p.id)}"${p.id === settings.imageProviderId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
        ).join('');
    }
    const provider = providers.find((p) => p.id === (pSel?.value || settings.imageProviderId)) ||
      resolveImageProvider();
    const ids = imageModelIds(provider);
    if (mSel) {
      mSel.innerHTML = '<option value="">自动</option>' +
        ids.map((id) =>
          `<option value="${escapeAttr(id)}"${id === settings.imageModel ? ' selected' : ''}>${escapeHtml(id)}</option>`
        ).join('');
    }
    const editModel = $('#img-set-edit-model');
    if (editModel) {
      editModel.innerHTML = '<option value="">同生图模型</option>' +
        ids.map((id) =>
          `<option value="${escapeAttr(id)}"${id === settings.imageEditModel ? ' selected' : ''}>${escapeHtml(id)}</option>`
        ).join('');
    }
    const size = $('#img-set-size');
    if (size) {
      size.innerHTML = SIZE_OPTIONS.map((s) =>
        `<option value="${s}"${s === settings.imageDefaultSize ? ' selected' : ''}>${s}</option>`
      ).join('');
    }
    const quality = $('#img-set-quality');
    if (quality) {
      quality.innerHTML = QUALITY_OPTIONS.map((s) =>
        `<option value="${s}"${s === settings.imageQuality ? ' selected' : ''}>${s}</option>`
      ).join('');
    }
    const format = $('#img-set-format');
    if (format) {
      format.innerHTML = FORMAT_OPTIONS.map((s) =>
        `<option value="${s}"${s === settings.imageOutputFormat ? ' selected' : ''}>${s}</option>`
      ).join('');
    }
    const count = $('#img-set-count');
    if (count) count.value = String(settings.imageDefaultCount || 1);
    const apiMode = $('#img-set-api-mode');
    if (apiMode) apiMode.value = settings.imageApiMode || 'images';
    const ep = $('#img-set-endpoint');
    if (ep) ep.value = settings.imageEndpointPath || '';
    const editEp = $('#img-set-edit-endpoint');
    if (editEp) editEp.value = settings.imageEditEndpointPath || '';
    const style = $('#img-set-style');
    if (style) {
      style.innerHTML = '<option value="">无</option>' +
        (settings.imageStylePresets || []).map((p) =>
          `<option value="${escapeAttr(p.id)}"${p.id === settings.imageStylePresetId ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
        ).join('');
    }
  }

  function readImageSettingsFromPage() {
    return {
      imageProviderId: $('#img-set-provider')?.value || '',
      imageModel: $('#img-set-model')?.value || '',
      imageEditModel: $('#img-set-edit-model')?.value || '',
      imageDefaultSize: $('#img-set-size')?.value || 'auto',
      imageQuality: $('#img-set-quality')?.value || 'auto',
      imageOutputFormat: $('#img-set-format')?.value || 'png',
      imageDefaultCount: Math.max(1, Math.min(8, parseInt($('#img-set-count')?.value || '1', 10) || 1)),
      imageApiMode: $('#img-set-api-mode')?.value || 'images',
      imageEndpointPath: ($('#img-set-endpoint')?.value || '').trim(),
      imageEditEndpointPath: ($('#img-set-edit-endpoint')?.value || '').trim(),
      imageStylePresetId: $('#img-set-style')?.value || '',
    };
  }

  /* ---------- Enter / leave mode ---------- */

  async function enterImageMode() {
    const state = S();
    if (!state) return;
    // Prefer current image session or first image session
    if (!state.session || state.session.mode !== 'image') {
      const first = filterImageSessions(state.sessions)[0];
      if (first && hooks.loadSession) {
        await hooks.loadSession(first.id);
      } else if (state.session?.mode === 'image') {
        state.session = null;
      }
    }
    canvasState = null;
    if (state.session?.imageCanvas && window.ImageCanvas) {
      canvasState = window.ImageCanvas.createState();
      window.ImageCanvas.restore(canvasState, state.session.imageCanvas);
    }
    referencePaths = Array.isArray(state.session?.draft?.referencePaths)
      ? state.session.draft.referencePaths.map(normalizeReferencePath).filter(Boolean)
      : (state.session?.draft?.referencePath ? [normalizeReferencePath(state.session.draft.referencePath)] : []);
    referencePath = referencePaths[0] || '';
    referenceMode = state.session?.draft?.referenceMode === 'edit' ? 'edit' : 'reference';
    renderImageSessionList();
    renderImageComposerMeta();
    updateReferenceChip();
    await hydrateTimelineThumbs();
    renderImageTimeline();
    await hydrateCanvasImages();
    renderCanvas();
  }

  async function newImageSession() {
    const state = S();
    if (!state) return;
    const session = createImageSession();
    state.session = session;
    state.lastImageSessionId = session.id;
    state.sessions = state.sessions || [];
    state.sessions.unshift(session);
    canvasState = window.ImageCanvas ? window.ImageCanvas.createState() : null;
    referencePath = '';
    referencePaths = [];
    referenceMode = 'reference';
    if (hooks.persistSession) await hooks.persistSession(session);
    if (hooks.refreshSessionList) await hooks.refreshSessionList();
    renderImageSessionList();
    renderImageTimeline();
    renderImageComposerMeta();
    updateReferenceChip();
    renderCanvas();
    const input = $('#image-composer-input');
    if (input) {
      input.value = '';
      input.focus();
    }
  }

  async function openImageSession(id) {
    if (hooks.loadSession) await hooks.loadSession(id);
    canvasState = null;
    referencePaths = Array.isArray(S()?.session?.draft?.referencePaths)
      ? S().session.draft.referencePaths.map(normalizeReferencePath).filter(Boolean)
      : (S()?.session?.draft?.referencePath ? [normalizeReferencePath(S().session.draft.referencePath)] : []);
    referencePath = referencePaths[0] || '';
    referenceMode = S()?.session?.draft?.referenceMode === 'edit' ? 'edit' : 'reference';
    await enterImageMode();
  }

  function bindUi() {
    document.addEventListener('click', (e) => {
      const pill = e.target.closest?.('.img-pill');
      if (pill) {
        const p = pill.getAttribute('data-prompt') || '';
        const input = $('#image-composer-input');
        if (input) {
          input.value = p;
          autoResizeImageInput(input);
          input.focus();
        }
        return;
      }
      const openBtn = e.target.closest?.('[data-act="open-image-session"]');
      if (openBtn) {
        const li = openBtn.closest('[data-id]');
        if (li) openImageSession(li.getAttribute('data-id'));
        return;
      }
      const menuBtn = e.target.closest?.('[data-act="image-session-menu"]');
      if (menuBtn) {
        e.stopPropagation();
        const item = menuBtn.closest('[data-id]');
        const menu = item?.querySelector('.image-session-menu');
        const open = menu && !menu.hidden;
        closeImageSessionMenus();
        if (menu && !open) menu.hidden = false;
        return;
      }
      const sessionAct = e.target.closest?.('[data-image-session-act]');
      if (sessionAct) {
        e.stopPropagation();
        const item = sessionAct.closest('[data-id]');
        const id = item?.getAttribute('data-id');
        const act = sessionAct.getAttribute('data-image-session-act');
        closeImageSessionMenus();
        if (id) handleImageSessionAction(id, act);
        return;
      }
      const refRemove = e.target.closest?.('[data-ref-remove]')?.getAttribute('data-ref-remove');
      if (refRemove != null) {
        removeReferencePath(refRemove);
        return;
      }
      if (e.target.closest?.('#btn-image-ref-clear')) {
        clearReferenceSelection();
        return;
      }
      const refModeBtn = e.target.closest?.('[data-ref-mode]');
      if (refModeBtn) {
        setReferenceMode(refModeBtn.getAttribute('data-ref-mode'));
        return;
      }
      const modelValue = e.target.closest?.('[data-image-model-value]')?.getAttribute('data-image-model-value');
      if (modelValue != null) {
        const select = $('#image-model-select');
        if (select) {
          select.value = modelValue;
          select.dispatchEvent(new Event('change'));
        }
        closeImagePickers();
        return;
      }
      const sizeValue = e.target.closest?.('[data-image-size-value]')?.getAttribute('data-image-size-value');
      if (sizeValue != null) {
        const select = $('#image-size-select');
        if (select) {
          select.value = sizeValue;
          renderImageSizePicker();
        }
        closeImagePickers();
        return;
      }
      if (!e.target.closest?.('.image-model-picker-popover, .image-model-picker-btn, .image-size-picker-popover, .image-size-picker-btn')) {
        closeImagePickers();
        closeImageSessionMenus();
      }
    });

    const send = $('#btn-image-send');
    const stop = $('#btn-image-stop');
    const input = $('#image-composer-input');
    const modelPickerBtn = $('#image-model-picker-btn');
    const modelPickerPopover = $('#image-model-picker-popover');
    const sizePickerBtn = $('#image-size-picker-btn');
    const sizePickerPopover = $('#image-size-picker-popover');
    $('#image-session-search')?.addEventListener('input', (event) => {
      imageSessionSearchQuery = event.target.value || '';
      renderImageSessionList();
    });
    $('#image-model-select')?.addEventListener('change', async (event) => {
      const [providerId, model] = event.target.value.split('\n');
      const state = S();
      if (!providerId || !model || !state?.session || state.session.mode !== 'image') return;
      state.session.providerId = providerId;
      state.session.model = model;
      await persistImageSessionLightweight(state.session);
      renderImageComposerMeta();
      renderImageSessionList();
    });
    modelPickerBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      if (modelPickerBtn.disabled) return;
      const open = !!modelPickerPopover?.hidden;
      closeImagePickers(open ? 'model' : undefined);
      if (modelPickerPopover) modelPickerPopover.hidden = !open;
      modelPickerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    sizePickerBtn?.addEventListener('click', (event) => {
      event.stopPropagation();
      const open = !!sizePickerPopover?.hidden;
      closeImagePickers(open ? 'size' : undefined);
      if (sizePickerPopover) sizePickerPopover.hidden = !open;
      sizePickerBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    send?.addEventListener('click', () => sendImagePrompt(input?.value || ''));
    stop?.addEventListener('click', stopGenerate);
    autoResizeImageInput(input);
    input?.addEventListener('input', () => autoResizeImageInput(input));
    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendImagePrompt(input.value);
      }
    });
    $('#btn-new-image')?.addEventListener('click', () => {
      newImageSession();
    });
    $('#btn-new-image-compact')?.addEventListener('click', () => {
      newImageSession();
    });
  }

  async function handleImageSessionAction(id, action) {
    const state = S();
    const session = state?.sessions?.find((s) => s.id === id) || (state?.session?.id === id ? state.session : null);
    if (!session) return;
    try {
      if (action === 'rename') {
        const name = await window.UIDialog?.prompt?.('重命名会话', session.title || '未命名生图', '会话名称');
        if (!name) return;
        session.title = String(name).trim() || session.title;
        session.updatedAt = nowIso();
        await persistImageSessionLightweight(session);
      } else if (action === 'pin') {
        session.pinned = !session.pinned;
        session.updatedAt = nowIso();
        await persistImageSessionLightweight(session);
      } else if (action === 'copy') {
        if (state.session?.id === id) await persistImageSessionLightweight(state.session);
        const copied = await hooks.invoke('copy_session', { id });
        const normalized = copied && typeof copied === 'object' ? copied : null;
        if (normalized) {
          normalized.createdAt = nowIso();
          normalized.updatedAt = nowIso();
          normalized.title = (normalized.title || session.title || '未命名生图') + ' 副本';
          const saved = await hooks.invoke('save_session', { session: normalized });
          state.session = saved || normalized;
          state.sessions = [state.session].concat((state.sessions || []).filter((s) => s.id !== state.session.id));
          state.lastImageSessionId = state.session.id;
          canvasState = null;
          await enterImageMode();
        }
      } else if (action === 'delete') {
        const ok = await window.UIDialog?.confirm?.(
          `删除后无法恢复：\n${session.title || '未命名生图'}\n\n将删除会话消息及其工作区目录。`,
          '删除生图会话',
          { danger: true, okText: '删除' }
        );
        if (!ok) return;
        await hooks.invoke('delete_session', { id });
        state.sessions = (state.sessions || []).filter((s) => s.id !== id);
        if (state.session?.id === id) {
          state.session = null;
          canvasState = null;
          await enterImageMode();
        }
      }
      if (hooks.refreshSessionList) await hooks.refreshSessionList();
      renderImageSessionList();
      window.UIDialog?.toast?.('已更新');
    } catch (err) {
      toast(err?.message || String(err), 'err');
    }
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function escapeAttr(s) {
    return escapeHtml(s).replace(/'/g, '&#39;');
  }

  /** Chat-mode tool entry */
  async function imageGoTool(args, ctx) {
    const prompt = String(args.prompt || '').trim();
    if (!prompt) return '错误：缺少 prompt';
    const style = String(args.style || '').trim();
    const toolPrompt = style ? prompt + '\n\nStyle: ' + style : prompt;
    try {
      const result = await runImageRequest({
        prompt: toolPrompt,
        size: args.size,
        count: args.count,
        targetFile: args.targetFile,
        stylePresetId: args.stylePresetId,
        referenceFiles: args.referenceFiles || [],
        source: 'image_go',
        signal: ctx?.signal,
        onStatus: ctx?.onStatus,
      });
      const paths = result.saved.map((s) => s.path);
      if (ctx?.onImagesSaved) {
        try { ctx.onImagesSaved(result.saved); } catch { /* ignore */ }
      }
      return paths.length
        ? '已生成图片：\n' + paths.map((p) => '- ' + p).join('\n')
        : '图片接口未返回文件';
    } catch (e) {
      return '错误：' + (e && e.message ? e.message : String(e));
    }
  }

  window.ImageMode = {
    bind,
    bindUi,
    enterImageMode,
    newImageSession,
    openImageSession,
    renderImageSessionList,
    renderImageTimeline,
    renderImageComposerMeta,
    renderCanvas,
    fillImageSettingsPage,
    readImageSettingsFromPage,
    mergeImageSettings,
    defaultImageSettings,
    defaultStylePresets: DEFAULT_STYLE_PRESETS,
    filterImageSessions,
    filterChatSessions,
    isImageSession,
    createImageSession,
    runImageRequest,
    imageGoTool,
    resolveImageProvider,
    resolveImageModel,
    setReferencePath,
    getReferencePath: () => referencePath,
    getReferencePaths,
    SIZE_OPTIONS,
    QUALITY_OPTIONS,
    FORMAT_OPTIONS,
  };
})();
