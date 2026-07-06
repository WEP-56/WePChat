/* WepChat - 通用工具函数 */
'use strict';

const U = {
  uuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    });
  },

  now() { return Date.now(); },

  isPlus() { return typeof window.plus !== 'undefined' && !!window.plus.io; },

  /* 时间显示：今天显示时刻，一周内显示星期，其余显示日期 */
  fmtTime(ts) {
    if (!ts) return '';
    const d = new Date(ts), n = new Date();
    const pad = x => String(x).padStart(2, '0');
    const sameDay = d.toDateString() === n.toDateString();
    if (sameDay) return pad(d.getHours()) + ':' + pad(d.getMinutes());
    const days = Math.floor((n - d) / 86400000);
    if (days < 7) return ['周日','周一','周二','周三','周四','周五','周六'][d.getDay()];
    if (d.getFullYear() === n.getFullYear()) return (d.getMonth() + 1) + '月' + d.getDate() + '日';
    return d.getFullYear() + '/' + (d.getMonth() + 1) + '/' + d.getDate();
  },

  fmtFull(ts) {
    const d = new Date(ts);
    const pad = x => String(x).padStart(2, '0');
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' +
      pad(d.getHours()) + ':' + pad(d.getMinutes());
  },

  fmtSize(n) {
    if (n == null) return '';
    if (n < 1024) return n + ' B';
    if (n < 1048576) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  },

  /* 会话按时间分组 */
  timeGroup(ts) {
    const n = new Date(); const d = new Date(ts);
    const startOfDay = new Date(n.getFullYear(), n.getMonth(), n.getDate()).getTime();
    if (ts >= startOfDay) return '今天';
    if (ts >= startOfDay - 86400000) return '昨天';
    if (ts >= startOfDay - 6 * 86400000) return '近 7 天';
    if (ts >= startOfDay - 29 * 86400000) return '近 30 天';
    return '更早';
  },

  truncate(s, n) {
    s = String(s == null ? '' : s);
    return s.length > n ? s.slice(0, n) + '…' : s;
  },

  escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  },

  async copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext !== false) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fallthrough */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:-999px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      return ok;
    } catch (e) { return false; }
  },

  /* 轻量 toast */
  toast(msg, dur) {
    if (U.isPlus() && plus.nativeUI) {
      plus.nativeUI.toast(msg, { duration: dur > 2500 ? 'long' : 'short' });
      return;
    }
    let el = document.getElementById('wc-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wc-toast';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('show'), dur || 2000);
  },

  vibrate(ms) {
    try { navigator.vibrate && navigator.vibrate(ms || 10); } catch (e) {}
  },

  openExternal(url) {
    if (!/^https?:\/\//i.test(url)) return;
    if (U.isPlus()) plus.runtime.openURL(url);
    else window.open(url, '_blank');
  },

  /* 读取用户选择的本地文件 */
  pickFile(accept, asDataUrl) {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      if (accept) input.accept = accept;
      input.style.display = 'none';
      document.body.appendChild(input);
      let done = false;
      input.onchange = () => {
        const f = input.files && input.files[0];
        document.body.removeChild(input);
        done = true;
        if (!f) return resolve(null);
        const reader = new FileReader();
        reader.onload = () => resolve({ name: f.name, size: f.size, type: f.type, content: reader.result });
        reader.onerror = () => resolve(null);
        if (asDataUrl) reader.readAsDataURL(f);
        else reader.readAsText(f);
      };
      /* 用户取消时无 change 事件，用 focus 兜底清理 */
      window.addEventListener('focus', function onFocus() {
        window.removeEventListener('focus', onFocus);
        setTimeout(() => { if (!done && input.parentNode) { document.body.removeChild(input); resolve(null); } }, 800);
      });
      input.click();
    });
  },

  isTextFile(name, mime) {
    if (mime && /^text\/|json|xml|javascript|yaml|csv/i.test(mime)) return true;
    return /\.(txt|md|markdown|json|js|ts|jsx|tsx|css|html|htm|xml|yml|yaml|csv|tsv|log|py|java|kt|c|h|cpp|cs|go|rs|rb|php|sh|bat|sql|ini|toml|conf|vue|svg)$/i.test(name || '');
  },

  isImageFile(name, mime) {
    if (mime && /^image\//i.test(mime)) return true;
    return /\.(png|jpe?g|gif|webp|bmp)$/i.test(name || '');
  },

  _safeExportName(filename) {
    return String(filename || 'download')
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim() || 'download';
  },

  _mimeForName(filename, fallback) {
    if (fallback) return fallback;
    if (/\.html?$/i.test(filename)) return 'text/html;charset=utf-8';
    if (/\.css$/i.test(filename)) return 'text/css;charset=utf-8';
    if (/\.m?js$/i.test(filename)) return 'text/javascript;charset=utf-8';
    if (/\.json$/i.test(filename)) return 'application/json;charset=utf-8';
    if (/\.(md|markdown)$/i.test(filename)) return 'text/markdown;charset=utf-8';
    if (/\.png$/i.test(filename)) return 'image/png';
    if (/\.jpe?g$/i.test(filename)) return 'image/jpeg';
    if (/\.webp$/i.test(filename)) return 'image/webp';
    return 'application/octet-stream';
  },

  _pickerTypes(filename, mime) {
    const ext = (String(filename || '').match(/\.[a-z0-9]+$/i) || ['.txt'])[0].toLowerCase();
    const cleanMime = String(mime || 'application/octet-stream').split(';')[0] || 'application/octet-stream';
    return [{ description: '文件', accept: { [cleanMime]: [ext] } }];
  },

  async _writeBlobWithPicker(filename, blob) {
    if (U.isPlus() || typeof window.showSaveFilePicker !== 'function') return null;
    const name = U._safeExportName(filename);
    let handle;
    try {
      handle = await window.showSaveFilePicker({
        suggestedName: name,
        types: U._pickerTypes(name, blob.type || U._mimeForName(name))
      });
    } catch (e) {
      if (e && e.name === 'TypeError') handle = await window.showSaveFilePicker({ suggestedName: name });
      else throw e;
    }
    const writer = await handle.createWritable();
    await writer.write(blob);
    await writer.close();
    return handle.name || name;
  },

  _downloadBlob(filename, blob) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = U._safeExportName(filename);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    return a.download;
  },

  /* 保存 Blob 到设备。浏览器优先弹保存文件对话框；plus 环境写入 Documents/wepchat。 */
  async saveBlobFile(filename, blob, opts) {
    const name = U._safeExportName(filename);
    const usePicker = !opts || opts.picker !== false;
    if (usePicker) {
      try {
        const picked = await U._writeBlobWithPicker(name, blob);
        if (picked) return picked;
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        throw e;
      }
    }
    return new Promise((resolve, reject) => {
      if (U.isPlus()) {
        plus.io.requestFileSystem(plus.io.PUBLIC_DOCUMENTS, fs => {
          U._plusGetDir(fs.root, ['wepchat']).then(dir => dir.getFile(name, { create: true }, entry => {
            entry.createWriter(writer => {
              writer.onwrite = () => resolve({ path: entry.fullPath || ('文档/wepchat/' + name), name });
              writer.onerror = e => reject(e);
              writer.write(blob);
            }, reject);
          }, reject)).catch(reject);
        }, reject);
      } else {
        resolve({ path: '浏览器下载目录', name: U._downloadBlob(name, blob) });
      }
    });
  },

  /* 保存文本到设备 */
  saveTextFile(filename, text, opts) {
    const blob = new Blob([text], { type: U._mimeForName(filename, opts && opts.mime) });
    return U.saveBlobFile(filename, blob, opts);
  },

  async saveDataUrlFile(filename, dataUrl, opts) {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    return U.saveBlobFile(filename, blob, opts);
  },

  _safePathParts(path) {
    return String(path || 'file')
      .replace(/\\/g, '/')
      .split('/')
      .map(p => p.trim().replace(/[\\/:*?"<>|]/g, '_'))
      .filter(Boolean);
  },

  async _blobForExportFile(file) {
    if (file.dataUrl && !file.content) {
      const res = await fetch(file.dataUrl);
      return await res.blob();
    }
    return new Blob([file.content || ''], { type: U._mimeForName(file.path, file.mime) });
  },

  async _writeDirectoryHandleFile(root, parts, blob) {
    let dir = root;
    for (let i = 0; i < parts.length - 1; i++) {
      dir = await dir.getDirectoryHandle(parts[i], { create: true });
    }
    const fh = await dir.getFileHandle(parts[parts.length - 1] || 'file', { create: true });
    const writer = await fh.createWritable();
    await writer.write(blob);
    await writer.close();
  },

  async _plusGetDir(root, parts) {
    let dir = root;
    for (const part of parts) {
      dir = await new Promise((resolve, reject) => dir.getDirectory(part, { create: true }, resolve, reject));
    }
    return dir;
  },

  async _plusWriteExportFile(root, baseDir, parts, blob) {
    const dir = await U._plusGetDir(root, ['wepchat', baseDir].concat(parts.slice(0, -1)));
    await new Promise((resolve, reject) => {
      dir.getFile(parts[parts.length - 1] || 'file', { create: true }, entry => {
        entry.createWriter(writer => {
          writer.onwrite = resolve;
          writer.onerror = reject;
          writer.write(blob);
        }, reject);
      }, reject);
    });
  },

  async exportFilesToDirectory(files, opts) {
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return null;
    if (!U.isPlus() && typeof window.showDirectoryPicker === 'function') {
      let dir;
      try {
        dir = await window.showDirectoryPicker({ mode: 'readwrite' });
      } catch (e) {
        if (e && e.name === 'AbortError') return null;
        throw e;
      }
      for (const file of list) {
        const parts = U._safePathParts(file.path);
        const blob = await U._blobForExportFile(file);
        await U._writeDirectoryHandleFile(dir, parts, blob);
      }
      return { count: list.length, path: '所选文件夹' };
    }
    if (U.isPlus()) {
      const baseDir = U._safeExportName((opts && opts.baseDir) || ('workspace-' + new Date().toISOString().slice(0, 10)));
      const root = await new Promise((resolve, reject) => {
        plus.io.requestFileSystem(plus.io.PUBLIC_DOCUMENTS, fs => resolve(fs.root), reject);
      });
      for (const file of list) {
        const parts = U._safePathParts(file.path);
        const blob = await U._blobForExportFile(file);
        await U._plusWriteExportFile(root, baseDir, parts, blob);
      }
      return { count: list.length, path: '文档/wepchat/' + baseDir };
    }
    for (const file of list) {
      const blob = await U._blobForExportFile(file);
      U._downloadBlob(U._safeExportName(file.path), blob);
    }
    return { count: list.length, path: '浏览器下载目录' };
  },

  debounce(fn, ms) {
    let t;
    return function () {
      clearTimeout(t);
      const args = arguments, self = this;
      t = setTimeout(() => fn.apply(self, args), ms);
    };
  },

  clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
};

window.U = U;
