/**
 * WePChat Windows — 聊天滚动控制器。
 *
 * 规则（对齐 docs/deepsearch.md）：
 * - 用户接近底部：新内容自动跟随。
 * - 用户上翻：脱离跟随，不抢滚动位置。
 * - 回到底部（滚回近底或点按钮）：恢复跟随。
 * - 远离底部时显示「回到底部」按钮。
 *
 * 实现要点：内容增长不触发 scroll 事件，scroll 事件只来自用户滚动或程序赋值；
 * 结合滚动方向判定 —— 向上滚即脱离跟随，向下滚回近底或触底则恢复。
 */

const NEAR_BOTTOM = 64;   // 向下滚回距底该值内 → 恢复跟随
const SHOW_BUTTON = 220;  // 距底大于该值 → 显示回到底部按钮
const NEAR_TOP = 96;      // 靠近顶部时加载更早消息

let host = null;
let jumpBtn = null;
let onNearTop = null;
let follow = true;
let lastTop = 0;
let resizeObserver = null;
let observedInner = null;

function distanceFromBottom() {
  if (!host) return 0;
  return host.scrollHeight - host.scrollTop - host.clientHeight;
}

function updateButton() {
  if (!jumpBtn) return;
  const show = distanceFromBottom() > SHOW_BUTTON;
  jumpBtn.hidden = !show;
}

function onScroll() {
  const top = host.scrollTop;
  const goingUp = top < lastTop - 1;
  const goingDown = top > lastTop + 1;
  lastTop = top;
  const dist = distanceFromBottom();
  // 任何向上滚动都脱离跟随；向下滚回近底、或到达底部时恢复
  if (goingUp && dist > 1) follow = false;
  else if (dist <= 1) follow = true;
  else if (goingDown && dist < NEAR_BOTTOM) follow = true;
  if (top <= NEAR_TOP) onNearTop?.();
  updateButton();
}

function observeInner() {
  if (!host || !resizeObserver) return;
  const inner = host.firstElementChild;
  if (inner === observedInner) return;
  if (observedInner) resizeObserver.unobserve(observedInner);
  observedInner = inner;
  if (inner) resizeObserver.observe(inner);
}

export function initChatScroll(options) {
  host = options.host;
  jumpBtn = options.jumpButton || null;
  onNearTop = typeof options.onNearTop === 'function' ? options.onNearTop : null;
  if (!host) return;
  host.addEventListener('scroll', onScroll, { passive: true });
  if (typeof ResizeObserver === 'function') {
    // 图片加载、代码高亮等异步高度变化时保持贴底
    resizeObserver = new ResizeObserver(() => {
      stickIfFollowing();
      updateButton();
    });
  }
  jumpBtn?.addEventListener('click', () => jumpToBottom());
}

export function stickIfFollowing() {
  if (!host || !follow) return;
  host.scrollTop = host.scrollHeight;
}

/** 内容更新后调用：贴底 + 维护按钮与观察目标 */
export function notifyContentChanged() {
  observeInner();
  stickIfFollowing();
  updateButton();
}

export function jumpToBottom(opts = {}) {
  if (!host) return;
  follow = true;
  host.scrollTo({ top: host.scrollHeight, behavior: opts.smooth ? 'smooth' : 'auto' });
  updateButton();
}

/** 会话切换：立刻贴底并恢复跟随 */
export function resetToBottom() {
  if (!host) return;
  follow = true;
  observeInner();
  host.scrollTop = host.scrollHeight;
  updateButton();
}

export async function preserveAnchor(task) {
  if (!host || typeof task !== 'function') return task?.();
  const beforeHeight = host.scrollHeight;
  const beforeTop = host.scrollTop;
  const result = await task();
  requestAnimationFrame(() => {
    if (!host) return;
    host.scrollTop = beforeTop + (host.scrollHeight - beforeHeight);
    lastTop = host.scrollTop;
    updateButton();
  });
  return result;
}

/** 定位到某条消息（rail 点击）：居中显示；若目标接近底部则自然恢复跟随 */
export function scrollToMessage(el) {
  if (!host || !el) return;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

export function isFollowing() {
  return follow;
}
