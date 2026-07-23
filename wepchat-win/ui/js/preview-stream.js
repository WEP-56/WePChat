/* WePChat Windows — streaming write_file → preview staging
 *
 * - Partial JSON parse of write_file path/content while composing
 * - Memory staging + optional Rust preview_server overlay (multi-file)
 * - Throttled browser refresh (not token-by-token disk writes)
 */
'use strict';

(() => {
  // 200ms: fewer document.write thrash during token bursts; still feels live
  const THROTTLE_MS = 200;
  const staging = new Map(); // path -> { content, streaming, toolId, updatedAt }
  const pending = new Map();
  const timers = new Map();
  let applyFn = null;

  function normalizePath(path) {
    return String(path || '')
      .replace(/\\/g, '/')
      .replace(/^\/+/, '')
      .trim();
  }

  function isHtmlPath(path) {
    return /\.html?$/i.test(path || '');
  }

  /** CSS / JS / images that multi-file pages need from the preview server. */
  function isPreviewAssetPath(path) {
    return /\.(html?|css|m?js|json|svg|png|jpe?g|gif|webp|woff2?|ttf|txt|md)$/i.test(path || '');
  }

  function unescapeJsonStringPartial(raw) {
    let out = '';
    for (let i = 0; i < raw.length; i++) {
      const c = raw[i];
      if (c === '\\') {
        if (i + 1 >= raw.length) break;
        const n = raw[++i];
        if (n === 'n') out += '\n';
        else if (n === 'r') out += '\r';
        else if (n === 't') out += '\t';
        else if (n === 'b') out += '\b';
        else if (n === 'f') out += '\f';
        else if (n === '"' || n === '\\' || n === '/') out += n;
        else if (n === 'u') {
          if (i + 4 >= raw.length) break;
          const hex = raw.slice(i + 1, i + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) break;
          out += String.fromCharCode(parseInt(hex, 16));
          i += 4;
        } else {
          out += n;
        }
      } else if (c === '"') {
        break;
      } else {
        out += c;
      }
    }
    return out;
  }

  function extractQuotedField(src, key) {
    const re = new RegExp('"' + key + '"\\s*:\\s*"');
    const m = re.exec(src);
    if (!m) return null;
    return unescapeJsonStringPartial(src.slice(m.index + m[0].length));
  }

  function extractPartialWriteFileArgs(argStr) {
    const s = String(argStr || '');
    if (!s || s.indexOf('{') === -1) return null;

    try {
      const o = JSON.parse(s);
      if (o && typeof o === 'object') {
        return {
          path: o.path != null ? normalizePath(o.path) : '',
          content: o.content != null ? String(o.content) : '',
          complete: true,
        };
      }
    } catch {
      /* partial */
    }

    let path = '';
    const pathMatch = s.match(/"path"\s*:\s*"((?:\\.|[^"\\])*)"/);
    if (pathMatch) {
      try {
        path = normalizePath(JSON.parse('"' + pathMatch[1] + '"'));
      } catch {
        path = normalizePath(pathMatch[1]);
      }
    } else {
      const partialPath = extractQuotedField(s, 'path');
      if (partialPath != null) path = normalizePath(partialPath);
    }

    let content = null;
    const contentVal = extractQuotedField(s, 'content');
    if (contentVal != null) content = contentVal;

    if (!path && content == null) return null;
    return {
      path,
      content: content == null ? '' : content,
      complete: false,
    };
  }

  function scheduleApply(path, content, meta, immediate) {
    pending.set(path, { content, meta });
    if (immediate) {
      if (timers.has(path)) {
        clearTimeout(timers.get(path));
        timers.delete(path);
      }
      const job = pending.get(path);
      pending.delete(path);
      if (job) flush(path, job.content, job.meta);
      return;
    }
    if (timers.has(path)) return;
    const t = setTimeout(() => {
      timers.delete(path);
      const job = pending.get(path);
      pending.delete(path);
      if (!job) return;
      flush(path, job.content, job.meta);
    }, THROTTLE_MS);
    timers.set(path, t);
  }

  function flush(path, content, meta) {
    const prev = staging.get(path);
    if (prev && prev.content === content && prev.streaming === !!meta.streaming) return;
    staging.set(path, {
      content,
      streaming: !!meta.streaming,
      toolId: meta.toolId || prev?.toolId || '',
      updatedAt: Date.now(),
    });
    if (typeof applyFn === 'function') {
      try {
        applyFn(path, content, {
          streaming: !!meta.streaming,
          toolId: meta.toolId || '',
          isHtml: isHtmlPath(path),
          isAsset: isPreviewAssetPath(path),
        });
      } catch (err) {
        console.warn('PreviewStream apply failed', err);
      }
    }
  }

  function flushPending() {
    const paths = Array.from(pending.keys());
    paths.forEach((path) => {
      if (timers.has(path)) {
        clearTimeout(timers.get(path));
        timers.delete(path);
      }
      const job = pending.get(path);
      pending.delete(path);
      if (job) flush(path, job.content, job.meta);
    });
  }

  function ingestWriteFileTool(tool, opts) {
    if (!tool) return;
    if ((tool.name || '') !== 'write_file') return;
    const parsed = extractPartialWriteFileArgs(tool.arguments);
    if (!parsed || !parsed.path) return;
    // Stage any previewable asset (html/css/js/…); browser opens only for html
    if (!isPreviewAssetPath(parsed.path)) return;
    scheduleApply(
      parsed.path,
      parsed.content || '',
      {
        streaming: opts && opts.forceComplete ? false : !parsed.complete,
        toolId: tool.id || '',
      },
      !!(opts && opts.immediate)
    );
  }

  function syncFromTools(tools, opts) {
    if (!Array.isArray(tools)) return;
    tools.forEach((t) => ingestWriteFileTool(t, opts));
    if (opts && opts.immediate) flushPending();
  }

  function getStaging(path) {
    return staging.get(normalizePath(path)) || null;
  }

  function clearPath(path) {
    const p = normalizePath(path);
    if (!p) return;
    if (timers.has(p)) {
      clearTimeout(timers.get(p));
      timers.delete(p);
    }
    pending.delete(p);
    staging.delete(p);
  }

  function clearAll() {
    timers.forEach((id) => clearTimeout(id));
    timers.clear();
    pending.clear();
    staging.clear();
  }

  function markCommitted(path) {
    const p = normalizePath(path);
    const entry = staging.get(p);
    if (!entry) return;
    entry.streaming = false;
    entry.committed = true;
  }

  function setApplyHandler(fn) {
    applyFn = typeof fn === 'function' ? fn : null;
  }

  /** Pretty display for tool cards (write_file shows path + content body). */
  function formatToolArgsForDisplay(name, argStr, limit) {
    const max = Math.max(200, Number(limit) || 6000);
    if (name === 'write_file' || name === 'edit_file') {
      if (name === 'write_file') {
        const p = extractPartialWriteFileArgs(argStr);
        if (p && (p.path || p.content)) {
          const head = '// ' + (p.path || '(path…)') + (p.complete ? '' : '  …streaming') + '\n';
          const body = p.content || '';
          const text = head + body;
          return text.length > max ? text.slice(0, max - 1) + '…' : text;
        }
      }
    }
    const raw = String(argStr || '');
    try {
      const o = JSON.parse(raw);
      const pretty = JSON.stringify(o, null, 2);
      return pretty.length > max ? pretty.slice(0, max - 1) + '…' : pretty;
    } catch {
      return raw.length > max ? raw.slice(0, max - 1) + '…' : raw;
    }
  }

  window.PreviewStream = {
    THROTTLE_MS,
    extractPartialWriteFileArgs,
    formatToolArgsForDisplay,
    syncFromTools,
    ingestWriteFileTool,
    getStaging,
    clearPath,
    clearAll,
    flushPending,
    markCommitted,
    setApplyHandler,
    isHtmlPath,
    isPreviewAssetPath,
    normalizePath,
  };
})();
