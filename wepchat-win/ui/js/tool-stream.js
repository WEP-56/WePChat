/* Stream tool-call display helpers (ported from Android app-helpers) */
'use strict';

(() => {
  function streamToolKey(step, idx) {
    return 'stream_' + step + '_' + idx;
  }

  function findToolDisplay(msg, src, key) {
    const calls = msg.toolCalls || (msg.toolCalls = []);
    return calls.find((t) => t && t._streamKey === key)
      || (src && src.id ? calls.find((t) => t && t.id === src.id) : null);
  }

  function syncStreamToolCalls(msg, tools, step) {
    if (!msg || !Array.isArray(tools) || !tools.length) return;
    const calls = msg.toolCalls || (msg.toolCalls = []);
    tools.filter(Boolean).forEach((src, idx) => {
      const key = streamToolKey(step, idx);
      let t = findToolDisplay(msg, src, key);
      if (!t) {
        t = {
          id: src.id || key,
          name: src.name || '',
          arguments: src.arguments || '',
          status: 'composing',
          result: null,
          _open: true,
          _streaming: true,
          _streamKey: key,
          _streamStep: step,
        };
        calls.push(t);
      }
      if (src.id) t.id = src.id;
      if (src.name) t.name = src.name;
      if (src.arguments != null) t.arguments = src.arguments || '';
      if (t.status !== 'running' && t.status !== 'done' && t.status !== 'error') t.status = 'composing';
      if (typeof t._open !== 'boolean') t._open = true;
      t._streaming = true;
      t._streamKey = key;
      t._streamStep = step;
    });
  }

  function clearStreamState(t) {
    delete t._streaming;
    delete t._streamKey;
    delete t._streamStep;
    return t;
  }

  function finalizeStreamToolCalls(msg, rawCalls, step) {
    const calls = msg.toolCalls || (msg.toolCalls = []);
    const displayCalls = [];
    (rawCalls || []).forEach((src, idx) => {
      const key = streamToolKey(step, idx);
      const id = src.id || ('call_' + step + '_' + idx);
      let t = findToolDisplay(msg, src, key);
      if (!t) {
        t = {
          id,
          name: src.name || '',
          arguments: src.arguments || '{}',
          status: 'running',
          result: null,
          _open: false,
        };
        calls.push(t);
      }
      t.id = id;
      t.name = src.name || t.name || '';
      t.arguments = src.arguments || t.arguments || '{}';
      t.status = 'running';
      if (t.result == null) t.result = null;
      if (typeof t._open !== 'boolean') t._open = false;
      displayCalls.push(clearStreamState(t));
    });
    for (let i = calls.length - 1; i >= 0; i--) {
      const t = calls[i];
      if (t && t._streaming && t._streamStep === step && !displayCalls.includes(t)) calls.splice(i, 1);
    }
    return displayCalls;
  }

  function discardStreamToolCalls(msg, step) {
    const calls = (msg && msg.toolCalls) || [];
    for (let i = calls.length - 1; i >= 0; i--) {
      const t = calls[i];
      if (t && t._streaming && t._streamStep === step) calls.splice(i, 1);
    }
  }

  function cancelStreamToolCalls(msg, step) {
    ((msg && msg.toolCalls) || []).forEach((t) => {
      if (!t || !t._streaming || t._streamStep !== step) return;
      t.status = 'cancelled';
      t.result = '已停止。';
      clearStreamState(t);
    });
  }

  window.ToolStream = {
    syncStreamToolCalls,
    finalizeStreamToolCalls,
    discardStreamToolCalls,
    cancelStreamToolCalls,
  };
})();
