/**
 * WePChat Windows — shell UI (M1)
 * Right pane: unified tabbed sidebar
 * Tabs: Browser, Files, Runner
 * + menu chooses kind
 * Resizable left & right sidebars
 */

const invoke = (cmd, args) => {
  const core = window.__TAURI__?.core;
  if (!core?.invoke) return Promise.reject(new Error('Tauri bridge unavailable'));
  return core.invoke(cmd, args);
};

const state = {
  mode: 'chat',
  settingsPage: 'providers',
  rightOpen: false,
  rightTabs: [],
  activeRightTabId: null,
  rightView: 'home', // home | files | browser | runner
  listCollapsed: false,
  maximized: false,
  settings: null,
  meta: null,
  providers: [],
  activeProviderId: '',
  activeModel: '',
  sessions: [],
  session: null,
  generating: false,
  abortCtl: null,
  stopRequested: false,
  defaultWorkspaceRoot: '',
  resolvedWorkspaceRoot: '',
  fileFilter: '',
  fileTabs: [],
  activeFileTabId: null,
  browserTabs: [{ id: 'b1', title: '新标签页', url: '' }],
  activeBrowserTabId: 'b1',
  openFolders: new Set(['']),
  lastRunJs: null,
  filesTree: null,
  filesSelectedPath: '',
};

function $(sel, root = document) {
  return root.querySelector(sel);
}

function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

function getAppWindow() {
  try {
    return window.__TAURI__?.window?.getCurrentWindow?.() || null;
  } catch {
    return null;
  }
}

/* ---------- App shell ---------- */

function setMode(mode) {
  state.mode = mode;
  $all('.rail-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.mode === mode);
  });
  $all('.list-panel').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.panel === mode);
  });
  $all('.main-view').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.view === mode);
  });
  if (mode !== 'chat') setRightOpen(false);
}

function setSettingsPage(page) {
  state.settingsPage = page;
  $all('.settings-nav-item').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.settings === page);
  });
  $all('.settings-page').forEach((el) => {
    el.classList.toggle('is-active', el.dataset.settingsPage === page);
  });
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

function defaultSettings() {
  return {
    workspaceRoot: null,
    theme: 'light',
    providers: [],
    activeProviderId: '',
    activeModel: '',
    systemPrompt: '',
    temperature: null,
    maxTokens: null,
    agentEnabled: true,
    maxToolRounds: 8,
    maxToolCalls: 24,
  };
}

function nowIso() {
  return new Date().toISOString();
}

/* ---------- 供应商草稿（对话框内编辑） ---------- */
let providerDraft = null;
let providerIsNew = false;
let modelTests = {};
let modelTestMessages = {};
let modelEditor = null;

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

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

function readProviderBasicsIntoDraft() {
  if (!providerDraft) return;
  providerDraft.name = ($('#provider-name')?.value || '').trim() || '未命名供应商';
  providerDraft.api = $('#provider-api')?.value || 'openai-chat';
  providerDraft.baseUrl = ($('#provider-base-url')?.value || '').trim();
  providerDraft.apiKey = ($('#provider-api-key')?.value || '').trim();
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
  return state.providers.find((provider) => provider.id === state.activeProviderId) || null;
}

function createSession() {
  const provider = currentProvider();
  return {
    id: uid('session'),
    title: '',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    mode: 'chat',
    providerId: provider?.id || '',
    model: state.activeModel || provider?.models[0] || '',
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
    m.toolCalls = Array.isArray(m.toolCalls) ? m.toolCalls : [];
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
    });
    m.activeVariantIndex = m.variants.length
      ? Math.max(0, Math.min(m.variants.length - 1, parseInt(m.activeVariantIndex || 0, 10) || 0))
      : 0;
  } else if (m.role === 'user') {
    m.parentAssistantId = m.parentAssistantId || '';
    m.parentVariantId = m.parentVariantId || '';
  }
  return m;
}

function normalizeSession(raw) {
  const base = createSession();
  const session = raw && typeof raw === 'object' ? raw : {};
  const out = {
    ...base,
    ...session,
    id: String(session.id || base.id).replace(/[^A-Za-z0-9_-]/g, '_'),
    messages: Array.isArray(session.messages) ? session.messages.map(normalizeMessage) : [],
    workspacePath: String(session.workspacePath || ''),
    pinned: !!session.pinned,
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

async function confirmStopIfGenerating(actionText) {
  if (!state.generating) return true;
  const ok = await UIDialog.confirm(
    `当前会话正在生成回复。${actionText || '继续操作'}会停止当前任务。`,
    '任务正在运行',
    { okText: '停止并继续' }
  );
  if (!ok) return false;
  state.stopRequested = true;
  state.abortCtl?.abort();
  return true;
}

function activeSessionProvider() {
  const sessionProvider = state.session && state.session.providerId;
  return state.providers.find((provider) => provider.id === sessionProvider) || currentProvider();
}

async function bindWindowControls() {
  const win = getAppWindow();
  $('#btn-toggle-list')?.addEventListener('click', (e) => {
    e.stopPropagation();
    setListCollapsed(!state.listCollapsed);
  });

  $('#win-min')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await win?.minimize();
    } catch (err) {
      console.warn(err);
    }
  });

  $('#win-max')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await win?.toggleMaximize();
      const isMax = await win?.isMaximized();
      setMaximizedUi(Boolean(isMax));
    } catch (err) {
      console.warn(err);
    }
  });

  $('#win-close')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    try {
      await win?.close();
    } catch (err) {
      console.warn(err);
    }
  });

  // Double-click titlebar drag area to maximize
  $all('[data-tauri-drag-region]').forEach((el) => {
    el.addEventListener('dblclick', async (e) => {
      if (e.target.closest('button')) return;
      try {
        await win?.toggleMaximize();
        const isMax = await win?.isMaximized();
        setMaximizedUi(Boolean(isMax));
      } catch (err) {
        console.warn(err);
      }
    });
  });
}

async function persistSettings() {
  const prev = state.settings || {};
  state.settings = {
    ...defaultSettings(),
    ...prev,
    providers: state.providers,
    activeProviderId: state.activeProviderId,
    activeModel: state.activeModel,
    systemPrompt: prev.systemPrompt ?? '',
    temperature: prev.temperature ?? null,
    maxTokens: prev.maxTokens ?? null,
    agentEnabled: prev.agentEnabled !== false,
    maxToolRounds: prev.maxToolRounds ?? 8,
    maxToolCalls: prev.maxToolCalls ?? 24,
  };
  try {
    const saved = await invoke('save_settings', { settings: state.settings });
    state.settings = { ...defaultSettings(), ...(saved || {}), providers: state.providers };
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
    item.classList.toggle('is-active', provider.id === state.activeProviderId);

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
    const use = document.createElement('button');
    use.type = 'button';
    use.className = 'secondary-btn';
    use.textContent = provider.id === state.activeProviderId ? '使用中' : '设为当前';
    use.disabled = provider.id === state.activeProviderId;
    use.addEventListener('click', () => selectProvider(provider.id));
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
    actions.append(use, edit, remove);
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

  if (!state.activeProviderId || !state.providers.some((item) => item.id === state.activeProviderId)) {
    state.activeProviderId = providerDraft.id;
    state.activeModel = providerDraft.models[0] || providerDraft.imageModels?.[0] || '';
  } else if (state.activeProviderId === providerDraft.id) {
    const ids = providerModelIds(providerDraft);
    if (!ids.includes(state.activeModel)) {
      state.activeModel = providerDraft.models[0] || ids[0] || '';
    }
  }

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
  if (state.activeProviderId === id) {
    const next = state.providers[0] || null;
    state.activeProviderId = next?.id || '';
    state.activeModel = next?.models[0] || next?.imageModels?.[0] || '';
  }
  await persistSettings();
  UIDialog.toast('已删除');
  renderProviders();
  renderModelSelect();
  renderComposerState();
}

async function selectProvider(id) {
  const provider = state.providers.find((item) => item.id === id);
  if (!provider) return;
  state.activeProviderId = provider.id;
  const ids = providerModelIds(provider);
  state.activeModel = ids.includes(state.activeModel) ? state.activeModel : (provider.models[0] || ids[0] || '');
  if (state.session && !state.session.messages.length) {
    state.session.providerId = state.activeProviderId;
    state.session.model = state.activeModel;
  }
  await persistSettings();
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

function sessionTitle(session) {
  return session.title
    || session.messages?.find((message) => message.role === 'user')?.content?.split(/\r?\n/)[0]?.slice(0, 48)
    || '新会话';
}

function sessionSummary(session) {
  return {
    id: session.id,
    title: session.title || '',
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    providerId: session.providerId || '',
    model: session.model || '',
    messages: session.messages || [],
    workspacePath: session.workspacePath || '',
    pinned: !!session.pinned,
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

function renderSessions() {
  const list = $('#session-list');
  const empty = $('.list-panel[data-panel="chat"] .empty-hint');
  if (!list) return;
  list.innerHTML = '';
  list.hidden = state.sessions.length === 0;
  if (empty) empty.hidden = state.sessions.length > 0;
  state.sessions.forEach((session) => {
    const item = document.createElement('li');
    item.className = 'session-item' + (session.id === state.session?.id ? ' is-active' : '');
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

    row.append(button, more);
    item.append(row, menu);
    list.appendChild(item);
  });
  renderWorkspaceSessionPath();
}

async function persistSession() {
  if (!state.session) return;
  state.session.updatedAt = nowIso();
  if (!state.session.title) state.session.title = sessionTitle(state.session);
  upsertSessionIndex(state.session);
  renderSessions();
  try {
    const saved = await invoke('save_session', { session: state.session });
    if (saved && typeof saved === 'object') {
      state.session.workspacePath = saved.workspacePath || state.session.workspacePath || '';
      upsertSessionIndex(state.session);
    }
  } catch (err) {
    console.warn('Unable to save session:', err);
    UIDialog.toast('会话保存失败：' + (err?.message || err), 3200);
  }
  renderWorkspaceSessionPath();
}

async function openSession(id) {
  if (!id) return;
  if (state.session?.id === id) return;
  if (!(await confirmStopIfGenerating('切换会话'))) return;
  try {
    const loaded = await invoke('load_session', { id });
    state.session = normalizeSession(loaded);
  } catch (err) {
    const item = state.sessions.find((session) => session.id === id);
    if (!item) {
      UIDialog.toast('会话不存在');
      return;
    }
    state.session = normalizeSession(item);
  }
  if (state.providers.some((provider) => provider.id === state.session.providerId)) {
    state.activeProviderId = state.session.providerId;
    const provider = currentProvider();
    const models = provider?.models || [];
    state.activeModel = models.includes(state.session.model)
      ? state.session.model
      : (models[0] || '');
  }
  renderSessions();
  renderModelSelect();
  renderComposerState();
  renderChat();
  setMode('chat');
}

async function createNewChat() {
  if (!(await confirmStopIfGenerating('新建会话'))) return;
  if (state.session?.id) await persistSession();
  state.session = createSession();
  await persistSession();
  renderSessions();
  renderModelSelect();
  renderComposerState();
  renderChat();
  setMode('chat');
  $('#composer-input')?.focus();
}

async function renameSession(id) {
  const item = state.sessions.find((s) => s.id === id) || (state.session?.id === id ? state.session : null);
  if (!item) return;
  const name = await UIDialog.prompt('重命名会话', sessionTitle(item), '会话名称');
  if (name == null) return;
  const title = String(name).replace(/\s+/g, ' ').trim().slice(0, 48) || '新会话';
  if (state.session?.id === id) {
    state.session.title = title;
    await persistSession();
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
    if (state.session?.id === id) {
      await apply(state.session);
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
  if (!(await confirmStopIfGenerating('复制会话'))) return;
  try {
    if (state.session?.id === id) await persistSession();
    const copied = normalizeSession(await invoke('copy_session', { id }));
    copied.createdAt = nowIso();
    copied.updatedAt = nowIso();
    const saved = await invoke('save_session', { session: copied });
    state.session = normalizeSession(saved || copied);
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
  if (state.session?.id === id) {
    if (!(await confirmStopIfGenerating('删除当前会话'))) return;
  }
  try {
    await invoke('delete_session', { id });
  } catch (err) {
    UIDialog.toast(err?.message || '删除失败', 3200);
    return;
  }
  state.sessions = state.sessions.filter((s) => s.id !== id);
  if (state.session?.id === id) {
    const next = state.sessions[0];
    if (next) {
      try {
        state.session = normalizeSession(await invoke('load_session', { id: next.id }));
      } catch {
        state.session = normalizeSession(next);
      }
    } else {
      state.session = createSession();
      await persistSession();
    }
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
  if (!select) return;
  select.innerHTML = '';
  state.providers.forEach((provider) => {
    const group = document.createElement('optgroup');
    group.label = provider.name;
    (provider.models || []).forEach((model) => {
      const option = document.createElement('option');
      option.value = `${provider.id}\n${model}`;
      const caps = window.MODEL_META ? MODEL_META.capLabels(modelMetaOf(provider, model)).join(' · ') : '';
      option.textContent = caps ? `${model} · ${caps}` : model;
      option.title = modelSummary(provider, model);
      option.selected = provider.id === state.activeProviderId && model === state.activeModel;
      group.appendChild(option);
    });
    if (group.childElementCount) select.appendChild(group);
  });
  select.disabled = state.providers.length === 0;
  if (!state.providers.length || !select.childElementCount) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '添加供应商后选择模型';
    select.appendChild(option);
  }
  const provider = currentProvider();
  if (providerLabel) {
    if (!provider) providerLabel.textContent = '尚未配置供应商';
    else if (state.activeModel) providerLabel.textContent = `${provider.name} · ${modelSummary(provider, state.activeModel)}`;
    else providerLabel.textContent = provider.name;
  }
}

function renderComposerState() {
  const input = $('#composer-input');
  const send = $('#btn-send');
  const hint = $('#composer-hint');
  const blocked = isBranchBlocked();
  const ready = Boolean(currentProvider() && state.activeModel) && !blocked;
  const hasContent = Boolean(input?.value.trim());
  if (input) input.disabled = !ready || state.generating;
  if (send) {
    send.disabled = state.generating ? false : (!ready || !hasContent);
    send.title = state.generating ? '停止生成' : (blocked ? '请先切回后续消息使用的回答版本' : '发送');
    send.setAttribute('aria-label', send.title);
    send.classList.toggle('is-ready', state.generating || (ready && hasContent));
    const icon = send.querySelector('path');
    if (icon) icon.setAttribute('d', state.generating ? 'M7 7h10v10H7z' : 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z');
  }
  if (hint) {
    if (state.generating) hint.textContent = '正在生成，点击发送按钮可停止';
    else if (blocked) hint.textContent = '当前查看的是旧回答分支。切回后续消息所使用的版本后，才能继续对话。';
    else if (ready) hint.textContent = 'Enter 发送，Shift+Enter 换行';
    else hint.textContent = '添加供应商并选择模型后即可开始对话';
  }
  const banner = $('#branch-blocked');
  if (banner) banner.hidden = !blocked;
}

function makeMsgAction(label, title, onClick, disabled) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'msg-action-btn';
  btn.textContent = label;
  btn.title = title || label;
  btn.disabled = !!disabled;
  btn.addEventListener('click', (event) => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

function renderChat() {
  const host = $('#chat-scroll');
  if (!host) return;
  const stickBottom = host.scrollHeight - host.scrollTop - host.clientHeight < 96;
  host.innerHTML = '';
  const messages = state.session?.messages || [];
  if (!messages.length) {
    const welcome = document.createElement('div');
    welcome.className = 'welcome';
    welcome.innerHTML = '<div class="welcome-mark" aria-hidden="true">W</div><p class="welcome-brand">WePChat</p><p class="welcome-sub">轻量 · 克制 · 快捷</p>';
    host.appendChild(welcome);
    return;
  }

  const inner = document.createElement('div');
  inner.className = 'chat-inner';

  messages.forEach((message, index) => {
    const item = document.createElement('article');
    item.className = `chat-message chat-message--${message.role}`;
    item.dataset.messageId = message.id;
    item.setAttribute('aria-label', message.role === 'user' ? '你' : '助手');

    if (message.role === 'assistant' && message.reasoning) {
      const reason = document.createElement('details');
      reason.className = 'chat-reasoning';
      if (message.status === 'streaming' && !message.content) reason.open = true;
      const summary = document.createElement('summary');
      summary.textContent = message.status === 'streaming' && !message.content ? '思考中…' : '思考过程';
      const pre = document.createElement('pre');
      pre.textContent = message.reasoning;
      reason.append(summary, pre);
      item.append(reason);
    }

    if (message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length) {
      const toolsHost = document.createElement('div');
      toolsHost.className = 'chat-tools';
      message.toolCalls.forEach((t) => {
        if (!t || !t.name) return;
        const card = document.createElement('details');
        card.className = 'tool-card tool-card--' + (t.status || 'done');
        if (t._open || t.status === 'composing' || t.status === 'running') card.open = true;
        const head = document.createElement('summary');
        head.className = 'tool-head';
        head.innerHTML = `<span class="tool-name"></span><span class="tool-status"></span>`;
        head.querySelector('.tool-name').textContent = t.name;
        head.querySelector('.tool-status').textContent = toolStatusLabel(t.status);
        const bodyEl = document.createElement('div');
        bodyEl.className = 'tool-body';
        const argsSec = document.createElement('div');
        argsSec.className = 'tool-sec';
        argsSec.textContent = '参数';
        const argsPre = document.createElement('pre');
        argsPre.className = 'tool-pre';
        argsPre.textContent = U.truncate(String(t.arguments || ''), 1200);
        bodyEl.append(argsSec, argsPre);
        if (t.result != null && t.result !== '') {
          const resSec = document.createElement('div');
          resSec.className = 'tool-sec';
          resSec.textContent = '结果';
          const resPre = document.createElement('pre');
          resPre.className = 'tool-pre';
          resPre.textContent = U.truncate(String(t.result), 2000);
          bodyEl.append(resSec, resPre);
        }
        card.append(head, bodyEl);
        toolsHost.appendChild(card);
      });
      item.append(toolsHost);
    }

    const body = document.createElement('div');
    body.className = 'chat-message-body' + (message.role === 'assistant' ? ' md' : '');
    const hasTools = message.role === 'assistant' && Array.isArray(message.toolCalls) && message.toolCalls.length;
    if (message.role === 'assistant' && !message.error && message.content) {
      body.innerHTML = message.status === 'streaming'
        ? MD.renderStreaming(message.content)
        : MD.render(message.content);
      $all('a', body).forEach((link) => {
        link.target = '_blank';
        link.rel = 'noreferrer';
      });
    } else if (message.error) {
      body.classList.add('has-error');
      body.textContent = message.content ? `${message.content}\n\n${message.error}` : message.error;
    } else if (message.status === 'streaming' && !message.content && !message.reasoning && !hasTools) {
      body.innerHTML = '<span class="typing-dot" aria-hidden="true"></span>';
    } else {
      body.textContent = message.content || '';
    }
    if (body.textContent || body.innerHTML) item.append(body);

    if (message.role === 'assistant' && message.error && message.status !== 'streaming') {
      const errRow = document.createElement('div');
      errRow.className = 'chat-error-row';
      const retry = document.createElement('button');
      retry.type = 'button';
      retry.className = 'err-retry-btn';
      retry.textContent = '重试';
      retry.disabled = !canRegenerateMessage(index);
      retry.addEventListener('click', () => regenerateMessage(index));
      errRow.appendChild(retry);
      item.append(errRow);
    }

    if (message.status !== 'streaming') {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';
      actions.appendChild(makeMsgAction('复制', '复制内容', () => copyMessage(message)));

      if (message.role === 'assistant') {
        const variants = Array.isArray(message.variants) ? message.variants : [];
        if (variants.length > 1) {
          const switcher = document.createElement('span');
          switcher.className = 'msg-variant-switch';
          const prev = document.createElement('button');
          prev.type = 'button';
          prev.textContent = '‹';
          prev.disabled = (message.activeVariantIndex || 0) <= 0;
          prev.title = '上一个回答版本';
          prev.addEventListener('click', () => switchAssistantVariant(index, -1));
          const meta = document.createElement('b');
          meta.textContent = `${(message.activeVariantIndex || 0) + 1}/${variants.length}`;
          const next = document.createElement('button');
          next.type = 'button';
          next.textContent = '›';
          next.disabled = (message.activeVariantIndex || 0) >= variants.length - 1;
          next.title = '下一个回答版本';
          next.addEventListener('click', () => switchAssistantVariant(index, 1));
          switcher.append(prev, meta, next);
          actions.appendChild(switcher);
        }
        actions.appendChild(makeMsgAction(
          '重新生成',
          canRegenerateMessage(index) ? '重新生成（最多 6 个版本）' : '无法继续重新生成',
          () => regenerateMessage(index),
          !canRegenerateMessage(index)
        ));
      }

      if (message.role === 'user') {
        actions.appendChild(makeMsgAction('编辑', '编辑此消息并截断后续', () => editUserMessage(index)));
      }
      actions.appendChild(makeMsgAction('删除', '删除此消息', () => deleteMessage(index)));

      if (message.role === 'assistant' && message.model) {
        const tag = document.createElement('span');
        tag.className = 'msg-model-tag';
        tag.textContent = message.model;
        actions.appendChild(tag);
      }
      item.append(actions);
    }

    if (message.status === 'streaming') item.classList.add('is-streaming');
    inner.appendChild(item);
  });

  host.appendChild(inner);
  if (stickBottom) host.scrollTop = host.scrollHeight;
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
  state.session.messages.splice(index);
  await persistSession();
  renderChat();
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

function shouldConfirmTool(name) {
  return name === 'delete_file';
}

async function authorizeToolCall(t) {
  if (!shouldConfirmTool(t.name)) return '';
  let preview = '';
  try {
    const args = typeof t.arguments === 'string' ? JSON.parse(t.arguments || '{}') : (t.arguments || {});
    const paths = Array.isArray(args.paths) ? args.paths : (args.path ? [args.path] : []);
    preview = paths.length ? paths.join('\n') : U.truncate(String(t.arguments || ''), 400);
  } catch {
    preview = U.truncate(String(t.arguments || ''), 400);
  }
  const ok = await UIDialog.confirm(
    'AI 请求删除以下路径：\n' + preview + '\n\n删除后无法从应用内恢复。',
    '确认删除',
    { danger: true, okText: '删除' }
  );
  return ok ? '' : '错误：用户拒绝了工具调用：delete_file';
}

function buildToolContext() {
  return {
    sessionId: state.session?.id,
    session: state.session,
    webFetchMode: 'always',
    previousResults: [],
    confirm: (msg) => UIDialog.confirm(String(msg), '工具授权'),
    openPreview: (payload) => openPreview(payload),
    onWorkspaceChanged: () => {
      if (state.rightOpen) refreshFilesTree();
      refreshBrowserIfOpen();
    },
    onRunJs: (info) => {
      state.lastRunJs = info;
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
  const provider = currentProvider();
  const model = state.activeModel || state.session?.model || provider?.models?.[0] || '';
  if (!provider || !model || !state.session) return;

  const targetIndex = Number.isInteger(opts.targetIndex) ? opts.targetIndex : -1;
  let assistantMsg;
  if (targetIndex >= 0) {
    assistantMsg = state.session.messages[targetIndex];
    if (!assistantMsg || assistantMsg.role !== 'assistant') return;
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
    state.session.messages.push(assistantMsg);
  }

  const assistantIndex = state.session.messages.indexOf(assistantMsg);
  const workingMessages = state.session.messages
    .slice(0, assistantIndex)
    .filter((m) => m.role === 'user' || m.role === 'assistant')
    .map((m) => {
      if (m.role === 'assistant') {
        return { role: 'assistant', content: m.content || '', reasoning: m.reasoning || '' };
      }
      return { role: 'user', content: m.content || '', attachments: m.attachments || [] };
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
  const toolCtx = buildToolContext();

  state.session.providerId = provider.id;
  state.session.model = model;
  state.generating = true;
  state.stopRequested = false;
  state.abortCtl = new AbortController();
  renderChat();
  renderComposerState();
  await persistSession();

  const TS = window.ToolStream || {};

  try {
    for (let step = 0; step <= maxToolRounds; step++) {
      const result = await API.send({
        provider,
        model,
        messages: workingMessages,
        tools,
        settings: reqSettings,
        signal: state.abortCtl.signal,
        requestKey: NetStability.idempotencyKey('chat-' + assistantMsg.id + '-' + step),
        onUpdate(stream) {
          assistantMsg.content = stream?.content || '';
          assistantMsg.reasoning = stream?.reasoning || '';
          assistantMsg.usage = stream?.usage || null;
          if (stream?.streamTools?.length && TS.syncStreamToolCalls) {
            TS.syncStreamToolCalls(assistantMsg, stream.streamTools, step);
          }
          assistantMsg.status = 'streaming';
          if (assistantMsg.variants?.length) syncActiveAssistantVariant(assistantMsg);
          renderChat();
        },
      });

      assistantMsg.content = result?.content || assistantMsg.content;
      assistantMsg.reasoning = result?.reasoning || assistantMsg.reasoning;
      assistantMsg.usage = result?.usage || assistantMsg.usage || null;

      if (state.stopRequested) {
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
      renderChat();
      await persistSession();

      for (let ti = 0; ti < displayCalls.length; ti++) {
        const t = displayCalls[ti];
        toolCtx.previousResults = previousToolResults;
        const denied = await authorizeToolCall(t);
        const out = denied || await Tools.execute(t.name, t.arguments, toolCtx);
        t.result = out;
        t.status = String(out).startsWith('错误：') ? 'error' : 'done';
        previousToolResults.push({ name: t.name, result: out });
        workingMessages.push({ role: 'tool', toolCallId: t.id, content: out });
        if (assistantMsg.variants?.length) syncActiveAssistantVariant(assistantMsg);
        renderChat();
        await persistSession();
      }
    }

    if (!assistantMsg.content && !(assistantMsg.toolCalls || []).length && state.stopRequested) {
      assistantMsg.content = '已停止。';
    }
    assistantMsg.status = 'done';
    if (assistantMsg.variants?.length) {
      ensureAssistantVariants(assistantMsg);
      syncActiveAssistantVariant(assistantMsg);
    }
  } catch (err) {
    assistantMsg.status = 'error';
    if (state.stopRequested || err?.code === 'NET-ABORTED') {
      if (!assistantMsg.content && !(assistantMsg.toolCalls || []).length) assistantMsg.content = '已停止。';
      assistantMsg.status = 'done';
      assistantMsg.error = '';
    } else {
      assistantMsg.error = NetStability.display(err);
    }
    if (assistantMsg.variants?.length) syncActiveAssistantVariant(assistantMsg);
  } finally {
    state.generating = false;
    state.abortCtl = null;
    state.stopRequested = false;
    renderChat();
    renderComposerState();
    await persistSession();
  }
}

async function sendMessage() {
  if (state.generating) {
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
  const provider = currentProvider();
  const model = state.activeModel;
  if (!content || !provider || !model || !state.session) return;

  const messages = state.session.messages || [];
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
    createdAt: nowIso(),
    parentAssistantId: parentAssistant?.id || '',
    parentVariantId: parentAssistant ? activeAssistantVariantId(parentAssistant) : '',
  });
  state.session.providerId = provider.id;
  state.session.model = model;
  state.session.title = state.session.title || content.split(/\r?\n/)[0].slice(0, 48);
  state.session.messages.push(user);
  input.value = '';
  renderSessions();
  renderChat();
  renderComposerState();
  await persistSession();
  await generateAssistant();
}

/* ---------- Global events and backend bootstrap ---------- */

function bindEvents() {
  $all('.rail-btn').forEach((btn) => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });

  $all('.settings-nav-item').forEach((btn) => {
    btn.addEventListener('click', () => setSettingsPage(btn.dataset.settings));
  });

  $('#btn-new-chat')?.addEventListener('click', () => createNewChat());
  $('#btn-new-chat-top')?.addEventListener('click', () => createNewChat());
  $('#btn-new-image')?.addEventListener('click', () => setMode('image'));
  $('#btn-save-agent')?.addEventListener('click', () => saveAgentSettings());
  $('#agent-enabled')?.addEventListener('click', () => {
    const btn = $('#agent-enabled');
    if (!btn) return;
    const on = btn.getAttribute('aria-pressed') !== 'true';
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('on', on);
  });
  document.addEventListener('click', () => closeSessionMenus());

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
    if (!providerId || !model) return;
    state.activeProviderId = providerId;
    state.activeModel = model;
    if (state.session) {
      state.session.providerId = providerId;
      state.session.model = model;
    }
    await persistSettings();
    if (state.session?.messages.length) await persistSession();
    renderProviders();
    renderModelSelect();
    renderComposerState();
  });

  $('#btn-send')?.addEventListener('click', sendMessage);
  $('#composer-input')?.addEventListener('input', renderComposerState);
  $('#composer-input')?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      sendMessage();
    }
  });
  $('#chat-scroll')?.addEventListener('click', async (event) => {
    const button = event.target.closest('.code-btn[data-act="copy"]');
    if (!button) return;
    const code = button.closest('.code-block')?.querySelector('code')?.textContent || '';
    try {
      await navigator.clipboard.writeText(code);
      const before = button.textContent;
      button.textContent = '已复制';
      setTimeout(() => { button.textContent = before; }, 1200);
    } catch (err) {
      console.warn('Unable to copy code:', err);
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
  renderProviders();
  renderSessions();
  renderModelSelect();
  renderComposerState();
  renderChat();
}

async function saveAgentSettings() {
  const status = $('#agent-status');
  const agentBtn = $('#agent-enabled');
  const rounds = $('#agent-max-rounds');
  const calls = $('#agent-max-calls');
  const next = {
    ...(state.settings || defaultSettings()),
    providers: state.providers,
    activeProviderId: state.activeProviderId,
    activeModel: state.activeModel,
    agentEnabled: agentBtn ? agentBtn.getAttribute('aria-pressed') === 'true' : true,
    maxToolRounds: U.clamp(parseInt(rounds?.value || 8, 10), 1, 32),
    maxToolCalls: U.clamp(parseInt(calls?.value || 24, 10), 1, 128),
  };
  if (status) status.textContent = '保存中…';
  try {
    state.settings = { ...defaultSettings(), ...(await invoke('save_settings', { settings: next })), providers: state.providers };
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
    state.settings = { ...defaultSettings(), ...(settings || {}) };
    state.defaultWorkspaceRoot = defaultRoot || '';
    state.resolvedWorkspaceRoot = resolvedRoot || '';
    state.providers = Array.isArray(state.settings.providers)
      ? state.settings.providers.map((item) => normalizeProvider(item))
      : [];
    state.activeProviderId = state.settings.activeProviderId || state.providers[0]?.id || '';
    const provider = currentProvider();
    state.activeModel = provider?.models.includes(state.settings.activeModel)
      ? state.settings.activeModel
      : provider?.models[0] || '';
    state.sessions = Array.isArray(sessions) ? sessions.map((item) => normalizeSession(item)) : [];
    if (state.sessions[0]) {
      try {
        state.session = normalizeSession(await invoke('load_session', { id: state.sessions[0].id }));
      } catch {
        state.session = normalizeSession(state.sessions[0]);
      }
    } else {
      state.session = createSession();
      await persistSession();
    }
    if (state.session.providerId && state.providers.some((item) => item.id === state.session.providerId)) {
      state.activeProviderId = state.session.providerId;
      const sessionProvider = currentProvider();
      state.activeModel = sessionProvider?.models.includes(state.session.model)
        ? state.session.model
        : sessionProvider?.models[0] || '';
    }
  } catch (err) {
    console.warn('Backend bootstrap unavailable:', err);
    state.settings ||= defaultSettings();
    state.providers = Array.isArray(state.settings.providers) ? state.settings.providers.map(normalizeProvider) : [];
    state.activeProviderId = state.settings.activeProviderId || state.providers[0]?.id || '';
    state.activeModel = state.settings.activeModel || currentProvider()?.models[0] || '';
    state.session ||= createSession();
  }
  renderBackendState();
}

async function saveWorkspaceSettings() {
  const input = $('#workspace-custom');
  const status = $('#workspace-status');
  if (!input) return;

  const next = {
    ...(state.settings || {}),
    workspaceRoot: input.value.trim() || null,
  };
  if (status) status.textContent = '保存中…';
  try {
    state.settings = await invoke('save_settings', { settings: next });
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
    el.querySelector('.rp-tab-label').textContent = tab.title;
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
      <div class="rp-browser-stage" id="browser-stage">
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
        <button type="button" class="rp-icon" data-act="refresh-files" title="刷新">
          <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 8 8h-2a6 6 0 1 1-1.76-4.24L14 10h6V4l-2.35 2.35z"/></svg>
        </button>
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
  }

  if (content) {
    host.innerHTML = content;
    host.hidden = false;
    if (tab.kind === 'browser') bindBrowserTab(tab);
    if (tab.kind === 'files') bindFilesTab(tab);
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

  let tab = state.rightTabs.find((t) => t.kind === 'browser' && t.path === path);
  if (!tab) {
    tab = { id: uid('r'), kind: 'browser', title, path, waiting: false };
    state.rightTabs.push(tab);
  } else {
    tab.title = title;
  }
  state.activeRightTabId = tab.id;
  renderRightTabs();
  renderRightContent();
  await loadBrowserPath(tab, path);
}

async function loadBrowserPath(tab, path) {
  if (!path || !state.session?.id || !window.Tools?.fs) {
    tab.waiting = true;
    return;
  }
  try {
    const content = await Tools.fs.read(state.session.id, path);
    if (String(content).startsWith('错误：')) {
      tab.waiting = true;
      tab.html = '';
      const empty = $('#browser-empty');
      const frame = $('.rp-frame');
      if (empty) {
        empty.hidden = false;
        const title = empty.querySelector('.rp-empty-title');
        const desc = empty.querySelector('.rp-empty-desc');
        if (title) title.textContent = '等待生成…';
        if (desc) desc.textContent = path + ' 尚未创建或不存在';
      }
      if (frame) frame.hidden = true;
      return;
    }
    tab.waiting = false;
    tab.path = path;
    tab.html = content;
    const empty = $('#browser-empty');
    const frame = $('.rp-frame');
    if (empty) empty.hidden = true;
    if (frame) {
      frame.hidden = false;
      frame.srcdoc = content;
    }
  } catch (err) {
    tab.waiting = true;
    UIDialog.toast(err?.message || String(err));
  }
}

function bindBrowserTab(tab) {
  const input = $('.rp-url');
  const go = () => {
    const path = (input?.value || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
    if (!path) return;
    tab.path = path;
    tab.title = path.split('/').pop() || '浏览器';
    renderRightTabs();
    loadBrowserPath(tab, path);
  };
  hostAct('go', go);
  hostAct('refresh', () => loadBrowserPath(tab, tab.path || input?.value || ''));
  input?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      go();
    }
  });
  if (tab.path && !tab.waiting) loadBrowserPath(tab, tab.path);
  else if (tab.path) loadBrowserPath(tab, tab.path);
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
        li.textContent = '📁 ' + (node.name || path);
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
      li.textContent = '📄 ' + (node.name || node.path);
      li.title = node.path || '';
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
  state.filesSelectedPath = path;
  const empty = $('#file-viewer-empty');
  const code = $('#file-viewer-code');
  try {
    const content = await Tools.fs.read(state.session.id, path);
    if (empty) empty.hidden = true;
    if (code) {
      code.hidden = false;
      code.textContent = String(content).startsWith('错误：') ? content : content;
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
  const filter = $('#file-tree-filter');
  filter?.addEventListener('input', () => {
    state.fileFilter = filter.value || '';
    paintFilesTree();
  });
  refreshFilesTree().then(() => {
    if (state.filesSelectedPath) openFileInViewer(state.filesSelectedPath);
    else paintFilesTree();
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
    runner: { title: '运行', kind: 'runner' }
  };
  if (!kinds[kind]) return;
  // Reuse single files/runner tab
  if (kind === 'files' || kind === 'runner') {
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
    const startWidth = side === 'list' ? 272 : 360;
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const newWidth = Math.max(180, Math.min(side === 'list' ? 400 : 800, startWidth + dx));
      document.documentElement.style.setProperty(side === 'list' ? '--list-w' : '--right-w', `${newWidth}px`);
    };
    const stop = () => {
      document.removeEventListener('mousemove', move);
      document.removeEventListener('mouseup', stop);
    };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', stop);
  }
}
async function boot() {
  bindEvents();
  await bindWindowControls();
  setMode('chat');
  setSettingsPage('providers');
  setListCollapsed(false);
  setRightOpen(false);
  await loadBackend();
  bindRightEvents();
}

boot().catch((err) => console.error('Unable to start WePChat:', err));
