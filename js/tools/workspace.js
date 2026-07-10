/* WepChat Tool - 工作区共享能力 */
'use strict';

(() => {

  const T = window.WepChatTools;

  function safeName(p, opts) {
    opts = opts || {};
    p = String(p || '').trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+/g, '/');
    if (p.indexOf('./') === 0) p = p.slice(2);
    if (p.endsWith('/')) p = p.slice(0, -1);
    const parts = p.split('/').filter(part => part && part !== '.');
    if (!parts.length) {
      if (opts.allowEmpty) return '';
      throw new Error('非法路径: ' + p);
    }
    parts.forEach(part => {
      if (part === '..' || /[\x00-\x1f]/.test(part)) throw new Error('非法路径: ' + p);
    });
    p = parts.join('/');
    if (p.length > 180) throw new Error('路径过长: ' + p);
    return p;
  }
  
  function ensureWorkspace(session) {
    session.files = session.files || {};
    session.folders = Array.isArray(session.folders) ? session.folders : [];
    session.services = Array.isArray(session.services) ? session.services : [];
  }
  
  function ensureParentFolders(session, path) {
    session.folders = Array.isArray(session.folders) ? session.folders : [];
    const parts = String(path || '').split('/');
    for (let i = 1; i < parts.length; i++) {
      const folder = parts.slice(0, i).join('/');
      if (folder && !session.folders.includes(folder)) session.folders.push(folder);
    }
  }
  
  function collectFolders(session) {
    ensureWorkspace(session);
    const out = new Set();
    (session.folders || []).forEach(path => {
      try {
        const p = safeName(path, { allowEmpty: true });
        if (p) out.add(p);
      } catch (e) {}
    });
    Object.keys(session.files || {}).forEach(name => {
      try {
        const parts = safeName(name).split('/');
        for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join('/'));
      } catch (e) {}
    });
    return out;
  }
  
  function textMime(name) {
    if (/\.html?$/i.test(name)) return 'text/html';
    if (/\.css$/i.test(name)) return 'text/css';
    if (/\.m?js$/i.test(name)) return 'text/javascript';
    if (/\.json$/i.test(name)) return 'application/json';
    if (/\.md$/i.test(name)) return 'text/markdown';
    if (/\.csv$/i.test(name)) return 'text/csv';
    return 'text/plain';
  }
  
  function isTextFile(f) {
    return !!f && !f.dataUrl && typeof f.content === 'string';
  }
  
  function diffText(path, before, after) {
    before = String(before == null ? '' : before);
    after = String(after == null ? '' : after);
    if (before === after) return '';
    const a = before.split(/\r?\n/);
    const b = after.split(/\r?\n/);
    const max = Math.max(a.length, b.length);
    const lines = ['--- ' + path, '+++ ' + path, '@@'];
    for (let i = 0; i < max; i++) {
      if (a[i] === b[i]) {
        if (a[i] != null && lines.length < 180) lines.push(' ' + a[i]);
      } else {
        if (a[i] != null) lines.push('-' + a[i]);
        if (b[i] != null) lines.push('+' + b[i]);
      }
      if (lines.length >= 180) {
        lines.push('... diff 已截断');
        break;
      }
    }
    return lines.join('\n');
  }
  
  function fileHead(content) {
    const head = String(content || '').slice(0, 200);
    return head || '(空文件)';
  }
  
  function notFoundError(before) {
    return new Error('未找到匹配内容，当前文件前 200 字符为：\n' + fileHead(before));
  }
  
  function parseLineRange(spec, total) {
    const s = String(spec == null ? '' : spec).trim();
    if (!s) return null;
    let m;
    if (/^\d+$/.test(s)) {
      const n = parseInt(s, 10);
      return [n, n];
    }
    if ((m = s.match(/^(\d*)-(\d*)$/))) {
      if (!m[1] && !m[2]) throw new Error('lines 参数格式错误，示例：1-20、1-、-30');
      if (!m[1]) {
        const count = parseInt(m[2], 10);
        return [Math.max(1, total - count + 1), total];
      }
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : total;
      return [start, end];
    }
    throw new Error('lines 参数格式错误，示例：1-20、50-80、1-、-30');
  }
  
  function readLines(content, lines) {
    const arr = String(content || '').split(/\r?\n/);
    const range = parseLineRange(lines, arr.length);
    if (!range) return content;
    const start = Math.max(1, range[0]);
    const end = Math.min(arr.length, Math.max(start, range[1]));
    return arr.slice(start - 1, end).join('\n');
  }
  
  function serviceName(name) {
    return U.truncate(String(name || '本地服务').replace(/\s+/g, ' ').trim(), 32) || '本地服务';
  }
  
  function findService(session, args) {
    ensureWorkspace(session);
    const key = String(args.service_id || args.id || args.name || '').trim();
    if (!key && session.services.length === 1) return session.services[0];
    return session.services.find(s => s.id === key || s.name === key);
  }

  T.workspace = {
    safeName,
    ensureWorkspace,
    ensureParentFolders,
    collectFolders,
    textMime,
    isTextFile,
    diffText,
    fileHead,
    notFoundError,
    parseLineRange,
    readLines,
    serviceName,
    findService
  };
})();
