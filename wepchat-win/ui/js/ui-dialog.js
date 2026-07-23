/* WePChat Windows — toast / confirm / prompt
 * 使用 <dialog showModal()> 叠在其它 modal dialog 之上（top layer），
 * 避免被供应商编辑窗挡住。 */
'use strict';

(function () {
  let dlgResolve = null;
  let toastTimer = null;
  let escBound = false;

  function topOpenDialog() {
    const list = Array.from(document.querySelectorAll('dialog[open]'));
    return list.length ? list[list.length - 1] : null;
  }

  function ensureToast() {
    let el = document.getElementById('wc-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'wc-toast';
      el.setAttribute('role', 'status');
      el.setAttribute('aria-live', 'polite');
    }
    /* toast 必须挂到当前 top-layer dialog 内，否则会沉在 modal 下面 */
    const host = topOpenDialog() || document.body;
    if (el.parentElement !== host) host.appendChild(el);
    return el;
  }

  function toast(msg, dur) {
    const el = ensureToast();
    el.textContent = String(msg || '');
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), Math.max(1200, Number(dur) || 2200));
  }

  function ensureDlg() {
    let dlg = document.getElementById('app-dlg');
    if (!dlg) {
      dlg = document.createElement('dialog');
      dlg.id = 'app-dlg';
      dlg.className = 'app-dlg';
      dlg.innerHTML = [
        '<button type="button" class="app-dlg-close" id="app-dlg-close" aria-label="关闭" title="关闭">',
        '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">',
        '<path fill="currentColor" d="M18.3 5.71a1 1 0 0 0-1.41 0L12 10.59 7.11 5.7A1 1 0 0 0 5.7 7.11L10.59 12 5.7 16.89a1 1 0 1 0 1.41 1.41L12 13.41l4.89 4.89a1 1 0 0 0 1.41-1.41L13.41 12l4.89-4.89a1 1 0 0 0 0-1.4z"/>',
        '</svg></button>',
        '<div class="app-dlg-title" id="app-dlg-title"></div>',
        '<div class="app-dlg-msg" id="app-dlg-msg"></div>',
        '<input class="app-dlg-input" id="app-dlg-input" hidden />',
        '<textarea class="app-dlg-input app-dlg-textarea" id="app-dlg-textarea" hidden></textarea>',
        '<div class="app-dlg-btns" id="app-dlg-btns"></div>'
      ].join('');
      document.body.appendChild(dlg);
    }
    if (!escBound) {
      escBound = true;
      // Esc / 关闭钮 = 拒绝；禁止点 backdrop 关闭（误触风险高，尤其工具授权）
      dlg.addEventListener('cancel', (e) => {
        e.preventDefault();
        answer(null);
      });
      dlg.querySelector('#app-dlg-close')?.addEventListener('click', () => answer(null));
    }
    return dlg;
  }

  function answer(value) {
    const dlg = document.getElementById('app-dlg');
    if (dlg && dlg.open) {
      try { dlg.close(); } catch (e) {}
    }
    const resolve = dlgResolve;
    dlgResolve = null;
    if (resolve) resolve(value);
  }

  function dialog(opts) {
    opts = opts || {};
    const dlg = ensureDlg();
    const title = dlg.querySelector('#app-dlg-title');
    const msg = dlg.querySelector('#app-dlg-msg');
    const input = dlg.querySelector('#app-dlg-input');
    const textarea = dlg.querySelector('#app-dlg-textarea');
    const btns = dlg.querySelector('#app-dlg-btns');

    title.textContent = opts.title || '';
    title.hidden = !opts.title;
    msg.textContent = opts.msg || '';
    msg.hidden = !opts.msg;

    input.hidden = true;
    textarea.hidden = true;
    input.value = '';
    textarea.value = '';

    let field = null;
    if (opts.textarea) {
      field = textarea;
      textarea.hidden = false;
      textarea.value = opts.value != null ? String(opts.value) : '';
      textarea.placeholder = opts.placeholder || '';
    } else if (opts.input != null || opts.prompt) {
      field = input;
      input.hidden = false;
      input.type = opts.inputType || 'text';
      input.value = opts.value != null ? String(opts.value) : (opts.input != null ? String(opts.input) : '');
      input.placeholder = opts.placeholder || '';
    }

    btns.innerHTML = '';
    const buttons = opts.buttons || [
      { text: '取消', value: false },
      { text: '确定', value: true, style: 'primary' }
    ];
    buttons.forEach((b) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'app-dlg-btn' + (b.style ? ' is-' + b.style : '');
      btn.textContent = b.text;
      btn.addEventListener('click', () => {
        if (field && (b.value === true || b.value === 'ok')) answer(field.value);
        else answer(b.value);
      });
      btns.appendChild(btn);
    });

    if (typeof dlg.showModal === 'function') {
      if (!dlg.open) dlg.showModal();
    } else {
      dlg.setAttribute('open', '');
    }

    if (field) {
      requestAnimationFrame(() => {
        try { field.focus(); if (field.select) field.select(); } catch (e) {}
      });
    }

    return new Promise((resolve) => {
      dlgResolve = resolve;
    });
  }

  function confirm(msg, title, opts) {
    return dialog(Object.assign({
      title: title || '确认',
      msg: String(msg || ''),
      buttons: [
        { text: (opts && opts.cancelText) || '取消', value: false },
        { text: (opts && opts.okText) || '确定', value: true, style: (opts && opts.danger) ? 'danger' : 'primary' }
      ]
    }, opts || {})).then((v) => v === true);
  }

  function prompt(title, value, placeholder, asTextarea) {
    return dialog({
      title: title || '输入',
      value: value || '',
      placeholder: placeholder || '',
      prompt: !asTextarea,
      textarea: !!asTextarea,
      buttons: [
        { text: '取消', value: null },
        { text: '确定', value: 'ok', style: 'primary' }
      ]
    }).then((v) => (v == null || v === false ? null : String(v)));
  }

  function alert(msg, title) {
    return dialog({
      title: title || '提示',
      msg: String(msg || ''),
      buttons: [{ text: '知道了', value: true, style: 'primary' }]
    }).then(() => undefined);
  }

  window.UIDialog = { toast, dialog, confirm, prompt, alert };

  if (!window.U) window.U = {};
  window.U.toast = toast;
})();
