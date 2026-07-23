/* WePChat Windows — smooth HTML preview paint (no full iframe navigation flash)
 *
 * Strategy:
 * - Prefer contentDocument.open/write/close into the same iframe
 * - Inject <base href> so relative CSS/JS resolve via preview_server
 * - Content-equality short-circuit + scroll restore
 * - Fall back to frame.src only when we have no HTML body
 */
'use strict';

(() => {
  /** @type {WeakMap<HTMLIFrameElement, { path: string, content: string, base: string }>} */
  const lastPaint = new WeakMap();

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
    // Ensure trailing slash on base
    const root = base.endsWith('/') ? base : base + '/';
    return root + dir;
  }

  function injectBaseHref(html, baseHref) {
    const src = String(html || '');
    if (!baseHref) return src;
    // Avoid double-injecting our marker
    if (/data-wep-preview-base\s*=/i.test(src)) return src;
    if (/<base\b/i.test(src)) return src;

    const tag = `<base href="${baseHref}" data-wep-preview-base="1">`;

    const headOpen = src.match(/<head\b[^>]*>/i);
    if (headOpen) {
      const i = headOpen.index + headOpen[0].length;
      return src.slice(0, i) + tag + src.slice(i);
    }

    const htmlOpen = src.match(/<html\b[^>]*>/i);
    if (htmlOpen) {
      const i = htmlOpen.index + htmlOpen[0].length;
      return src.slice(0, i) + `<head>${tag}</head>` + src.slice(i);
    }

    // Partial / fragment HTML (common while streaming)
    return `<!DOCTYPE html><html><head>${tag}<meta charset="utf-8"></head><body>${src}</body></html>`;
  }

  function readScroll(frame) {
    try {
      const win = frame.contentWindow;
      if (!win) return { x: 0, y: 0 };
      return {
        x: win.scrollX || win.pageXOffset || 0,
        y: win.scrollY || win.pageYOffset || 0,
      };
    } catch {
      return { x: 0, y: 0 };
    }
  }

  function restoreScroll(frame, pos) {
    if (!pos) return;
    try {
      const win = frame.contentWindow;
      if (!win) return;
      // After document.write, layout may not be ready in the same tick
      const apply = () => {
        try {
          win.scrollTo(pos.x || 0, pos.y || 0);
        } catch {
          /* ignore */
        }
      };
      apply();
      if (typeof requestAnimationFrame === 'function') {
        requestAnimationFrame(apply);
      }
    } catch {
      /* ignore */
    }
  }

  /**
   * Write HTML into iframe without assigning frame.src (avoids white flash).
   * @returns {'written'|'skipped'|'failed'}
   */
  function writeHtml(frame, html, opts) {
    opts = opts || {};
    if (!frame) return 'failed';

    const path = normalizePath(opts.path || '');
    const baseHref = opts.baseHref || '';
    const content = String(html || '');
    const docHtml = injectBaseHref(content, baseHref);

    const prev = lastPaint.get(frame);
    if (
      !opts.force &&
      prev &&
      prev.path === path &&
      prev.content === content &&
      prev.base === baseHref
    ) {
      return 'skipped';
    }

    const scroll = opts.preserveScroll !== false ? readScroll(frame) : { x: 0, y: 0 };

    try {
      // Clear navigation src so we own the document
      if (frame.getAttribute('src')) {
        frame.removeAttribute('src');
      }
      // Prefer contentDocument write over srcdoc assignment:
      // repeated srcdoc sets still full-reload; open/write is the progressive path.
      const doc = frame.contentDocument;
      if (!doc) {
        // Rare: iframe not ready — fall back to srcdoc once
        frame.srcdoc = docHtml;
        lastPaint.set(frame, { path, content, base: baseHref });
        return 'written';
      }

      doc.open();
      doc.write(docHtml);
      doc.close();

      lastPaint.set(frame, { path, content, base: baseHref });
      restoreScroll(frame, scroll);
      return 'written';
    } catch (err) {
      console.warn('BrowserPreview.writeHtml failed', err);
      try {
        frame.srcdoc = docHtml;
        lastPaint.set(frame, { path, content, base: baseHref });
        return 'written';
      } catch {
        return 'failed';
      }
    }
  }

  function clear(frame) {
    if (!frame) return;
    lastPaint.delete(frame);
    try {
      frame.removeAttribute('srcdoc');
      frame.removeAttribute('src');
      frame.removeAttribute('data-preview-key');
      const doc = frame.contentDocument;
      if (doc) {
        doc.open();
        doc.write('<!DOCTYPE html><html><head></head><body></body></html>');
        doc.close();
      }
    } catch {
      /* ignore */
    }
  }

  function invalidate(frame) {
    if (frame) lastPaint.delete(frame);
  }

  window.BrowserPreview = {
    normalizePath,
    baseHrefFor,
    injectBaseHref,
    writeHtml,
    clear,
    invalidate,
    readScroll,
    restoreScroll,
  };
})();
