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
    if (/\.gif$/i.test(filename)) return 'image/gif';
    if (/\.zip$/i.test(filename)) return 'application/zip';
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

  _plusFileSystem(type) {
    return new Promise((resolve, reject) => {
      plus.io.requestFileSystem(type, fs => resolve(fs.root), reject);
    });
  },

  _plusEntryUrl(entry) {
    if (!entry) return '';
    try {
      if (entry.toLocalURL) return entry.toLocalURL();
    } catch (e) {}
    return entry.fullPath || entry.name || '';
  },

  async _plusWriteBlobAt(root, parts, blob) {
    const clean = (parts || []).map(p => U._safeExportName(p)).filter(Boolean);
    const filename = clean.pop() || 'file';
    const dir = await U._plusGetDir(root, clean);
    return await new Promise((resolve, reject) => {
      dir.getFile(filename, { create: true }, entry => {
        entry.createWriter(writer => {
          let writing = false;
          writer.onerror = reject;
          writer.onwriteend = () => {
            if (!writing) {
              writing = true;
              try { writer.seek(0); } catch (e) {}
              writer.write(blob);
              return;
            }
            resolve(entry);
          };
          try {
            if (writer.length > 0) writer.truncate(0);
            else {
              writing = true;
              writer.write(blob);
            }
          }
          catch (e) {
            writing = true;
            writer.write(blob);
          }
        }, reject);
      }, reject);
    });
  },

  /* 保存 Blob 到设备。浏览器优先弹保存文件对话框；plus 环境写入公共下载目录。 */
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
        const fsType = plus.io.PUBLIC_DOWNLOADS != null ? plus.io.PUBLIC_DOWNLOADS : plus.io.PUBLIC_DOCUMENTS;
        U._plusFileSystem(fsType).then(root => {
          U._plusWriteBlobAt(root, ['wepchat', name], blob).then(entry => {
            resolve({
              path: '下载/wepchat/' + name,
              name,
              fullPath: entry.fullPath || '',
              localUrl: U._plusEntryUrl(entry)
            });
          }, reject);
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

  async saveImageToGallery(filename, dataUrl) {
    const name = U._safeExportName(filename);
    if (!U.isPlus() || !plus.gallery || !plus.gallery.save) {
      return U.saveDataUrlFile(name, dataUrl, { picker: false });
    }
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const root = await U._plusFileSystem(plus.io.PRIVATE_DOC);
    const entry = await U._plusWriteBlobAt(root, ['wepchat-share', Date.now() + '-' + name], blob);
    const localUrl = U._plusEntryUrl(entry);
    try {
      await new Promise((resolve, reject) => plus.gallery.save(localUrl, resolve, reject));
      return { path: '系统相册', name };
    } finally {
      try { entry.remove(() => {}, () => {}); } catch (e) {}
    }
  },

  canShare() {
    return !!((U.isPlus() && plus.share && plus.share.sendWithSystem) || navigator.share);
  },

  async shareImageFile(filename, dataUrl) {
    const name = U._safeExportName(filename);
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    if (U.isPlus() && plus.share && plus.share.sendWithSystem) {
      const saved = await U.saveBlobFile(name, blob, { picker: false });
      const localUrl = saved.localUrl || saved.fullPath || '';
      if (!localUrl) throw new Error('无法创建可分享的本地文件');
      return await new Promise((resolve, reject) => {
        plus.share.sendWithSystem({
          type: 'image',
          content: name,
          pictures: [localUrl]
        }, () => resolve({ path: '系统分享面板', name }), reject);
      });
    }
    if (navigator.share && typeof File !== 'undefined') {
      const file = new File([blob], name, { type: blob.type || U._mimeForName(name) });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({ title: name, files: [file] });
        return { path: '系统分享面板', name };
      }
    }
    throw new Error('当前环境不支持系统分享');
  },

  async shareText(title, text) {
    const name = U._safeExportName(title || 'text.txt');
    const content = String(text == null ? '' : text);
    if (U.isPlus() && plus.share && plus.share.sendWithSystem) {
      return await new Promise((resolve, reject) => {
        plus.share.sendWithSystem({
          type: 'text',
          title: name,
          content
        }, () => resolve({ path: '系统分享面板', name }), reject);
      });
    }
    if (navigator.share) {
      await navigator.share({ title: name, text: content });
      return { path: '系统分享面板', name };
    }
    throw new Error('当前环境不支持系统分享');
  },

  _safePathParts(path) {
    return String(path || 'file')
      .replace(/\\/g, '/')
      .split('/')
      .map(p => p.trim().replace(/[\\/:*?"<>|]/g, '_'))
      .filter(p => p && p !== '.' && p !== '..');
  },

  async _blobForExportFile(file) {
    if (file.dataUrl && !file.content) {
      const res = await fetch(file.dataUrl);
      return await res.blob();
    }
    return new Blob([file.content || ''], { type: U._mimeForName(file.path, file.mime) });
  },

  _crcTable: null,

  _crc32(bytes) {
    if (!U._crcTable) {
      U._crcTable = new Uint32Array(256);
      for (let i = 0; i < 256; i++) {
        let c = i;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
        U._crcTable[i] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = U._crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  },

  _zipDateParts(date) {
    const d = date instanceof Date ? date : new Date();
    const year = Math.max(1980, d.getFullYear());
    return {
      time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
      date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
    };
  },

  _zipSafePath(path) {
    return U._safePathParts(path).join('/') || 'file';
  },

  async zipFilesBlob(files) {
    const list = Array.isArray(files) ? files : [];
    const enc = new TextEncoder();
    const chunks = [];
    const records = [];
    const seen = new Map();
    let offset = 0;
    const stamp = U._zipDateParts(new Date());

    for (const file of list) {
      const blob = await U._blobForExportFile(file);
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let path = U._zipSafePath(file.path);
      const used = seen.get(path) || 0;
      seen.set(path, used + 1);
      if (used) {
        const dot = path.lastIndexOf('.');
        path = dot > 0 ? path.slice(0, dot) + '-' + (used + 1) + path.slice(dot) : path + '-' + (used + 1);
      }
      const nameBytes = enc.encode(path);
      const crc = U._crc32(bytes);
      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0x0800, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, stamp.time, true);
      lv.setUint16(12, stamp.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, bytes.length, true);
      lv.setUint32(22, bytes.length, true);
      lv.setUint16(26, nameBytes.length, true);
      local.set(nameBytes, 30);
      chunks.push(local, bytes);
      records.push({ nameBytes, crc, size: bytes.length, offset, stamp });
      offset += local.length + bytes.length;
    }

    const centralStart = offset;
    for (const rec of records) {
      const central = new Uint8Array(46 + rec.nameBytes.length);
      const cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0x0800, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, rec.stamp.time, true);
      cv.setUint16(14, rec.stamp.date, true);
      cv.setUint32(16, rec.crc, true);
      cv.setUint32(20, rec.size, true);
      cv.setUint32(24, rec.size, true);
      cv.setUint16(28, rec.nameBytes.length, true);
      cv.setUint32(42, rec.offset, true);
      central.set(rec.nameBytes, 46);
      chunks.push(central);
      offset += central.length;
    }

    const centralSize = offset - centralStart;
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, records.length, true);
    ev.setUint16(10, records.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralStart, true);
    chunks.push(end);
    return new Blob(chunks, { type: 'application/zip' });
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
    await U._plusWriteBlobAt(root, ['wepchat', baseDir].concat(parts), blob);
  },

  async exportFilesAsZip(files, filename, opts) {
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return null;
    const zipName = U._safeExportName(filename || ('workspace-' + new Date().toISOString().slice(0, 10) + '.zip'));
    const blob = await U.zipFilesBlob(list);
    return U.saveBlobFile(zipName, blob, Object.assign({ picker: true }, opts || {}, { mime: 'application/zip' }));
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
        const fsType = plus.io.PUBLIC_DOWNLOADS != null ? plus.io.PUBLIC_DOWNLOADS : plus.io.PUBLIC_DOCUMENTS;
        plus.io.requestFileSystem(fsType, fs => resolve(fs.root), reject);
      });
      for (const file of list) {
        const parts = U._safePathParts(file.path);
        const blob = await U._blobForExportFile(file);
        await U._plusWriteExportFile(root, baseDir, parts, blob);
      }
      return { count: list.length, path: '下载/wepchat/' + baseDir };
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
