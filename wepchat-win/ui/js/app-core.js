/**
 * WePChat Windows shared application state and low-level helpers.
 * Feature modules import these bindings instead of depending on app.js scope.
 */

export const invoke = (cmd, args) => {
  const core = window.__TAURI__?.core;
  if (!core?.invoke) return Promise.reject(new Error('Tauri bridge unavailable'));
  return core.invoke(cmd, args);
};

export const state = {
  mode: 'chat',
  settingsPage: 'providers',
  rightOpen: false,
  rightTabs: [],
  activeRightTabId: null,
  rightView: 'home',
  listCollapsed: false,
  maximized: false,
  settings: null,
  meta: null,
  providers: [],
  sessions: [],
  session: null,
  sessionSearchQuery: '',
  lastChatSessionId: '',
  lastImageSessionId: '',
  generating: false,
  abortCtl: null,
  stopRequested: false,
  pendingAttachments: [],
  backgroundTasks: new Map(),
  sessionSaveChains: new Map(),
  messagePageState: new Map(),
  contextWarnings: new Map(),
  deletedSessionIds: new Set(),
  sessionNavigationSeq: 0,
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

export function $(sel, root = document) {
  return root.querySelector(sel);
}

export function $all(sel, root = document) {
  return [...root.querySelectorAll(sel)];
}

export function uid(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2, 9)}`;
}

export function getAppWindow() {
  try {
    return window.__TAURI__?.window?.getCurrentWindow?.() || null;
  } catch {
    return null;
  }
}

export const TOOL_PERM_KEYS = ['run_js', 'files', 'delete_files', 'web_fetch', 'image_go'];
export const TOOL_PERM_LABELS = {
  run_js: 'JavaScript 沙盒',
  web_fetch: '网页访问',
  image_go: '图片生成',
  delete_files: '删除工作区文件/文件夹',
  files: '工作区文件',
};

export function defaultToolPermissions() {
  return {
    run_js: 'ask',
    files: 'ask',
    delete_files: 'ask',
    web_fetch: 'ask',
    image_go: 'ask',
  };
}

export function normalizeToolMode(mode) {
  return mode === 'always' || mode === 'never' ? mode : 'ask';
}

export function normalizeToolPermissions(raw) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of TOOL_PERM_KEYS) {
    let mode = normalizeToolMode(src[key]);
    if (key === 'delete_files' && mode === 'always') mode = 'ask';
    out[key] = mode;
  }
  return out;
}

export function defaultSettings() {
  const img = globalThis.window?.ImageMode?.defaultImageSettings?.() || {
    imageProviderId: '',
    imageModel: '',
    imageEditModel: '',
    imageDefaultSize: 'auto',
    imageQuality: 'auto',
    imageBackground: 'auto',
    imageDefaultCount: 1,
    imageOutputFormat: 'png',
    imageStylePresetId: '',
    imageStylePresets: [],
    imageApiMode: 'images',
    imageEndpointPath: '',
    imageEditEndpointPath: '',
  };
  return {
    workspaceRoot: null,
    theme: 'light',
    themeStyle: 'graphite',
    providers: [],
    systemPrompt: '',
    temperature: null,
    maxTokens: null,
    agentEnabled: true,
    maxToolRounds: 8,
    maxToolCalls: 24,
    toolPermissions: defaultToolPermissions(),
    ...img,
  };
}

export function nowIso() {
  return new Date().toISOString();
}

export function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}
