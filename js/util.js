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

  /* 保存文本到设备（plus 环境写入 Documents，浏览器触发下载） */
  saveTextFile(filename, text) {
    return new Promise((resolve, reject) => {
      if (U.isPlus()) {
        plus.io.requestFileSystem(plus.io.PUBLIC_DOCUMENTS, fs => {
          fs.root.getFile('wepchat/' + filename, { create: true }, entry => {
            entry.createWriter(writer => {
              writer.onwrite = () => resolve(entry.fullPath || ('文档/wepchat/' + filename));
              writer.onerror = e => reject(e);
              writer.write(text);
            }, reject);
          }, reject);
        }, reject);
      } else {
        const blob = new Blob([text], { type: 'application/octet-stream' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        resolve(filename);
      }
    });
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
