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

  /* data: URL 同步解码为 Blob。不用 fetch(dataUrl)：部分 Android WebView 不支持 */
  dataUrlToBlob(dataUrl) {
    const s = String(dataUrl || '');
    const m = s.match(/^data:([^;,]+)?((?:;[^;,]+)*?)(;base64)?,/i);
    if (!m) throw new Error('无效的图片数据');
    const mime = m[1] || 'application/octet-stream';
    const body = s.slice(m[0].length);
    if (m[3]) {
      const bin = atob(body);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new Blob([bytes], { type: mime });
    }
    return new Blob([decodeURIComponent(body)], { type: mime });
  },

  blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('读取数据失败'));
      reader.readAsDataURL(blob);
    });
  },

  blobToText(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('读取数据失败'));
      reader.readAsText(blob);
    });
  },

  /* plus 桥接回调在部分 ROM 上可能不触发，所有原生操作都要有超时兜底，
     否则 await 永久挂起，界面表现为“点了没反应” */
  _withTimeout(promise, ms, msg) {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(msg || '操作超时')), ms);
      Promise.resolve(promise).then(
        v => { clearTimeout(t); resolve(v); },
        e => { clearTimeout(t); reject(e); }
      );
    });
  },

  _plusError(e, fallback) {
    if (e instanceof Error) return e;
    const msg = (e && (e.message || (e.code != null ? '错误码 ' + e.code : ''))) || '';
    return new Error(msg || fallback || '操作失败');
  },

  /* Android 6+ 运行时存储权限。Android 11+ 会直接拒绝但公共目录写入不受影响，
     所以无论结果如何都放行，由后续写入操作自己报错 */
  _requestStoragePermission() {
    return new Promise(resolve => {
      if (!U.isPlus() || !window.plus.android || typeof plus.android.requestPermissions !== 'function') return resolve(true);
      let done = false;
      const finish = () => { if (!done) { done = true; resolve(true); } };
      setTimeout(finish, 8000);
      try {
        plus.android.requestPermissions(
          ['android.permission.WRITE_EXTERNAL_STORAGE', 'android.permission.READ_EXTERNAL_STORAGE'],
          finish, finish
        );
      } catch (e) { finish(); }
    });
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
      plus.io.requestFileSystem(type, fs => resolve(fs.root), e => reject(U._plusError(e, '访问文件系统失败')));
    });
  },

  _plusEntryUrl(entry) {
    if (!entry) return '';
    try {
      if (entry.toLocalURL) return entry.toLocalURL();
    } catch (e) {}
    return entry.fullPath || entry.name || '';
  },

  /* Entry 的平台绝对路径（/storage/...），供 Native.js 和 gallery/share 使用 */
  _plusEntryPath(entry) {
    if (!entry) return '';
    try {
      if (typeof entry.toLocalURL === 'function') {
        const u = entry.toLocalURL() || '';
        if (/^file:\/\//i.test(u)) return u.replace(/^file:\/\//i, '');
        if (u && plus.io && typeof plus.io.convertLocalFileSystemURL === 'function') {
          const abs = plus.io.convertLocalFileSystemURL(u);
          if (abs) return abs;
        }
      }
    } catch (e) {}
    try {
      if (entry.fullPath && entry.fullPath.charAt(0) === '/') return entry.fullPath;
    } catch (e) {}
    return '';
  },

  /* 导出目录以 plus.io.PUBLIC_DOWNLOADS 的实际映射为准。不同基座、包名和
     Android 版本的绝对路径可能不同，不能在界面层硬编码。 */
  async exportDirectoryInfo() {
    if (!U.isPlus()) {
      return {
        path: '浏览器默认下载目录',
        localUrl: '',
        isApp: false
      };
    }
    const fsType = plus.io.PUBLIC_DOWNLOADS != null ? plus.io.PUBLIC_DOWNLOADS : plus.io.PUBLIC_DOCUMENTS;
    const root = await U._withTimeout(U._plusFileSystem(fsType), 10000, '打开下载目录超时');
    const dir = await U._withTimeout(U._plusGetDir(root, ['wepchat']), 10000, '打开 WepChat 导出目录超时');
    const localUrl = U._plusEntryUrl(dir);
    let path = U._plusEntryPath(dir);
    if (!path && localUrl && plus.io && typeof plus.io.convertLocalFileSystemURL === 'function') {
      try { path = plus.io.convertLocalFileSystemURL(localUrl) || ''; } catch (e) {}
    }
    return {
      path: path || localUrl || '应用数据目录/Download/wepchat',
      fullPath: path,
      localUrl,
      isApp: true
    };
  },

  _androidDocumentUriForPath(path) {
    if (!U.isPlus() || !plus.android || !path) return null;
    const clean = String(path).replace(/^file:\/\//i, '').replace(/\\/g, '/').replace(/\/+$/, '');
    let docId = '';
    let m = clean.match(/^\/storage\/emulated\/0\/(.+)$/i);
    if (m) docId = 'primary:' + m[1];
    if (!docId) {
      m = clean.match(/^\/storage\/([^/]+)\/(.+)$/i);
      if (m) docId = m[1] + ':' + m[2];
    }
    if (!docId) return null;
    try {
      const DocumentsContract = plus.android.importClass('android.provider.DocumentsContract');
      return DocumentsContract.buildDocumentUri('com.android.externalstorage.documents', docId);
    } catch (e) {
      return null;
    }
  },

  async openExportDirectory() {
    let info;
    try {
      info = await U.exportDirectoryInfo();
    } catch (e) {
      info = {
        path: '应用数据目录/Download/wepchat',
        fullPath: '',
        localUrl: '',
        isApp: U.isPlus(),
        opened: false,
        error: e && e.message || String(e)
      };
    }
    if (!info.isApp || !plus.android) {
      return Object.assign(info, {
        opened: false,
        error: info.error || '浏览器无法直接打开系统下载目录'
      });
    }

    const uri = U._androidDocumentUriForPath(info.fullPath || info.path);
    if (!uri) {
      return Object.assign(info, {
        opened: false,
        error: info.error || '无法为导出目录创建系统 URI'
      });
    }

    let firstError = null;
    try {
      const Intent = plus.android.importClass('android.content.Intent');
      const activity = plus.android.runtimeMainActivity();
      const intent = new Intent(Intent.ACTION_VIEW);
      intent.setDataAndType(uri, 'vnd.android.document/directory');
      if (Intent.FLAG_ACTIVITY_NEW_TASK != null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      if (Intent.FLAG_GRANT_READ_URI_PERMISSION != null) intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      activity.startActivity(intent);
      return Object.assign(info, { opened: true, method: 'file-manager' });
    } catch (e) {
      firstError = e;
    }

    try {
      const Intent = plus.android.importClass('android.content.Intent');
      const activity = plus.android.runtimeMainActivity();
      const intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
      if (Intent.FLAG_ACTIVITY_NEW_TASK != null) intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
      if (Intent.FLAG_GRANT_READ_URI_PERMISSION != null) intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
      try { intent.putExtra('android.provider.extra.INITIAL_URI', uri); } catch (e) {}
      activity.startActivity(intent);
      return Object.assign(info, { opened: true, method: 'document-tree' });
    } catch (e) {
      return Object.assign(info, {
        opened: false,
        error: (e && e.message) || (firstError && firstError.message) || '系统文件管理器无法打开此目录'
      });
    }
  },

  /* 原生 Bitmap 保存图片：base64 原生解码、原生落盘，不让二进制数据过 JS 桥。
     Native.js 的 byte[] 跨桥会拿到 null（实机 NullPointerException），不能用 */
  _plusSaveBitmap(absPath, dataUrl) {
    return new Promise((resolve, reject) => {
      if (!plus.nativeObj || !plus.nativeObj.Bitmap) return reject(new Error('当前基座不支持 Bitmap'));
      const bmp = new plus.nativeObj.Bitmap('wc-export-' + Date.now() + '-' + Math.floor(Math.random() * 1e6));
      const done = err => {
        try { bmp.clear(); } catch (e) {}
        if (err) reject(err); else resolve();
      };
      bmp.loadBase64Data(dataUrl, () => {
        const fmt = /\.jpe?g$/i.test(absPath) ? 'jpg' : 'png';
        bmp.save(absPath, { overwrite: true, format: fmt, quality: 100 },
          () => done(),
          e => done(U._plusError(e, '保存图片失败')));
      }, e => done(U._plusError(e, '解码图片数据失败')));
    });
  },

  async _plusWriteBlobAt(root, parts, blob) {
    const clean = (parts || []).map(p => U._safeExportName(p)).filter(Boolean);
    const filename = clean.pop() || 'file';
    const dir = await U._plusGetDir(root, clean);
    let entry = await new Promise((resolve, reject) => {
      dir.getFile(filename, { create: true }, resolve, e => reject(U._plusError(e, '创建文件失败')));
    });
    const absPath = U._plusEntryPath(entry) || U._plusEntryUrl(entry);
    /* 图片：原生 Bitmap 落盘 */
    if (/^image\//i.test(blob && blob.type || '') && absPath) {
      const dataUrl = await U.blobToDataUrl(blob);
      await U._withTimeout(U._plusSaveBitmap(absPath, dataUrl), 20000, '保存图片超时');
      return entry;
    }
    /* 文本：FileWriter 只可靠支持字符串写入；先删除重建避免旧内容残留 */
    const text = await U.blobToText(blob);
    await new Promise(resolve => { try { entry.remove(resolve, resolve); } catch (e) { resolve(); } });
    entry = await new Promise((resolve, reject) => {
      dir.getFile(filename, { create: true }, resolve, e => reject(U._plusError(e, '创建文件失败')));
    });
    await U._withTimeout(new Promise((resolve, reject) => {
      entry.createWriter(writer => {
        writer.onwriteend = () => resolve();
        writer.onerror = () => reject(U._plusError(writer.error, '写入文件失败'));
        writer.write(text);
      }, e => reject(U._plusError(e, '写入文件失败')));
    }), 15000, '写入文件超时');
    return entry;
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
    if (U.isPlus()) {
      await U._requestStoragePermission();
      const fsType = plus.io.PUBLIC_DOWNLOADS != null ? plus.io.PUBLIC_DOWNLOADS : plus.io.PUBLIC_DOCUMENTS;
      const root = await U._withTimeout(U._plusFileSystem(fsType), 10000, '打开下载目录超时');
      const entry = await U._withTimeout(U._plusWriteBlobAt(root, ['wepchat', name], blob), 30000, '写入下载目录超时');
      return {
        path: '下载/wepchat/' + name,
        name,
        fullPath: entry.fullPath || '',
        localUrl: U._plusEntryUrl(entry)
      };
    }
    return { path: '浏览器下载目录', name: U._downloadBlob(name, blob) };
  },

  /* 保存文本到设备 */
  saveTextFile(filename, text, opts) {
    const blob = new Blob([text], { type: U._mimeForName(filename, opts && opts.mime) });
    return U.saveBlobFile(filename, blob, opts);
  },

  async saveDataUrlFile(filename, dataUrl, opts) {
    return U.saveBlobFile(filename, U.dataUrlToBlob(dataUrl), opts);
  },

  async saveImageToGallery(filename, dataUrl) {
    const name = U._safeExportName(filename);
    if (!U.isPlus() || !plus.gallery || !plus.gallery.save) {
      return U.saveDataUrlFile(name, dataUrl, { picker: false });
    }
    await U._requestStoragePermission();
    const blob = U.dataUrlToBlob(dataUrl);
    const root = await U._withTimeout(U._plusFileSystem(plus.io.PRIVATE_DOC), 10000, '打开应用目录超时');
    const entry = await U._withTimeout(
      U._plusWriteBlobAt(root, ['wepchat-share', Date.now() + '-' + name], blob),
      30000, '写入临时文件超时'
    );
    const target = U._plusEntryPath(entry) || U._plusEntryUrl(entry);
    try {
      await U._withTimeout(new Promise((resolve, reject) => {
        plus.gallery.save(target, resolve, e => reject(U._plusError(e, '保存到相册失败')));
      }), 20000, '保存到相册超时');
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
    const blob = U.dataUrlToBlob(dataUrl);
    if (U.isPlus() && plus.share && plus.share.sendWithSystem) {
      /* 临时文件放应用私有目录，分享不依赖存储权限 */
      const root = await U._withTimeout(U._plusFileSystem(plus.io.PRIVATE_DOC), 10000, '打开应用目录超时');
      const entry = await U._withTimeout(
        U._plusWriteBlobAt(root, ['wepchat-share', Date.now() + '-' + name], blob),
        30000, '创建分享文件超时'
      );
      const pic = U._plusEntryPath(entry) || U._plusEntryUrl(entry);
      if (!pic) throw new Error('无法创建可分享的本地文件');
      return await new Promise((resolve, reject) => {
        plus.share.sendWithSystem({
          type: 'image',
          content: name,
          pictures: [pic]
        }, () => resolve({ path: '系统分享面板', name }), e => reject(U._plusError(e, '系统分享失败')));
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
        }, () => resolve({ path: '系统分享面板', name }), e => reject(U._plusError(e, '系统分享失败')));
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
      return U.dataUrlToBlob(file.dataUrl);
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

  async _inflateZipBytes(bytes) {
    if (typeof DecompressionStream !== 'function') {
      throw new Error('当前系统 WebView 不支持解压备份，请更新 Android System WebView');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  },

  /* 仅读取 ZIP 中指定的文本文件，不向磁盘解压。支持 store/deflate，
     同时限制条目数与解压体积，避免异常备份耗尽 WebView 内存。 */
  async readZipTextFiles(blob, wantedNames) {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.length < 22) throw new Error('备份包不是有效的 ZIP 文件');
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const min = Math.max(0, bytes.length - 22 - 0xffff);
    for (let i = bytes.length - 22; i >= min; i--) {
      if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('备份包缺少 ZIP 目录信息');
    const count = view.getUint16(eocd + 10, true);
    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    if (count > 1000) throw new Error('备份包文件条目过多');
    if (centralOffset + centralSize > bytes.length) throw new Error('备份包目录已损坏');

    const wanted = new Set((wantedNames || []).map(name => String(name).toLowerCase()));
    const out = {};
    const decoder = new TextDecoder('utf-8');
    let offset = centralOffset;
    for (let i = 0; i < count; i++) {
      if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) {
        throw new Error('备份包目录条目已损坏');
      }
      const method = view.getUint16(offset + 10, true);
      const crc = view.getUint32(offset + 16, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const plainSize = view.getUint32(offset + 24, true);
      const nameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      if (offset + 46 + nameLength + extraLength + commentLength > bytes.length) throw new Error('备份包文件名已损坏');
      const rawName = decoder.decode(bytes.slice(offset + 46, offset + 46 + nameLength)).replace(/\\/g, '/');
      const baseName = rawName.split('/').filter(Boolean).pop() || '';
      if (wanted.has(baseName.toLowerCase())) {
        if (plainSize > 64 * 1024 * 1024 || compressedSize > 64 * 1024 * 1024) throw new Error('备份数据超过 64 MB 上限');
        if (localOffset + 30 > bytes.length || view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('备份包本地条目已损坏');
        const localNameLength = view.getUint16(localOffset + 26, true);
        const localExtraLength = view.getUint16(localOffset + 28, true);
        const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
        if (dataOffset + compressedSize > bytes.length) throw new Error('备份包数据已截断');
        const packed = bytes.slice(dataOffset, dataOffset + compressedSize);
        let plain;
        if (method === 0) plain = packed;
        else if (method === 8) plain = await U._inflateZipBytes(packed);
        else throw new Error('备份包使用了不支持的压缩算法：' + method);
        if (plainSize !== plain.length || U._crc32(plain) !== crc) throw new Error('备份包校验失败，文件可能已损坏');
        out[baseName.toLowerCase()] = decoder.decode(plain).replace(/^\uFEFF/, '');
      }
      offset += 46 + nameLength + extraLength + commentLength;
    }
    return out;
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
      dir = await new Promise((resolve, reject) => {
        dir.getDirectory(part, { create: true }, resolve, e => reject(U._plusError(e, '创建目录失败')));
      });
    }
    return dir;
  },

  async _plusWriteExportFile(root, baseDir, parts, blob) {
    await U._plusWriteBlobAt(root, ['wepchat', baseDir].concat(parts), blob);
  },

  /* App 端 ZIP：文件先暂存到 _doc/ 临时目录（图片走 Bitmap、文本走 FileWriter），
     再用 plus.zip.compress 原生压缩到下载目录，全程无二进制过 JS 桥 */
  async _plusExportZip(files, zipName) {
    await U._requestStoragePermission();
    const docRoot = await U._withTimeout(U._plusFileSystem(plus.io.PRIVATE_DOC), 10000, '打开应用目录超时');
    const stageName = 'wepchat-zip-' + Date.now();
    const baseName = U._safeExportName(zipName.replace(/\.(?:zip|wepchat)$/i, '')) || 'workspace';
    const cleanup = () => {
      try {
        docRoot.getDirectory(stageName, {}, d => d.removeRecursively(() => {}, () => {}), () => {});
      } catch (e) {}
    };
    try {
      for (const file of files) {
        const parts = [stageName, baseName].concat(U._safePathParts(file.path));
        const blob = await U._blobForExportFile(file);
        await U._withTimeout(U._plusWriteBlobAt(docRoot, parts, blob), 30000, '写入临时文件超时');
      }
      const fsType = plus.io.PUBLIC_DOWNLOADS != null ? plus.io.PUBLIC_DOWNLOADS : plus.io.PUBLIC_DOCUMENTS;
      const dlRoot = await U._withTimeout(U._plusFileSystem(fsType), 10000, '打开下载目录超时');
      const dlDir = await U._plusGetDir(dlRoot, ['wepchat']);
      /* 已存在的同名 ZIP 先删除，避免 compress 追加或报错 */
      await new Promise(resolve => {
        try { dlDir.getFile(zipName, {}, old => old.remove(resolve, resolve), resolve); } catch (e) { resolve(); }
      });
      const dstPath = (U._plusEntryPath(dlDir) || U._plusEntryUrl(dlDir)) + '/' + zipName;
      const srcUrl = '_doc/' + stageName + '/' + baseName;
      await U._withTimeout(new Promise((resolve, reject) => {
        plus.zip.compress(srcUrl, dstPath, resolve, e => reject(U._plusError(e, '压缩失败')));
      }), 60000, '压缩超时');
      return { path: '下载/wepchat/' + zipName, name: zipName };
    } finally {
      cleanup();
    }
  },

  async exportFilesAsZip(files, filename, opts) {
    const list = Array.isArray(files) ? files : [];
    if (!list.length) return null;
    const zipName = U._safeExportName(filename || ('workspace-' + new Date().toISOString().slice(0, 10) + '.zip'));
    if (U.isPlus() && plus.zip && plus.zip.compress) {
      return await U._plusExportZip(list, zipName);
    }
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
      await U._requestStoragePermission();
      const baseDir = U._safeExportName((opts && opts.baseDir) || ('workspace-' + new Date().toISOString().slice(0, 10)));
      const fsType = plus.io.PUBLIC_DOWNLOADS != null ? plus.io.PUBLIC_DOWNLOADS : plus.io.PUBLIC_DOCUMENTS;
      const root = await U._withTimeout(U._plusFileSystem(fsType), 10000, '打开下载目录超时');
      for (const file of list) {
        const parts = U._safePathParts(file.path);
        const blob = await U._blobForExportFile(file);
        await U._withTimeout(U._plusWriteExportFile(root, baseDir, parts, blob), 30000, '写入下载目录超时');
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
