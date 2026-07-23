/**
 * WePChat Windows — 增量聊天渲染器。
 *
 * 消息按 id 映射为稳定 DOM 节点，reasoning / 工具卡 / 正文 / 图片 / 错误 / 操作行
 * 各自独立按需更新；流式正文用顶层 Markdown 块缓存，只重渲染发生变化的块，
 * 完成后做一次完整解析收尾。流式更新经 40ms 合并 + rAF 对齐后落地。
 */

const FLUSH_MS = 40;

let ctx = null; // { host, callbacks }
let lastSessionId = '';
let welcomeEl = null;
let innerEl = null;

/** @type {Map<string, MessageRecord>} */
const nodes = new Map();

/* ---------- 流式合并调度 ---------- */

const pendingStream = new Map(); // messageId -> { session, message }
let flushTimer = 0;
let flushRaf = 0;
let lastFlushAt = 0;

export function initChatView(options) {
  ctx = { host: options.host, callbacks: options.callbacks || {} };
}

export function scheduleStreamUpdate(session, message) {
  if (!ctx || !session || !message) return;
  pendingStream.set(message.id, { session, message });
  if (flushTimer || flushRaf) return;
  const elapsed = performance.now() - lastFlushAt;
  const wait = Math.max(0, FLUSH_MS - elapsed);
  flushTimer = setTimeout(() => {
    flushTimer = 0;
    flushRaf = requestAnimationFrame(flushStreamNow);
  }, wait);
}

export function flushStreamNow() {
  flushRaf = 0;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
  if (!ctx || !pendingStream.size) return;
  lastFlushAt = performance.now();
  const items = [...pendingStream.values()];
  pendingStream.clear();
  let needFull = false;
  for (const { session, message } of items) {
    if (session.id !== lastSessionId) continue;
    const rec = nodes.get(message.id);
    if (!rec) { needFull = true; continue; }
    updateMessage(rec, message, rec.index);
  }
  if (needFull && items.length) renderChatView(items[items.length - 1].session);
  ctx.callbacks.onAfterRender?.('stream');
}

function cancelPendingStream() {
  pendingStream.clear();
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = 0; }
  if (flushRaf) { cancelAnimationFrame(flushRaf); flushRaf = 0; }
}

/* ---------- 全量 reconcile ---------- */

export function renderChatView(session) {
  if (!ctx?.host) return;
  const host = ctx.host;
  const sessionId = session?.id || '';
  const switched = sessionId !== lastSessionId;
  if (switched) {
    lastSessionId = sessionId;
    cancelPendingStream();
    nodes.clear();
    host.innerHTML = '';
    innerEl = null;
    welcomeEl = null;
  }
  cancelPendingStream();

  const messages = session?.messages || [];
  if (!messages.length) {
    if (innerEl) { innerEl.remove(); innerEl = null; nodes.clear(); }
    if (!welcomeEl) {
      welcomeEl = document.createElement('div');
      welcomeEl.className = 'welcome';
      welcomeEl.innerHTML = '<div class="welcome-mark" aria-hidden="true">W</div><p class="welcome-brand">WePChat</p><p class="welcome-sub">轻量 · 克制 · 快捷</p>';
      host.appendChild(welcomeEl);
    }
    ctx.callbacks.onAfterRender?.(switched ? 'session' : 'full');
    return;
  }

  if (welcomeEl) { welcomeEl.remove(); welcomeEl = null; }
  if (!innerEl) {
    innerEl = document.createElement('div');
    innerEl.className = 'chat-inner';
    host.appendChild(innerEl);
  }

  // 移除已删除消息的节点
  const wantIds = new Set(messages.map((m) => m.id));
  for (const [id, rec] of nodes) {
    if (!wantIds.has(id)) {
      rec.el.remove();
      nodes.delete(id);
    }
  }

  // 顺序对齐 + 逐消息更新
  let cursor = innerEl.firstElementChild;
  messages.forEach((message, index) => {
    let rec = nodes.get(message.id);
    if (!rec) {
      rec = createMessageNode(message);
      nodes.set(message.id, rec);
    }
    if (rec.el === cursor) {
      cursor = cursor.nextElementSibling;
    } else {
      innerEl.insertBefore(rec.el, cursor);
    }
    updateMessage(rec, message, index);
  });
  // 清理 cursor 之后残留的陈旧节点（理论上不会出现）
  while (cursor) {
    const next = cursor.nextElementSibling;
    cursor.remove();
    cursor = next;
  }

  ctx.callbacks.onAfterRender?.(switched ? 'session' : 'full');
}

export function getMessageElement(id) {
  return nodes.get(id)?.el || null;
}

export function resetChatView() {
  cancelPendingStream();
  nodes.clear();
  innerEl = null;
  welcomeEl = null;
  lastSessionId = '';
  if (ctx?.host) ctx.host.innerHTML = '';
}

/* ---------- 消息节点 ---------- */

/**
 * @typedef {object} MessageRecord
 * @property {HTMLElement} el
 * @property {number} index
 * @property {object} refs
 * @property {object} sig  上次渲染的指纹，用于跳过未变化的部位
 * @property {object} md   流式块缓存 { blockMode, blocks: [{raw, el}] }
 */

function createMessageNode(message) {
  const el = document.createElement('article');
  el.className = `chat-message chat-message--${message.role}`;
  el.dataset.messageId = message.id;
  el.setAttribute('aria-label', message.role === 'user' ? '你' : '助手');
  return {
    el,
    index: -1,
    refs: {},
    sig: {},
    md: { blockMode: false, blocks: [] },
    reasoningIntent: '',
    prog: { count: 0 },
  };
}

/** 部位在 article 内的固定顺序 */
const PART_ORDER = ['reasoning', 'tools', 'body', 'images', 'errRow', 'actions'];

function partAnchor(rec, key) {
  const idx = PART_ORDER.indexOf(key);
  for (let i = idx + 1; i < PART_ORDER.length; i++) {
    const next = rec.refs[PART_ORDER[i]];
    const el = next?.root || next;
    if (el && el.parentNode === rec.el) return el;
  }
  return null;
}

function mountPart(rec, key, el) {
  rec.el.insertBefore(el, partAnchor(rec, key));
}

function removePart(rec, key) {
  const part = rec.refs[key];
  const el = part?.root || part;
  if (el) el.remove();
  rec.refs[key] = null;
}

/** 程序化改 details.open 时打标，toggle 回调据此区分用户操作 */
function setDetailsOpen(details, open, prog) {
  if (details.open === !!open) return;
  prog.count++;
  details.open = !!open;
}

function updateMessage(rec, m, index) {
  rec.index = index;
  const isAssistant = m.role === 'assistant';

  if (isAssistant) {
    updateReasoning(rec, m);
    updateTools(rec, m);
  }
  updateBody(rec, m);
  if (isAssistant) {
    updateImages(rec, m);
    updateErrorRow(rec, m);
  }
  updateActions(rec, m);

  const streaming = m.status === 'streaming';
  if (rec.sig.streaming !== streaming) {
    rec.el.classList.toggle('is-streaming', streaming);
    rec.sig.streaming = streaming;
  }
}

/* ---------- reasoning ---------- */

function updateReasoning(rec, m) {
  const text = m.reasoning || '';
  if (!text) {
    if (rec.refs.reasoning) removePart(rec, 'reasoning');
    rec.sig.reasoning = '';
    return;
  }
  let part = rec.refs.reasoning;
  if (!part) {
    const root = document.createElement('details');
    root.className = 'chat-reasoning';
    const summary = document.createElement('summary');
    const pre = document.createElement('pre');
    root.append(summary, pre);
    part = rec.refs.reasoning = { root, summary, pre };
    root.addEventListener('toggle', () => {
      if (rec.prog.count > 0) { rec.prog.count--; return; }
      rec.reasoningIntent = root.open ? 'open' : 'closed';
    });
    mountPart(rec, 'reasoning', root);
  }

  const thinkingLive = m.status === 'streaming' && !m.content;
  const summaryText = thinkingLive ? '思考中…' : '思考过程';
  if (rec.sig.reasoningSummary !== summaryText) {
    part.summary.textContent = summaryText;
    rec.sig.reasoningSummary = summaryText;
  }
  if (rec.sig.reasoning !== text) {
    const stick = part.root.open
      && part.pre.scrollHeight - part.pre.scrollTop - part.pre.clientHeight < 48;
    part.pre.textContent = text;
    rec.sig.reasoning = text;
    if (stick || thinkingLive) part.pre.scrollTop = part.pre.scrollHeight;
  }
  // 思考中自动展开；正文开始后自动收起；用户手动操作过则尊重用户
  if (thinkingLive) {
    if (rec.reasoningIntent !== 'closed') setDetailsOpen(part.root, true, rec.prog);
  } else if (rec.reasoningIntent !== 'open') {
    setDetailsOpen(part.root, false, rec.prog);
  }
}

/* ---------- 工具卡 ---------- */

function updateTools(rec, m) {
  const list = (Array.isArray(m.toolCalls) ? m.toolCalls : []).filter((t) => t && t.name);
  if (!list.length) {
    if (rec.refs.tools) removePart(rec, 'tools');
    return;
  }
  let part = rec.refs.tools;
  if (!part) {
    const root = document.createElement('div');
    root.className = 'chat-tools';
    // 以工具对象身份为键：流式期间 id 会从 streamKey 换成真实 id，对象引用是稳定的
    part = rec.refs.tools = { root, cards: new Map() };
    mountPart(rec, 'tools', root);
  }

  const wanted = new Set(list);
  for (const [obj, card] of part.cards) {
    if (!wanted.has(obj)) {
      card.root.remove();
      part.cards.delete(obj);
    }
  }

  let cursor = part.root.firstElementChild;
  list.forEach((t) => {
    let card = part.cards.get(t);
    if (!card) {
      card = createToolCard(t);
      part.cards.set(t, card);
    }
    if (card.root === cursor) cursor = cursor.nextElementSibling;
    else part.root.insertBefore(card.root, cursor);
    updateToolCard(card, t);
  });
  while (cursor) {
    const next = cursor.nextElementSibling;
    cursor.remove();
    cursor = next;
  }
}

function createToolCard(t) {
  const root = document.createElement('details');
  root.className = 'tool-card';
  const head = document.createElement('summary');
  head.className = 'tool-head';
  head.innerHTML = '<span class="tool-pulse" aria-hidden="true"></span><span class="tool-name"></span><span class="tool-status"></span>';
  const body = document.createElement('div');
  body.className = 'tool-body';
  const argsSec = document.createElement('div');
  argsSec.className = 'tool-sec';
  const argsPre = document.createElement('pre');
  argsPre.className = 'tool-pre';
  body.append(argsSec, argsPre);
  root.append(head, body);
  const card = {
    root,
    body,
    nameEl: head.querySelector('.tool-name'),
    statusEl: head.querySelector('.tool-status'),
    argsSec,
    argsPre,
    resSec: null,
    resPre: null,
    prog: { count: 0 },
    sig: {},
    data: t,
  };
  root.addEventListener('toggle', () => {
    if (card.prog.count > 0) { card.prog.count--; return; }
    card.data._open = root.open;
    card.data._userOpen = true;
  });
  return card;
}

function updateToolCard(card, t) {
  card.data = t;
  const active = t.status === 'composing' || t.status === 'running';
  const cls = 'tool-card tool-card--' + (t.status || 'done') + (active ? ' is-live' : '');
  if (card.sig.cls !== cls) {
    card.root.className = cls;
    card.sig.cls = cls;
  }
  if (card.sig.name !== t.name) {
    card.nameEl.textContent = t.name;
    card.sig.name = t.name;
  }
  const statusLabel = ctx.callbacks.toolStatusLabel?.(t.status) || '';
  if (card.sig.status !== statusLabel) {
    card.statusEl.textContent = statusLabel;
    card.sig.status = statusLabel;
  }
  const argsLabel = active && t.name === 'write_file' ? '内容' : '参数';
  if (card.sig.argsLabel !== argsLabel) {
    card.argsSec.textContent = argsLabel;
    card.sig.argsLabel = argsLabel;
  }
  const argsPreCls = 'tool-pre' + (active ? ' tool-pre--live' : '');
  if (card.sig.argsPreCls !== argsPreCls) {
    card.argsPre.className = argsPreCls;
    card.sig.argsPreCls = argsPreCls;
  }
  const argsText = ctx.callbacks.formatToolCardArgs?.(t) ?? '';
  if (card.sig.args !== argsText) {
    card.argsPre.textContent = argsText;
    card.sig.args = argsText;
    // 进行中：参数/内容贴底滚动，像代码一行行出来
    if (active) card.argsPre.scrollTop = card.argsPre.scrollHeight;
  }

  const hasResult = t.result != null && t.result !== '';
  if (hasResult) {
    if (!card.resSec) {
      card.resSec = document.createElement('div');
      card.resSec.className = 'tool-sec';
      card.resSec.textContent = '结果';
      card.resPre = document.createElement('pre');
      card.resPre.className = 'tool-pre';
      card.body.append(card.resSec, card.resPre);
    }
    const resText = window.U.truncate(String(t.result), 4000);
    if (card.sig.result !== resText) {
      card.resPre.textContent = resText;
      card.sig.result = resText;
    }
  } else if (card.resSec) {
    card.resSec.remove();
    card.resPre.remove();
    card.resSec = card.resPre = null;
    card.sig.result = undefined;
  }

  // 进行中强制展开；完成后默认收起；用户手动点过则尊重 _open
  if (active) setDetailsOpen(card.root, true, card.prog);
  else if (t._userOpen) setDetailsOpen(card.root, !!t._open, card.prog);
  else setDetailsOpen(card.root, false, card.prog);
}

/* ---------- 正文 ---------- */

function hardenLinks(root) {
  root.querySelectorAll('a').forEach((link) => {
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    if (!link.title && link.href) link.title = link.href;
  });
}

function ensureBody(rec, m) {
  let body = rec.refs.body;
  if (!body) {
    body = document.createElement('div');
    body.className = 'chat-message-body' + (m.role === 'assistant' ? ' md' : '');
    rec.refs.body = body;
    mountPart(rec, 'body', body);
  }
  return body;
}

function updateBody(rec, m) {
  const body = ensureBody(rec, m);
  const hasTools = m.role === 'assistant' && Array.isArray(m.toolCalls) && m.toolCalls.length;
  const streaming = m.status === 'streaming';
  const baseCls = 'chat-message-body' + (m.role === 'assistant' ? ' md' : '');

  let mode = 'plain';
  if (m.role === 'assistant' && !m.error && m.content) mode = streaming ? 'md-stream' : 'md-done';
  else if (m.error) mode = 'error';
  else if (streaming && !m.content && !m.reasoning && !hasTools) mode = 'typing';

  const content = m.content || '';
  const key = mode + '|' + content.length + '|' + content + (m.error || '');
  if (rec.sig.bodyKey === key) {
    body.hidden = !(body.textContent || body.childElementCount);
    return;
  }

  if (mode !== 'md-stream' && rec.md.blockMode) {
    rec.md.blockMode = false;
    rec.md.blocks = [];
  }

  switch (mode) {
    case 'md-stream': {
      if (body.className !== baseCls) body.className = baseCls;
      renderStreamingBlocks(rec, body, m);
      break;
    }
    case 'md-done': {
      if (body.className !== baseCls) body.className = baseCls;
      body.innerHTML = window.MD.render(m.content);
      hardenLinks(body);
      window.MD.renderMath?.(body);
      break;
    }
    case 'error': {
      body.className = baseCls + ' has-error';
      body.textContent = m.content ? `${m.content}\n\n${m.error}` : m.error;
      break;
    }
    case 'typing': {
      if (body.className !== baseCls) body.className = baseCls;
      body.innerHTML = '<span class="typing-dot" aria-hidden="true"></span>';
      break;
    }
    default: {
      if (body.className !== baseCls) body.className = baseCls;
      body.textContent = m.content || '';
    }
  }
  rec.sig.bodyKey = key;
  body.hidden = !(body.textContent || body.childElementCount);
}

/** 流式正文：顶层块缓存，只重渲染 raw 发生变化的块 */
function renderStreamingBlocks(rec, body, m) {
  if (!rec.md.blockMode) {
    body.innerHTML = '';
    rec.md.blockMode = true;
    rec.md.blocks = [];
  }
  const blocks = window.MD.lexBlocks(m.content);
  const cache = rec.md.blocks;
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    let slot = cache[i];
    if (slot && slot.raw === b.raw) continue;
    const html = window.MD.renderBlock(b.raw);
    if (!slot) {
      const wrap = document.createElement('div');
      wrap.className = 'md-block';
      body.appendChild(wrap);
      slot = cache[i] = { raw: '', el: wrap };
    }
    slot.raw = b.raw;
    slot.el.innerHTML = html;
    hardenLinks(slot.el);
    window.MD.renderMath?.(slot.el);
  }
  while (cache.length > blocks.length) cache.pop().el.remove();

  // 活跃尾部若是可预览代码围栏，通知宿主（artifact 流式低频刷新）
  const last = blocks[blocks.length - 1];
  if (last && last.type === 'code' && window.MD.isPreviewableLang(last.lang)) {
    let fenceIndex = -1;
    for (const b of blocks) if (b.type === 'code') fenceIndex++;
    ctx.callbacks.onLiveCodeBlock?.({
      messageId: m.id,
      fenceIndex,
      lang: last.lang,
      code: last.text,
      streaming: true,
    });
  }
}

/* ---------- 图片 ---------- */

function updateImages(rec, m) {
  const images = (Array.isArray(m.images) ? m.images : []).filter((im) => im && (im.path || im.dataUrl));
  const fp = images.map((im) => `${im.path || ''}|${(im.dataUrl || '').length}`).join('\n');
  if (rec.sig.imagesFp === fp) return;
  rec.sig.imagesFp = fp;
  if (!images.length) {
    if (rec.refs.images) removePart(rec, 'images');
    return;
  }
  let grid = rec.refs.images;
  if (!grid) {
    grid = document.createElement('div');
    grid.className = 'chat-image-grid';
    rec.refs.images = grid;
    mountPart(rec, 'images', grid);
  }
  grid.innerHTML = '';
  images.forEach((image) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'chat-image-card';
    card.title = image.path || '打开图片';
    card.addEventListener('click', () => {
      if (image.path) ctx.callbacks.openImage?.(image);
    });
    if (image.dataUrl) {
      const img = document.createElement('img');
      img.src = image.dataUrl;
      img.alt = image.path || '生成图片';
      img.loading = 'lazy';
      card.appendChild(img);
    } else {
      card.textContent = image.path || '图片';
    }
    grid.appendChild(card);
  });
}

/* ---------- 错误行 ---------- */

function updateErrorRow(rec, m) {
  const want = !!(m.error && m.status !== 'streaming');
  const canRetry = want && !!ctx.callbacks.canRegenerateMessage?.(rec.index);
  const fp = want ? `1|${canRetry ? 1 : 0}` : '';
  if (rec.sig.errFp === fp) return;
  rec.sig.errFp = fp;
  if (!want) {
    if (rec.refs.errRow) removePart(rec, 'errRow');
    return;
  }
  removePart(rec, 'errRow');
  const row = document.createElement('div');
  row.className = 'chat-error-row';
  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'err-retry-btn';
  retry.textContent = '重试';
  retry.disabled = !canRetry;
  retry.addEventListener('click', () => ctx.callbacks.regenerateMessage?.(rec.index));
  row.appendChild(retry);
  rec.refs.errRow = row;
  mountPart(rec, 'errRow', row);
}

/* ---------- 操作行 + 元信息 ---------- */

function fmtTokens(n) {
  const v = Number(n) || 0;
  if (v >= 10000) return (v / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k';
  return String(v);
}

function fmtDuration(ms) {
  const v = Number(ms) || 0;
  if (v <= 0) return '';
  if (v < 1000) return '<1s';
  if (v < 60000) return Math.round(v / 1000) + 's';
  const min = Math.floor(v / 60000);
  const sec = Math.round((v % 60000) / 1000);
  return `${min}m${sec ? sec + 's' : ''}`;
}

function fmtClock(iso) {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

function metaParts(m) {
  const parts = [];
  if (m.model) parts.push(m.model);
  const clock = fmtClock(m.createdAt);
  if (clock) parts.push(clock);
  const u = m.usage;
  if (u && (u.inputTokens || u.outputTokens)) {
    parts.push(`输入 ${fmtTokens(u.inputTokens)}`);
    parts.push(`输出 ${fmtTokens(u.outputTokens)}`);
  }
  const dur = fmtDuration(m.durationMs);
  if (dur) parts.push(dur);
  return parts;
}

function makeAction(label, title, onClick, disabled) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'msg-action-btn';
  btn.textContent = label;
  btn.title = title || label;
  btn.disabled = !!disabled;
  btn.addEventListener('click', onClick);
  return btn;
}

function updateActions(rec, m) {
  const want = m.status !== 'streaming';
  if (!want) {
    if (rec.refs.actions) removePart(rec, 'actions');
    rec.sig.actionsFp = '';
    return;
  }
  const variants = Array.isArray(m.variants) ? m.variants : [];
  const canRegen = m.role === 'assistant' ? !!ctx.callbacks.canRegenerateMessage?.(rec.index) : false;
  const meta = m.role === 'assistant' ? metaParts(m).join(' · ') : '';
  const fp = [m.role, variants.length, m.activeVariantIndex || 0, canRegen ? 1 : 0, meta].join('|');
  if (rec.sig.actionsFp === fp && rec.refs.actions) return;
  rec.sig.actionsFp = fp;
  removePart(rec, 'actions');

  const cb = ctx.callbacks;
  const actions = document.createElement('div');
  actions.className = 'msg-actions';
  actions.appendChild(makeAction('复制', '复制内容', () => cb.copyMessage?.(m)));

  if (m.role === 'assistant') {
    if (variants.length > 1) {
      const switcher = document.createElement('span');
      switcher.className = 'msg-variant-switch';
      const prev = document.createElement('button');
      prev.type = 'button';
      prev.textContent = '‹';
      prev.disabled = (m.activeVariantIndex || 0) <= 0;
      prev.title = '上一个回答版本';
      prev.addEventListener('click', () => cb.switchAssistantVariant?.(rec.index, -1));
      const label = document.createElement('b');
      label.textContent = `${(m.activeVariantIndex || 0) + 1}/${variants.length}`;
      const next = document.createElement('button');
      next.type = 'button';
      next.textContent = '›';
      next.disabled = (m.activeVariantIndex || 0) >= variants.length - 1;
      next.title = '下一个回答版本';
      next.addEventListener('click', () => cb.switchAssistantVariant?.(rec.index, 1));
      switcher.append(prev, label, next);
      actions.appendChild(switcher);
    }
    actions.appendChild(makeAction(
      '重新生成',
      canRegen ? '重新生成（最多 6 个版本）' : '无法继续重新生成',
      () => cb.regenerateMessage?.(rec.index),
      !canRegen
    ));
  }

  if (m.role === 'user') {
    actions.appendChild(makeAction('编辑', '编辑此消息并截断后续', () => cb.editUserMessage?.(rec.index)));
  }
  actions.appendChild(makeAction('删除', '删除此消息', () => cb.deleteMessage?.(rec.index)));

  if (meta) {
    const tag = document.createElement('span');
    tag.className = 'msg-meta';
    tag.textContent = meta;
    actions.appendChild(tag);
  }

  rec.refs.actions = actions;
  mountPart(rec, 'actions', actions);
}
