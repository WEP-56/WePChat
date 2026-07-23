/* WePChat Windows — 隔离预览绘制桥（postMessage → preview_server harness）
 *
 * 安全模型：
 * - 外层 iframe 只加载 preview_server 的 harness 页（127.0.0.1 随机端口独立 origin），
 *   sandbox="allow-scripts allow-same-origin" 让 harness 可维护内部预览文档；该 origin
 *   与 Tauri 主窗口仍不同源，模型脚本无法触碰应用窗口或 Tauri IPC。
 * - HTML 经 postMessage 交给 harness，由 harness 写入其内部 iframe；
 *   文档级 CSP 由 preview_server 响应头下发（禁外部网络）。
 * - 主窗口绝不通过 contentDocument.write / srcdoc 写入模型 HTML。
 *
 * 仍保留：<base href> 注入（相对 CSS/JS 经 preview_server 解析）、
 * 内容相等短路、滚动位置保持（harness 侧执行）。
 */
'use strict';

(() => {
  /** @type {WeakMap<HTMLIFrameElement, {
   *   harnessUrl: string, ready: boolean, queue: object[],
   *   path: string, content: string, base: string,
   * }>} */
  const frames = new WeakMap();

  function normalizePath(path) {
    return String(path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .trim();
  }

  /**
   * Directory URL for <base href> so relative assets resolve next to the HTML entry.
   * previewBaseUrl is like http://127.0.0.1:port/token/
   * path is like index.html or pages/about.html
   */
  function baseHrefFor(previewBaseUrl, path) {
    const base = String(previewBaseUrl || '');
    if (!base) return '';
    const norm = normalizePath(path);
    const slash = norm.lastIndexOf('/');
    const dir = slash >= 0 ? norm.slice(0, slash + 1) : '';
    const root = base.endsWith('/') ? base : base + '/';
    return root + dir;
  }

  function injectBaseHref(html, baseHref) {
    const src = String(html || '');
    if (/data-wep-preview-base\s*=/i.test(src)) return src;
    const tag = baseHref ? `<base href="${baseHref}" data-wep-preview-base="1">` : '';

    const headOpen = src.match(/<head\b[^>]*>/i);
    if (headOpen) {
      if (!tag) return src;
      const i = headOpen.index + headOpen[0].length;
      return src.slice(0, i) + tag + src.slice(i);
    }

    const htmlOpen = src.match(/<html\b[^>]*>/i);
    if (htmlOpen) {
      if (!tag) return src;
      const i = htmlOpen.index + htmlOpen[0].length;
      return src.slice(0, i) + `<head>${tag}</head>` + src.slice(i);
    }

    // Partial / fragment HTML (common while streaming)
    return `<!DOCTYPE html><html><head>${tag}<meta charset="utf-8"></head><body>${src}</body></html>`;
  }

  function harnessUrlFor(previewBaseUrl) {
    const base = String(previewBaseUrl || '');
    if (!base) return '';
    return (base.endsWith('/') ? base : base + '/') + '__wep_preview__';
  }

  function stateFor(frame) {
    let st = frames.get(frame);
    if (!st) {
      st = { harnessUrl: '', ready: false, queue: [], path: '', content: '', base: '' };
      frames.set(frame, st);
    }
    return st;
  }

  /** 确保外层 iframe 指向 harness；harness 变更（换会话/端口）时重置就绪状态 */
  function ensureHarness(frame, previewBaseUrl) {
    if (!frame) return null;
    const url = harnessUrlFor(previewBaseUrl);
    if (!url) return null;
    const st = stateFor(frame);
    if (st.harnessUrl !== url) {
      st.harnessUrl = url;
      st.ready = false;
      st.queue = [];
      st.path = '';
      st.content = '';
      st.base = '';
      frame.removeAttribute('srcdoc');
      frame.src = url;
    }
    return st;
  }

  function post(frame, st, msg) {
    if (!st.ready) {
      st.queue.push(msg);
      // harness 就绪信号丢失的兜底：短暂重试后直接尝试投递
      if (!st._kick) {
        st._kick = setTimeout(() => {
          st._kick = null;
          if (!st.ready && st.queue.length) {
            st.ready = true;
            flushQueue(frame, st);
          }
        }, 1200);
      }
      return;
    }
    try {
      frame.contentWindow?.postMessage(msg, '*');
    } catch (err) {
      console.warn('BrowserPreview.post failed', err);
    }
  }

  function flushQueue(frame, st) {
    const queue = st.queue.splice(0, st.queue.length);
    // 只保留每类消息的最后一条，避免排队期间的中间帧
    const lastPaint = [...queue].reverse().find((m) => m.type === 'paint');
    const lastOther = queue.filter((m) => m.type !== 'paint');
    for (const msg of lastOther) post(frame, st, msg);
    if (lastPaint) post(frame, st, lastPaint);
  }

  // harness → 宿主的就绪信号
  window.addEventListener('message', (ev) => {
    const d = ev.data;
    if (!d || d.__wepPreview !== 1 || d.type !== 'ready') return;
    document.querySelectorAll('iframe.rp-frame').forEach((frame) => {
      if (frame.contentWindow !== ev.source) return;
      const st = frames.get(frame);
      if (!st) return;
      st.ready = true;
      if (st._kick) { clearTimeout(st._kick); st._kick = null; }
      flushQueue(frame, st);
    });
  });

  /**
   * 将 HTML 交给 harness 绘制。
   * @returns {'written'|'skipped'|'failed'}
   */
  function writeHtml(frame, html, opts) {
    opts = opts || {};
    if (!frame) return 'failed';
    const st = ensureHarness(frame, opts.previewBaseUrl);
    if (!st) return 'failed';

    const path = normalizePath(opts.path || '');
    const baseHref = opts.baseHref || '';
    const content = String(html || '');
    if (
      !opts.force &&
      st.path === path &&
      st.content === content &&
      st.base === baseHref
    ) {
      return 'skipped';
    }
    st.path = path;
    st.content = content;
    st.base = baseHref;

    post(frame, st, {
      __wepPreview: 1,
      type: 'paint',
      html: injectBaseHref(content, baseHref),
      preserveScroll: opts.preserveScroll !== false,
    });
    return 'written';
  }

  /** 让 harness 内部 iframe 直接加载 preview_server 上的文件（相对资源天然可用） */
  function navigate(frame, url, opts) {
    opts = opts || {};
    if (!frame) return 'failed';
    const st = ensureHarness(frame, opts.previewBaseUrl);
    if (!st) return 'failed';
    st.path = '';
    st.content = '';
    st.base = '';
    post(frame, st, { __wepPreview: 1, type: 'navigate', url: String(url || '') });
    return 'written';
  }

  function clear(frame) {
    if (!frame) return;
    const st = frames.get(frame);
    if (!st) return;
    st.path = '';
    st.content = '';
    st.base = '';
    if (st.harnessUrl) post(frame, st, { __wepPreview: 1, type: 'clear' });
  }

  function invalidate(frame) {
    if (!frame) return;
    const st = frames.get(frame);
    if (st) {
      st.path = '';
      st.content = '';
      st.base = '';
    }
  }

  window.BrowserPreview = {
    normalizePath,
    baseHrefFor,
    injectBaseHref,
    harnessUrlFor,
    ensureHarness,
    writeHtml,
    navigate,
    clear,
    invalidate,
  };
})();
