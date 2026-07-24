/* WePChat Windows — light dot-grid image canvas (Grok Imagine-inspired)
 * Pan / zoom / place / select. No snap / links / multi-transform.
 */
'use strict';

(() => {
  const DEFAULT_ZOOM = 1;
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  const CARD_W = 280;
  const SNAP_PX = 7;

  function createState() {
    return {
      items: [], // { id, path, dataUrl?, x, y, w }
      zoom: DEFAULT_ZOOM,
      panX: 0,
      panY: 0,
      tool: 'hand',
      selectedId: null,
      selectedIds: [],
      dragging: null, // { id, startX, startY, origX, origY } | { pan, startX, startY, origX, origY }
      marquee: null,
    };
  }

  function clampZoom(z) {
    return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(z) || DEFAULT_ZOOM));
  }

  function placeItem(state, item, index) {
    const i = index == null ? state.items.length : index;
    const col = i % 3;
    const row = Math.floor(i / 3);
    return {
      id: item.id || ('img_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6)),
      path: item.path || '',
      dataUrl: item.dataUrl || '',
      status: item.status || '',
      label: item.label || '',
      prompt: item.prompt || '',
      x: item.x != null ? item.x : 48 + col * (CARD_W + 28),
      y: item.y != null ? item.y : 48 + row * (CARD_W + 48),
      w: item.w || CARD_W,
    };
  }

  function addItems(state, list) {
    const added = [];
    (list || []).forEach((raw) => {
      if (!raw || !raw.path) return;
      const existing = state.items.find((it) => it.path === raw.path);
      if (existing) {
        if (raw.dataUrl) existing.dataUrl = raw.dataUrl;
        added.push(existing);
        return;
      }
      const it = placeItem(state, raw, state.items.length);
      state.items.push(it);
      added.push(it);
    });
    return added;
  }

  function addPending(state, raw) {
    const it = placeItem(state, Object.assign({}, raw, {
      id: raw?.id,
      path: '',
      status: 'pending',
      label: raw?.label || 'Generating',
      prompt: raw?.prompt || '',
      w: raw?.w || 220,
    }), state.items.length);
    state.items.push(it);
    state.selectedId = it.id;
    state.selectedIds = [it.id];
    return it;
  }

  function removeById(state, id) {
    if (!id) return;
    state.items = state.items.filter((it) => it.id !== id);
    if (state.selectedId === id) state.selectedId = null;
    state.selectedIds = (state.selectedIds || []).filter((x) => x !== id);
  }

  function select(state, id) {
    state.selectedId = id || null;
    state.selectedIds = id ? [id] : [];
  }

  function selectMany(state, ids) {
    const clean = [...new Set((ids || []).filter(Boolean))];
    state.selectedIds = clean;
    state.selectedId = clean[clean.length - 1] || null;
  }

  function selected(state) {
    return state.items.find((it) => it.id === state.selectedId) || null;
  }

  function selectedItems(state) {
    const ids = new Set(state.selectedIds?.length ? state.selectedIds : (state.selectedId ? [state.selectedId] : []));
    return state.items.filter((it) => ids.has(it.id));
  }

  function removeSelected(state) {
    const ids = new Set(state.selectedIds?.length ? state.selectedIds : (state.selectedId ? [state.selectedId] : []));
    if (!ids.size) return;
    state.items = state.items.filter((it) => !ids.has(it.id));
    state.selectedId = null;
    state.selectedIds = [];
  }

  function serialize(state) {
    return {
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
      tool: state.tool === 'select' ? 'select' : 'hand',
      selectedId: state.selectedId,
      items: state.items.filter((it) => it.path && it.status !== 'pending').map((it) => ({
        id: it.id,
        path: it.path,
        x: it.x,
        y: it.y,
        w: it.w,
      })),
    };
  }

  function restore(state, data) {
    if (!data || typeof data !== 'object') return;
    state.zoom = clampZoom(data.zoom);
    state.panX = Number(data.panX) || 0;
    state.panY = Number(data.panY) || 0;
    state.tool = data.tool === 'select' ? 'select' : 'hand';
    state.selectedId = data.selectedId || null;
    state.selectedIds = state.selectedId ? [state.selectedId] : [];
    state.items = Array.isArray(data.items)
      ? data.items.map((it, i) => placeItem(state, it, i))
      : [];
  }

  function render(host, state, handlers) {
    handlers = handlers || {};
    if (!host) return;
    host._imgCanvasState = state;
    const zoomPct = Math.round(state.zoom * 100);
    const selectedIds = new Set(state.selectedIds?.length ? state.selectedIds : (state.selectedId ? [state.selectedId] : []));
    host.innerHTML = `
      <div class="img-canvas-stage" data-role="stage">
        <div class="img-canvas-world" data-role="world" style="transform: translate(${state.panX}px, ${state.panY}px) scale(${state.zoom});">
          ${state.items.map((it) => `
            <div class="img-canvas-card${selectedIds.has(it.id) ? ' is-selected' : ''}"
                 data-id="${escapeAttr(it.id)}"
                 style="left:${it.x}px;top:${it.y}px;width:${it.w}px;">
              <div class="img-canvas-card-media">
                ${it.status === 'pending'
                  ? `<div class="img-canvas-card-pending">
                      <span class="img-canvas-spinner" aria-hidden="true"></span>
                      <strong>${escapeHtml(it.label || 'Generating')}</strong>
                      <small>${escapeHtml(it.prompt || '')}</small>
                    </div>`
                  : it.dataUrl
                  ? `<img src="${escapeAttr(it.dataUrl)}" alt="${escapeAttr(it.path)}" draggable="false" />`
                  : `<div class="img-canvas-card-placeholder">${escapeHtml(it.path.split('/').pop() || 'image')}</div>`}
              </div>
              <div class="img-canvas-card-label" title="${escapeAttr(it.path || it.label)}">${escapeHtml(it.path ? (it.path.split('/').pop() || it.path) : (it.label || 'Generating'))}</div>
            </div>
            ${it.id === state.selectedId && it.path && handlers.onEditPrompt ? `
              <form class="img-canvas-edit-popover" data-for="${escapeAttr(it.id)}" style="left:${it.x}px;top:${it.y + it.w + 42}px;width:${Math.max(260, it.w)}px;">
                <div class="img-canvas-edit-mode" role="group" aria-label="图片输入模式">
                  <button type="button" class="${handlers.referenceMode === 'edit' ? '' : 'is-active'}" data-edit-mode="reference">参考</button>
                  <button type="button" class="${handlers.referenceMode === 'edit' ? 'is-active' : ''}" data-edit-mode="edit">编辑</button>
                </div>
                <textarea rows="1" placeholder="输入即见所想…"></textarea>
                <button type="submit" class="img-canvas-edit-send" title="对话编辑" aria-label="对话编辑">↑</button>
              </form>
            ` : ''}
          `).join('')}
        </div>
        <div class="img-canvas-marquee" data-role="marquee" hidden></div>
        <div class="img-canvas-guide img-canvas-guide--x" data-role="guide-x" hidden></div>
        <div class="img-canvas-guide img-canvas-guide--y" data-role="guide-y" hidden></div>
      </div>
      <div class="img-canvas-chrome">
        <div class="img-canvas-mode">
          <button type="button" class="img-canvas-btn img-canvas-icon-btn${state.tool === 'select' ? ' is-active' : ''}" data-act="tool-select" title="选择">↖</button>
          <button type="button" class="img-canvas-btn img-canvas-icon-btn${state.tool === 'hand' ? ' is-active' : ''}" data-act="tool-hand" title="抓手工具">✋</button>
        </div>
        <div class="img-canvas-zoom">
          <button type="button" class="img-canvas-btn" data-act="zoom-out" title="缩小">−</button>
          <span class="img-canvas-zoom-label">${zoomPct}%</span>
          <button type="button" class="img-canvas-btn" data-act="zoom-in" title="放大">+</button>
          <button type="button" class="img-canvas-btn" data-act="zoom-reset" title="重置视图">重置</button>
        </div>
        <div class="img-canvas-tools">
          <button type="button" class="img-canvas-btn" data-act="upload" title="上传图片到画布">上传</button>
          <button type="button" class="img-canvas-btn${selected(state)?.path ? ' is-active' : ''}" data-act="use-ref" title="用作参考" ${selected(state)?.path ? '' : 'disabled'}>参考</button>
          <button type="button" class="img-canvas-btn" data-act="clear-sel" title="取消选中" ${state.selectedId ? '' : 'disabled'}>取消选中</button>
        </div>
      </div>
    `;

    const stage = host.querySelector('[data-role="stage"]');
    const world = host.querySelector('[data-role="world"]');

    host.querySelectorAll('[data-act]').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const act = btn.getAttribute('data-act');
        if (act === 'zoom-in') {
          state.zoom = clampZoom(state.zoom + 0.1);
          if (handlers.onChange) handlers.onChange(state);
          render(host, state, handlers);
        } else if (act === 'zoom-out') {
          state.zoom = clampZoom(state.zoom - 0.1);
          if (handlers.onChange) handlers.onChange(state);
          render(host, state, handlers);
        } else if (act === 'zoom-reset') {
          state.zoom = DEFAULT_ZOOM;
          state.panX = 0;
          state.panY = 0;
          if (handlers.onChange) handlers.onChange(state);
          render(host, state, handlers);
        } else if (act === 'tool-select') {
          state.tool = 'select';
          if (handlers.onChange) handlers.onChange(state);
          render(host, state, handlers);
        } else if (act === 'tool-hand') {
          state.tool = 'hand';
          if (handlers.onChange) handlers.onChange(state);
          render(host, state, handlers);
        } else if (act === 'upload') {
          if (handlers.onUpload) handlers.onUpload();
        } else if (act === 'use-ref') {
          const it = selected(state);
          if (it && it.path && handlers.onUseReference) handlers.onUseReference(it);
        } else if (act === 'clear-sel') {
          select(state, null);
          if (handlers.onSelect) handlers.onSelect(null);
          if (handlers.onChange) handlers.onChange(state);
          render(host, state, handlers);
        }
      });
    });

    host.querySelectorAll('.img-canvas-edit-popover').forEach((form) => {
      const textarea = form.querySelector('textarea');
      form.addEventListener('mousedown', (e) => e.stopPropagation());
      form.addEventListener('click', (e) => e.stopPropagation());
      form.querySelectorAll('[data-edit-mode]').forEach((btn) => {
        btn.addEventListener('click', () => {
          form.querySelectorAll('[data-edit-mode]').forEach((item) => item.classList.toggle('is-active', item === btn));
          if (handlers.onReferenceModeChange) handlers.onReferenceModeChange(btn.getAttribute('data-edit-mode'));
        });
      });
      textarea?.addEventListener('input', () => {
        textarea.style.height = 'auto';
        textarea.style.height = Math.min(96, textarea.scrollHeight) + 'px';
      });
      form.addEventListener('submit', (e) => {
        e.preventDefault();
        e.stopPropagation();
        const id = form.getAttribute('data-for');
        const it = state.items.find((x) => x.id === id);
        const prompt = String(textarea?.value || '').trim();
        const mode = form.querySelector('[data-edit-mode].is-active')?.getAttribute('data-edit-mode') || handlers.referenceMode || 'reference';
        if (it && prompt && handlers.onEditPrompt) handlers.onEditPrompt(it, prompt, mode);
      });
    });

    host.querySelectorAll('.img-canvas-card').forEach((card) => {
      card.addEventListener('mousedown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        e.stopPropagation();
        const id = card.getAttribute('data-id');
        const it = state.items.find((x) => x.id === id);
        if (!it) return;
        select(state, id);
        if (handlers.onSelect) handlers.onSelect(it);
        if (state.tool === 'select') {
          if (handlers.onChange) handlers.onChange(state);
          render(host, state, handlers);
          return;
        }
        state.dragging = {
          kind: 'item',
          id,
          startX: e.clientX,
          startY: e.clientY,
          origX: it.x,
          origY: it.y,
        };
        card.classList.add('is-dragging');
      });
      card.addEventListener('click', (e) => {
        e.stopPropagation();
        const id = card.getAttribute('data-id');
        select(state, id);
        const it = state.items.find((x) => x.id === id);
        if (handlers.onSelect) handlers.onSelect(it || null);
        host.querySelectorAll('.img-canvas-card').forEach((c) => {
          c.classList.toggle('is-selected', c.getAttribute('data-id') === id);
        });
        const refBtn = host.querySelector('[data-act="use-ref"]');
        const clearBtn = host.querySelector('[data-act="clear-sel"]');
        if (refBtn) refBtn.disabled = !(it && it.path);
        if (clearBtn) clearBtn.disabled = !id;
        render(host, state, handlers);
      });
    });

    if (stage) {
      stage.addEventListener('mousedown', (e) => {
        if (e.button !== 0 && e.button !== 1) return;
        if (e.target.closest('.img-canvas-card')) return;
        e.preventDefault();
        if (state.tool === 'select') {
          const rect = stage.getBoundingClientRect();
          state.marquee = {
            startX: e.clientX,
            startY: e.clientY,
            rectLeft: rect.left,
            rectTop: rect.top,
          };
          const marquee = host.querySelector('[data-role="marquee"]');
          if (marquee) {
            marquee.hidden = false;
            marquee.style.left = (e.clientX - rect.left) + 'px';
            marquee.style.top = (e.clientY - rect.top) + 'px';
            marquee.style.width = '0px';
            marquee.style.height = '0px';
          }
        } else {
          state.dragging = {
            kind: 'pan',
            startX: e.clientX,
            startY: e.clientY,
            origX: state.panX,
            origY: state.panY,
          };
          stage.classList.add('is-panning');
        }
      });

      stage.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.08 : 0.08;
        state.zoom = clampZoom(state.zoom + delta);
        if (world) {
          world.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
        }
        const label = host.querySelector('.img-canvas-zoom-label');
        if (label) label.textContent = Math.round(state.zoom * 100) + '%';
        if (handlers.onChange) handlers.onChange(state);
      }, { passive: false });
    }

    const onMove = (e) => {
      if (state.marquee) {
        const m = state.marquee;
        const left = Math.min(m.startX, e.clientX) - m.rectLeft;
        const top = Math.min(m.startY, e.clientY) - m.rectTop;
        const width = Math.abs(e.clientX - m.startX);
        const height = Math.abs(e.clientY - m.startY);
        const marquee = host.querySelector('[data-role="marquee"]');
        if (marquee) {
          marquee.hidden = false;
          marquee.style.left = left + 'px';
          marquee.style.top = top + 'px';
          marquee.style.width = width + 'px';
          marquee.style.height = height + 'px';
        }
        return;
      }
      if (!state.dragging) return;
      const dx = e.clientX - state.dragging.startX;
      const dy = e.clientY - state.dragging.startY;
      if (state.dragging.kind === 'pan') {
        updateGuides(host, null, null);
        state.panX = state.dragging.origX + dx;
        state.panY = state.dragging.origY + dy;
        if (world) {
          world.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
        }
      } else if (state.dragging.kind === 'item') {
        const it = state.items.find((x) => x.id === state.dragging.id);
        if (!it) return;
        const inv = 1 / (state.zoom || 1);
        const snapped = snapItem(state, it, state.dragging.origX + dx * inv, state.dragging.origY + dy * inv);
        it.x = snapped.x;
        it.y = snapped.y;
        updateGuides(host, snapped.guideX, snapped.guideY);
        const card = host.querySelector(`.img-canvas-card[data-id="${cssEscape(state.dragging.id)}"]`);
        if (card) {
          card.style.left = it.x + 'px';
          card.style.top = it.y + 'px';
        }
      }
    };

    const onUp = (e) => {
      if (state.marquee) {
        const m = state.marquee;
        const endX = e?.clientX ?? m.startX;
        const endY = e?.clientY ?? m.startY;
        const sx = (Math.min(m.startX, endX) - m.rectLeft - state.panX) / (state.zoom || 1);
        const sy = (Math.min(m.startY, endY) - m.rectTop - state.panY) / (state.zoom || 1);
        const ex = (Math.max(m.startX, endX) - m.rectLeft - state.panX) / (state.zoom || 1);
        const ey = (Math.max(m.startY, endY) - m.rectTop - state.panY) / (state.zoom || 1);
        const ids = state.items
          .filter((it) => it.path && it.x < ex && it.x + it.w > sx && it.y < ey && it.y + it.w > sy)
          .map((it) => it.id);
        selectMany(state, ids);
        state.marquee = null;
        if (handlers.onSelectMany) handlers.onSelectMany(selectedItems(state));
        else if (handlers.onSelect) handlers.onSelect(selected(state));
        if (handlers.onChange) handlers.onChange(state);
        render(host, state, handlers);
        return;
      }
      if (!state.dragging) return;
      const was = state.dragging;
      state.dragging = null;
      stage?.classList.remove('is-panning');
      updateGuides(host, null, null);
      host.querySelectorAll('.img-canvas-card.is-dragging').forEach((c) => c.classList.remove('is-dragging'));
      if (was.kind === 'item' || was.kind === 'pan') {
        if (handlers.onChange) handlers.onChange(state);
      }
    };

    // Bind on host dataset to avoid duplicate globals: re-render cleans via replace
    host._imgCanvasMove = onMove;
    host._imgCanvasUp = onUp;
    window.removeEventListener('mousemove', host._imgCanvasPrevMove || (() => {}));
    window.removeEventListener('mouseup', host._imgCanvasPrevUp || (() => {}));
    host._imgCanvasPrevMove = onMove;
    host._imgCanvasPrevUp = onUp;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }

  function itemEdges(it, x, y) {
    const left = x ?? it.x;
    const top = y ?? it.y;
    const w = Number(it.w) || CARD_W;
    return {
      x: [
        { kind: 'left', value: left },
        { kind: 'center', value: left + w / 2 },
        { kind: 'right', value: left + w },
      ],
      y: [
        { kind: 'top', value: top },
        { kind: 'center', value: top + w / 2 },
        { kind: 'bottom', value: top + w },
      ],
      w,
    };
  }

  function snapItem(state, item, x, y) {
    const threshold = SNAP_PX / (state.zoom || 1);
    const moving = itemEdges(item, x, y);
    let bestX = null;
    let bestY = null;
    state.items.forEach((other) => {
      if (!other || other.id === item.id || !other.path) return;
      const target = itemEdges(other);
      moving.x.forEach((edge) => {
        target.x.forEach((candidate) => {
          const dist = Math.abs(edge.value - candidate.value);
          if (dist <= threshold && (!bestX || dist < bestX.dist)) {
            bestX = { dist, edge: edge.kind, value: candidate.value };
          }
        });
      });
      moving.y.forEach((edge) => {
        target.y.forEach((candidate) => {
          const dist = Math.abs(edge.value - candidate.value);
          if (dist <= threshold && (!bestY || dist < bestY.dist)) {
            bestY = { dist, edge: edge.kind, value: candidate.value };
          }
        });
      });
    });
    if (bestX) {
      if (bestX.edge === 'left') x = bestX.value;
      else if (bestX.edge === 'center') x = bestX.value - moving.w / 2;
      else x = bestX.value - moving.w;
    }
    if (bestY) {
      if (bestY.edge === 'top') y = bestY.value;
      else if (bestY.edge === 'center') y = bestY.value - moving.w / 2;
      else y = bestY.value - moving.w;
    }
    return {
      x,
      y,
      guideX: bestX ? bestX.value : null,
      guideY: bestY ? bestY.value : null,
    };
  }

  function updateGuides(host, guideX, guideY) {
    const gx = host.querySelector('[data-role="guide-x"]');
    const gy = host.querySelector('[data-role="guide-y"]');
    const state = host && host._imgCanvasState;
    if (gx) {
      gx.hidden = guideX == null;
      if (guideX != null && state) gx.style.left = (state.panX + guideX * state.zoom) + 'px';
    }
    if (gy) {
      gy.hidden = guideY == null;
      if (guideY != null && state) gy.style.top = (state.panY + guideY * state.zoom) + 'px';
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

  function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) return CSS.escape(s);
    return String(s).replace(/"/g, '\\"');
  }

  window.ImageCanvas = {
    createState,
    addItems,
    addPending,
    select,
    selected,
    selectedItems,
    removeSelected,
    removeById,
    serialize,
    restore,
    render,
    clampZoom,
  };
})();
