/* WePChat Windows — light dot-grid image canvas (Grok Imagine-inspired)
 * Pan / zoom / place / select. No snap / links / multi-transform.
 */
'use strict';

(() => {
  const DEFAULT_ZOOM = 1;
  const MIN_ZOOM = 0.25;
  const MAX_ZOOM = 3;
  const CARD_W = 280;

  function createState() {
    return {
      items: [], // { id, path, dataUrl?, x, y, w }
      zoom: DEFAULT_ZOOM,
      panX: 0,
      panY: 0,
      selectedId: null,
      dragging: null, // { id, startX, startY, origX, origY } | { pan, startX, startY, origX, origY }
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

  function select(state, id) {
    state.selectedId = id || null;
  }

  function selected(state) {
    return state.items.find((it) => it.id === state.selectedId) || null;
  }

  function removeSelected(state) {
    if (!state.selectedId) return;
    state.items = state.items.filter((it) => it.id !== state.selectedId);
    state.selectedId = null;
  }

  function serialize(state) {
    return {
      zoom: state.zoom,
      panX: state.panX,
      panY: state.panY,
      selectedId: state.selectedId,
      items: state.items.map((it) => ({
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
    state.selectedId = data.selectedId || null;
    state.items = Array.isArray(data.items)
      ? data.items.map((it, i) => placeItem(state, it, i))
      : [];
  }

  function render(host, state, handlers) {
    handlers = handlers || {};
    if (!host) return;
    const zoomPct = Math.round(state.zoom * 100);
    host.innerHTML = `
      <div class="img-canvas-stage" data-role="stage">
        <div class="img-canvas-world" data-role="world" style="transform: translate(${state.panX}px, ${state.panY}px) scale(${state.zoom});">
          ${state.items.map((it) => `
            <div class="img-canvas-card${it.id === state.selectedId ? ' is-selected' : ''}"
                 data-id="${escapeAttr(it.id)}"
                 style="left:${it.x}px;top:${it.y}px;width:${it.w}px;">
              <div class="img-canvas-card-media">
                ${it.dataUrl
                  ? `<img src="${escapeAttr(it.dataUrl)}" alt="${escapeAttr(it.path)}" draggable="false" />`
                  : `<div class="img-canvas-card-placeholder">${escapeHtml(it.path.split('/').pop() || 'image')}</div>`}
              </div>
              <div class="img-canvas-card-label" title="${escapeAttr(it.path)}">${escapeHtml(it.path.split('/').pop() || it.path)}</div>
            </div>
          `).join('')}
        </div>
      </div>
      <div class="img-canvas-chrome">
        <div class="img-canvas-zoom">
          <button type="button" class="img-canvas-btn" data-act="zoom-out" title="缩小">−</button>
          <span class="img-canvas-zoom-label">${zoomPct}%</span>
          <button type="button" class="img-canvas-btn" data-act="zoom-in" title="放大">+</button>
          <button type="button" class="img-canvas-btn" data-act="zoom-reset" title="重置视图">重置</button>
        </div>
        <div class="img-canvas-tools">
          <button type="button" class="img-canvas-btn${state.selectedId ? ' is-active' : ''}" data-act="use-ref" title="用作参考" ${state.selectedId ? '' : 'disabled'}>参考</button>
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
        } else if (act === 'use-ref') {
          const it = selected(state);
          if (it && handlers.onUseReference) handlers.onUseReference(it);
        } else if (act === 'clear-sel') {
          select(state, null);
          if (handlers.onSelect) handlers.onSelect(null);
          if (handlers.onChange) handlers.onChange(state);
          render(host, state, handlers);
        }
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
        if (refBtn) refBtn.disabled = !id;
        if (clearBtn) clearBtn.disabled = !id;
      });
    });

    if (stage) {
      stage.addEventListener('mousedown', (e) => {
        if (e.button !== 0 && e.button !== 1) return;
        if (e.target.closest('.img-canvas-card')) return;
        e.preventDefault();
        state.dragging = {
          kind: 'pan',
          startX: e.clientX,
          startY: e.clientY,
          origX: state.panX,
          origY: state.panY,
        };
        stage.classList.add('is-panning');
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
      if (!state.dragging) return;
      const dx = e.clientX - state.dragging.startX;
      const dy = e.clientY - state.dragging.startY;
      if (state.dragging.kind === 'pan') {
        state.panX = state.dragging.origX + dx;
        state.panY = state.dragging.origY + dy;
        if (world) {
          world.style.transform = `translate(${state.panX}px, ${state.panY}px) scale(${state.zoom})`;
        }
      } else if (state.dragging.kind === 'item') {
        const it = state.items.find((x) => x.id === state.dragging.id);
        if (!it) return;
        const inv = 1 / (state.zoom || 1);
        it.x = state.dragging.origX + dx * inv;
        it.y = state.dragging.origY + dy * inv;
        const card = host.querySelector(`.img-canvas-card[data-id="${cssEscape(state.dragging.id)}"]`);
        if (card) {
          card.style.left = it.x + 'px';
          card.style.top = it.y + 'px';
        }
      }
    };

    const onUp = () => {
      if (!state.dragging) return;
      const was = state.dragging;
      state.dragging = null;
      stage?.classList.remove('is-panning');
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
    select,
    selected,
    removeSelected,
    serialize,
    restore,
    render,
    clampZoom,
  };
})();
