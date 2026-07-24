import { $, $all, cloneJson, defaultSettings } from './app-core.js';

const AGENTS = [
  { kind: 'codex', label: 'Codex' },
  { kind: 'claude', label: 'Claude Code' },
  { kind: 'pi', label: 'Pi' },
];

let deps = null;
let detection = [];

function settings() {
  return deps?.getState?.().settings || defaultSettings();
}

function externalSettings() {
  const base = cloneJson(defaultSettings().externalConnections);
  const current = settings().externalConnections || {};
  const next = {
    ...base,
    ...current,
    agents: {
      ...(base.agents || {}),
      ...(current.agents || {}),
    },
    projects: {
      ...(base.projects || {}),
      ...(current.projects || {}),
    },
  };
  AGENTS.forEach((agent) => {
    next.agents[agent.kind] ||= { enabled: false, commandPath: null, extraArgs: [], env: {} };
    next.projects[agent.kind] ||= [];
  });
  return next;
}

function setPressed(btn, on) {
  if (!btn) return;
  btn.classList.toggle('on', !!on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
}

function agentDetection(kind) {
  return detection.find((item) => item.kind === kind) || null;
}

function readExternalSettingsFromUi() {
  const next = externalSettings();
  next.enabled = $('#external-enabled')?.getAttribute('aria-pressed') === 'true';
  next.agents ||= {};
  AGENTS.forEach((agent) => {
    next.agents[agent.kind] ||= { enabled: false, commandPath: null, extraArgs: [], env: {} };
    next.agents[agent.kind].enabled = $(`#external-${agent.kind}-enabled`)?.getAttribute('aria-pressed') === 'true';
    next.agents[agent.kind].commandPath = ($(`#external-${agent.kind}-path`)?.value || '').trim() || null;
    next.agents[agent.kind].extraArgs = Array.isArray(next.agents[agent.kind].extraArgs) ? next.agents[agent.kind].extraArgs : [];
    next.agents[agent.kind].env = next.agents[agent.kind].env || {};
  });
  return next;
}

async function saveSettings() {
  const status = $('#external-status');
  const appState = deps.getState();
  appState.settings = {
    ...defaultSettings(),
    ...(appState.settings || {}),
    providers: appState.providers || [],
    externalConnections: readExternalSettingsFromUi(),
  };
  if (status) status.textContent = '保存中...';
  await deps.persistSettings();
  if (status) status.textContent = '已保存';
}

async function detect() {
  const list = await deps.invoke('external_agent_detect_all');
  detection = Array.isArray(list) ? list : [];
  renderSettings();
}

function renderSettings() {
  const s = externalSettings();
  setPressed($('#external-enabled'), s.enabled);
  AGENTS.forEach((agent) => {
    const config = s.agents?.[agent.kind] || {};
    setPressed($(`#external-${agent.kind}-enabled`), !!config.enabled);
    const path = $(`#external-${agent.kind}-path`);
    if (path) path.value = config.commandPath || '';
    const status = $(`#external-${agent.kind}-status`);
    if (!status) return;
    const found = agentDetection(agent.kind);
    if (!found) {
      status.textContent = '未检测';
    } else if (found.installed) {
      status.textContent = `已安装 · ${found.path || 'PATH'}${found.version ? ` · ${found.version}` : ''}`;
    } else {
      status.textContent = `未找到 ${found.command || agent.kind}`;
    }
  });
}

function bind() {
  $('#external-enabled')?.addEventListener('click', (event) => {
    const btn = event.currentTarget;
    setPressed(btn, btn.getAttribute('aria-pressed') !== 'true');
  });
  AGENTS.forEach((agent) => {
    $(`#external-${agent.kind}-enabled`)?.addEventListener('click', (event) => {
      const btn = event.currentTarget;
      setPressed(btn, btn.getAttribute('aria-pressed') !== 'true');
    });
  });
  $all('[data-external-detect]').forEach((btn) => btn.addEventListener('click', detect));
  $('#btn-save-external')?.addEventListener('click', saveSettings);
}

export function initExternalAgentMode(options) {
  deps = options;
  bind();
  window.ExternalAgentMode = {
    refresh,
  };
}

async function refresh() {
  renderSettings();
  if (!detection.length) {
    detect().catch(() => {});
  }
}
