/**
 * WePChat Windows — 消息位置 rail（轻量导航器）。
 *
 * - 每个用户提问对应一个刻度；点击跳转到该消息（居中）。
 * - hover 显示一行问题摘要。
 * - 滚动时高亮当前可见位置对应的刻度；刻度过多时活动刻度保持在 rail 中央。
 * - 用户提问少于 2 条时隐藏，避免噪音。
 */

let root = null;      // .chat-rail
let viewport = null;  // .chat-rail-viewport
let track = null;     // .chat-rail-track
let tip = null;       // .chat-rail-tip
let chatHost = null;  // #chat-scroll
let getMessageElement = null;
let onJump = null;

let entries = [];     // [{ id, summary, el(tick) }]
let entriesFp = '';
let activeId = '';
let scrollRaf = 0;
let jumpLockId = '';
let jumpUnlockTimer = 0;

function summarize(text) {
  const line = String(text || '').split(/\r?\n/).find((l) => l.trim()) || '';
  const compact = line.replace(/\s+/g, ' ').trim();
  return compact.length > 72 ? compact.slice(0, 71) + '…' : compact;
}

function activateEntry(entry) {
  if (!entry) return;
  activeId = entry.id;
  entries.forEach((e) => e.el.classList.toggle('is-active', e === entry));
  centerActive(entry);
}

function armJumpUnlock() {
  clearTimeout(jumpUnlockTimer);
  jumpUnlockTimer = setTimeout(() => {
    jumpUnlockTimer = 0;
    jumpLockId = '';
    scheduleSync();
  }, 180);
}

export function initChatRail(options) {
  root = options.root;
  chatHost = options.chatHost;
  getMessageElement = options.getMessageElement;
  onJump = options.onJump;
  if (!root || !chatHost) return;
  viewport = root.querySelector('.chat-rail-viewport') || root;
  track = root.querySelector('.chat-rail-track');
  tip = root.querySelector('.chat-rail-tip');
  chatHost.addEventListener('scroll', () => {
    // smooth scroll 途中保持用户刚点击的刻度，结束后再按实际视口同步。
    if (jumpLockId) armJumpUnlock();
    else scheduleSync();
  }, { passive: true });
}

export function updateChatRail(session) {
  if (!root || !track) return;
  const users = (session?.messages || []).filter((m) => m.role === 'user');
  if (users.length < 2) {
    root.hidden = true;
    entries = [];
    entriesFp = '';
    activeId = '';
    jumpLockId = '';
    clearTimeout(jumpUnlockTimer);
    hideTip();
    return;
  }
  const fp = users.map((m) => m.id + ':' + String(m.content || '').slice(0, 96)).join('|');
  root.hidden = false;
  if (fp === entriesFp) {
    scheduleSync();
    return;
  }
  entriesFp = fp;
  activeId = '';
  jumpLockId = '';
  clearTimeout(jumpUnlockTimer);
  track.style.transform = '';
  track.innerHTML = '';
  entries = users.map((m) => {
    const tick = document.createElement('button');
    tick.type = 'button';
    tick.className = 'chat-rail-tick';
    tick.dataset.messageId = m.id;
    tick.setAttribute('aria-label', summarize(m.content) || '定位消息');
    const entry = { id: m.id, summary: summarize(m.content), el: tick };
    tick.addEventListener('click', () => {
      hideTip();
      const target = getMessageElement?.(m.id);
      if (target) {
        jumpLockId = entry.id;
        activateEntry(entry);
        armJumpUnlock();
        onJump?.(target);
      }
    });
    tick.addEventListener('mouseenter', () => showTip(entry));
    tick.addEventListener('mouseleave', hideTip);
    tick.addEventListener('focus', () => showTip(entry));
    tick.addEventListener('blur', hideTip);
    track.appendChild(tick);
    return entry;
  });
  scheduleSync();
}

function showTip(entry) {
  if (!tip || !entry.summary) return;
  tip.textContent = entry.summary;
  tip.hidden = false;
  const railRect = root.getBoundingClientRect();
  const tickRect = entry.el.getBoundingClientRect();
  tip.style.top = `${tickRect.top - railRect.top + tickRect.height / 2}px`;
}

function hideTip() {
  if (tip) tip.hidden = true;
}

function scheduleSync() {
  if (scrollRaf || !entries.length) return;
  scrollRaf = requestAnimationFrame(() => {
    scrollRaf = 0;
    syncActive();
  });
}

/** 当前刻度 = 视口上缘 1/3 处之上最近的用户消息 */
function syncActive() {
  if (!chatHost || !entries.length) return;
  const hostRect = chatHost.getBoundingClientRect();
  const probe = hostRect.top + hostRect.height * 0.33;
  let current = entries[0];
  for (const entry of entries) {
    const el = getMessageElement?.(entry.id);
    if (!el) continue;
    const rect = el.getBoundingClientRect();
    if (rect.top <= probe) current = entry;
    else break;
  }
  if (current.id !== activeId) activateEntry(current);
}

/** 刻度超出 rail 可视高度时，让活动刻度尽量停在中央 */
function centerActive(entry) {
  if (!track || !viewport) return;
  const trackH = track.scrollHeight;
  const viewH = viewport.clientHeight;
  if (trackH <= viewH) {
    track.style.transform = '';
    return;
  }
  const offset = entry.el.offsetTop + entry.el.offsetHeight / 2 - viewH / 2;
  const max = trackH - viewH;
  const y = Math.max(0, Math.min(max, offset));
  track.style.transform = `translateY(${-y}px)`;
}
