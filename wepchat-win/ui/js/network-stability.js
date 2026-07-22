/* WepChat - unified network errors, backoff and retry policy */
'use strict';

(function () {
  const RETRY_DELAYS = [800, 1600, 3200, 6400, 10000];

  function createError(code, message, meta) {
    const err = new Error(String(message || '网络请求失败'));
    err.code = String(code || 'NET-CONNECT');
    Object.assign(err, meta || {});
    return err;
  }

  function normalizeError(err, fallbackCode) {
    if (err && err.code && err.message) return err;
    const status = Number(err && err.status) || 0;
    let code = fallbackCode || 'NET-CONNECT';
    if (status === 408) code = 'HTTP-408';
    else if (status === 429) code = 'HTTP-429';
    else if (status >= 500) code = 'HTTP-5XX';
    else if (typeof navigator !== 'undefined' && navigator.onLine === false) code = 'NET-OFFLINE';
    else if (/timeout|超时/i.test(String(err && err.message || ''))) code = 'NET-TIMEOUT';
    const out = createError(code, err && err.message || String(err || '网络请求失败'));
    if (status) out.status = status;
    if (err && err.url) out.url = err.url;
    if (err && err.body) out.body = err.body;
    if (err && err.cause) out.cause = err.cause;
    return out;
  }

  function isRetryable(err) {
    const e = normalizeError(err);
    return /^(NET-|STREAM-FIRST-BYTE-TIMEOUT|REMOTE-WS-|IMAGE-DOWNLOAD-|HTTP-(408|429|5XX))/.test(e.code) &&
      !/^(STREAM-IDLE-TIMEOUT|IMAGE-SUBMIT-UNKNOWN|IMAGE-TOO-LARGE|REMOTE-RECONNECT-EXHAUSTED)$/.test(e.code);
  }

  function delayFor(attempt) {
    const base = RETRY_DELAYS[Math.max(0, Math.min(RETRY_DELAYS.length - 1, attempt - 1))];
    return Math.round(base * (0.85 + Math.random() * 0.3));
  }

  function wait(ms, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(createError('NET-ABORTED', '用户已停止请求'));
      const timer = setTimeout(done, Math.max(0, ms || 0));
      function done() {
        if (signal) signal.removeEventListener('abort', aborted);
        resolve();
      }
      function aborted() {
        clearTimeout(timer);
        reject(createError('NET-ABORTED', '用户已停止请求'));
      }
      if (signal) signal.addEventListener('abort', aborted, { once: true });
    });
  }

  async function retry(operation, options) {
    options = options || {};
    const retries = options.retries == null ? 5 : Math.max(0, Number(options.retries) || 0);
    let lastError;
    for (let attempt = 0; attempt <= retries; attempt++) {
      if (options.signal && options.signal.aborted) throw createError('NET-ABORTED', '用户已停止请求');
      try {
        return await operation(attempt);
      } catch (err) {
        lastError = normalizeError(err, options.fallbackCode);
        const canRetry = attempt < retries && (options.shouldRetry ? options.shouldRetry(lastError, attempt) : isRetryable(lastError));
        if (!canRetry) {
          lastError.attempt = attempt;
          lastError.max = retries;
          throw lastError;
        }
        const nextAttempt = attempt + 1;
        const delay = delayFor(nextAttempt);
        if (options.onStatus) options.onStatus({
          state: 'retrying',
          code: lastError.code,
          message: lastError.message,
          attempt: nextAttempt,
          max: retries,
          delay
        });
        await wait(delay, options.signal);
      }
    }
    throw lastError || createError(options.fallbackCode || 'NET-CONNECT', '网络请求失败');
  }

  function idempotencyKey(prefix) {
    const id = window.U && U.uuid ? U.uuid() : (Date.now() + '-' + Math.random().toString(16).slice(2));
    return String(prefix || 'wepchat') + '-' + id;
  }

  function display(err) {
    const e = normalizeError(err);
    return '[' + e.code + '] ' + e.message;
  }

  window.NetStability = {
    RETRY_DELAYS: RETRY_DELAYS.slice(),
    createError,
    normalizeError,
    isRetryable,
    delayFor,
    wait,
    retry,
    idempotencyKey,
    display
  };
})();
