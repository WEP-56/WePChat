/**
 * WePChat Windows — shell UI (M1)
 * Right pane: unified tabbed sidebar
 * Tabs: Browser, Files, Runner
 * + menu chooses kind
 * Resizable left & right sidebars
 */

import {
  $,
  $all,
  TOOL_PERM_KEYS,
  TOOL_PERM_LABELS,
  cloneJson,
  defaultSettings,
  invoke,
  normalizeToolMode,
  normalizeToolPermissions,
  nowIso,
  state,
  uid,
} from './app-core.js';
import { bindAppearanceEvents, renderThemeUI } from './appearance.js';
import { bindWindowControls } from './window-controls.js';
import {
  initChatView,
  renderChatView,
  scheduleStreamUpdate,
  getMessageElement,
} from './chat-view.js';
import * as ChatScroll from './chat-scroll.js';
import { initChatRail, updateChatRail } from './chat-rail.js';
import { initExternalAgentMode } from './external-agent-mode.js';

const LAST_SESSION_KEY = 'wepchat:last-active-session';
const MESSAGE_PAGE_LIMIT = 50;

function rememberedSessionId() {
  try { return localStorage.getItem(LAST_SESSION_KEY) || ''; }
  catch { return ''; }
}

function rememberActiveSession(session) {
  if (!session?.id) return;
  try { localStorage.setItem(LAST_SESSION_KEY, session.id); }
  catch { /* WebView storage unavailable: keep the in-memory session */ }
  state.filesTree = null;
  state.filesSelectedPath = '';
}

/* ---------- App shell ---------- */

function setMode(mode) {
  state.mode = mode;
  if (mode === 'chat' && state.session?.mode === 'image') {
    const target = state.sessions.find((item) => item.id === state.lastChatSessionId && item.mode !== 'image')
      || state.sessions.find((item) => item.mode !== 'image');
    if (target && target.id !== state.session.id) {
      openSession(target.id).catch((err) => console.warn('restore chat session', err));
      return;
    }
    if (!target) {
      state.session = createSession();
      state.pendingAttachments = [];
      rememberActiveSession(state.session);
      state.lastChatSessionId = state.session.id;
      persistSession().catch((err) => console.warn('create chat session', err));
    }
  }
  $all('.rail-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === mode);
  });
  $all('.list-panel').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.panel === mode);
  });
  $all('.main-view').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.view === mode);
  });
  renderSessions();
  if (window.ImageMode) window.ImageMode.renderImageSessionList();
  if (mode === 'image') {
    // Image mode owns its canvas inside the main studio; the right pane remains for chat/files/browser.
    setRightOpen(false);
    if (window.ImageMode) {
      window.ImageMode.enterImageMode().catch((err) => console.warn('enterImageMode', err));
    }
  } else if (mode !== 'chat') {
    setRightOpen(false);
  } else {
    // Chat mode: close sidebar and reset tabs so it refreshes properly on session switch
    setRightOpen(false);
    state.rightTabs = [];
    renderRightPane();
  }
}

function showImageCanvasPane() {
  setRightOpen(true);
  // Prefer a single canvas tab for image mode
  let tab = state.rightTabs.find((t) => t.kind === 'canvas');
  if (!tab) {
    tab = { id: uid('r'), kind: 'canvas', title: '画布' };
    state.rightTabs = [tab];
  }
  state.activeRightTabId = tab.id;
  renderRightTabs();
  renderRightContent();
}

function setSettingsPage(page) {
  state.settingsPage = page;
  $all('.settings-nav-item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.settings === page);
  });
  $all('.settings-page').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.settingsPage === page);
  });
  if (page === 'image' && window.ImageMode) {
    window.ImageMode.fillImageSettingsPage();
  }
}

function setRightOpen(open) {
  state.rightOpen = open;
  const pane = $('#right-pane');
  const handle = $('#resize-right');
  if (pane) pane.hidden = !open;
  if (handle) handle.hidden = !open;
  const btn = $('#btn-toggle-workspace');
  if (btn) {
    btn.classList.toggle('is-active', open);
    btn.setAttribute('aria-pressed', open ? 'true' : 'false');
    btn.title = open ? '收起侧栏' : '打开侧栏';
  }
  if (open) renderRightPane();
}

function setListCollapsed(collapsed) {
  state.listCollapsed = collapsed;
  const body = $('#app-body');
  const btn = $('#btn-toggle-list');
  if (body) body.classList.toggle('is-list-collapsed', collapsed);
  if (btn) {
    btn.classList.toggle('is-active', collapsed);
    btn.setAttribute('aria-pressed', collapsed ? 'true' : 'false');
    btn.title = collapsed ? '展开左侧列表' : '收起左侧列表';
  }
}

function setMaximizedUi(maximized) {
  state.maximized = maximized;
  const maxIcon = $('.win-max-icon');
  const restoreIcon = $('.win-restore-icon');
  const btn = $('#win-max');
  if (maxIcon) maxIcon.hidden = maximized;
  if (restoreIcon) restoreIcon.hidden = !maximized;
  if (btn) btn.title = maximized ? '还原' : '最大化';
}

/* ---------- 供应商草稿（对话框内编辑） ---------- */
let providerDraft = null;
let providerIsNew = false;
let modelTests = {};
let modelTestMessages = {};
let modelEditor = null;

function normalizeProvider(raw = {}) {
  const api = ['openai-chat', 'openai-responses', 'anthropic', 'openai-completions'].includes(raw.api)
    ? raw.api
    : 'openai-chat';
  const models = Array.isArray(raw.models)
    ? raw.models.map((model) => String(model || '').trim()).filter(Boolean)
    : String(raw.models || '').split(/\r?\n/).map((model) => model.trim()).filter(Boolean);
  const imageModels = Array.isArray(raw.imageModels)
    ? raw.imageModels.map((model) => String(model || '').trim()).filter(Boolean)
    : [];
  const base = {
    id: String(raw.id || uid('provider')),
    name: String(raw.name || '未命名供应商').trim() || '未命名供应商',
    api,
    baseUrl: String(raw.baseUrl || '').trim(),
    apiKey: String(raw.apiKey || '').trim(),
    models: [...new Set(models)],
    imageModels: [...new Set(imageModels)],
    modelMeta: raw.modelMeta && typeof raw.modelMeta === 'object' ? cloneJson(raw.modelMeta) : {},
    imageModelMeta: raw.imageModelMeta && typeof raw.imageModelMeta === 'object' ? cloneJson(raw.imageModelMeta) : {},
    extraHeaders: Array.isArray(raw.extraHeaders) ? cloneJson(raw.extraHeaders) : [],
    imageBaseUrl: String(raw.imageBaseUrl || '').trim(),
    imageApiKey: String(raw.imageApiKey || '').trim(),
    imageEndpointPath: String(raw.imageEndpointPath || '').trim(),
    imageEditEndpointPath: String(raw.imageEditEndpointPath || '').trim(),
  };
  if (window.MODEL_META && typeof MODEL_META.normalizeProvider === 'function') {
    return MODEL_META.normalizeProvider(base);
  }
  return base;
}

function providerApiLabel(api) {
  const found = window.API?.API_TYPES?.find((item) => item.value === api);
  if (found) return found.label;
  return {
    'openai-chat': 'Chat Completions',
    'openai-responses': 'OpenAI Responses',
    anthropic: 'Anthropic Messages',
    'openai-completions': 'Completions',
  }[api] || api || '接口';
}

function providerModelIds(provider) {
  if (!provider) return [];
  return (provider.models || [])
    .concat(provider.imageModels || [])
    .filter((id, index, arr) => id && arr.indexOf(id) === index);
}

function isProviderImageModel(provider, id) {
  return !!(provider && (provider.imageModels || []).includes(id));
}

function modelMetaOf(provider, id) {
  if (window.MODEL_META && typeof MODEL_META.get === 'function') {
    return MODEL_META.get(provider, id);
  }
  return { id, contextWindow: 128000, maxOutputTokens: 8192, capabilities: {} };
}

function modelSummary(provider, id) {
  const meta = modelMetaOf(provider, id);
  const ctx = window.MODEL_META ? MODEL_META.fmtTokens(meta.contextWindow) : String(meta.contextWindow || '');
  const caps = window.MODEL_META ? MODEL_META.capLabels(meta).join(' · ') : '文本';
  return `${ctx} 上下文 · ${caps}`;
}

function ensureSessionContext(session, provider, model) {
  if (!session || !provider || !model) return null;
  if (!session.contextWindow || !session.contextModel) {
    const meta = modelMetaOf(provider, model);
    session.contextProviderId = provider.id || '';
    session.contextModel = model;
    session.contextWindow = Number(meta.contextWindow || 128000);
    session.contextVision = meta.capabilities?.vision !== false;
  }
  return {
    contextWindow: Number(session.contextWindow || 128000),
    contextModel: session.contextModel || model,
    contextVision: session.contextVision !== false,
  };
}

function estimateContextUsage(session, inputText = '') {
  if (!session?.model || !window.MODEL_META) return { used: 0, limit: 0, ratio: 0 };
  const provider = state.providers.find((item) => item.id === (session.contextProviderId || session.providerId));
  const context = ensureSessionContext(session, provider, session.model);
  const estimate = MODEL_META.estimateTokens || ((text) => Math.ceil(String(text || '').length / 4));
  let used = estimate(state.settings?.systemPrompt || '');
  for (const message of session.messages || []) {
    used += estimate(message.content || '');
    if (message.reasoning) used += estimate(message.reasoning);
    const attachments = message.attachments || message.referenceFiles || [];
    if (Array.isArray(attachments)) used += attachments.length * 256;
  }
  used += estimate(inputText || '');
  for (const attachment of state.pendingAttachments || []) {
    used += attachment.kind === 'text' && attachment.content ? estimate(attachment.content) : 256;
  }
  const limit = Math.max(1, Number(context?.contextWindow || 128000));
  return { used, limit, ratio: Math.min(1, used / limit), context };
}

function renderTokenMeter() {
  const meter = $('#token-meter');
  if (!meter) return;
  const visible = state.mode === 'chat' && state.session?.mode === 'chat';
  meter.hidden = !visible;
  if (!visible) return;
  if (!state.session?.model) {
    meter.style.setProperty('--token-progress', '0');
    meter.classList.remove('is-warning', 'is-danger');
    meter.title = '请选择对话模型';
    meter.setAttribute('aria-label', '请选择对话模型');
    const emptyDetail = $('#token-meter-detail');
    if (emptyDetail) emptyDetail.textContent = '请选择对话模型';
    return;
  }
  const usage = estimateContextUsage(state.session, $('#composer-input')?.value || '');
  const percent = Math.round(usage.ratio * 100);
  meter.style.setProperty('--token-progress', String(percent));
  meter.classList.toggle('is-warning', percent >= 85);
  meter.classList.toggle('is-danger', percent >= 95);
  const label = `${MODEL_META.fmtTokens(usage.used)} / ${MODEL_META.fmtTokens(usage.limit)} tokens · ${percent}%`;
  meter.title = label;
  meter.setAttribute('aria-label', label);
  const detail = $('#token-meter-detail');
  if (detail) detail.textContent = `${label}（${usage.context?.contextModel || state.session.model}）`;
  const level = percent >= 95 ? 'danger' : (percent >= 85 ? 'warning' : 'normal');
  const previous = state.contextWarnings.get(state.session.id) || 'normal';
  if (level !== previous && (level === 'warning' || level === 'danger')) {
    UIDialog.toast(level === 'danger'
      ? '上下文即将达到上限，请开启新会话继续。'
      : '上下文已使用 85%，建议开启新会话以避免达到上限。', 4200);
  }
  state.contextWarnings.set(state.session.id, level);
}

function readProviderBasicsIntoDraft() {
  if (!providerDraft) return;
  providerDraft.name = ($('#provider-name')?.value || '').trim() || '未命名供应商';
  providerDraft.api = $('#provider-api')?.value || 'openai-chat';
  providerDraft.baseUrl = ($('#provider-base-url')?.value || '').trim();
  providerDraft.apiKey = ($('#provider-api-key')?.value || '').trim();
  providerDraft.imageBaseUrl = ($('#provider-image-base-url')?.value || '').trim();
  providerDraft.imageApiKey = ($('#provider-image-api-key')?.value || '').trim();
  providerDraft.imageEndpointPath = ($('#provider-image-endpoint')?.value || '').trim();
}

function setProviderStatus(text, kind) {
  const status = $('#provider-form-status');
  if (!status) return;
  status.textContent = text || '';
  status.classList.remove('is-ok', 'is-err', 'is-busy');
  if (kind) status.classList.add(kind);
}

function setProviderNetStatus(info) {
  const el = $('#provider-net-status');
  if (!el) return;
  if (!info) {
    el.hidden = true;
    el.textContent = '';
    return;
  }
  el.hidden = false;
  if (info.state === 'retrying') {
    el.textContent = `连接不稳定 · 第 ${info.attempt || 1} 次重试${info.delay ? `（${Math.round(info.delay / 1000)}s）` : ''} · ${info.message || info.code || ''}`;
    el.className = 'field-status is-net is-busy';
  } else if (info.state === 'recovered') {
    el.textContent = '连接已恢复';
    el.className = 'field-status is-net is-ok';
  } else {
    el.textContent = info.message || info.code || '';
    el.className = 'field-status is-net';
  }
}

function currentProvider() {
  const sessionProviderId = state.session?.providerId || '';
  return state.providers.find((provider) => provider.id === sessionProviderId) || null;
}

function createSession() {
  return {
    id: uid('session'),
    title: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    mode: 'chat',
    providerId: '',
    model: '',
    contextModel: '',
    contextProviderId: '',
    contextWindow: 0,
    contextVision: true,
    messages: [],
    workspacePath: '',
    pinned: false,
  };
}

function normalizeMessage(raw) {
  const m = raw && typeof raw === 'object' ? { ...raw } : {};
  m.id = String(m.id || uid('message'));
  m.role = m.role === 'assistant' ? 'assistant' : (m.role === 'tool' ? 'tool' : 'user');
  m.content = String(m.content || '');
  m.createdAt = m.createdAt || nowIso();
  if (m.role === 'assistant') {
    m.reasoning = String(m.reasoning || '');
    m.status = m.status || 'done';
    m.error = String(m.error || '');
    m.model = m.model || '';
    m.durationMs = Number(m.durationMs || 0);
    m.toolCalls = Array.isArray(m.toolCalls) ? m.toolCalls : [];
    m.images = Array.isArray(m.images) ? m.images : [];
    m.images.forEach((image) => {
      if (!image || typeof image !== 'object') return;
      image.path = String(image.path || '');
      image.mime = String(image.mime || 'image/png');
    });
    m.variantBaseId = m.variantBaseId || (m.id + ':v1');
    m.variants = Array.isArray(m.variants) ? m.variants.slice(0, 6) : [];
    m.variants.forEach((v, idx) => {
      v.id = v.id || (idx === 0 ? m.variantBaseId : uid('variant'));
      v.content = String(v.content || '');
      v.reasoning = String(v.reasoning || '');
      v.error = String(v.error || '');
      v.model = v.model || '';
      v.toolCalls = Array.isArray(v.toolCalls) ? v.toolCalls : [];
      v.status = v.status === 'streaming' ? 'done' : (v.status || 'done');
      v.durationMs = Number(v.durationMs || 0);
    });
    m.activeVariantIndex = m.variants.length
      ? Math.max(0, Math.min(m.variants.length - 1, parseInt(m.activeVariantIndex || 0, 10) || 0))
      : 0;
  } else if (m.role === 'user') {
    m.parentAssistantId = m.parentAssistantId || '';
    m.parentVariantId = m.parentVariantId || '';
    m.attachments = Array.isArray(m.attachments) ? m.attachments.map((att) => {
      const a = att && typeof att === 'object' ? { ...att } : {};
      a.id = String(a.id || uid('att'));
      a.kind = ['image', 'text', 'file'].includes(a.kind) ? a.kind : attachmentKindFor(a.name || a.path, a.mime || '');
      a.name = String(a.name || a.path || 'file');
      a.path = String(a.path || '');
      a.mime = String(a.mime || '');
      a.size = Number(a.size || 0);
      a.source = a.source === 'workspace' ? 'workspace' : 'upload';
      if (a.content != null) a.content = String(a.content);
      if (a.dataUrl != null) a.dataUrl = String(a.dataUrl);
      return a;
    }) : [];
    m.referenceFiles = Array.isArray(m.referenceFiles) ? m.referenceFiles : [];
  }
  return m;
}

function normalizeSession(raw) {
  const base = createSession();
  const session = raw && typeof raw === 'object' ? raw : {};
  const mode = session.mode === 'image' ? 'image' : 'chat';
  const out = {
    ...base,
    ...session,
    id: String(session.id || base.id).replace(/[^A-Za-z0-9_-]/g, '_'),
    mode,
    messages: Array.isArray(session.messages) ? session.messages.map(normalizeMessage) : [],
    workspacePath: String(session.workspacePath || ''),
    pinned: !!session.pinned,
    contextModel: String(session.contextModel || ''),
    contextProviderId: String(session.contextProviderId || ''),
    contextWindow: Number(session.contextWindow || 0),
    contextVision: session.contextVision !== false,
    imageCanvas: session.imageCanvas && typeof session.imageCanvas === 'object' ? session.imageCanvas : null,
  };
  let previousAssistant = null;
  out.messages.forEach((m) => {
    if (m.role === 'assistant') previousAssistant = m;
    else if (m.role === 'user' && previousAssistant && !m.parentAssistantId) {
      m.parentAssistantId = previousAssistant.id;
      const active = previousAssistant.variants?.[previousAssistant.activeVariantIndex || 0];
      m.parentVariantId = active?.id || previousAssistant.variantBaseId || '';
    }
  });
  return out;
}

/* ---------- Chat attachments: every external file first becomes a workspace file ---------- */

const WORKSPACE_DRAG_MIME = 'application/x-wepchat-workspace-path';
const ATTACHMENT_UPLOAD_DIR = 'attachments';
const MAX_TEXT_UPLOAD_BYTES = 512 * 1024;
let attachmentUploadSeq = 0;
let draggingWorkspacePath = '';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'ico', 'tif', 'tiff', 'heic', 'heif']);
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'csv', 'json', 'jsonl', 'html', 'htm', 'css', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
  'py', 'rs', 'go', 'java', 'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'swift', 'kt', 'kts',
  'toml', 'yaml', 'yml', 'xml', 'sql', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'ini', 'env', 'log',
]);

function fileExt(name = '') {
  const m = /\.([^.\/\\]+)$/.exec(String(name || '').toLowerCase());
  return m ? m[1] : '';
}

function fileIconLabel(name = '', mime = '') {
  const ext = fileExt(name);
  if (String(mime || '').startsWith('image/') || IMAGE_EXTS.has(ext)) return 'IMG';
  return ({
    js: 'JS', mjs: 'JS', cjs: 'JS', ts: 'TS', tsx: 'TSX', jsx: 'JSX',
    py: 'PY', rs: 'RS', go: 'GO', java: 'JAVA', c: 'C', cc: 'C++', cpp: 'C++',
    h: 'H', hpp: 'H++', cs: 'CS', php: 'PHP', rb: 'RB', swift: 'SW', kt: 'KT',
    md: 'MD', markdown: 'MD', json: 'JSON', jsonl: 'JSON', html: 'HTML', htm: 'HTML',
    css: 'CSS', toml: 'TOML', yaml: 'YAML', yml: 'YAML', xml: 'XML', csv: 'CSV',
    sql: 'SQL', sh: 'SH', ps1: 'PS1', bat: 'BAT', cmd: 'CMD', txt: 'TXT', log: 'LOG',
  })[ext] || 'FILE';
}

function treeIconClass(name = '', mime = '') {
  const ext = fileExt(name);
  if (isImageNameOrMime(name, mime)) return 'is-img';
  if (ext === 'json' || ext === 'jsonl') return 'is-json';
  if (ext === 'html' || ext === 'htm') return 'is-html';
  if (ext === 'md' || ext === 'markdown') return 'is-md';
  if (['js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx'].includes(ext)) return 'is-js';
  return '';
}

function isImageNameOrMime(name = '', mime = '') {
  return String(mime || '').startsWith('image/') || IMAGE_EXTS.has(fileExt(name));
}

function isTextNameOrMime(name = '', mime = '') {
  const type = String(mime || '').toLowerCase();
  return type.startsWith('text/')
    || ['application/json', 'application/xml', 'application/yaml', 'application/toml', 'application/javascript'].includes(type)
    || TEXT_EXTS.has(fileExt(name));
}

function attachmentKindFor(name = '', mime = '') {
  if (isImageNameOrMime(name, mime)) return 'image';
  if (isTextNameOrMime(name, mime)) return 'text';
  return 'file';
}

function sanitizeUploadName(name = '') {
  const raw = String(name || 'file').trim() || 'file';
  let clean = raw.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_').replace(/^\.+$/, 'file').slice(0, 96);
  if (/^session\.json(?:\.tmp)?$/i.test(clean)) clean = `upload_${clean}`;
  return clean || 'file';
}

function uploadPathForFile(file) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = [
    d.getFullYear(), pad(d.getMonth() + 1), pad(d.getDate()), '_',
    pad(d.getHours()), pad(d.getMinutes()), pad(d.getSeconds()),
  ].join('');
  attachmentUploadSeq += 1;
  return `${ATTACHMENT_UPLOAD_DIR}/${stamp}_${attachmentUploadSeq}_${sanitizeUploadName(file?.name)}`;
}

function dataUrlBase64(dataUrl) {
  const m = /^data:[^;]*;base64,(.*)$/s.exec(String(dataUrl || ''));
  return m ? m[1] : '';
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.onload = () => resolve(String(reader.result || ''));
    reader.readAsDataURL(file);
  });
}

function cloneAttachmentForDisk(att) {
  if (!att || typeof att !== 'object') return null;
  return {
    id: String(att.id || uid('att')),
    kind: ['image', 'text', 'file'].includes(att.kind) ? att.kind : 'file',
    name: String(att.name || att.path || 'file'),
    path: String(att.path || ''),
    mime: String(att.mime || ''),
    size: Number(att.size || 0),
    source: att.source === 'workspace' ? 'workspace' : 'upload',
  };
}

function attachmentRenderTitle(att) {
  return [att?.name || att?.path || 'file', att?.path].filter(Boolean).join('\n');
}

function renderAttachmentChip(att, opts = {}) {
  const chip = document.createElement('div');
  chip.className = 'attachment-chip' + (att.kind === 'image' ? ' is-image' : ' is-file');
  chip.title = attachmentRenderTitle(att);
  const preview = document.createElement('div');
  preview.className = 'attachment-preview';
  if (att.kind === 'image' && att.dataUrl) {
    const img = document.createElement('img');
    img.src = att.dataUrl;
    img.alt = att.name || att.path || 'image';
    preview.appendChild(img);
  } else {
    preview.textContent = fileIconLabel(att.name || att.path, att.mime);
  }
  const meta = document.createElement('div');
  meta.className = 'attachment-meta';
  const name = document.createElement('div');
  name.className = 'attachment-name';
  name.textContent = att.name || att.path || 'file';
  const sub = document.createElement('div');
  sub.className = 'attachment-path';
  sub.textContent = att.path || (att.size ? U.fmtSize(att.size) : '');
  meta.append(name, sub);
  chip.append(preview, meta);
  if (opts.onRemove) {
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'attachment-remove';
    remove.title = '移除附件';
    remove.textContent = '×';
    remove.addEventListener('click', (event) => {
      event.stopPropagation();
      opts.onRemove(att);
    });
    chip.appendChild(remove);
  }
  if (opts.onOpen && att.path) {
    chip.classList.add('is-clickable');
    chip.addEventListener('click', () => opts.onOpen(att));
  }
  return chip;
}

function renderPendingAttachments() {
  const row = $('#composer-attachments');
  if (!row) return;
  row.innerHTML = '';
  const attachments = state.pendingAttachments || [];
  row.hidden = !attachments.length;
  attachments.forEach((att) => {
    row.appendChild(renderAttachmentChip(att, {
      onRemove(removeAtt) {
        state.pendingAttachments = state.pendingAttachments.filter((item) => item.id !== removeAtt.id);
        renderPendingAttachments();
        renderComposerState();
      },
      onOpen(openAtt) {
        if (openAtt.path) openFileInViewer(openAtt.path);
      },
    }));
  });
}

async function writeUploadToWorkspace(file, { attach = true } = {}) {
  if (!state.session?.id) throw new Error('缺少当前会话');
  const name = sanitizeUploadName(file?.name || 'file');
  const mime = String(file?.type || '');
  let kind = attachmentKindFor(name, mime);
  let content = '';
  let dataUrl = '';
  let encoding = 'utf8';
  let payload = '';

  if (kind === 'text' && Number(file.size || 0) <= MAX_TEXT_UPLOAD_BYTES) {
    content = await file.text();
    payload = content;
  } else {
    if (kind === 'text') kind = 'file';
    dataUrl = await readFileAsDataUrl(file);
    payload = dataUrlBase64(dataUrl);
    encoding = 'base64';
  }

  const path = uploadPathForFile({ name });
  const res = await invoke('ws_write', {
    args: { sessionId: state.session.id, path, content: payload, mime: mime || null, encoding },
  });
  if (res && typeof res === 'object' && res.ok === false) {
    throw new Error(String(res.content || '写入工作区失败'));
  }
  const att = {
    id: uid('att'),
    kind,
    name,
    path,
    mime: mime || (kind === 'text' ? 'text/plain' : ''),
    size: Number(file.size || 0),
    source: 'upload',
  };
  if (attach && kind === 'text') att.content = content;
  if (attach && kind === 'image') att.dataUrl = dataUrl;
  return att;
}

async function importFilesToWorkspace(fileList, { attach = true } = {}) {
  const files = Array.from(fileList || []).filter(Boolean);
  if (!files.length) return [];
  if (!state.session?.id) {
    UIDialog.toast('请先创建或打开一个会话');
    return [];
  }
  const imported = [];
  for (const file of files) {
    try {
      const att = await writeUploadToWorkspace(file, { attach });
      imported.push(att);
    } catch (err) {
      UIDialog.toast(`${file?.name || '文件'} 上传失败：${err?.message || err}`, 4200);
    }
  }
  if (imported.length) {
    if (attach) {
      state.pendingAttachments.push(...imported);
      renderPendingAttachments();
      renderComposerState();
    }
    await refreshFilesTree();
    if (attach) UIDialog.toast(`已加入 ${imported.length} 个附件`);
    else UIDialog.toast(`已上传 ${imported.length} 个文件到工作区`);
  }
  return imported;
}

function parseWsExists(res) {
  try {
    const value = JSON.parse(String(res?.content || '{}'));
    return value && typeof value === 'object' ? value : null;
  } catch {
    return null;
  }
}

async function hydrateAttachment(att, sessionId = state.session?.id) {
  if (!att?.path || !sessionId) return att;
  try {
    if (att.kind === 'image' && !att.dataUrl) {
      const res = await invoke('ws_read_bytes', { args: { sessionId, path: att.path } });
      if (res?.contentBase64) {
        const mime = String(res.mime || '').startsWith('image/') ? res.mime : (att.mime || 'image/png');
        att.mime = mime;
        att.size = Number(res.size || att.size || 0);
        att.dataUrl = `data:${mime};base64,${res.contentBase64}`;
      }
    } else if (att.kind === 'text' && !att.content) {
      const res = await invoke('ws_read', { args: { sessionId, path: att.path } });
      const text = typeof res === 'string' ? res : String(res?.content || '');
      if (text && !text.startsWith('错误：')) att.content = text;
    }
  } catch {
    /* Keep path-only attachments usable. */
  }
  return att;
}

async function addWorkspacePathToComposer(path) {
  const rel = String(path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
  if (!rel || !state.session?.id) return;
  try {
    const exists = parseWsExists(await invoke('ws_exists', { args: { sessionId: state.session.id, path: rel } }));
    if (!exists?.exists || exists.type !== 'file') {
      UIDialog.toast('只能引用工作区文件');
      return;
    }
    const kind = attachmentKindFor(rel, exists.mime || '');
    const att = {
      id: uid('att'),
      kind,
      name: rel.split('/').pop() || rel,
      path: rel,
      mime: exists.mime || '',
      size: Number(exists.size || 0),
      source: 'workspace',
    };
    await hydrateAttachment(att, state.session.id);
    state.pendingAttachments.push(att);
    renderPendingAttachments();
    renderComposerState();
  } catch (err) {
    UIDialog.toast('引用文件失败：' + (err?.message || err), 3600);
  }
}

function currentModelHasVision() {
  const session = state.session;
  const provider = activeSessionProvider();
  const model = session?.model || '';
  if (!session || !provider || !model) return true;
  const meta = modelMetaOf(provider, model);
  return session.contextVision !== false && meta.capabilities?.vision !== false;
}

function snapshotAssistantVariant(m, id) {
  return {
    id: id || uid('variant'),
    content: String(m?.content || ''),
    reasoning: String(m?.reasoning || ''),
    toolCalls: cloneJson(Array.isArray(m?.toolCalls) ? m.toolCalls : []),
    error: String(m?.error || ''),
    usage: m?.usage ? cloneJson(m.usage) : null,
    model: m?.model || '',
    createdAt: m?.createdAt || nowIso(),
    durationMs: Number(m?.durationMs || 0),
    status: m?.status === 'streaming' ? 'streaming' : (m?.status || 'done'),
  };
}

function ensureAssistantVariants(m) {
  if (!m || m.role !== 'assistant') return [];
  m.variantBaseId = m.variantBaseId || (m.id + ':v1');
  if (!Array.isArray(m.variants) || !m.variants.length) {
    m.variants = [snapshotAssistantVariant(m, m.variantBaseId)];
    m.activeVariantIndex = 0;
  }
  return m.variants;
}

function activeAssistantVariantId(m) {
  if (!m) return '';
  const variants = Array.isArray(m.variants) ? m.variants : [];
  const active = variants[m.activeVariantIndex || 0];
  return active?.id || m.variantBaseId || (m.id + ':v1');
}

function syncActiveAssistantVariant(m) {
  const variants = Array.isArray(m?.variants) ? m.variants : [];
  const active = variants[m.activeVariantIndex || 0];
  if (!active) return;
  const fresh = snapshotAssistantVariant(m, active.id);
  Object.keys(fresh).forEach((k) => { active[k] = fresh[k]; });
}

function applyAssistantVariant(m, index) {
  const variants = Array.isArray(m?.variants) ? m.variants : [];
  if (!variants.length) return;
  const idx = Math.max(0, Math.min(variants.length - 1, Number(index) || 0));
  const v = variants[idx];
  m.activeVariantIndex = idx;
  m.content = v.content || '';
  m.reasoning = v.reasoning || '';
  m.toolCalls = cloneJson(Array.isArray(v.toolCalls) ? v.toolCalls : []);
  m.error = v.error || '';
  m.usage = v.usage ? cloneJson(v.usage) : null;
  m.model = v.model || m.model || '';
  m.createdAt = v.createdAt || m.createdAt;
  m.durationMs = Number(v.durationMs || 0);
  m.status = v.status === 'streaming' ? 'done' : (v.status || 'done');
}

function isBranchBlocked() {
  const messages = state.session?.messages || [];
  const assistants = new Map(messages.filter((m) => m.role === 'assistant').map((m) => [m.id, m]));
  return messages.some((m) => {
    if (m.role !== 'user' || !m.parentAssistantId || !m.parentVariantId) return false;
    const parent = assistants.get(m.parentAssistantId);
    if (!parent) return false;
    const activeId = activeAssistantVariantId(parent);
    return activeId !== m.parentVariantId;
  });
}

function canRegenerateMessage(index) {
  const messages = state.session?.messages || [];
  const m = messages[index];
  if (!m || m.role !== 'assistant' || state.generating) return false;
  const later = messages.slice(index + 1).some((x) => x.role === 'user' || x.role === 'assistant');
  const count = Array.isArray(m.variants) && m.variants.length ? m.variants.length : 1;
  return !later && count < 6;
}

function activeSessionProvider() {
  if (state.session?.mode !== 'chat' || !state.session.model) return null;
  const provider = currentProvider();
  return provider?.models?.includes(state.session.model) ? provider : null;
}

async function persistSettings() {
  const prev = state.settings || {};
  state.settings = {
    ...defaultSettings(),
    ...prev,
    providers: state.providers,
    systemPrompt: prev.systemPrompt ?? '',
    temperature: prev.temperature ?? null,
    maxTokens: prev.maxTokens ?? null,
    agentEnabled: prev.agentEnabled !== false,
    maxToolRounds: prev.maxToolRounds ?? 8,
    maxToolCalls: prev.maxToolCalls ?? 24,
    toolPermissions: normalizeToolPermissions(prev.toolPermissions),
  };
  try {
    const saved = await invoke('save_settings', { settings: state.settings });
    state.settings = {
      ...defaultSettings(),
      ...(saved || {}),
      providers: state.providers,
      toolPermissions: normalizeToolPermissions(saved?.toolPermissions || state.settings.toolPermissions),
    };
  } catch (err) {
    console.warn('Unable to save settings:', err);
  }
}

function renderProviders() {
  const host = $('#provider-list');
  const empty = $('#provider-empty');
  if (!host || !empty) return;
  host.innerHTML = '';
  host.hidden = state.providers.length === 0;
  empty.hidden = state.providers.length > 0;

  state.providers.forEach((provider) => {
    const item = document.createElement('article');
    item.className = 'provider-item';

    const info = document.createElement('div');
    info.className = 'provider-info';
    const name = document.createElement('strong');
    name.textContent = provider.name;
    const meta = document.createElement('span');
    const total = providerModelIds(provider).length;
    const first = provider.models[0] || provider.imageModels?.[0] || '';
    const firstSummary = first ? modelSummary(provider, first) : '';
    meta.textContent = firstSummary
      ? `${providerApiLabel(provider.api)} · ${total} 个模型 · ${firstSummary}`
      : `${providerApiLabel(provider.api)} · ${total} 个模型`;
    info.append(name, meta);

    const actions = document.createElement('div');
    actions.className = 'provider-actions';
    const edit = document.createElement('button');
    edit.type = 'button';
    edit.className = 'secondary-btn';
    edit.textContent = '编辑';
    edit.addEventListener('click', () => openProviderDialog(provider));
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'danger-text-btn';
    remove.textContent = '删除';
    remove.addEventListener('click', () => deleteProvider(provider.id));
    actions.append(edit, remove);
    item.append(info, actions);
    host.appendChild(item);
  });
}

function renderProviderModelList() {
  const list = $('#provider-model-list');
  const empty = $('#provider-model-empty');
  const count = $('#provider-model-count');
  if (!list || !empty || !providerDraft) return;
  const ids = providerModelIds(providerDraft);
  if (count) count.textContent = `${ids.length} 个`;
  list.innerHTML = '';
  list.hidden = ids.length === 0;
  empty.hidden = ids.length > 0;

  ids.forEach((id) => {
    const row = document.createElement('div');
    row.className = 'provider-model-row';

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'provider-model-main';
    main.addEventListener('click', () => openModelEditor(id));
    const name = document.createElement('span');
    name.className = 'provider-model-name';
    name.textContent = id;
    const summary = document.createElement('span');
    summary.className = 'provider-model-summary';
    summary.textContent = modelSummary(providerDraft, id)
      + (isProviderImageModel(providerDraft, id) ? ' · 图片' : '');
    main.append(name, summary);

    const testState = modelTests[id] || '';
    let badge = null;
    if (testState === 'ok') {
      badge = document.createElement('span');
      badge.className = 'provider-model-result ok';
      badge.textContent = '可达';
      badge.title = modelTestMessages[id] || '可达';
    } else if (testState === 'error') {
      badge = document.createElement('span');
      badge.className = 'provider-model-result error';
      badge.textContent = '失败';
      badge.title = modelTestMessages[id] || '失败';
    }

    const testBtn = document.createElement('button');
    testBtn.type = 'button';
    testBtn.className = 'provider-model-test' + (testState ? ` is-${testState}` : '');
    testBtn.disabled = testState === 'testing';
    testBtn.title = isProviderImageModel(providerDraft, id)
      ? '图片模型需在生图页测试'
      : '测试模型可达性';
    testBtn.setAttribute('aria-label', testBtn.title);
    if (testState === 'testing') {
      testBtn.innerHTML = '<span class="mini-spinner" aria-hidden="true"></span>';
    } else {
      testBtn.innerHTML = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M8 12h8M9 8V5M15 8V5M7 8h10v8a3 3 0 0 1-3 3h-4a3 3 0 0 1-3-3V8zM12 19v3"/></svg>';
    }
    testBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      testProviderModel(id);
    });

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'provider-model-del';
    delBtn.title = '删除模型';
    delBtn.setAttribute('aria-label', '删除模型');
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';
    delBtn.addEventListener('click', (event) => {
      event.stopPropagation();
      deleteProviderModelById(id);
    });

    row.append(main);
    if (badge) row.append(badge);
    row.append(testBtn, delBtn);
    list.appendChild(row);
  });
}

function openProviderDialog(provider = null) {
  const dialog = $('#provider-dialog');
  if (!dialog) return;
  providerIsNew = !provider;
  providerDraft = normalizeProvider(provider || {
    name: 'OpenAI Compatible',
    api: 'openai-chat',
    baseUrl: '',
    apiKey: '',
    models: ['gpt-4o-mini'],
  });
  modelTests = {};
  modelTestMessages = {};
  modelEditor = null;
  closeModelEditor();

  $('#provider-dialog-title').textContent = provider ? '编辑供应商' : '添加供应商';
  $('#provider-name').value = providerDraft.name;
  $('#provider-api').value = providerDraft.api;
  $('#provider-base-url').value = providerDraft.baseUrl;
  $('#provider-api-key').value = providerDraft.apiKey;
  $('#provider-api-key').type = 'password';
  $('#btn-toggle-provider-key').textContent = '显示';
  const imgBase = $('#provider-image-base-url');
  const imgKey = $('#provider-image-api-key');
  const imgEp = $('#provider-image-endpoint');
  if (imgBase) imgBase.value = providerDraft.imageBaseUrl || '';
  if (imgKey) imgKey.value = providerDraft.imageApiKey || '';
  if (imgEp) imgEp.value = providerDraft.imageEndpointPath || '';
  const delBtn = $('#btn-delete-provider');
  if (delBtn) delBtn.hidden = providerIsNew;
  setProviderStatus('');
  setProviderNetStatus(null);
  renderProviderModelList();

  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function closeProviderDialog() {
  const dialog = $('#provider-dialog');
  if (!dialog) return;
  providerDraft = null;
  modelTests = {};
  modelTestMessages = {};
  closeModelEditor();
  if (typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

async function saveProvider(event) {
  event.preventDefault();
  if (!providerDraft) return;
  readProviderBasicsIntoDraft();
  providerDraft = normalizeProvider(providerDraft);
  if (!providerDraft.baseUrl) {
    setProviderStatus('请填写 API 地址', 'is-err');
    UIDialog.toast('请填写 API 地址');
    return;
  }
  if (!providerModelIds(providerDraft).length) {
    setProviderStatus('请至少添加一个模型', 'is-err');
    UIDialog.toast('请至少添加一个模型');
    return;
  }

  const index = state.providers.findIndex((item) => item.id === providerDraft.id);
  if (index >= 0) state.providers[index] = providerDraft;
  else state.providers.push(providerDraft);

  await persistSettings();
  UIDialog.toast('已保存供应商');
  closeProviderDialog();
  renderProviders();
  renderModelSelect();
  renderComposerState();
}

async function deleteProviderFromDialog() {
  if (!providerDraft || providerIsNew) return;
  const ok = await UIDialog.confirm(`删除提供商：${providerDraft.name}`, '删除提供商', { danger: true, okText: '删除' });
  if (!ok) return;
  await deleteProvider(providerDraft.id, true);
  closeProviderDialog();
}

async function deleteProvider(id, skipConfirm) {
  const provider = state.providers.find((item) => item.id === id);
  if (!provider) return;
  if (!skipConfirm) {
    const ok = await UIDialog.confirm(`删除供应商「${provider.name}」？`, '删除供应商', { danger: true, okText: '删除' });
    if (!ok) return;
  }
  state.providers = state.providers.filter((item) => item.id !== id);
  if (state.session?.providerId === id) {
    state.session.providerId = '';
    state.session.model = '';
  }
  await persistSettings();
  UIDialog.toast('已删除');
  renderProviders();
  renderModelSelect();
  renderComposerState();
}

async function fetchProviderModels() {
  if (!providerDraft) return;
  readProviderBasicsIntoDraft();
  if (!providerDraft.baseUrl) {
    setProviderStatus('请先填写 API 地址', 'is-err');
    UIDialog.toast('请先填写 API 地址');
    return;
  }
  const button = $('#btn-fetch-models');
  if (button) button.disabled = true;
  setProviderStatus('正在获取模型…', 'is-busy');
  setProviderNetStatus(null);
  try {
    const raw = API.listModelsDetailed
      ? await API.listModelsDetailed(providerDraft)
      : await API.listModels(providerDraft);
    if (window.MODEL_META && typeof MODEL_META.applyApiModels === 'function') {
      MODEL_META.applyApiModels(providerDraft, raw);
    } else {
      const ids = (Array.isArray(raw) ? raw : []).map((item) => (
        typeof item === 'string' ? item : (item && (item.id || item.name || item.model)) || ''
      )).filter(Boolean);
      providerDraft.models = ids;
    }
    renderProviderModelList();
    const n = providerModelIds(providerDraft).length;
    setProviderStatus(n ? `已获取 ${n} 个模型与元数据` : '接口返回了空列表', n ? 'is-ok' : 'is-err');
    UIDialog.toast(n ? `已获取 ${n} 个模型` : '接口返回空列表');
  } catch (err) {
    const msg = err?.message || NetStability.display(err) || '获取失败';
    setProviderStatus(msg, 'is-err');
    UIDialog.toast(msg, 3600);
  } finally {
    if (button) button.disabled = false;
  }
}

async function testProvider() {
  if (!providerDraft) return;
  readProviderBasicsIntoDraft();
  if (!providerDraft.baseUrl) {
    setProviderStatus('请先填写 API 地址', 'is-err');
    UIDialog.toast('请先填写 API 地址');
    return;
  }
  const button = $('#btn-test-provider');
  if (button) button.disabled = true;
  setProviderStatus('正在测试连接…', 'is-busy');
  setProviderNetStatus(null);
  try {
    await API.listModels(providerDraft);
    setProviderStatus('连接正常（/models 可达）', 'is-ok');
    UIDialog.toast('连接正常');
  } catch (err) {
    const msg = NetStability.display(err);
    setProviderStatus(msg, 'is-err');
    UIDialog.toast(msg, 3600);
  } finally {
    if (button) button.disabled = false;
  }
}

async function testProviderModel(id) {
  if (!providerDraft || !id) return;
  readProviderBasicsIntoDraft();
  if (!providerDraft.baseUrl) {
    UIDialog.toast('请先填写 API 地址');
    return;
  }
  if (isProviderImageModel(providerDraft, id)) {
    UIDialog.toast('图片模型需要实际生成图片，请在生图页测试', 3600);
    return;
  }
  modelTests[id] = 'testing';
  modelTestMessages[id] = '';
  renderProviderModelList();
  setProviderNetStatus(null);
  let answer = '';
  try {
    const result = await API.send({
      provider: providerDraft,
      model: id,
      messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
      tools: [],
      settings: { systemPrompt: '', temperature: 0, maxTokens: 16 },
      requestKey: NetStability.idempotencyKey('model-test-' + id),
      onStatus: (info) => setProviderNetStatus(Object.assign({ source: '模型测试' }, info || {})),
      onUpdate: (st) => { answer = st?.content || answer; },
    });
    answer = String(result?.content || answer || '').trim();
    modelTests[id] = 'ok';
    modelTestMessages[id] = answer;
    setProviderStatus(`模型可达${answer ? ' · ' + U.truncate(answer, 36) : ''}`, 'is-ok');
    UIDialog.toast(`模型可达${answer ? ' · ' + U.truncate(answer, 36) : ''}`);
  } catch (err) {
    modelTests[id] = 'error';
    modelTestMessages[id] = err?.message || String(err);
    setProviderStatus(NetStability.display(err), 'is-err');
    UIDialog.toast('模型不可达：' + (err?.message || String(err)), 4200);
  } finally {
    renderProviderModelList();
  }
}

async function addProviderModel() {
  if (!providerDraft) return;
  const id = await UIDialog.prompt('添加模型', '', '输入接口使用的完整模型名称');
  const cleanId = String(id || '').trim();
  if (!cleanId) return;
  if (providerModelIds(providerDraft).includes(cleanId)) {
    UIDialog.toast('模型已经存在');
    return;
  }
  const meta = window.MODEL_META ? MODEL_META.infer(cleanId, providerDraft.name) : { id: cleanId, capabilities: {} };
  providerDraft.modelMeta = providerDraft.modelMeta || {};
  providerDraft.imageModelMeta = providerDraft.imageModelMeta || {};
  if (window.MODEL_META && (MODEL_META.isImageGenerationMeta(meta) || meta.capabilities?.imageEdit)) {
    providerDraft.imageModels = providerDraft.imageModels || [];
    providerDraft.imageModels.push(cleanId);
    providerDraft.imageModelMeta[cleanId] = meta;
  } else {
    providerDraft.models = providerDraft.models || [];
    providerDraft.models.push(cleanId);
    providerDraft.modelMeta[cleanId] = meta;
  }
  providerDraft = normalizeProvider(providerDraft);
  renderProviderModelList();
  openModelEditor(cleanId);
}

function openModelEditor(id) {
  if (!providerDraft || !id) return;
  const stored = (providerDraft.modelMeta && providerDraft.modelMeta[id])
    || (providerDraft.imageModelMeta && providerDraft.imageModelMeta[id]);
  const meta = window.MODEL_META
    ? MODEL_META.mergeMeta(MODEL_META.infer(id, providerDraft.name), stored)
    : Object.assign({ id, contextWindow: 128000, maxOutputTokens: 8192, capabilities: {} }, stored || {});
  modelEditor = {
    originalId: id,
    id,
    contextWindow: String(meta.contextWindow || ''),
    maxOutputTokens: String(meta.maxOutputTokens || ''),
    capabilities: Object.assign({}, meta.capabilities || {}),
  };
  $('#model-editor-id').value = modelEditor.id;
  $('#model-editor-context').value = modelEditor.contextWindow;
  $('#model-editor-max-out').value = modelEditor.maxOutputTokens;
  $all('#model-editor-caps .model-editor-cap').forEach((row) => {
    const key = row.dataset.cap;
    const on = !!modelEditor.capabilities[key];
    const sw = row.querySelector('.switch');
    if (sw) {
      sw.classList.toggle('on', on);
      sw.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  });
  const dlg = $('#model-editor-dialog');
  if (!dlg) return;
  if (typeof dlg.showModal === 'function') {
    if (!dlg.open) dlg.showModal();
  } else {
    dlg.setAttribute('open', '');
  }
}

function closeModelEditor() {
  modelEditor = null;
  const dlg = $('#model-editor-dialog');
  if (!dlg) return;
  if (dlg.open && typeof dlg.close === 'function') {
    try { dlg.close(); } catch (e) {}
  } else {
    dlg.removeAttribute('open');
  }
}

async function deleteProviderModelById(id) {
  if (!providerDraft || !id) return;
  const ok = await UIDialog.confirm(`删除模型：${id}`, '删除模型', { danger: true, okText: '删除' });
  if (!ok) return;
  providerDraft.models = (providerDraft.models || []).filter((name) => name !== id);
  providerDraft.imageModels = (providerDraft.imageModels || []).filter((name) => name !== id);
  if (providerDraft.modelMeta) delete providerDraft.modelMeta[id];
  if (providerDraft.imageModelMeta) delete providerDraft.imageModelMeta[id];
  delete modelTests[id];
  delete modelTestMessages[id];
  if (modelEditor && modelEditor.originalId === id) closeModelEditor();
  renderProviderModelList();
  UIDialog.toast('已删除模型');
}

function toggleModelEditorCap(key) {
  if (!modelEditor || !key) return;
  modelEditor.capabilities[key] = !modelEditor.capabilities[key];
  const row = $(`#model-editor-caps .model-editor-cap[data-cap="${key}"]`);
  const sw = row?.querySelector('.switch');
  if (sw) {
    sw.classList.toggle('on', !!modelEditor.capabilities[key]);
    sw.setAttribute('aria-pressed', modelEditor.capabilities[key] ? 'true' : 'false');
  }
}

function saveModelEditor() {
  if (!providerDraft || !modelEditor) return;
  const id = String($('#model-editor-id')?.value || '').trim();
  if (!id) {
    UIDialog.toast('请填写模型名称');
    return;
  }
  const duplicate = providerModelIds(providerDraft).some((name) => name === id && name !== modelEditor.originalId);
  if (duplicate) {
    UIDialog.toast('模型名称已存在');
    return;
  }
  const remove = (arr) => (arr || []).filter((name) => name !== modelEditor.originalId && name !== id);
  providerDraft.models = remove(providerDraft.models);
  providerDraft.imageModels = remove(providerDraft.imageModels);
  providerDraft.modelMeta = providerDraft.modelMeta || {};
  providerDraft.imageModelMeta = providerDraft.imageModelMeta || {};
  delete providerDraft.modelMeta[modelEditor.originalId];
  delete providerDraft.imageModelMeta[modelEditor.originalId];

  const meta = window.MODEL_META
    ? MODEL_META.mergeMeta(MODEL_META.infer(id, providerDraft.name), {
      id,
      contextWindow: MODEL_META.toInt($('#model-editor-context')?.value) || 0,
      maxOutputTokens: MODEL_META.toInt($('#model-editor-max-out')?.value) || 0,
      capabilities: Object.assign({}, modelEditor.capabilities || {}),
      source: 'user',
    })
    : {
      id,
      contextWindow: Number($('#model-editor-context')?.value) || 128000,
      maxOutputTokens: Number($('#model-editor-max-out')?.value) || 8192,
      capabilities: Object.assign({}, modelEditor.capabilities || {}),
      source: 'user',
    };

  const imageOnly = meta.capabilities?.imageGeneration || meta.capabilities?.imageEdit;
  if (imageOnly) {
    providerDraft.imageModels.push(id);
    providerDraft.imageModelMeta[id] = meta;
  } else {
    providerDraft.models.push(id);
    providerDraft.modelMeta[id] = meta;
  }
  providerDraft = normalizeProvider(providerDraft);
  if (modelTests[modelEditor.originalId] && modelEditor.originalId !== id) {
    modelTests[id] = modelTests[modelEditor.originalId];
    modelTestMessages[id] = modelTestMessages[modelEditor.originalId];
    delete modelTests[modelEditor.originalId];
    delete modelTestMessages[modelEditor.originalId];
  }
  closeModelEditor();
  renderProviderModelList();
  UIDialog.toast('模型已更新');
}

async function deleteModelFromEditor() {
  if (!providerDraft || !modelEditor) return;
  const originalId = modelEditor.originalId;
  await deleteProviderModelById(originalId);
}

function hasUntitledSessionTitle(title) {
  const value = String(title || '').trim();
  return !value || value === '\u65b0\u4f1a\u8bdd';
}

function sessionTitle(session) {
  return session.title
    || session.messages?.find((message) => message.role === 'user')?.content?.split(/\r?\n/)[0]?.slice(0, 48)
    || String(session.summary || '').slice(0, 48)
    || '新会话';
}

function sessionSummary(session) {
  const messages = Array.isArray(session.messages) ? session.messages : [];
  return {
    id: session.id,
    title: session.title || '',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    mode: session.mode === 'image' ? 'image' : 'chat',
    providerId: session.providerId || '',
    model: session.model || '',
    messages,
    summary: messages.find((m) => m.role === 'user')?.content?.split(/\r?\n/)[0]?.trim().slice(0, 64)
      || session.summary || '',
    messageCount: messages.length || session.messageCount || 0,
    workspacePath: session.workspacePath || '',
    pinned: !!session.pinned,
    contextModel: session.contextModel || '',
    contextProviderId: session.contextProviderId || '',
    contextWindow: session.contextWindow || 0,
    contextVision: session.contextVision !== false,
  };
}

function upsertSessionIndex(session) {
  const index = state.sessions.findIndex((item) => item.id === session.id);
  const summary = sessionSummary(session);
  if (index >= 0) state.sessions[index] = summary;
  else state.sessions.unshift(summary);
  state.sessions.sort((a, b) => {
    if (!!b.pinned !== !!a.pinned) return b.pinned ? 1 : -1;
    return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
  });
}

function closeSessionMenus() {
  $all('.session-menu').forEach((el) => { el.hidden = true; });
}

function syncActiveTaskState() {
  const task = state.session?.id ? state.backgroundTasks.get(state.session.id) : null;
  state.generating = task?.status === 'running';
  state.abortCtl = state.generating ? task.abortCtl : null;
  state.stopRequested = state.generating ? !!task.stopRequested : false;
}

function liveSessionById(id) {
  if (state.session?.id === id) return state.session;
  return state.backgroundTasks.get(id)?.session || null;
}

function markSessionHistoryComplete(session) {
  if (!session?.id) return;
  state.messagePageState.set(session.id, {
    beforeSeq: null,
    hasMore: false,
    loading: false,
  });
}

function setSessionHistoryPage(sessionId, page) {
  if (!sessionId) return;
  state.messagePageState.set(sessionId, {
    beforeSeq: page?.nextBeforeSeq ?? null,
    hasMore: !!page?.hasMore,
    loading: false,
  });
}

function indexedSessionById(id) {
  return state.sessions.find((item) => item.id === id) || null;
}

async function loadChatSessionInitial(id) {
  const indexItem = indexedSessionById(id);
  if (indexItem?.mode === 'image') {
    const loaded = normalizeSession(await invoke('load_session', { id }));
    markSessionHistoryComplete(loaded);
    return loaded;
  }
  const page = await invoke('session_messages_page', {
    args: { sessionId: id, beforeSeq: null, limit: MESSAGE_PAGE_LIMIT },
  });
  const session = normalizeSession({
    ...(indexItem || {}),
    id,
    mode: 'chat',
    messages: Array.isArray(page?.messages) ? page.messages : [],
  });
  setSessionHistoryPage(id, page);
  return session;
}

async function loadOlderMessagesFor(session) {
  if (!session?.id) return false;
  const pageState = state.messagePageState.get(session.id);
  if (!pageState?.hasMore) return false;
  if (pageState.loading) return pageState.promise || false;
  pageState.loading = true;
  pageState.promise = (async () => {
    const page = await invoke('session_messages_page', {
      args: {
        sessionId: session.id,
        beforeSeq: pageState.beforeSeq,
        limit: MESSAGE_PAGE_LIMIT,
      },
    });
    const older = Array.isArray(page?.messages) ? page.messages.map(normalizeMessage) : [];
    if (!older.length) {
      pageState.hasMore = false;
      pageState.beforeSeq = null;
      return false;
    }
    const existing = new Set((session.messages || []).map((message) => message.id));
    const fresh = older.filter((message) => !existing.has(message.id));
    session.messages = fresh.concat(session.messages || []);
    pageState.beforeSeq = page?.nextBeforeSeq ?? null;
    pageState.hasMore = !!page?.hasMore;
    await hydrateSessionImages({ id: session.id, messages: fresh });
    return fresh.length > 0;
  })();
  try {
    return await pageState.promise;
  } catch (err) {
    console.warn('load older messages failed:', err);
    UIDialog.toast('加载历史消息失败：' + (err?.message || err), 3200);
    return false;
  } finally {
    pageState.loading = false;
    pageState.promise = null;
  }
}

async function ensureFullHistoryLoaded(session) {
  if (!session?.id) return;
  const pageState = state.messagePageState.get(session.id);
  if (!pageState?.hasMore) return;
  while (pageState.hasMore) {
    const changed = await loadOlderMessagesFor(session);
    if (!changed) break;
  }
}

async function loadOlderActiveMessages() {
  const session = state.session;
  if (!session?.id || session.mode === 'image') return;
  const pageState = state.messagePageState.get(session.id);
  if (!pageState?.hasMore || pageState.loading || state.generating) return;
  await ChatScroll.preserveAnchor(async () => {
    const changed = await loadOlderMessagesFor(session);
    if (changed) renderChat();
  });
}

function renderSessions() {
  const list = $('#session-list');
  const empty = $('.list-panel[data-panel="chat"] .empty-hint');
  if (!list) return;
  list.innerHTML = '';
  const allChatSessions = (state.sessions || []).filter((s) => s.mode !== 'image');
  const query = String(state.sessionSearchQuery || '').trim().toLowerCase();
  const chatSessions = query
    ? allChatSessions.filter((s) => sessionTitle(s).toLowerCase().includes(query))
    : allChatSessions;
  list.hidden = chatSessions.length === 0;
  if (empty) {
    empty.hidden = chatSessions.length > 0;
    const title = empty.querySelector('.empty-title');
    const desc = empty.querySelector('.empty-desc');
    if (query && allChatSessions.length) {
      if (title) title.textContent = '没有匹配会话';
      if (desc) desc.textContent = '换个标题关键词试试。';
    } else {
      if (title) title.textContent = '还没有会话';
      if (desc) desc.textContent = '新建一条，或配置模型后开始对话。';
    }
  }
  chatSessions.forEach((session) => {
    const item = document.createElement('li');
    item.className = 'session-item' + (session.id === state.session?.id && state.session?.mode !== 'image' ? ' is-active' : '');
    if (session.pinned) item.classList.add('is-pinned');

    const row = document.createElement('div');
    row.className = 'session-item-row';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'session-item-btn';
    button.textContent = (session.pinned ? '📌 ' : '') + sessionTitle(session);
    button.title = session.workspacePath
      ? `${sessionTitle(session)}\n${session.workspacePath}`
      : sessionTitle(session);
    button.addEventListener('click', () => openSession(session.id));

    const task = state.backgroundTasks.get(session.id);
    const status = document.createElement('span');
    status.className = 'session-status';
    if (task?.status === 'running') status.classList.add('is-running');
    else if (task?.unread) status.classList.add('is-unread');
    status.title = task?.status === 'running' ? '后台生成中' : (task?.unread ? '有新的回复' : '');

    const more = document.createElement('button');
    more.type = 'button';
    more.className = 'session-item-more';
    more.title = '会话操作';
    more.setAttribute('aria-label', '会话操作');
    more.textContent = '⋯';
    more.addEventListener('click', (event) => {
      event.stopPropagation();
      const menu = item.querySelector('.session-menu');
      const open = menu && !menu.hidden;
      closeSessionMenus();
      if (menu && !open) menu.hidden = false;
    });

    const menu = document.createElement('div');
    menu.className = 'session-menu';
    menu.hidden = true;
    const actions = [
      { label: '重命名', run: () => renameSession(session.id) },
      { label: session.pinned ? '取消置顶' : '置顶', run: () => togglePinSession(session.id) },
      { label: '复制会话', run: () => copySession(session.id) },
      { label: '删除', danger: true, run: () => deleteSessionById(session.id) },
    ];
    actions.forEach((act) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'session-menu-item' + (act.danger ? ' is-danger' : '');
      btn.textContent = act.label;
      btn.addEventListener('click', async (event) => {
        event.stopPropagation();
        closeSessionMenus();
        await act.run();
      });
      menu.appendChild(btn);
    });

    row.append(status, button, more);
    item.append(row, menu);
    list.appendChild(item);
  });
  renderWorkspaceSessionPath();
}

/** 落盘前剥离图片/附件正文（文件本体在工作区文件系统） */
function stripMessageImages(message) {
  if (Array.isArray(message.images)) {
    message.images = message.images.map((image) => ({
      path: image.path || '', mime: image.mime || 'image/png', prompt: image.prompt || '',
      revisedPrompt: image.revisedPrompt || '', imageMeta: image.imageMeta,
    }));
  }
  if (Array.isArray(message.attachments)) {
    message.attachments = message.attachments
      .map(cloneAttachmentForDisk)
      .filter(Boolean);
  }
  return message;
}

/** 会话写操作统一走每会话串行链，保证与全量保存的顺序 */
function queueSessionWrite(sessionId, task) {
  const previous = state.sessionSaveChains.get(sessionId) || Promise.resolve();
  const current = previous.catch(() => {}).then(task);
  state.sessionSaveChains.set(sessionId, current);
  return current;
}

function sessionDiskSnapshot(target) {
  const diskSession = cloneJson(target);
  (diskSession.messages || []).forEach(stripMessageImages);
  return diskSession;
}

async function saveFullSessionToDisk(target, diskSession = sessionDiskSnapshot(target)) {
  try {
    const saved = await invoke('save_session', { session: diskSession });
    if (saved && typeof saved === 'object') {
      target.workspacePath = saved.workspacePath || target.workspacePath || '';
      upsertSessionIndex(target);
    }
  } catch (err) {
    console.warn('Unable to save session:', err);
    if (state.session?.id === target.id) UIDialog.toast('会话保存失败：' + (err?.message || err), 3200);
  }
}

async function persistSession(sessionArg = null) {
  const target = sessionArg || state.session;
  if (!target?.id || state.deletedSessionIds.has(target.id)) return;
  await ensureFullHistoryLoaded(target);
  target.updatedAt = nowIso();
  if (hasUntitledSessionTitle(target.title)) {
    const firstUser = target.messages?.find((message) => message.role === 'user');
    const firstLine = firstUser?.content?.split(/\r?\n/)[0]?.replace(/\s+/g, ' ').trim();
    if (firstLine) target.title = firstLine.slice(0, 48);
  }
  upsertSessionIndex(target);
  renderSessions();
  if (window.ImageMode) window.ImageMode.renderImageSessionList();
  // Keep the original queue semantics: each full save persists its call-time snapshot.
  const diskSession = sessionDiskSnapshot(target);
  await queueSessionWrite(target.id, () => saveFullSessionToDisk(target, diskSession));
  if (state.session?.id === target.id) renderWorkspaceSessionPath();
}

/**
 * S2 流式热路径：只写当前活跃消息一行 + 会话 updated_at。
 * 会话结构已变化（seq 冲突、行不存在）时由 Rust 报错，这里回退整包保存。
 */
async function persistActiveMessage(session, message) {
  const target = session || state.session;
  if (!target?.id || state.deletedSessionIds.has(target.id)) return;
  const seq = (target.messages || []).indexOf(message);
  if (seq < 0) {
    await persistSession(target);
    return;
  }
  target.updatedAt = nowIso();
  const updatedAt = target.updatedAt;
  const row = stripMessageImages(cloneJson(message));
  await queueSessionWrite(target.id, async () => {
    try {
      await invoke('session_upsert_message', {
        args: { sessionId: target.id, seq, updatedAt, message: row },
      });
    } catch (err) {
      console.warn('incremental save fell back to full save:', err);
      await saveFullSessionToDisk(target);
    }
  });
}

async function hydrateSessionImages(session) {
  if (!session?.id) return;
  for (const message of session.messages || []) {
    if (message.role === 'assistant' && Array.isArray(message.images)) {
      for (const image of message.images) {
        if (!image?.path || image.dataUrl) continue;
        try {
          const res = await invoke('ws_read_bytes', { args: { sessionId: session.id, path: image.path } });
          if (res?.contentBase64) {
            image.dataUrl = `data:${res.mime || image.mime || 'image/png'};base64,${res.contentBase64}`;
            image.mime = res.mime || image.mime || 'image/png';
          }
        } catch {
          /* Keep the path so the file pane can still open it. */
        }
      }
    }
    if (message.role === 'user' && Array.isArray(message.attachments)) {
      for (const attachment of message.attachments) {
        await hydrateAttachment(attachment, session.id);
      }
    }
  }
}

async function openSession(id) {
  if (!id) return;
  if (state.session?.id === id) return;
  const navigationSeq = ++state.sessionNavigationSeq;
  if (state.session?.id) {
    if (state.session.mode === 'image') state.lastImageSessionId = state.session.id;
    else state.lastChatSessionId = state.session.id;
  }
  const task = state.backgroundTasks.get(id);
  let nextSession = null;
  if (task?.session) {
    nextSession = task.session;
  } else try {
    nextSession = await loadChatSessionInitial(id);
  } catch (err) {
    // 索引项不含消息，不能当完整会话打开（否则一次保存就会清空该会话）
    UIDialog.toast('无法加载会话：' + (err?.message || err), 3200);
    return;
  }
  if (navigationSeq !== state.sessionNavigationSeq || !nextSession) return;
  state.session = nextSession;
  state.pendingAttachments = [];
  rememberActiveSession(state.session);
  if (task) task.unread = false;
  syncActiveTaskState();
  await hydrateSessionImages(state.session);
  if (navigationSeq !== state.sessionNavigationSeq) return;
  previewServerInfo = null;
  window.PreviewStream?.clearAll?.();
  renderSessions();
  renderModelSelect();
  renderComposerState();
  renderChat();
  if (state.session?.mode === 'image') {
    setMode('image');
  } else {
    setMode('chat');
  }
}

async function createNewChat() {
  const navigationSeq = ++state.sessionNavigationSeq;
  if (state.session?.id) persistSession(state.session).catch((err) => console.warn('save previous session', err));
  previewServerInfo = null;
  window.PreviewStream?.clearAll?.();
  state.session = createSession();
  state.pendingAttachments = [];
  rememberActiveSession(state.session);
  syncActiveTaskState();
  state.lastChatSessionId = state.session.id;
  await persistSession();
  if (navigationSeq !== state.sessionNavigationSeq) return;
  renderSessions();
  renderModelSelect();
  renderComposerState();
  renderChat();
  setMode('chat');
  $('#composer-input')?.focus();
}

async function renameSession(id) {
  const item = liveSessionById(id) || state.sessions.find((s) => s.id === id);
  if (!item) return;
  const name = await UIDialog.prompt('重命名会话', sessionTitle(item), '会话名称');
  if (name == null) return;
  const title = String(name).replace(/\s+/g, ' ').trim().slice(0, 48) || '新会话';
  const live = liveSessionById(id);
  if (live) {
    live.title = title;
    await persistSession(live);
  } else {
    try {
      const loaded = normalizeSession(await invoke('load_session', { id }));
      loaded.title = title;
      loaded.updatedAt = nowIso();
      await invoke('save_session', { session: loaded });
      upsertSessionIndex(loaded);
      renderSessions();
    } catch (err) {
      UIDialog.toast(err?.message || '重命名失败');
    }
  }
  UIDialog.toast('已重命名');
}

async function togglePinSession(id) {
  const apply = async (sess) => {
    sess.pinned = !sess.pinned;
    sess.updatedAt = nowIso();
    await invoke('save_session', { session: sess });
    upsertSessionIndex(sess);
  };
  try {
    const live = liveSessionById(id);
    if (live) {
      live.pinned = !live.pinned;
      await persistSession(live);
    } else {
      const loaded = normalizeSession(await invoke('load_session', { id }));
      await apply(loaded);
    }
    renderSessions();
  } catch (err) {
    UIDialog.toast(err?.message || '操作失败');
  }
}

async function copySession(id) {
  try {
    const live = liveSessionById(id);
    if (live) await persistSession(live);
    const copied = normalizeSession(await invoke('copy_session', { id }));
    copied.createdAt = nowIso();
    copied.updatedAt = nowIso();
    const saved = await invoke('save_session', { session: copied });
    state.session = normalizeSession(saved || copied);
    markSessionHistoryComplete(state.session);
    rememberActiveSession(state.session);
    syncActiveTaskState();
    upsertSessionIndex(state.session);
    renderSessions();
    renderModelSelect();
    renderComposerState();
    renderChat();
    setMode('chat');
    UIDialog.toast('已复制会话');
  } catch (err) {
    UIDialog.toast(err?.message || '复制失败', 3200);
  }
}

async function deleteSessionById(id) {
  const item = state.sessions.find((s) => s.id === id) || (state.session?.id === id ? state.session : null);
  if (!item) return;
  const ok = await UIDialog.confirm(
    `删除后无法恢复：\n${sessionTitle(item)}\n\n将删除会话消息及其工作区目录。`,
    '删除会话',
    { danger: true, okText: '删除' }
  );
  if (!ok) return;
  state.deletedSessionIds.add(id);
  const task = state.backgroundTasks.get(id);
  if (task?.status === 'running') {
    task.stopRequested = true;
    task.abortCtl?.abort();
    state.backgroundTasks.delete(id);
  }
  try {
    await (state.sessionSaveChains.get(id) || Promise.resolve()).catch(() => {});
    await invoke('delete_session', { id });
    state.sessionSaveChains.delete(id);
    state.contextWarnings.delete(id);
  } catch (err) {
    state.deletedSessionIds.delete(id);
    UIDialog.toast(err?.message || '删除失败', 3200);
    return;
  }
  state.sessions = state.sessions.filter((s) => s.id !== id);
  if (state.session?.id === id) {
    const next = state.sessions[0];
    if (next) {
      try {
        state.session = await loadChatSessionInitial(next.id);
      } catch {
        // 索引项不含消息，加载失败时新建会话而不是拿空索引当会话
        state.session = createSession();
        await persistSession();
      }
    } else {
      state.session = createSession();
      await persistSession();
    }
    syncActiveTaskState();
    rememberActiveSession(state.session);
  }
  renderSessions();
  renderModelSelect();
  renderComposerState();
  renderChat();
  UIDialog.toast('会话已删除');
}

function renderWorkspaceSessionPath() {
  const el = $('#workspace-session-path');
  if (!el) return;
  el.value = state.session?.workspacePath || '（保存会话后生成）';
}

function renderModelSelect() {
  const select = $('#model-select');
  const providerLabel = $('#model-provider-label');
  const pickerTitle = $('#model-picker-title');
  const pickerBtn = $('#model-picker-btn');
  const picker = $('#model-picker-popover');
  if (!select) return;
  const selectedProviderId = state.session?.mode === 'chat' ? (state.session.providerId || '') : '';
  const selectedModel = state.session?.mode === 'chat' ? (state.session.model || '') : '';
  select.innerHTML = '<option value="">选择对话模型</option>';
  if (picker) picker.innerHTML = '';
  state.providers.forEach((provider) => {
    const group = document.createElement('optgroup');
    group.label = provider.name;
    const pickerGroup = document.createElement('div');
    pickerGroup.className = 'model-picker-group';
    const groupTitle = document.createElement('div');
    groupTitle.className = 'model-picker-group-title';
    groupTitle.textContent = provider.name || 'Provider';
    pickerGroup.appendChild(groupTitle);
    (provider.models || []).forEach((model) => {
      const option = document.createElement('option');
      option.value = `${provider.id}\n${model}`;
      const caps = window.MODEL_META ? MODEL_META.capLabels(modelMetaOf(provider, model)).join(' · ') : '';
      option.textContent = caps ? `${model} · ${caps}` : model;
      option.title = modelSummary(provider, model);
      option.selected = provider.id === selectedProviderId && model === selectedModel;
      group.appendChild(option);

      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'model-picker-option' + (option.selected ? ' is-active' : '');
      item.role = 'option';
      item.setAttribute('aria-selected', option.selected ? 'true' : 'false');
      item.dataset.providerId = provider.id;
      item.dataset.model = model;
      const name = document.createElement('span');
      name.className = 'model-picker-model';
      name.textContent = model;
      const summary = document.createElement('span');
      summary.className = 'model-picker-summary';
      summary.textContent = caps || modelSummary(provider, model);
      item.append(name, summary);
      item.addEventListener('click', async () => {
        closeModelPicker();
        await selectChatModel(provider.id, model);
      });
      pickerGroup.appendChild(item);
    });
    if (group.childElementCount) select.appendChild(group);
    if (picker && pickerGroup.children.length > 1) picker.appendChild(pickerGroup);
  });
  select.disabled = state.providers.length === 0 || state.generating;
  if (pickerBtn) {
    pickerBtn.disabled = select.disabled;
    pickerBtn.setAttribute('aria-disabled', select.disabled ? 'true' : 'false');
  }
  if (pickerTitle) pickerTitle.textContent = selectedModel || '选择对话模型';
  const provider = currentProvider();
  if (providerLabel) {
    if (!provider) providerLabel.textContent = '尚未配置供应商';
    else if (selectedModel) providerLabel.textContent = `${provider.name} · ${modelSummary(provider, selectedModel)}`;
    else providerLabel.textContent = provider.name;
  }
  renderTokenMeter();
}

function closeModelPicker() {
  const root = $('.main-top-center .model-switch');
  const btn = $('#model-picker-btn');
  const popover = $('#model-picker-popover');
  root?.classList.remove('is-open');
  if (btn) btn.setAttribute('aria-expanded', 'false');
  if (popover) {
    setTimeout(() => {
      if (!root?.classList.contains('is-open')) popover.hidden = true;
    }, 160);
  }
}

function openModelPicker() {
  const root = $('.main-top-center .model-switch');
  const btn = $('#model-picker-btn');
  const popover = $('#model-picker-popover');
  if (!root || !btn || !popover || btn.disabled) return;
  popover.hidden = false;
  requestAnimationFrame(() => {
    root.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
  });
}

function toggleModelPicker() {
  if ($('.main-top-center .model-switch')?.classList.contains('is-open')) closeModelPicker();
  else openModelPicker();
}

async function selectChatModel(providerId, model) {
  if (!providerId || !model) return;
  if (state.session) {
    const changed = state.session.model && (state.session.providerId !== providerId || state.session.model !== model);
    if (changed && state.session.messages?.length && !state.session.contextModel) {
      ensureSessionContext(
        state.session,
        state.providers.find((item) => item.id === state.session.providerId),
        state.session.model
      );
    }
    const hasImages = (state.session.messages || []).some((message) => {
      const attachments = message.attachments || message.referenceFiles || [];
      return (Array.isArray(attachments) && attachments.length > 0)
        || (Array.isArray(message.images) && message.images.length > 0);
    });
    if (changed && state.session.messages?.length) {
      UIDialog.toast('当前会话中途切换模型可能导致上下文风格和工具能力不一致', 4200);
    }
    const targetMeta = modelMetaOf(state.providers.find((item) => item.id === providerId), model);
    if (changed && hasImages && targetMeta.capabilities?.vision === false) {
      UIDialog.toast('切换的目标模型无视觉能力，上下文内的图片将会被忽略。', 4500);
    }
    state.session.providerId = providerId;
    state.session.model = model;
    if (!state.session.messages.length) {
      state.session.contextModel = '';
      state.session.contextProviderId = '';
      state.session.contextWindow = 0;
    }
    if (!state.session.contextModel) {
      ensureSessionContext(state.session, state.providers.find((item) => item.id === providerId), model);
    }
  }
  await persistSession();
  renderModelSelect();
  renderComposerState();
}

function resizeChatComposer() {
  const input = $('#composer-input');
  if (!input) return;
  input.style.height = 'auto';
  const max = parseInt(getComputedStyle(input).maxHeight || '180', 10) || 180;
  const next = Math.min(max, Math.max(24, input.scrollHeight));
  input.style.height = `${next}px`;
  input.style.overflowY = input.scrollHeight > max ? 'auto' : 'hidden';
}

function renderComposerState() {
  const input = $('#composer-input');
  const send = $('#btn-send');
  const hint = $('#composer-hint');
  const attach = $('#btn-attach');
  const blocked = isBranchBlocked();
  const ready = Boolean(activeSessionProvider()) && !blocked;
  const hasContent = Boolean(input?.value.trim());
  const hasAttachments = Boolean(state.pendingAttachments?.length);
  if (input) input.disabled = !ready || state.generating;
  resizeChatComposer();
  if (attach) attach.disabled = !state.session?.id || state.generating || blocked;
  if (send) {
    send.disabled = state.generating ? false : (!ready || (!hasContent && !hasAttachments));
    send.title = state.generating ? '停止生成' : (blocked ? '请先切回后续消息使用的回答版本' : '发送');
    send.setAttribute('aria-label', send.title);
    send.classList.toggle('is-ready', state.generating || (ready && (hasContent || hasAttachments)));
    const icon = send.querySelector('path');
    if (icon) icon.setAttribute('d', state.generating ? 'M7 7h10v10H7z' : 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z');
  }
  if (hint) {
    if (state.generating) hint.textContent = '正在生成，点击发送按钮可停止';
    else if (blocked) hint.textContent = '当前查看的是旧回答分支。切回后续消息所使用的版本后，才能继续对话。';
    else if (ready) hint.textContent = 'Enter 发送，Shift+Enter 换行';
    else hint.textContent = '添加供应商并选择模型后即可开始对话';
  }
  renderPendingAttachments();
  const banner = $('#branch-blocked');
  if (banner) banner.hidden = !blocked;
  renderTokenMeter();
}

function formatToolCardArgs(t) {
  const PS = window.PreviewStream;
  if (PS?.formatToolArgsForDisplay) {
    return PS.formatToolArgsForDisplay(t.name, t.arguments, 8000);
  }
  return U.truncate(String(t.arguments || ''), 2000);
}

let chatViewReady = false;

function ensureChatView() {
  if (chatViewReady) return;
  const host = $('#chat-scroll');
  if (!host) return;
  initChatView({
    host,
    callbacks: {
      copyMessage,
      deleteMessage,
      editUserMessage,
      regenerateMessage,
      switchAssistantVariant,
      canRegenerateMessage,
      toolStatusLabel,
      formatToolCardArgs,
      openImage: (image) => { if (image.path) openFileInViewer(image.path); },
      openAttachment: (attachment) => { if (attachment.path) openFileInViewer(attachment.path); },
      onLiveCodeBlock: handleLiveCodeBlock,
      onAfterRender(reason) {
        if (reason === 'session') ChatScroll.resetToBottom();
        else ChatScroll.notifyContentChanged();
        if (reason === 'stream') renderTokenMeter();
        updateChatRail(state.session);
      },
    },
  });
  ChatScroll.initChatScroll({
    host,
    jumpButton: $('#btn-jump-bottom'),
    onNearTop: loadOlderActiveMessages,
  });
  initChatRail({
    root: $('#chat-rail'),
    chatHost: host,
    getMessageElement,
    onJump: (el) => ChatScroll.scrollToMessage(el),
  });
  chatViewReady = true;
}

/** 全量 reconcile：消息节点按 id 复用，只更新变化的部位（chat-view.js） */
function renderChat() {
  ensureChatView();
  renderChatView(state.session);
}

async function copyMessage(message) {
  const text = String(message?.content || '');
  try {
    await navigator.clipboard.writeText(text);
    UIDialog.toast('已复制');
  } catch {
    UIDialog.toast('复制失败');
  }
}

async function deleteMessage(index) {
  if (!state.session || state.generating) return;
  const m = state.session.messages[index];
  if (!m) return;
  const ok = await UIDialog.confirm('删除这条消息？', '删除消息', { danger: true, okText: '删除' });
  if (!ok) return;
  state.session.messages.splice(index, 1);
  await persistSession();
  renderChat();
  renderComposerState();
}

async function editUserMessage(index) {
  if (!state.session || state.generating) return;
  const m = state.session.messages[index];
  if (!m || m.role !== 'user') return;
  const input = $('#composer-input');
  if (input) input.value = m.content || '';
  state.pendingAttachments = cloneJson(m.attachments || []);
  state.session.messages.splice(index);
  await persistSession();
  renderChat();
  renderPendingAttachments();
  renderComposerState();
  input?.focus();
}

function switchAssistantVariant(index, delta) {
  if (state.generating || !state.session) return;
  const m = state.session.messages[index];
  if (!m || m.role !== 'assistant') return;
  ensureAssistantVariants(m);
  const next = Math.max(0, Math.min(m.variants.length - 1, (m.activeVariantIndex || 0) + delta));
  if (next === (m.activeVariantIndex || 0)) return;
  applyAssistantVariant(m, next);
  persistSession();
  renderChat();
  renderComposerState();
}

async function regenerateMessage(index) {
  if (state.generating || !state.session) return;
  const m = state.session.messages[index];
  if (!m || m.role !== 'assistant') return;
  if (!canRegenerateMessage(index)) {
    const later = state.session.messages.slice(index + 1).some((x) => x.role === 'user' || x.role === 'assistant');
    UIDialog.toast(later ? '已有后续消息，只能查看现有版本' : '每条回复最多保留 6 个版本');
    return;
  }
  await generateAssistant({ targetIndex: index });
}

function toolStatusLabel(status) {
  return ({
    composing: '组装中',
    running: '执行中',
    done: '完成',
    error: '错误',
    cancelled: '已停止',
  })[status] || status || '';
}

function toolPermissionKey(name) {
  if (name === 'run_js') return 'run_js';
  if (name === 'web_fetch') return 'web_fetch';
  if (name === 'image_go' || name === 'image_generation') return 'image_go';
  if (name === 'delete_file') return 'delete_files';
  // Windows has no run_service; remaining FS tools share "files".
  return 'files';
}

function toolPermissionLabel(nameOrKey) {
  const key = TOOL_PERM_KEYS.includes(nameOrKey) ? nameOrKey : toolPermissionKey(nameOrKey);
  return TOOL_PERM_LABELS[key] || String(nameOrKey || '工具');
}

function toolPermission(nameOrKey) {
  const key = TOOL_PERM_KEYS.includes(nameOrKey) ? nameOrKey : toolPermissionKey(nameOrKey);
  const perms = normalizeToolPermissions(state.settings?.toolPermissions);
  let mode = perms[key] || 'ask';
  if (key === 'delete_files' && mode === 'always') mode = 'ask';
  return mode;
}

let persistPermTimer = null;

function setToolPermission(key, mode) {
  if (!TOOL_PERM_KEYS.includes(key)) return;
  let next = normalizeToolMode(mode);
  if (key === 'delete_files' && next === 'always') next = 'ask';
  const toolPermissions = {
    ...normalizeToolPermissions(state.settings?.toolPermissions),
    [key]: next,
  };
  state.settings = {
    ...(state.settings || defaultSettings()),
    toolPermissions,
  };
  renderToolPermissions();
  // 立刻持久化（防抖），不必点「保存」
  schedulePersistToolSettings();
}

function schedulePersistToolSettings() {
  clearTimeout(persistPermTimer);
  persistPermTimer = setTimeout(() => {
    persistToolSettingsNow().catch((err) => console.warn('persist tool settings', err));
  }, 280);
}

async function persistToolSettingsNow() {
  const prev = state.settings || defaultSettings();
  const agentBtn = $('#agent-enabled');
  const rounds = $('#agent-max-rounds');
  const calls = $('#agent-max-calls');
  const next = {
    ...defaultSettings(),
    ...prev,
    providers: state.providers,
    agentEnabled: agentBtn
      ? agentBtn.getAttribute('aria-pressed') === 'true'
      : prev.agentEnabled !== false,
    maxToolRounds: rounds
      ? U.clamp(parseInt(rounds.value || 8, 10), 1, 32)
      : (prev.maxToolRounds ?? 8),
    maxToolCalls: calls
      ? U.clamp(parseInt(calls.value || 24, 10), 1, 128)
      : (prev.maxToolCalls ?? 24),
    toolPermissions: normalizeToolPermissions(
      readToolPermissionsFromUi?.() || prev.toolPermissions
    ),
  };
  try {
    const saved = await invoke('save_settings', { settings: next });
    state.settings = {
      ...defaultSettings(),
      ...(saved || {}),
      providers: state.providers,
      toolPermissions: normalizeToolPermissions(saved?.toolPermissions || next.toolPermissions),
    };
  } catch (err) {
    console.warn('Unable to persist tool settings:', err);
  }
}

function formatToolArgsPreview(args, limit) {
  try {
    const obj = typeof args === 'string' ? JSON.parse(args || '{}') : (args || {});
    return U.truncate(JSON.stringify(obj, null, 2), limit || 900);
  } catch {
    return U.truncate(String(args || ''), limit || 900);
  }
}

async function authorizeToolCall(t) {
  const key = toolPermissionKey(t.name);
  let mode = toolPermission(t.name);
  if (key === 'delete_files' && mode === 'always') mode = 'ask';
  const label = toolPermissionLabel(t.name);
  if (mode === 'never') return '错误：用户已禁止工具：' + label;
  if (mode === 'always') return '';

  if (key === 'delete_files') {
    let preview = '';
    try {
      const args = typeof t.arguments === 'string' ? JSON.parse(t.arguments || '{}') : (t.arguments || {});
      const paths = Array.isArray(args.paths) ? args.paths : (args.path ? [args.path] : []);
      preview = paths.length ? paths.join('\n') : formatToolArgsPreview(t.arguments, 400);
    } catch {
      preview = formatToolArgsPreview(t.arguments, 400);
    }
    const ok = await UIDialog.confirm(
      'AI 请求删除以下路径：\n' + preview + '\n\n删除后无法从应用内恢复。',
      '确认删除',
      { danger: true, okText: '删除' }
    );
    return ok ? '' : '错误：用户拒绝了工具调用：' + label;
  }

  const ok = await UIDialog.confirm(
    'AI 请求使用工具：' + label + '\n\n' +
    '工具名：' + t.name + '\n' +
    '参数：\n' + formatToolArgsPreview(t.arguments, 900),
    '工具授权'
  );
  return ok ? '' : '错误：用户拒绝了工具调用：' + label;
}

function buildToolContext(assistantMsg, session = state.session) {
  // After authorizeToolCall gates group-level ask/never, pass web_fetch as
  // always (unless never) so GET is not double-confirmed — same as Android.
  const webFetchPerm = toolPermission('web_fetch');
  return {
    sessionId: session?.id,
    session,
    webFetchMode: webFetchPerm === 'never' ? 'never' : 'always',
    previousResults: [],
    confirm: (msg) => UIDialog.confirm(String(msg), '工具授权'),
    openPreview: (payload) => {
      if (state.session?.id === session?.id) openPreview(payload);
    },
    onWorkspaceChanged: () => {
      if (state.session?.id !== session?.id) return;
      if (state.rightOpen) refreshFilesTree();
      refreshBrowserIfOpen();
    },
    onImagesSaved: (saved) => {
      if (!assistantMsg || !Array.isArray(saved)) return;
      assistantMsg.images = (assistantMsg.images || []).concat(saved.map((image) => ({
        path: image.path || '',
        mime: image.mime || 'image/png',
        dataUrl: image.dataUrl || '',
        prompt: image.prompt || '',
        revisedPrompt: image.revisedPrompt || '',
        imageMeta: image.imageMeta,
      })));
       if (state.session?.id === session?.id) renderChat();
    },
    onRunJs: (info) => {
      state.lastRunJs = info;
      if (state.session?.id !== session?.id) return;
      if (state.rightOpen) {
        const tab = state.rightTabs.find((t) => t.id === state.activeRightTabId);
        if (tab?.kind === 'runner') renderRightContent();
      }
    },
  };
}

function settingsForRequest(tools) {
  const base = {
    systemPrompt: state.settings?.systemPrompt || '',
    temperature: state.settings?.temperature ?? null,
    maxTokens: state.settings?.maxTokens || null,
  };
  if (tools && tools.length && window.Tools?.SYSTEM_HINT) {
    base.systemPrompt = [base.systemPrompt, Tools.SYSTEM_HINT].filter(Boolean).join('\n\n');
  }
  return base;
}

async function generateAssistant(opts = {}) {
  const session = opts.session || state.session;
  const provider = state.providers.find((item) => item.id === session?.providerId) || null;
  const model = session?.model || '';
  if (!provider || !model || !session || state.deletedSessionIds.has(session.id)) return;
  const existingTask = state.backgroundTasks.get(session.id);
  if (existingTask?.status === 'running') return;
  ensureSessionContext(session, provider, model);
  const task = {
    sessionId: session.id,
    session,
    providerId: provider.id,
    model,
    abortCtl: new AbortController(),
    stopRequested: false,
    status: 'running',
    unread: false,
    startedAt: nowIso(),
  };
  const startedMs = Date.now();
  state.backgroundTasks.set(session.id, task);
  const refresh = () => {
    renderSessions();
    if (state.session?.id === session.id) {
      renderChat();
      renderComposerState();
    }
  };

  const targetIndex = Number.isInteger(opts.targetIndex) ? opts.targetIndex : -1;
  let assistantMsg;
  if (targetIndex >= 0) {
    assistantMsg = session.messages[targetIndex];
    if (!assistantMsg || assistantMsg.role !== 'assistant') {
      state.backgroundTasks.delete(session.id);
      return;
    }
    const variants = ensureAssistantVariants(assistantMsg);
    const nextVariant = snapshotAssistantVariant({
      content: '', reasoning: '', toolCalls: [], error: '', usage: null, model, createdAt: nowIso(), status: 'streaming',
    }, uid('variant'));
    variants.push(nextVariant);
    assistantMsg.activeVariantIndex = variants.length - 1;
    applyAssistantVariant(assistantMsg, assistantMsg.activeVariantIndex);
    assistantMsg.status = 'streaming';
    assistantMsg.model = model;
    assistantMsg.toolCalls = [];
  } else {
    assistantMsg = normalizeMessage({
      id: uid('message'),
      role: 'assistant',
      content: '',
      reasoning: '',
      toolCalls: [],
      status: 'streaming',
      model,
      createdAt: nowIso(),
    });
    assistantMsg.variantBaseId = assistantMsg.id + ':v1';
    session.messages.push(assistantMsg);
  }

  const assistantIndex = session.messages.indexOf(assistantMsg);
  const workingMessages = session.messages
    .slice(0, assistantIndex)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      if (m.role === 'assistant') {
        return { role: 'assistant', content: m.content || '', reasoning: m.reasoning || '' };
      }
      const attachments = cloneJson(m.attachments || []);
      if (session.contextVision === false) {
        attachments.forEach((att) => {
          if (att?.kind === 'image') delete att.dataUrl;
        });
      }
      return { role: 'user', content: m.content || '', attachments };
    });

  const agentOn = state.settings?.agentEnabled !== false;
  const tools = (agentOn && window.API?.supportsTools?.(provider) && window.Tools?.DEFS)
    ? Tools.DEFS
    : [];
  const reqSettings = settingsForRequest(tools);
  const maxToolRounds = U.clamp(parseInt(state.settings?.maxToolRounds || 8, 10), 1, 32);
  const maxToolCalls = U.clamp(parseInt(state.settings?.maxToolCalls || 24, 10), 1, 128);
  let totalToolCalls = 0;
  const previousToolResults = [];
  const toolCtx = buildToolContext(assistantMsg, session);

  session.providerId = provider.id;
  session.model = model;
  if (state.session?.id === session.id) {
    state.generating = true;
    state.stopRequested = false;
    state.abortCtl = task.abortCtl;
  }
  refresh();
  if (state.backgroundTasks.get(session.id) === task) await persistSession(session);

  const TS = window.ToolStream || {};

  try {
    for (let step = 0; step <= maxToolRounds; step++) {
      const result = await API.send({
        provider,
        model,
        messages: workingMessages,
        tools,
        settings: reqSettings,
        signal: task.abortCtl.signal,
        requestKey: NetStability.idempotencyKey('chat-' + assistantMsg.id + '-' + step),
        onUpdate(stream) {
          assistantMsg.content = stream?.content || '';
          assistantMsg.reasoning = stream?.reasoning || '';
          assistantMsg.usage = stream?.usage || null;
          if (stream?.streamTools?.length && TS.syncStreamToolCalls) {
            TS.syncStreamToolCalls(assistantMsg, stream.streamTools, step);
            // write_file 参数流式 → 预览 staging（不落盘）
            if (state.session?.id === session.id) {
              window.PreviewStream?.syncFromTools?.(stream.streamTools);
            }
          }
          assistantMsg.status = 'streaming';
          if (assistantMsg.variants?.length) syncActiveAssistantVariant(assistantMsg);
          // 40ms 合并 + rAF 对齐的局部更新，不再逐 token 重建整个消息列表
          if (state.session?.id === session.id) scheduleStreamUpdate(session, assistantMsg);
        },
      });

      assistantMsg.content = result?.content || assistantMsg.content;
      assistantMsg.reasoning = result?.reasoning || assistantMsg.reasoning;
      assistantMsg.usage = result?.usage || assistantMsg.usage || null;

      if (task.stopRequested) {
        TS.cancelStreamToolCalls?.(assistantMsg, step);
        break;
      }
      if (!tools.length || !result?.toolCalls?.length) {
        TS.discardStreamToolCalls?.(assistantMsg, step);
        break;
      }

      const rawCalls = result.toolCalls.filter((t) => t && t.name);
      if (!rawCalls.length) {
        TS.discardStreamToolCalls?.(assistantMsg, step);
        break;
      }
      if (step >= maxToolRounds) {
        TS.discardStreamToolCalls?.(assistantMsg, step);
        assistantMsg.error = '已达到最大工具轮次（' + maxToolRounds + '）。可在设置中调高「最大工具轮次」。';
        break;
      }
      if (totalToolCalls + rawCalls.length > maxToolCalls) {
        TS.discardStreamToolCalls?.(assistantMsg, step);
        assistantMsg.error = '已达到最大工具调用数（' + maxToolCalls + '）。可在设置中调高「最大工具调用数」。';
        break;
      }
      totalToolCalls += rawCalls.length;

      const displayCalls = TS.finalizeStreamToolCalls
        ? TS.finalizeStreamToolCalls(assistantMsg, rawCalls, step)
        : rawCalls.map((t, idx) => {
          const d = {
            id: t.id || ('call_' + step + '_' + idx),
            name: t.name,
            arguments: t.arguments || '{}',
            status: 'running',
            result: null,
            _open: false,
          };
          assistantMsg.toolCalls = assistantMsg.toolCalls || [];
          assistantMsg.toolCalls.push(d);
          return d;
        });

      // 参数完整：立刻刷一帧完整预览（绕过 throttle）
      if (state.session?.id === session.id) {
        window.PreviewStream?.syncFromTools?.(rawCalls, { immediate: true, forceComplete: true });
      }

      workingMessages.push({
        role: 'assistant',
        content: result.content || '',
        toolCalls: rawCalls.map((t, idx) => ({
          id: t.id || displayCalls[idx].id,
          name: t.name,
          arguments: t.arguments || '{}',
        })),
      });
      if (assistantMsg.variants?.length) syncActiveAssistantVariant(assistantMsg);
      if (state.session?.id === session.id) renderChat();
      // S2：工具轮边界只增量写当前助手消息，避免整会话重写
      if (state.backgroundTasks.get(session.id) === task) await persistActiveMessage(session, assistantMsg);

      for (let ti = 0; ti < displayCalls.length; ti++) {
        const t = displayCalls[ti];
        toolCtx.previousResults = previousToolResults;
        const denied = await authorizeToolCall(t);
        const out = denied || await Tools.execute(t.name, t.arguments, toolCtx);
        t.result = out;
        t.status = String(out).startsWith('错误：') ? 'error' : 'done';
        // 完成后默认收起
        t._open = false;
        t._userOpen = false;
        if (t.name === 'write_file' && state.session?.id === session.id) {
          settleWriteFilePreview(t, t.status === 'done');
        }
        previousToolResults.push({ name: t.name, result: out });
        workingMessages.push({ role: 'tool', toolCallId: t.id, content: out });
        if (assistantMsg.variants?.length) syncActiveAssistantVariant(assistantMsg);
        if (state.session?.id === session.id) renderChat();
        if (state.backgroundTasks.get(session.id) === task) await persistActiveMessage(session, assistantMsg);
      }
    }

    if (!assistantMsg.content && !(assistantMsg.toolCalls || []).length && task.stopRequested) {
      assistantMsg.content = '已停止。';
    }
    assistantMsg.status = 'done';
    if (assistantMsg.variants?.length) {
      ensureAssistantVariants(assistantMsg);
      syncActiveAssistantVariant(assistantMsg);
    }
  } catch (err) {
    assistantMsg.status = 'error';
    if (task.stopRequested || err?.code === 'NET-ABORTED') {
      if (!assistantMsg.content && !(assistantMsg.toolCalls || []).length) assistantMsg.content = '已停止。';
      assistantMsg.status = 'done';
      assistantMsg.error = '';
    } else {
      assistantMsg.error = NetStability.display(err);
    }
    if (assistantMsg.variants?.length) syncActiveAssistantVariant(assistantMsg);
  } finally {
    assistantMsg.durationMs = Date.now() - startedMs;
    if (assistantMsg.variants?.length) syncActiveAssistantVariant(assistantMsg);
    const registered = state.backgroundTasks.get(session.id) === task;
    task.status = task.stopRequested ? 'stopped' : (assistantMsg.status === 'error' ? 'error' : 'done');
    task.unread = registered && state.session?.id !== session.id && task.status !== 'stopped';
    if (state.session?.id === session.id) {
      state.generating = false;
      state.abortCtl = null;
      state.stopRequested = false;
      // 结束本轮后去掉「流式」徽标；正式落盘的路径已由 settleWriteFilePreview 清理
      state.rightTabs.forEach((tab) => {
        if (tab.kind === 'browser' && tab.streaming) tab.streaming = false;
      });
      renderRightTabs();
      renderChat();
      renderComposerState();
      settleCodeArtifacts(assistantMsg);
    }
    renderSessions();
    if (registered) await persistSession(session);
  }
}

async function sendMessage() {
  if (state.generating) {
    const task = state.session?.id ? state.backgroundTasks.get(state.session.id) : null;
    if (task) task.stopRequested = true;
    state.stopRequested = true;
    state.abortCtl?.abort();
    return;
  }
  if (isBranchBlocked()) {
    UIDialog.toast('当前是旧回答分支，请先切回后续消息使用的版本');
    return;
  }
  const input = $('#composer-input');
  const content = input?.value.trim() || '';
  const attachments = cloneJson(state.pendingAttachments || []);
  const session = state.session;
  const provider = activeSessionProvider();
  const model = session?.model || '';
  if ((!content && !attachments.length) || !provider || !model || !session) return;

  const messages = session.messages || [];
  let parentAssistant = null;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'assistant') {
      parentAssistant = messages[i];
      break;
    }
  }
  const user = normalizeMessage({
    id: uid('message'),
    role: 'user',
    content,
    attachments,
    createdAt: nowIso(),
    parentAssistantId: parentAssistant?.id || '',
    parentVariantId: parentAssistant ? activeAssistantVariantId(parentAssistant) : '',
  });
  session.providerId = provider.id;
  session.model = model;
  ensureSessionContext(session, provider, model);
  if (attachments.some((att) => att.kind === 'image') && !currentModelHasVision()) {
    UIDialog.toast('当前模型无多模态能力，图片会作为工作区文件路径进入上下文。', 4500);
  }
  if (hasUntitledSessionTitle(session.title)) {
    const baseTitle = content
      ? content.split(/\r?\n/)[0].replace(/\s+/g, ' ').trim()
      : `附件：${attachments.map((att) => att.name || att.path).filter(Boolean).slice(0, 3).join(', ')}`;
    session.title = baseTitle.slice(0, 48);
  }
  session.messages.push(user);
  input.value = '';
  state.pendingAttachments = [];
  renderPendingAttachments();
  renderSessions();
  if (state.session?.id === session.id) {
    renderChat();
    renderComposerState();
    ChatScroll.jumpToBottom();
  }
  await persistSession(session);
  await generateAssistant({ session });
}

function pickFilesForWorkspace({ attach = true } = {}) {
  const input = attach ? $('#composer-file-input') : document.createElement('input');
  if (!input) return;
  input.type = 'file';
  input.multiple = true;
  input.onchange = async () => {
    const files = Array.from(input.files || []);
    input.value = '';
    input.onchange = null;
    await importFilesToWorkspace(files, { attach });
  };
  input.click();
}

function dragHasChatAttachment(dataTransfer) {
  const types = Array.from(dataTransfer?.types || []);
  const lowered = types.map((type) => String(type || '').toLowerCase());
  return !!draggingWorkspacePath
    || lowered.includes('files')
    || lowered.includes(WORKSPACE_DRAG_MIME)
    || lowered.includes('text/x-wepchat-workspace-path');
}

function filesFromTransfer(dataTransfer) {
  const files = Array.from(dataTransfer?.files || []).filter(Boolean);
  if (files.length) return files;
  return Array.from(dataTransfer?.items || [])
    .filter((item) => item.kind === 'file')
    .map((item) => item.getAsFile())
    .filter(Boolean);
}

function setComposerDragOver(on) {
  $('.composer')?.classList.toggle('is-drag-over', !!on);
  $('.composer-box')?.classList.toggle('is-drag-over', !!on);
}

async function handleComposerDrop(event) {
  const dt = event.dataTransfer;
  if (!dragHasChatAttachment(dt)) return;
  event.preventDefault();
  setComposerDragOver(false);
  const files = filesFromTransfer(dt);
  if (files.length) {
    await importFilesToWorkspace(files, { attach: true });
    return;
  }
  const path = dt.getData(WORKSPACE_DRAG_MIME)
    || dt.getData('text/x-wepchat-workspace-path')
    || draggingWorkspacePath;
  if (path) await addWorkspacePathToComposer(path);
  draggingWorkspacePath = '';
}

function hideContextMenu() {
  const menu = $('#context-menu');
  if (!menu) return;
  menu.hidden = true;
  menu.innerHTML = '';
}

function isEditableElement(el) {
  return !!el?.closest?.('textarea, input, [contenteditable="true"]');
}

function selectedTextOf(target) {
  const editable = target?.closest?.('textarea, input');
  if (editable && typeof editable.selectionStart === 'number') {
    return editable.value.slice(editable.selectionStart, editable.selectionEnd);
  }
  return String(window.getSelection?.()?.toString() || '');
}

async function runContextAction(action, target) {
  const editable = target?.closest?.('textarea, input');
  editable?.focus?.();
  try {
    if (action === 'copy') {
      const text = selectedTextOf(target);
      if (text) await navigator.clipboard.writeText(text);
    } else if (action === 'cut' && editable) {
      const text = selectedTextOf(editable);
      if (text) await navigator.clipboard.writeText(text);
      document.execCommand('delete');
      resizeChatComposer();
      renderComposerState();
    } else if (action === 'paste' && editable) {
      const text = await navigator.clipboard.readText();
      document.execCommand('insertText', false, text);
      resizeChatComposer();
      renderComposerState();
    } else if (action === 'select-all') {
      if (editable?.select) editable.select();
      else document.execCommand('selectAll');
    }
  } catch {
    UIDialog.toast('操作失败，可能需要剪贴板权限');
  }
}

function showContextMenu(event) {
  const menu = $('#context-menu');
  if (!menu) return;
  event.preventDefault();
  closeModelPicker();
  const target = event.target;
  const editable = isEditableElement(target);
  const hasSelection = Boolean(selectedTextOf(target));
  const items = [
    editable && { label: '剪切', kbd: 'Ctrl+X', action: 'cut', disabled: !hasSelection },
    { label: '复制', kbd: 'Ctrl+C', action: 'copy', disabled: !hasSelection },
    editable && { label: '粘贴', kbd: 'Ctrl+V', action: 'paste', disabled: false },
    { sep: true },
    { label: '全选', kbd: 'Ctrl+A', action: 'select-all', disabled: false },
  ].filter(Boolean);
  menu.innerHTML = '';
  items.forEach((item) => {
    if (item.sep) {
      const sep = document.createElement('div');
      sep.className = 'context-menu-sep';
      menu.appendChild(sep);
      return;
    }
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'context-menu-item';
    btn.disabled = !!item.disabled;
    const label = document.createElement('span');
    label.textContent = item.label;
    const kbd = document.createElement('span');
    kbd.className = 'context-menu-kbd';
    kbd.textContent = item.kbd || '';
    btn.append(label, kbd);
    btn.addEventListener('mousedown', (ev) => ev.preventDefault());
    btn.addEventListener('click', async () => {
      hideContextMenu();
      await runContextAction(item.action, target);
    });
    menu.appendChild(btn);
  });
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const x = Math.min(event.clientX, window.innerWidth - rect.width - 8);
  const y = Math.min(event.clientY, window.innerHeight - rect.height - 8);
  menu.style.left = `${Math.max(8, x)}px`;
  menu.style.top = `${Math.max(8, y)}px`;
}

/* ---------- Global events and backend bootstrap ---------- */

function bindEvents() {
  $all('.rail-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  $all('.settings-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => setSettingsPage(btn.dataset.settings));
  });

  bindAppearanceEvents({ persistSettings });

  $('#btn-new-chat')?.addEventListener('click', () => createNewChat());
  $('#btn-new-chat-top')?.addEventListener('click', () => createNewChat());
  $('#session-search')?.addEventListener('input', (event) => {
    state.sessionSearchQuery = event.target.value || '';
    renderSessions();
  });
  // image new session handled by ImageMode.bindUi
  $('#btn-save-agent')?.addEventListener('click', () => saveAgentSettings());
  $('#btn-save-image-settings')?.addEventListener('click', () => saveImageSettings());
  $('#btn-toggle-image-canvas')?.addEventListener('click', () => {
    if (state.rightOpen && state.rightTabs.some((t) => t.kind === 'canvas' && t.id === state.activeRightTabId)) {
      setRightOpen(false);
    } else {
      showImageCanvasPane();
    }
  });
  $('#agent-enabled')?.addEventListener('click', () => {
    const btn = $('#agent-enabled');
    if (!btn) return;
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('on', on);
    if (state.settings) state.settings.agentEnabled = on;
    schedulePersistToolSettings();
  });
  // 轮次/调用数变更也自动保存
  $('#agent-max-rounds')?.addEventListener('change', () => schedulePersistToolSettings());
  $('#agent-max-calls')?.addEventListener('change', () => schedulePersistToolSettings());
  $('#tool-perm-list')?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('.seg-btn');
    if (!btn) return;
    const row = btn.closest('.tool-perm-row');
    const key = row?.dataset.permKey;
    if (!key) return;
    setToolPermission(key, btn.dataset.mode);
  });
  document.addEventListener('click', () => {
    closeSessionMenus();
    closeModelPicker();
    hideContextMenu();
  });
  document.addEventListener('contextmenu', showContextMenu);
  document.addEventListener('scroll', hideContextMenu, true);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      closeModelPicker();
      hideContextMenu();
    }
  });
  $('#model-picker-popover')?.addEventListener('click', (event) => event.stopPropagation());
  $('#context-menu')?.addEventListener('click', (event) => event.stopPropagation());

  $('#btn-add-provider')?.addEventListener('click', () => openProviderDialog());
  $('#btn-close-provider')?.addEventListener('click', closeProviderDialog);
  $('#btn-cancel-provider')?.addEventListener('click', closeProviderDialog);
  $('#btn-delete-provider')?.addEventListener('click', () => deleteProviderFromDialog());
  $('#provider-form')?.addEventListener('submit', saveProvider);
  $('#btn-fetch-models')?.addEventListener('click', fetchProviderModels);
  $('#btn-test-provider')?.addEventListener('click', testProvider);
  $('#btn-add-model')?.addEventListener('click', () => addProviderModel());
  $('#btn-toggle-provider-key')?.addEventListener('click', () => {
    const input = $('#provider-api-key');
    const button = $('#btn-toggle-provider-key');
    if (!input || !button) return;
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    button.textContent = show ? '隐藏' : '显示';
  });
  $('#btn-close-model-editor')?.addEventListener('click', closeModelEditor);
  $('#btn-cancel-model-editor')?.addEventListener('click', closeModelEditor);
  $('#btn-save-model-editor')?.addEventListener('click', saveModelEditor);
  $('#btn-delete-model')?.addEventListener('click', () => deleteModelFromEditor());
  const modelDlg = $('#model-editor-dialog');
  if (modelDlg) {
    modelDlg.addEventListener('cancel', (event) => {
      event.preventDefault();
      closeModelEditor();
    });
    modelDlg.addEventListener('click', (event) => {
      if (event.target === modelDlg) closeModelEditor();
    });
  }
  $all('#model-editor-caps .model-editor-cap').forEach((row) => {
    const sw = row.querySelector('.switch');
    if (!sw) return;
    sw.addEventListener('click', () => toggleModelEditorCap(row.dataset.cap));
  });

  $('#model-select')?.addEventListener('change', async (event) => {
    const [providerId, model] = event.target.value.split('\n');
    await selectChatModel(providerId, model);
  });
  $('#model-picker-btn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    toggleModelPicker();
  });

  $('#btn-send')?.addEventListener('click', sendMessage);
  $('#btn-attach')?.addEventListener('click', () => pickFilesForWorkspace({ attach: true }));
  $('#composer-input')?.addEventListener('input', () => {
    resizeChatComposer();
    renderComposerState();
  });
  $('#composer-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });
  $('#composer-input')?.addEventListener('paste', async (event) => {
    const files = filesFromTransfer(event.clipboardData);
    if (!files.length) return;
    event.preventDefault();
    await importFilesToWorkspace(files, { attach: true });
  });
  const composer = $('.composer');
  composer?.addEventListener('dragenter', (event) => {
    if (!dragHasChatAttachment(event.dataTransfer)) return;
    event.preventDefault();
    setComposerDragOver(true);
  });
  composer?.addEventListener('dragover', (event) => {
    if (!dragHasChatAttachment(event.dataTransfer)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    setComposerDragOver(true);
  });
  composer?.addEventListener('dragleave', (event) => {
    if (!composer.contains(event.relatedTarget)) setComposerDragOver(false);
  });
  composer?.addEventListener('drop', handleComposerDrop);
  document.addEventListener('dragend', () => {
    draggingWorkspacePath = '';
    setComposerDragOver(false);
  });
  document.addEventListener('drop', () => {
    setTimeout(() => {
      draggingWorkspacePath = '';
      setComposerDragOver(false);
    }, 0);
  });
  $('#chat-scroll')?.addEventListener('click', async (event) => {
    const button = event.target.closest('.code-btn');
    if (!button) return;
    const blockEl = button.closest('.code-block');
    if (!blockEl) return;
    if (button.dataset.act === 'copy') {
      const code = blockEl.querySelector('code')?.textContent || '';
      try {
        await navigator.clipboard.writeText(code);
        const before = button.textContent;
        button.textContent = '已复制';
        setTimeout(() => { button.textContent = before; }, 1200);
      } catch (err) {
        console.warn('Unable to copy code:', err);
      }
      return;
    }
    if (button.dataset.act === 'preview') {
      const code = blockEl.querySelector('code')?.textContent || '';
      const lang = blockEl.querySelector('.code-lang')?.textContent?.trim() || 'html';
      const messageId = button.closest('.chat-message')?.dataset.messageId || '';
      const bodyEl = button.closest('.chat-message-body');
      const fenceIndex = bodyEl
        ? Math.max(0, [...bodyEl.querySelectorAll('.code-block')].indexOf(blockEl))
        : 0;
      if (messageId) openCodeArtifact({ messageId, fenceIndex, lang, code });
    }
  });

  $('#btn-toggle-workspace')?.addEventListener('click', () => {
    setRightOpen(!state.rightOpen);
  });
  $('#btn-close-right')?.addEventListener('click', () => setRightOpen(false));

  $('#btn-save-workspace')?.addEventListener('click', saveWorkspaceSettings);
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape') return;
    if ($('#app-dlg')?.open) return;
    if ($('#model-editor-dialog')?.open) return;
    if ($('#provider-dialog')?.open) return;
    if (state.rightOpen) setRightOpen(false);
  });
}

function renderBackendState() {
  const settings = state.settings || {};
  const custom = $('#workspace-custom');
  const resolved = $('#workspace-resolved');
  const defaultNote = $('#workspace-default-note');
  const about = $('#about-meta');

  if (custom) custom.value = settings.workspaceRoot || '';
  if (resolved) resolved.value = state.resolvedWorkspaceRoot || '';
  if (defaultNote && state.defaultWorkspaceRoot) {
    defaultNote.textContent = `默认路径：${state.defaultWorkspaceRoot}`;
  }
  if (about && state.meta) {
    const version = state.meta.version ? ` v${state.meta.version}` : '';
    about.textContent = `${state.meta.name || 'WePChat'}${version} · Windows`;
  }
  const agentBtn = $('#agent-enabled');
  if (agentBtn) {
    const on = settings.agentEnabled !== false;
    agentBtn.classList.toggle('on', on);
    agentBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
  }
  const rounds = $('#agent-max-rounds');
  if (rounds) rounds.value = String(settings.maxToolRounds ?? 8);
  const calls = $('#agent-max-calls');
  if (calls) calls.value = String(settings.maxToolCalls ?? 24);
  renderToolPermissions();
  renderThemeUI();
  renderProviders();
  renderSessions();
  renderModelSelect();
  renderComposerState();
  renderChat();
}

function renderToolPermissions() {
  const perms = normalizeToolPermissions(state.settings?.toolPermissions);
  $all('.tool-perm-row').forEach((row) => {
    const key = row.dataset.permKey;
    if (!key) return;
    const mode = perms[key] || 'ask';
    row.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.classList.toggle('is-on', btn.dataset.mode === mode);
    });
  });
}

function readToolPermissionsFromUi() {
  const perms = normalizeToolPermissions(state.settings?.toolPermissions);
  $all('.tool-perm-row').forEach((row) => {
    const key = row.dataset.permKey;
    if (!TOOL_PERM_KEYS.includes(key)) return;
    const on = row.querySelector('.seg-btn.is-on');
    let mode = normalizeToolMode(on?.dataset.mode || perms[key]);
    if (key === 'delete_files' && mode === 'always') mode = 'ask';
    perms[key] = mode;
  });
  return perms;
}

async function saveAgentSettings() {
  const status = $('#agent-status');
  const agentBtn = $('#agent-enabled');
  const rounds = $('#agent-max-rounds');
  const calls = $('#agent-max-calls');
  const next = {
    ...(state.settings || defaultSettings()),
    providers: state.providers,
    agentEnabled: agentBtn ? agentBtn.getAttribute('aria-pressed') === 'true' : true,
    maxToolRounds: U.clamp(parseInt(rounds?.value || 8, 10), 1, 32),
    maxToolCalls: U.clamp(parseInt(calls?.value || 24, 10), 1, 128),
    toolPermissions: readToolPermissionsFromUi(),
  };
  if (status) status.textContent = '保存中…';
  try {
    const saved = await invoke('save_settings', { settings: next });
    state.settings = {
      ...defaultSettings(),
      ...(saved || {}),
      providers: state.providers,
      toolPermissions: normalizeToolPermissions(saved?.toolPermissions || next.toolPermissions),
    };
    if (status) status.textContent = '已保存';
    UIDialog.toast('工具设置已保存');
    renderBackendState();
  } catch (err) {
    if (status) status.textContent = '保存失败';
    UIDialog.toast(err?.message || String(err));
  }
}

async function loadBackend() {
  try {
    const [meta, settings, defaultRoot, resolvedRoot, sessions] = await Promise.all([
      invoke('get_app_meta'),
      invoke('get_settings'),
      invoke('get_default_workspace_root'),
      invoke('resolve_workspace_root'),
      invoke('list_sessions'),
    ]);
    state.meta = meta || null;
    state.settings = {
      ...defaultSettings(),
      ...(settings || {}),
      toolPermissions: normalizeToolPermissions(settings?.toolPermissions),
    };
    state.defaultWorkspaceRoot = defaultRoot || '';
    state.resolvedWorkspaceRoot = resolvedRoot || '';
    state.providers = Array.isArray(state.settings.providers)
      ? state.settings.providers.map((item) => normalizeProvider(item))
      : [];
    state.sessions = Array.isArray(sessions) ? sessions.map((item) => normalizeSession(item)) : [];
    const remembered = rememberedSessionId();
    const initialSession = state.sessions.find((session) => session.id === remembered) || state.sessions[0];
    if (initialSession) {
      try {
        state.session = await loadChatSessionInitial(initialSession.id);
      } catch (err) {
        // 索引项不含消息，加载失败时新建会话，避免把有内容的会话当空会话覆盖
        console.warn('load first session failed:', err);
        state.session = createSession();
        await persistSession();
      }
    } else {
      state.session = createSession();
      await persistSession();
    }
    rememberActiveSession(state.session);
    if (state.session?.mode === 'image') state.lastImageSessionId = state.session.id;
    else if (state.session?.id) state.lastChatSessionId = state.session.id;
    await hydrateSessionImages(state.session);
  } catch (err) {
    console.warn('Backend bootstrap unavailable:', err);
    state.settings ||= defaultSettings();
    state.providers = Array.isArray(state.settings.providers) ? state.settings.providers.map(normalizeProvider) : [];
    state.session ||= createSession();
  }
  renderBackendState();
}

async function saveWorkspaceSettings() {
  const input = $('#workspace-custom');
  const status = $('#workspace-status');
  if (!input) return;

  const prev = state.settings || defaultSettings();
  const next = {
    ...defaultSettings(),
    ...prev,
    providers: state.providers,
    workspaceRoot: input.value.trim() || null,
    toolPermissions: normalizeToolPermissions(prev.toolPermissions),
  };
  if (status) status.textContent = '保存中…';
  try {
    const saved = await invoke('save_settings', { settings: next });
    state.settings = {
      ...defaultSettings(),
      ...(saved || {}),
      providers: state.providers,
      toolPermissions: normalizeToolPermissions(saved?.toolPermissions || next.toolPermissions),
    };
    state.resolvedWorkspaceRoot = await invoke('resolve_workspace_root');
    renderBackendState();
    if (status) status.textContent = '已保存';
  } catch (err) {
    console.warn('Unable to save workspace settings:', err);
    if (status) status.textContent = '保存失败';
  }
}

/* ---------- Right pane ---------- */

function renderRightPane() {
  if (!state.rightOpen) return;
  const pane = $('#right-pane');
  if (!pane) return;

  if (!state.rightTabs.some((tab) => tab.id === state.activeRightTabId)) {
    state.activeRightTabId = state.rightTabs[0]?.id || null;
  }

  renderRightTabs();
  renderRightContent();
}

function renderRightTabs() {
  const host = $('#right-tabs');
  if (!host) return;
  host.innerHTML = '';

  state.rightTabs.forEach((tab) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'rp-tab' + (tab.id === state.activeRightTabId ? ' is-active' : '');
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', tab.id === state.activeRightTabId ? 'true' : 'false');
    el.innerHTML = `<span class="rp-tab-label"></span><span class="rp-tab-close" title="关闭">×</span>`;
    const label = tab.streaming
      ? (tab.title || '浏览器') + ' · 生成中'
      : (tab.title || '');
    el.querySelector('.rp-tab-label').textContent = label;
    if (tab.streaming) el.classList.add('is-streaming');
    el.addEventListener('click', (e) => {
      if (e.target.closest('.rp-tab-close')) {
        e.stopPropagation();
        closeRightTab(tab.id);
        return;
      }
      state.activeRightTabId = tab.id;
      renderRightTabs();
      renderRightContent();
    });
    host.appendChild(el);
  });
}

function renderRightContent() {
  const host = $('#rp-content');
  const home = $('#rp-home');
  const pane = $('#right-pane');
  if (!host) return;
  host.innerHTML = '';
  host.hidden = true;

  const tab = state.rightTabs.find((t) => t.id === state.activeRightTabId);
  if (!tab) {
    if (home) home.hidden = false;
    if (pane) pane.dataset.view = 'home';
    return;
  }

  if (home) home.hidden = true;
  if (pane) pane.dataset.view = tab.kind;

  let content = '';
  if (tab.kind === 'browser') {
    content = `
      <div class="rp-browser-bar">
        <button type="button" class="rp-icon" data-act="refresh" title="刷新">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-1.76-4.24L14 10h6V4l-2.35 2.35z"/></svg>
        </button>
        <input type="text" class="rp-url" placeholder="输入路径，如 index.html" spellcheck="false" value="${U.escapeHtml(tab.path || '')}" />
        <button type="button" class="rp-icon" data-act="go" title="打开">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8-8-8z"/></svg>
        </button>
      </div>
      <div class="rp-browser-stage${tab.streaming ? ' is-streaming' : ''}" id="browser-stage">
        <div class="rp-stream-indicator" aria-hidden="true"></div>
        <div class="rp-empty" id="browser-empty">
          <div class="rp-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="32" height="32">
              <path fill="currentColor" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
            </svg>
          </div>
          <p class="rp-empty-title">${tab.waiting ? '等待生成…' : '开始浏览'}</p>
          <p class="rp-empty-desc">${tab.waiting ? U.escapeHtml(tab.path || '') + ' 尚未创建' : '输入工作区 HTML 路径以预览'}</p>
        </div>
        <iframe class="rp-frame" title="HTML 预览" sandbox="allow-scripts allow-same-origin" hidden></iframe>
      </div>
    `;
  } else if (tab.kind === 'files') {
    content = `
      <div class="rp-files-path">
        <span class="rp-path-label" id="file-path-label">${U.escapeHtml(state.session?.workspacePath || '/')}</span>
        <span class="rp-files-actions">
          <button type="button" class="rp-icon" data-act="upload-files" title="上传到工作区">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M5 20h14v-2H5v2zM13 16h-2V7.83l-3.59 3.58L6 10l6-6 6 6-1.41 1.41L13 7.83V16z"/></svg>
          </button>
          <button type="button" class="rp-icon" data-act="open-workspace" title="在资源管理器中打开/定位">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M10 4l2 2h8c1.1 0 2 .9 2 2v1H2V6c0-1.1.9-2 2-2h6zm12 7v7c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-7h20z"/></svg>
          </button>
          <button type="button" class="rp-icon" data-act="refresh-files" title="刷新">
            <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-1.76-4.24L14 10h6V4l-2.35 2.35z"/></svg>
          </button>
        </span>
      </div>
      <div class="rp-files-split">
        <div class="rp-file-viewer">
          <div class="rp-empty" id="file-viewer-empty">
            <div class="rp-empty-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28">
                <path fill="currentColor" d="M20 6h-8l-2-2H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2z"/>
              </svg>
            </div>
            <p class="rp-empty-title">打开文件</p>
            <p class="rp-empty-desc">从工作区目录树中选择文件</p>
          </div>
          <pre class="rp-code" id="file-viewer-code" hidden></pre>
        </div>
        <div class="rp-file-tree-pane">
          <div class="rp-tree-search">
            <svg viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
            <input type="search" id="file-tree-filter" placeholder="筛选文件…" aria-label="筛选文件" value="${U.escapeHtml(state.fileFilter || '')}" />
          </div>
          <ul class="rp-tree" id="file-tree" role="tree"></ul>
        </div>
      </div>
    `;
  } else if (tab.kind === 'runner') {
    const run = state.lastRunJs;
    content = `
      <div class="rp-runner-head">
        <span class="rp-runner-title">运行</span>
      </div>
      <div class="rp-runner-body">
        ${run ? `<pre class="rp-code rp-runner-out">${U.escapeHtml(
          [run.ok ? 'ok' : 'error', run.stdout && ('stdout:\n' + run.stdout), run.stderr && ('stderr:\n' + run.stderr), run.result != null && ('return: ' + run.result)]
            .filter(Boolean).join('\n\n')
        )}</pre>` : `
        <div class="rp-empty">
          <div class="rp-empty-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="28" height="28">
              <path fill="currentColor" d="M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
            </svg>
          </div>
          <p class="rp-empty-title">JS 沙盒</p>
          <p class="rp-empty-desc">浏览器 Worker 沙盒，非 Node / 真终端<br />最近一次 run_js 输出会显示在这里</p>
        </div>`}
      </div>
    `;
  } else if (tab.kind === 'canvas') {
    content = `<div class="img-canvas-host" id="image-canvas-host"></div>`;
  }

  if (content) {
    host.innerHTML = content;
    host.hidden = false;
    if (tab.kind === 'browser') bindBrowserTab(tab);
    if (tab.kind === 'files') bindFilesTab(tab);
    if (tab.kind === 'canvas' && window.ImageMode) {
      window.ImageMode.renderCanvas();
    }
  }
}

/* ---------- Browser preview via local HTTP (multi-file CSS/JS) ---------- */

let previewRefreshTimer = null;
let previewServerInfo = null; // { baseUrl, port, token, sessionId }
let previewPaintGen = 0; // drop stale async paints

async function ensurePreviewServer() {
  const sid = state.session?.id;
  if (!sid) return null;
  if (previewServerInfo?.sessionId === sid && previewServerInfo.baseUrl) {
    return previewServerInfo;
  }
  try {
    const info = await invoke('preview_ensure', { args: { sessionId: sid } });
    previewServerInfo = {
      baseUrl: info.baseUrl || info.base_url,
      port: info.port,
      token: info.token,
      sessionId: info.sessionId || info.session_id || sid,
    };
    return previewServerInfo;
  } catch (err) {
    console.warn('preview_ensure failed', err);
    return null;
  }
}

function browserPreviewUrl(path, bust) {
  const base = previewServerInfo?.baseUrl;
  if (!base || !path) return '';
  const rel = String(path).replace(/^\/+/, '');
  const q = bust != null ? bust : Date.now();
  return base + rel + (base.includes('?') ? '&' : '?') + 't=' + q;
}

async function stageToPreviewServer(path, content) {
  const sid = state.session?.id;
  if (!sid || !path) return;
  try {
    await ensurePreviewServer();
    await invoke('preview_stage', {
      args: { sessionId: sid, path, content: content == null ? '' : String(content) },
    });
  } catch (err) {
    console.warn('preview_stage', err);
  }
}

async function unstageFromPreviewServer(path) {
  const sid = state.session?.id;
  if (!sid || !path) return;
  try {
    await invoke('preview_unstage', {
      args: { sessionId: sid, path, content: '' },
    });
  } catch {
    /* ignore */
  }
}

function setBrowserStreamingUi(streaming) {
  const stage = $('#browser-stage');
  if (!stage) return;
  stage.classList.toggle('is-streaming', !!streaming);
}

function showBrowserEmpty(tab, opts = {}) {
  if (!tab || state.activeRightTabId !== tab.id) return;
  const empty = $('#browser-empty');
  const frame = $('.rp-frame');
  tab.waiting = true;
  setBrowserStreamingUi(!!opts.streaming);
  if (empty) {
    empty.hidden = false;
    const title = empty.querySelector('.rp-empty-title');
    const desc = empty.querySelector('.rp-empty-desc');
    if (title) title.textContent = opts.streaming ? '生成中…' : '等待生成…';
    if (desc) {
      desc.textContent = (tab.path || '') + (opts.streaming ? ' · 流式预览' : ' 尚未创建或不存在');
    }
  }
  if (frame) {
    frame.hidden = true;
    window.BrowserPreview?.clear?.(frame);
  }
}

/**
 * Paint browser preview with minimal flicker.
 * HTML 一律经 BrowserPreview 桥 postMessage 给 preview_server 的隔离 harness 绘制，
 * 主窗口不再直接向 iframe 写入模型 HTML；无内容且磁盘已有文件时，
 * 让 harness 内部 iframe 直接加载该文件（相对资源天然可用）。
 */
async function paintBrowserHttp(tab, opts = {}) {
  if (!tab || state.activeRightTabId !== tab.id) return;
  const path = tab.path;
  const isArtifact = !!tab.artifact;
  if (!path && !isArtifact) {
    showBrowserEmpty(tab, opts);
    return;
  }

  const gen = ++previewPaintGen;
  const empty = $('#browser-empty');
  const frame = $('.rp-frame');
  const BP = window.BrowserPreview;
  const staged = path ? window.PreviewStream?.getStaging?.(path) : null;
  let content = opts.content != null
    ? String(opts.content)
    : (staged?.content != null ? String(staged.content) : (tab.html || ''));

  // When re-painting after CSS/JS asset stream, reuse last HTML body
  if (!content && tab.html) content = String(tab.html);

  tab.streaming = !!opts.streaming;
  setBrowserStreamingUi(!!opts.streaming);
  if (!frame || !BP) return;

  // 流式中还没有正文：保持等待态，不必启动服务
  if (!content && opts.streaming) {
    showBrowserEmpty(tab, opts);
    return;
  }

  const info = await ensurePreviewServer();
  if (gen !== previewPaintGen || state.activeRightTabId !== tab.id) return;
  if (!info?.baseUrl) {
    showBrowserEmpty(tab, opts);
    return;
  }

  // Have HTML body → postMessage 给 harness 平滑重绘（不重载外层 iframe）
  if (content) {
    const baseHref = path ? BP.baseHrefFor(info.baseUrl, path) : '';
    tab.waiting = false;
    tab.html = content;
    if (empty) empty.hidden = true;
    frame.hidden = false;
    BP.writeHtml(frame, content, {
      previewBaseUrl: info.baseUrl,
      path: path || tab.artifactKey || 'artifact',
      baseHref,
      force: !!opts.force,
      preserveScroll: opts.preserveScroll !== false,
    });
    return;
  }

  // No body yet: 磁盘可能已有文件 → harness 内部 iframe 直接加载
  if (path) {
    const bust = opts.bust != null ? opts.bust : Date.now();
    const url = browserPreviewUrl(path, bust);
    tab.waiting = false;
    if (empty) empty.hidden = true;
    frame.hidden = false;
    BP.navigate(frame, url, { previewBaseUrl: info.baseUrl });
    return;
  }
  if (gen === previewPaintGen) showBrowserEmpty(tab, opts);
}

function scheduleBrowserRefresh(reason) {
  clearTimeout(previewRefreshTimer);
  previewRefreshTimer = setTimeout(() => {
    const tab = state.rightTabs.find((t) => t.id === state.activeRightTabId);
    if (tab?.kind === 'browser' && tab.path) {
      // Asset updates: re-write current HTML so relative CSS/JS re-fetch (no-store).
      // Do NOT assign frame.src — that is the white-flash path.
      const staged = window.PreviewStream?.getStaging?.(tab.path);
      const content = staged?.content || tab.html || '';
      paintBrowserHttp(tab, {
        streaming: !!tab.streaming,
        force: true,
        content: content || undefined,
        preserveScroll: true,
      });
    }
  }, reason === 'stream' ? 200 : 100);
}

/**
 * write_file 流式：任意 html/css/js 进 staging + 预览服务；
 * HTML 入口自动开 Browser；资源变更刷新当前页。
 */
function applyStreamPreview(path, content, meta = {}) {
  const PS = window.PreviewStream;
  const norm = PS ? PS.normalizePath(path) : String(path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (!norm || (PS && !PS.isPreviewAssetPath(norm))) return;

  // Push to Rust overlay (async, fire-and-forget)
  stageToPreviewServer(norm, content);

  const isHtml = PS ? PS.isHtmlPath(norm) : /\.html?$/i.test(norm);

  if (isHtml) {
    setRightOpen(true);
    let tab = state.rightTabs.find((t) => t.kind === 'browser' && t.path === norm);
    if (!tab) {
      tab = state.rightTabs.find((t) => t.kind === 'browser' && (!t.path || t.path === norm));
    }
    let needFullRender = false;
    if (!tab) {
      tab = {
        id: uid('r'),
        kind: 'browser',
        title: norm.split('/').pop() || '浏览器',
        path: norm,
        waiting: !content,
        streaming: !!meta.streaming,
      };
      state.rightTabs.push(tab);
      needFullRender = true;
    } else {
      tab.path = norm;
      if (!tab.title || tab.title === '浏览器') tab.title = norm.split('/').pop() || tab.title;
    }
    tab.streaming = !!meta.streaming;
    tab.waiting = !content;
    tab.html = content;

    if (state.activeRightTabId !== tab.id) {
      state.activeRightTabId = tab.id;
      needFullRender = true;
    }

    if (needFullRender || !$('.rp-frame')) {
      renderRightTabs();
      renderRightContent();
    } else {
      renderRightTabs();
      setBrowserStreamingUi(!!meta.streaming);
    }
    // In-place write; no bust/src navigation during stream
    paintBrowserHttp(tab, {
      streaming: !!meta.streaming,
      content,
      preserveScroll: true,
    });
    return;
  }

  // Non-html asset: re-write open HTML entry so relative CSS/JS re-fetch
  const active = state.rightTabs.find((t) => t.id === state.activeRightTabId);
  if (active?.kind === 'browser' && active.path) {
    active.streaming = true;
    renderRightTabs();
    setBrowserStreamingUi(true);
    scheduleBrowserRefresh('stream');
  }
}

function settleWriteFilePreview(toolCall, success) {
  const PS = window.PreviewStream;
  if (!PS) return;
  let path = '';
  try {
    const args = typeof toolCall.arguments === 'string'
      ? JSON.parse(toolCall.arguments || '{}')
      : (toolCall.arguments || {});
    path = PS.normalizePath(args.path);
  } catch {
    path = '';
  }
  if (!path || !PS.isPreviewAssetPath(path)) return;

  if (success) {
    PS.clearPath(path);
    unstageFromPreviewServer(path);
    state.rightTabs.forEach((tab) => {
      if (tab.kind === 'browser' && (tab.path === path || PS.isHtmlPath(tab.path))) {
        tab.streaming = false;
        tab.waiting = false;
      }
    });
    setBrowserStreamingUi(false);
    renderRightTabs();
    const active = state.rightTabs.find((t) => t.id === state.activeRightTabId);
    if (active?.kind === 'browser' && active.path) {
      // HTML entry committed: re-read disk and in-place paint
      // CSS/JS asset committed: re-write open HTML so assets re-fetch
      if (PS.isHtmlPath(path) && active.path === path) {
        loadBrowserPath(active, active.path);
      } else if (PS.isHtmlPath(active.path)) {
        scheduleBrowserRefresh('commit');
      }
    }
  } else {
    PS.markCommitted(path);
    state.rightTabs.forEach((tab) => {
      if (tab.kind === 'browser') tab.streaming = false;
    });
    setBrowserStreamingUi(false);
    renderRightTabs();
  }
}

async function openPreview(payload = {}) {
  const path = String(payload.path || '').replace(/\\/g, '/').replace(/^\/+/, '');
  const kind = payload.kind === 'js' ? 'runner' : 'browser';
  const title = payload.title || path || (kind === 'runner' ? '运行' : '浏览器');
  setRightOpen(true);

  if (kind === 'runner') {
    let tab = state.rightTabs.find((t) => t.kind === 'runner' && (!path || t.path === path));
    if (!tab) {
      tab = { id: uid('r'), kind: 'runner', title, path };
      state.rightTabs.push(tab);
    } else {
      tab.title = title;
      tab.path = path;
    }
    state.activeRightTabId = tab.id;
    renderRightTabs();
    renderRightContent();
    return;
  }

  let tab = state.rightTabs.find((t) => t.kind === 'browser' && !t.artifact && t.path === path);
  if (!tab) {
    tab = { id: uid('r'), kind: 'browser', title, path, waiting: false, streaming: false };
    state.rightTabs.push(tab);
  } else {
    tab.title = title;
  }
  state.activeRightTabId = tab.id;
  renderRightTabs();
  renderRightContent();
  await loadBrowserPath(tab, path);
}

/* ---------- 代码块 artifact 预览（聊天 Markdown 中的 html/svg 等围栏） ---------- */

function artifactKeyOf(messageId, fenceIndex) {
  return `${messageId}:${fenceIndex}`;
}

/** 把围栏内容包装为可预览文档；html 片段由 harness 侧 injectBaseHref 兜底补壳 */
function artifactHtmlFor(lang, code) {
  const src = String(code || '');
  if (String(lang || '').toLowerCase() === 'svg') {
    return '<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;display:grid;place-items:center;background:#fff}svg{max-width:96vw;max-height:96vh}</style></head><body>'
      + src + '</body></html>';
  }
  return src;
}

function findArtifactTab(key) {
  return state.rightTabs.find((t) => t.kind === 'browser' && t.artifact && t.artifactKey === key);
}

/** 代码块「运行」：在右栏打开该围栏的隔离预览 */
function openCodeArtifact({ messageId, fenceIndex, lang, code }) {
  const key = artifactKeyOf(messageId, fenceIndex);
  const title = `${String(lang || 'html').toLowerCase()} 预览`;
  setRightOpen(true);
  let tab = findArtifactTab(key);
  if (!tab) {
    tab = {
      id: uid('r'),
      kind: 'browser',
      title,
      path: '',
      artifact: true,
      artifactKey: key,
      waiting: false,
      streaming: false,
      html: '',
    };
    state.rightTabs.push(tab);
  }
  tab.title = title;
  tab.html = artifactHtmlFor(lang, code);
  state.activeRightTabId = tab.id;
  renderRightTabs();
  renderRightContent();
}

let liveArtifactTimer = 0;
let liveArtifactInfo = null;

/** 流式中活跃尾部是可预览围栏：若对应 artifact 标签开着，节流 500ms 刷新预览 */
function handleLiveCodeBlock(info) {
  const key = artifactKeyOf(info.messageId, info.fenceIndex);
  if (!findArtifactTab(key)) return;
  liveArtifactInfo = { ...info, key };
  if (liveArtifactTimer) return;
  liveArtifactTimer = setTimeout(() => {
    liveArtifactTimer = 0;
    const cur = liveArtifactInfo;
    liveArtifactInfo = null;
    if (!cur) return;
    const tab = findArtifactTab(cur.key);
    if (!tab) return;
    tab.html = artifactHtmlFor(cur.lang, cur.code);
    tab.streaming = true;
    if (state.activeRightTabId === tab.id) {
      paintBrowserHttp(tab, { content: tab.html, streaming: true, force: true, preserveScroll: true });
    }
  }, 500);
}

/** 消息完成：该消息的 artifact 标签用最终围栏内容收尾 */
function settleCodeArtifacts(message) {
  if (!message?.id) return;
  const prefix = `${message.id}:`;
  const tabs = state.rightTabs.filter(
    (t) => t.kind === 'browser' && t.artifact && String(t.artifactKey || '').startsWith(prefix)
  );
  if (!tabs.length) return;
  const fences = window.MD.lexBlocks(message.content || '').filter((b) => b.type === 'code');
  tabs.forEach((tab) => {
    const idx = parseInt(String(tab.artifactKey).slice(prefix.length), 10);
    const fence = Number.isInteger(idx) ? fences[idx] : null;
    tab.streaming = false;
    if (fence) tab.html = artifactHtmlFor(fence.lang, fence.text);
    if (state.activeRightTabId === tab.id) {
      paintBrowserHttp(tab, { content: tab.html, streaming: false, force: true, preserveScroll: true });
    }
  });
  renderRightTabs();
}

async function loadBrowserPath(tab, path) {
  if (!path) {
    tab.waiting = true;
    showBrowserEmpty(tab, {});
    return;
  }
  tab.path = path;
  const PS = window.PreviewStream;
  const staged = PS?.getStaging?.(path);

  // If streaming staging has content, push to server overlay first
  if (staged?.content) {
    await stageToPreviewServer(path, staged.content);
    tab.streaming = !!staged.streaming;
    tab.html = staged.content;
    await paintBrowserHttp(tab, { streaming: !!staged.streaming, content: staged.content, force: true });
    return;
  }

  // Disk file → ensure server and load via HTTP
  if (state.session?.id && window.Tools?.fs) {
    try {
      const content = await Tools.fs.read(state.session.id, path);
      if (!String(content).startsWith('错误：')) {
        tab.waiting = false;
        tab.streaming = false;
        tab.html = content;
        PS?.clearPath?.(path);
        await paintBrowserHttp(tab, {
          streaming: false,
          force: true,
          content,
          preserveScroll: true,
        });
        return;
      }
    } catch {
      /* fall through */
    }
  }

  tab.waiting = true;
  tab.streaming = false;
  tab.html = '';
  showBrowserEmpty(tab, {});
}

function bindBrowserTab(tab) {
  const input = $('.rp-url');
  const go = () => {
    const path = (input?.value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path) return;
    tab.path = path;
    tab.artifact = false;
    tab.artifactKey = '';
    tab.title = path.split('/').pop() || '浏览器';
    renderRightTabs();
    loadBrowserPath(tab, path);
  };
  hostAct('go', go);
  hostAct('refresh', () => {
    if (tab.artifact && tab.html) {
      paintBrowserHttp(tab, { content: tab.html, streaming: !!tab.streaming, force: true });
      return;
    }
    loadBrowserPath(tab, tab.path || input?.value || '');
  });
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      go();
    }
  });
  if (tab.artifact && tab.html) {
    paintBrowserHttp(tab, { content: tab.html, streaming: !!tab.streaming, force: true });
    return;
  }
  if (tab.path) loadBrowserPath(tab, tab.path);
}

function hostAct(name, fn) {
  const btn = $(`[data-act="${name}"]`);
  if (btn) btn.addEventListener('click', fn);
}

async function refreshFilesTree() {
  if (!state.session?.id || !window.Tools?.fs) return;
  try {
    const data = await Tools.fs.statTree(state.session.id);
    state.filesTree = data;
    if (data?.workspacePath && state.session) state.session.workspacePath = data.workspacePath;
    const tab = state.rightTabs.find((t) => t.id === state.activeRightTabId);
    if (tab?.kind === 'files') paintFilesTree();
  } catch (err) {
    console.warn('refreshFilesTree', err);
  }
}

function paintFilesTree() {
  const tree = $('#file-tree');
  const label = $('#file-path-label');
  if (label) label.textContent = state.filesTree?.workspacePath || state.session?.workspacePath || '/';
  if (!tree) return;
  tree.innerHTML = '';
  const filter = String(state.fileFilter || '').toLowerCase();
  const root = state.filesTree?.tree;
  if (!root) {
    tree.innerHTML = '<li class="rp-tree-empty">加载中…</li>';
    return;
  }

  function addNode(node, parentUl, depth) {
    if (!node) return;
    if (node.type === 'folder') {
      const children = Array.isArray(node.children) ? node.children : [];
      const path = node.path || '';
      if (path) {
        const li = document.createElement('li');
        li.className = 'rp-tree-item is-folder';
        li.style.paddingLeft = (8 + depth * 12) + 'px';
        li.innerHTML = `<span class="rp-tree-icon">DIR</span><span class="rp-tree-name"></span>`;
        li.querySelector('.rp-tree-name').textContent = node.name || path;
        parentUl.appendChild(li);
      }
      children.forEach((child) => addNode(child, parentUl, depth + (path ? 1 : 0)));
      return;
    }
    if (node.type === 'file') {
      if (filter && !String(node.path || node.name || '').toLowerCase().includes(filter)) return;
      const li = document.createElement('li');
      li.className = 'rp-tree-item is-file' + (state.filesSelectedPath === node.path ? ' is-active' : '');
      li.style.paddingLeft = (8 + depth * 12) + 'px';
      li.draggable = true;
      li.dataset.path = node.path || '';
      li.title = node.path || '';
      const icon = document.createElement('span');
      icon.className = 'rp-tree-icon ' + treeIconClass(node.name || node.path, node.mime || '');
      icon.textContent = fileIconLabel(node.name || node.path, node.mime || '');
      const name = document.createElement('span');
      name.className = 'rp-tree-name';
      name.textContent = node.name || node.path;
      li.append(icon, name);
      li.addEventListener('dragstart', (event) => {
        draggingWorkspacePath = node.path || '';
        event.dataTransfer?.setData(WORKSPACE_DRAG_MIME, node.path || '');
        event.dataTransfer?.setData('text/x-wepchat-workspace-path', node.path || '');
        event.dataTransfer?.setData('text/plain', node.path || '');
        if (event.dataTransfer) event.dataTransfer.effectAllowed = 'copy';
      });
      li.addEventListener('dragend', () => {
        setTimeout(() => { draggingWorkspacePath = ''; }, 0);
        setComposerDragOver(false);
      });
      li.addEventListener('click', () => openFileInViewer(node.path));
      parentUl.appendChild(li);
    }
  }

  addNode(root, tree, 0);
  if (!tree.children.length) {
    tree.innerHTML = '<li class="rp-tree-empty">（工作区为空）</li>';
  }
}

async function openFileInViewer(path) {
  if (!path || !state.session?.id) return;
  setRightOpen(true);
  let filesTab = state.rightTabs.find((tab) => tab.kind === 'files');
  if (!filesTab) {
    filesTab = { id: uid('r'), kind: 'files', title: '文件' };
    state.rightTabs.push(filesTab);
  }
  const isFilesTabActive = state.activeRightTabId === filesTab.id;
  if (!isFilesTabActive) {
    state.activeRightTabId = filesTab.id;
    renderRightTabs();
    renderRightContent();
  }
  state.filesSelectedPath = path;
  await loadFileContent(path);
}

async function loadFileContent(path) {
  const empty = $('#file-viewer-empty');
  const code = $('#file-viewer-code');
  const viewer = $('.rp-file-viewer');
  viewer?.querySelector('.rp-binary-viewer')?.remove();
  try {
    if (/\.(?:png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?|heic|heif)$/i.test(path)) {
      const res = await invoke('ws_read_bytes', { args: { sessionId: state.session.id, path } });
      if (!res?.contentBase64) throw new Error('图片内容为空');
      if (empty) empty.hidden = true;
      if (code) code.hidden = true;
      if (viewer) {
        const wrap = document.createElement('div');
        wrap.className = 'rp-binary-viewer';
        const image = document.createElement('img');
        image.className = 'rp-file-image';
        image.src = `data:${res.mime || 'image/png'};base64,${res.contentBase64}`;
        image.alt = path;
        const label = document.createElement('div');
        label.className = 'rp-binary-label';
        label.textContent = path;
        wrap.append(image, label);
        viewer.appendChild(wrap);
      }
    } else {
      const content = await Tools.fs.read(state.session.id, path);
      if (empty) empty.hidden = true;
      if (code) {
        code.hidden = false;
        code.textContent = String(content).startsWith('错误：') ? content : content;
      }
    }
  } catch (err) {
    if (code) {
      code.hidden = false;
      code.textContent = err?.message || String(err);
    }
  }
  paintFilesTree();
}

function bindFilesTab() {
  hostAct('refresh-files', () => refreshFilesTree());
  hostAct('upload-files', () => pickFilesForWorkspace({ attach: false }));
  hostAct('open-workspace', async () => {
    if (!state.session?.id) return;
    try {
      if (state.filesSelectedPath) {
        await invoke('ws_reveal_path', { args: { sessionId: state.session.id, path: state.filesSelectedPath } });
      } else {
        await invoke('ws_open_workspace', { args: { sessionId: state.session.id } });
      }
    } catch (err) {
      UIDialog.toast('无法打开资源管理器：' + (err?.message || err), 3600);
    }
  });
  const filter = $('#file-tree-filter');
  filter?.addEventListener('input', () => {
    state.fileFilter = filter.value || '';
    paintFilesTree();
  });
  const pane = $('.rp-file-tree-pane');
  pane?.addEventListener('dragover', (event) => {
    if (!event.dataTransfer?.types || !Array.from(event.dataTransfer.types).includes('Files')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
    pane.classList.add('is-drag-over');
  });
  pane?.addEventListener('dragleave', (event) => {
    if (!pane.contains(event.relatedTarget)) pane.classList.remove('is-drag-over');
  });
  pane?.addEventListener('drop', async (event) => {
    const files = filesFromTransfer(event.dataTransfer);
    if (!files.length) return;
    event.preventDefault();
    pane.classList.remove('is-drag-over');
    await importFilesToWorkspace(files, { attach: false });
  });
  refreshFilesTree().then(() => {
    paintFilesTree();
  });
}

function refreshBrowserIfOpen() {
  const tab = state.rightTabs.find((t) => t.id === state.activeRightTabId);
  if (tab?.kind === 'browser' && tab.path) loadBrowserPath(tab, tab.path);
}

function closeRightTab(id) {
  const idx = state.rightTabs.findIndex((t) => t.id === id);
  if (idx < 0) return;
  state.rightTabs.splice(idx, 1);
  if (state.activeRightTabId === id) {
    const next = state.rightTabs[idx] || state.rightTabs[idx - 1] || null;
    state.activeRightTabId = next?.id || null;
  }
  renderRightTabs();
  renderRightContent();
}

function setTabAddMenuOpen(open) {
  const menu = $('#tab-add-menu');
  const btn = $('#btn-tab-add');
  if (!menu || !btn) return;
  menu.hidden = !open;
  btn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function showTabAddMenu() {
  const menu = $('#tab-add-menu');
  if (!menu) return;
  setTabAddMenuOpen(menu.hidden);
}

function addRightTab(kind) {
  const kinds = {
    browser: { title: '浏览器', kind: 'browser', path: '' },
    files: { title: '文件', kind: 'files' },
    runner: { title: '运行', kind: 'runner' },
    canvas: { title: '画布', kind: 'canvas' },
  };
  if (!kinds[kind]) return;
  // Reuse single files/runner/canvas tab
  if (kind === 'files' || kind === 'runner' || kind === 'canvas') {
    const existing = state.rightTabs.find((t) => t.kind === kind);
    if (existing) {
      state.activeRightTabId = existing.id;
      renderRightTabs();
      renderRightContent();
      return;
    }
  }
  const tab = { id: uid('r'), ...kinds[kind] };
  state.rightTabs.push(tab);
  state.activeRightTabId = tab.id;
  renderRightTabs();
  renderRightContent();
}

function bindRightEvents() {
  $('#btn-tab-add')?.addEventListener('click', () => showTabAddMenu());
  $all('.rp-add-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      addRightTab(btn.dataset.kind);
      setTabAddMenuOpen(false);
    });
  });
  $all('.rp-tool').forEach((btn) => {
    btn.addEventListener('click', () => addRightTab(btn.dataset.kind));
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest('.rp-tab-add-wrap')) setTabAddMenuOpen(false);
  });
  document.addEventListener('keydown', (event) => {
    if (!state.rightOpen || !event.ctrlKey || event.altKey || event.metaKey) return;
    const kind = event.key.toLowerCase() === 't'
      ? 'browser'
      : event.key.toLowerCase() === 'p'
        ? 'files'
        : event.code === 'Backquote'
          ? 'runner'
          : null;
    if (!kind) return;
    event.preventDefault();
    addRightTab(kind);
    setTabAddMenuOpen(false);
  });

  // Resize handles
  const listHandle = $('#resize-list');
  const rightHandle = $('#resize-right');
  if (listHandle) {
    listHandle.addEventListener('mousedown', (e) => startResize(e, 'list'));
  }
  if (rightHandle) {
    rightHandle.addEventListener('mousedown', (e) => startResize(e, 'right'));
  }

  function startResize(e, side) {
    e.preventDefault();
    const startX = e.clientX;
    const pane = side === 'list' ? $('#list-pane') : $('#right-pane');
    const startWidth = pane?.getBoundingClientRect().width || (side === 'list' ? 268 : 360);
    document.documentElement.classList.add('is-resizing');
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const max = side === 'list' ? 400 : 800;
      const newWidth = Math.max(180, Math.min(max, startWidth + (side === 'list' ? dx : -dx)));
      if (side === 'list') {
        document.documentElement.style.setProperty('--list-w', `${newWidth}px`);
      } else {
        document.documentElement.style.setProperty('--right-w', `${newWidth}px`);
        document.documentElement.style.setProperty('--right-w-wide', `${newWidth}px`);
      }
    };
    const stop = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
      document.documentElement.classList.remove('is-resizing');
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
  }
}
async function saveImageSettings() {
  const status = $('#image-settings-status');
  if (!window.ImageMode) {
    if (status) status.textContent = '生图模块未加载';
    return;
  }
  const patch = window.ImageMode.readImageSettingsFromPage();
  const prev = state.settings || defaultSettings();
  const next = {
    ...defaultSettings(),
    ...prev,
    ...patch,
    imageStylePresets: prev.imageStylePresets?.length
      ? prev.imageStylePresets
      : (window.ImageMode.defaultStylePresets || []),
    providers: state.providers,
    toolPermissions: normalizeToolPermissions(prev.toolPermissions),
  };
  if (status) status.textContent = '保存中…';
  try {
    const saved = await invoke('save_settings', { settings: next });
    state.settings = {
      ...defaultSettings(),
      ...(saved || {}),
      providers: state.providers,
      toolPermissions: normalizeToolPermissions(saved?.toolPermissions || next.toolPermissions),
    };
    if (status) status.textContent = '已保存';
    window.ImageMode.fillImageSettingsPage();
    window.ImageMode.renderImageComposerMeta?.();
    UIDialog.toast('生图设置已保存');
  } catch (err) {
    console.warn('save image settings', err);
    if (status) status.textContent = '保存失败';
  }
}

async function boot() {
  bindEvents();
  initExternalAgentMode({
    getState: () => state,
    invoke,
    uid,
    nowIso,
    setMode,
    persistSettings,
    refreshSessions: async () => {
      const sessions = await invoke('list_sessions');
      state.sessions = Array.isArray(sessions) ? sessions.map((item) => normalizeSession(item)) : state.sessions;
      renderSessions();
    },
  });
  if (window.ImageMode) {
    window.ImageMode.bind({
      getState: () => state,
      invoke,
      persistSession,
      refreshSessionList: async () => {
        try {
          const sessions = await invoke('list_sessions');
          state.sessions = Array.isArray(sessions) ? sessions.map((item) => normalizeSession(item)) : state.sessions;
        } catch { /* keep local */ }
        renderSessions();
        window.ImageMode.renderImageSessionList();
      },
      loadSession: async (id) => {
        const navigationSeq = ++state.sessionNavigationSeq;
        if (state.session?.id) {
          if (state.session.mode === 'image') state.lastImageSessionId = state.session.id;
          else state.lastChatSessionId = state.session.id;
        }
        try {
          const loaded = await invoke('load_session', { id });
          if (navigationSeq !== state.sessionNavigationSeq) return;
          state.session = normalizeSession(loaded);
          markSessionHistoryComplete(state.session);
          rememberActiveSession(state.session);
        } catch (err) {
          if (navigationSeq !== state.sessionNavigationSeq) return;
          // 索引项不含消息，不能当完整会话使用；保持当前会话并提示
          UIDialog.toast('无法加载会话：' + (err?.message || err), 3200);
          return;
        }
        if (state.session?.mode === 'image') state.lastImageSessionId = state.session.id;
        else if (state.session?.id) state.lastChatSessionId = state.session.id;
        syncActiveTaskState();
        upsertSessionIndex(state.session);
      },
      toast: (msg, kind) => UIDialog.toast(msg, kind === 'err' ? 4000 : 2200),
      uid,
      nowIso,
      setRightOpen,
      showImageCanvasPane,
    });
    window.ImageMode.bindUi();
  }
  await bindWindowControls({ setListCollapsed, setMaximizedUi });
  setMode('chat');
  setSettingsPage('providers');
  setListCollapsed(false);
  setRightOpen(false);
  window.PreviewStream?.setApplyHandler?.(applyStreamPreview);
  await loadBackend();
  window.ExternalAgentMode?.refresh?.();
  bindRightEvents();
  setMode(state.session?.mode === 'image' ? 'image' : 'chat');
  renderSessions();
  if (window.ImageMode) window.ImageMode.renderImageSessionList();
}

boot().catch((err) => console.error('Unable to start WePChat:', err));
