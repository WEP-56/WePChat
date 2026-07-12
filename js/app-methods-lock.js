/* WepChat - 本地 PIN 应用锁 */
'use strict';

(() => {
  const { nextTick } = Vue;

  function bytesToBase64(bytes) {
    let raw = '';
    bytes.forEach(x => { raw += String.fromCharCode(x); });
    return btoa(raw);
  }

  function base64ToBytes(text) {
    const raw = atob(String(text || ''));
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  async function pinHash(pin, saltText, iterations) {
    if (!window.crypto || !crypto.subtle || typeof TextEncoder === 'undefined') {
      throw new Error('当前系统 WebView 不支持安全 PIN 加密，请更新 Android System WebView');
    }
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      salt: base64ToBytes(saltText),
      iterations: Number(iterations) || 120000,
      hash: 'SHA-256'
    }, key, 256);
    return bytesToBase64(new Uint8Array(bits));
  }

  function equalHash(a, b) {
    a = String(a || ''); b = String(b || '');
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  window.WepChatAppMethodsLock = {
    promptAppLockPin(title, message) {
      return new Promise(resolve => {
        const dlg = {
          title,
          msg: message || '',
          value: '',
          input: '',
          inputType: 'password',
          inputMode: 'numeric',
          maxlength: 8,
          placeholder: '4–8 位数字 PIN',
          buttons: [
            { text: '取消', value: null },
            { text: '确定', value: 'ok', style: 'primary' }
          ],
          _resolve: value => resolve(value === 'ok' ? String(dlg.value || '') : null)
        };
        this.dlg = dlg;
        nextTick(() => {
          const el = this.$refs.dlgInput;
          if (el && el.focus) el.focus();
        });
      });
    },
    validAppLockPin(pin) {
      return /^\d{4,8}$/.test(String(pin || ''));
    },
    async verifyAppLockPin(pin) {
      const lock = this.settings.appLock || {};
      if (!lock.enabled || !lock.salt || !lock.hash) return false;
      const hash = await pinHash(pin, lock.salt, lock.iterations);
      return equalHash(hash, lock.hash);
    },
    async toggleAppLock() {
      const lock = this.settings.appLock || {};
      if (lock.enabled) {
        const pin = await this.promptAppLockPin('关闭应用锁', '请输入当前 PIN。');
        if (pin == null) return;
        try {
          if (!await this.verifyAppLockPin(pin)) return U.toast('PIN 不正确');
          this.settings.appLock = Object.assign({}, lock, { enabled: false });
          this.appLocked = false;
          this.persistSettings();
          U.toast('应用锁已关闭');
        } catch (e) { U.toast(e.message || '无法验证 PIN', 3600); }
        return;
      }
      const first = await this.promptAppLockPin('设置应用锁', '设置一个 4–8 位数字 PIN。');
      if (first == null) return;
      if (!this.validAppLockPin(first)) return U.toast('请输入 4–8 位数字 PIN');
      const second = await this.promptAppLockPin('确认 PIN', '再次输入相同的 PIN。');
      if (second == null) return;
      if (first !== second) return U.toast('两次 PIN 不一致');
      try {
        const salt = new Uint8Array(16);
        crypto.getRandomValues(salt);
        const saltText = bytesToBase64(salt);
        const iterations = 120000;
        const hash = await pinHash(first, saltText, iterations);
        this.settings.appLock = { enabled: true, salt: saltText, hash, iterations, timeoutMinutes: 1 };
        this.persistSettings();
        U.toast('应用锁已开启');
      } catch (e) { U.toast(e.message || '无法启用应用锁', 4200); }
    },
    async changeAppLockPin() {
      const oldPin = await this.promptAppLockPin('修改应用锁 PIN', '先输入当前 PIN。');
      if (oldPin == null) return;
      try {
        if (!await this.verifyAppLockPin(oldPin)) return U.toast('PIN 不正确');
        const first = await this.promptAppLockPin('设置新 PIN', '输入新的 4–8 位数字 PIN。');
        if (first == null) return;
        if (!this.validAppLockPin(first)) return U.toast('请输入 4–8 位数字 PIN');
        const second = await this.promptAppLockPin('确认新 PIN', '再次输入新的 PIN。');
        if (second == null) return;
        if (first !== second) return U.toast('两次 PIN 不一致');
        const salt = new Uint8Array(16);
        crypto.getRandomValues(salt);
        const saltText = bytesToBase64(salt);
        const iterations = 120000;
        const hash = await pinHash(first, saltText, iterations);
        this.settings.appLock = Object.assign({}, this.settings.appLock, { salt: saltText, hash, iterations });
        this.persistSettings();
        U.toast('PIN 已修改');
      } catch (e) { U.toast(e.message || '无法修改 PIN', 4200); }
    },
    setAppLockTimeout(minutes) {
      this.settings.appLock.timeoutMinutes = [0, 1, 5].includes(Number(minutes)) ? Number(minutes) : 1;
      this.persistSettings();
    },
    focusAppLockInput() {
      nextTick(() => {
        const el = this.$refs.appLockInput;
        if (el && el.focus) el.focus();
      });
    },
    async unlockApp() {
      if (this.appLockBusy || !this.validAppLockPin(this.appLockPin)) return;
      this.appLockBusy = true;
      this.appLockError = '';
      try {
        if (!await this.verifyAppLockPin(this.appLockPin)) {
          this.appLockError = 'PIN 不正确';
          this.appLockPin = '';
          this.focusAppLockInput();
          return;
        }
        this.appLocked = false;
        this.appLockPin = '';
        this.appLockError = '';
        this.appBackgroundAt = 0;
      } catch (e) {
        this.appLockError = e.message || '无法验证 PIN';
      } finally {
        this.appLockBusy = false;
      }
    },
    noteAppBackgroundForLock() {
      const lock = this.settings.appLock || {};
      if (!lock.enabled) return;
      this.appBackgroundAt = Date.now();
      if (Number(lock.timeoutMinutes) === 0) {
        this.appLocked = true;
        this.appLockPin = '';
        this.appLockError = '';
      }
    },
    lockAppIfNeeded() {
      const lock = this.settings.appLock || {};
      if (!lock.enabled || !this.appBackgroundAt) return;
      const timeout = Math.max(0, Number(lock.timeoutMinutes) || 0) * 60000;
      if (timeout === 0 || Date.now() - this.appBackgroundAt >= timeout) {
        this.appLocked = true;
        this.appLockPin = '';
        this.appLockError = '';
        this.focusAppLockInput();
      }
      this.appBackgroundAt = 0;
    }
  };
})();
