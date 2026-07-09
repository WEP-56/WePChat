/* WepChat - optional H5+ QR scanner */
'use strict';

(function () {
  function remove(el) {
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function scan() {
    return new Promise((resolve, reject) => {
      if (!window.plus || !plus.barcode) {
        reject(new Error('当前环境不支持扫码，请手动粘贴配对文本'));
        return;
      }

      const id = 'wc-remote-scan-' + Date.now();
      const wrap = document.createElement('div');
      wrap.className = 'remote-scan-page';
      wrap.innerHTML = '<div id="' + id + '" class="remote-scan-view"></div><button class="remote-scan-close" type="button">取消</button>';
      document.body.appendChild(wrap);

      let scanner = null;
      let settled = false;
      const done = (err, value) => {
        if (settled) return;
        settled = true;
        try { if (scanner) scanner.cancel(); } catch (e) {}
        try { if (scanner) scanner.close(); } catch (e) {}
        remove(wrap);
        if (err) reject(err);
        else resolve(value);
      };

      wrap.querySelector('button').onclick = () => done(new Error('已取消扫码'));

      try {
        scanner = new plus.barcode.Barcode(id, [plus.barcode.QR], {
          frameColor: '#ffffff',
          scanbarColor: '#ffffff',
          background: '#000000'
        });
        scanner.onmarked = (type, result) => done(null, String(result || '').trim());
        scanner.onerror = e => done(new Error(e && e.message || '扫码失败'));
        scanner.start({ conserve: true, filename: '_doc/barcode/' });
      } catch (e) {
        done(e);
      }
    });
  }

  window.RemoteScan = { scan };
})();
