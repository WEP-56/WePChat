/* WepChat - Provider API 适配层
 * 支持四种接口：
 *  - openai-chat        OpenAI 兼容 Chat Completions（含工具调用）
 *  - openai-responses   OpenAI Responses（含工具调用）
 *  - anthropic          Anthropic Messages（含工具调用）
 *  - openai-completions 传统 Text Completions（无工具）
 * 统一输出：onUpdate({content, reasoning}) 增量回调；resolve({content, reasoning, toolCalls}) */
'use strict';

const API = (() => {

  const API_TYPES = [
    { value: 'openai-chat', label: 'Chat Completions（OpenAI 兼容）' },
    { value: 'openai-responses', label: 'Responses（OpenAI）' },
    { value: 'anthropic', label: 'Messages（Anthropic）' },
    { value: 'openai-completions', label: 'Completions（传统补全）' }
  ];

  /* ---------- URL 处理 ---------- */
  function normBase(base) {
    base = String(base || '').trim().replace(/\/+$/, '');
    return base;
  }
  /* 仅有域名时自动补 /v1；base 以 # 结尾表示“就用这个地址，不追加路径” */
  function joinUrl(base, path, opts) {
    base = normBase(base);
    if (base.endsWith('#')) return base.slice(0, -1);
    try {
      const u = new URL(base);
      let p = u.pathname.replace(/\/+$/, '');
      p = p.replace(/\/(?:v\d+\/)?(?:images\/generations|images\/edits|chat\/completions|responses|models|completions|messages)$/i, m => {
        return m.toLowerCase().startsWith('/v') ? m.split('/').slice(0, 2).join('/') : '';
      });
      if ((p === '' || p === '/') && (opts && opts.autoV1)) p = '/v1';
      u.pathname = p || '/';
      u.search = '';
      u.hash = '';
      base = u.toString().replace(/\/+$/, '');
    } catch (e) {}
    return base + path;
  }

  /* ---------- SSE 流式请求（XHR 增量解析，abort 可中断） ---------- */
  function sseOnce({ url, headers, body, onEvent, signal }) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('Accept', 'text/event-stream');
      Object.keys(headers || {}).forEach(k => { try { xhr.setRequestHeader(k, headers[k]); } catch (e) {} });

      let seen = 0, buf = '', curEvent = '', aborted = false, forcedError = null;
      let firstByteTimer = null, idleTimer = null;

      const clearTimers = () => {
        clearTimeout(firstByteTimer);
        clearTimeout(idleTimer);
      };
      const failAfter = (code, message) => {
        forcedError = NetStability.createError(code, message, { url, receivedBytes: seen });
        try { xhr.abort(); } catch (e) { clearTimers(); reject(forcedError); }
      };
      const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => failAfter('STREAM-IDLE-TIMEOUT', '流式响应超过 90 秒没有新数据'), 90000);
      };
      firstByteTimer = setTimeout(() => failAfter('STREAM-FIRST-BYTE-TIMEOUT', '等待模型首个响应超过 45 秒'), 45000);

      function feed(chunk) {
        buf += chunk;
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          let line = buf.slice(0, idx); buf = buf.slice(idx + 1);
          if (line.endsWith('\r')) line = line.slice(0, -1);
          if (line === '') { curEvent = ''; continue; }
          if (line.startsWith('event:')) { curEvent = line.slice(6).trim(); continue; }
          if (line.startsWith('data:')) {
            const data = line.slice(5).trim();
            if (data === '[DONE]') continue;
            try { onEvent(curEvent, JSON.parse(data)); } catch (e) { /* 非 JSON 行忽略 */ }
          }
        }
      }

      xhr.onprogress = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const t = xhr.responseText;
          if (t.length > seen) {
            clearTimeout(firstByteTimer);
            feed(t.slice(seen));
            seen = t.length;
            armIdle();
          }
        }
      };
      xhr.onload = () => {
        clearTimers();
        if (aborted) return;
        if (xhr.status >= 200 && xhr.status < 300) {
          const t = xhr.responseText;
          if (t.length > seen) feed(t.slice(seen));
          /* 服务端可能忽略 stream 参数直接返回 JSON */
          if (seen === 0 && t && t.trim().startsWith('{')) {
            try { onEvent('__json__', JSON.parse(t)); } catch (e) {}
          }
          resolve();
        } else {
          reject(NetStability.createError(
            xhr.status === 408 ? 'HTTP-408' : xhr.status === 429 ? 'HTTP-429' : xhr.status >= 500 ? 'HTTP-5XX' : 'HTTP-' + xhr.status,
            extractError(xhr.responseText, xhr.status),
            { status: xhr.status, url, receivedBytes: seen }
          ));
        }
      };
      xhr.onerror = () => {
        clearTimers();
        reject(NetStability.createError('NET-CONNECT', '网络请求失败，请检查网络与接口地址', { url, receivedBytes: seen }));
      };
      xhr.onabort = () => {
        clearTimers();
        aborted = true;
        if (forcedError) reject(forcedError);
        else resolve();
      };
      if (signal) {
        if (signal.aborted) { resolve(); return; }
        signal.addEventListener('abort', () => { try { xhr.abort(); } catch (e) {} });
      }
      xhr.send(JSON.stringify(body));
    });
  }

  async function sseRequest(options) {
    options = options || {};
    const headers = Object.assign({}, options.headers || {});
    headers['Idempotency-Key'] = options.requestKey || NetStability.idempotencyKey('chat');
    let retried = false;
    const result = await NetStability.retry(() => sseOnce(Object.assign({}, options, { headers })), {
      retries: 5,
      signal: options.signal,
      shouldRetry: err => !err.receivedBytes && NetStability.isRetryable(err),
      onStatus: info => {
        retried = true;
        if (options.onStatus) options.onStatus(Object.assign({ source: '模型提供商' }, info));
      }
    });
    if (retried && options.onStatus) options.onStatus({ state: 'recovered', source: '模型提供商', code: 'NET-RECOVERED', message: '模型连接已恢复' });
    return result;
  }

  function extractError(text, status) {
    let msg = 'HTTP ' + status;
    try {
      const j = JSON.parse(text);
      msg = (j.error && (j.error.message || j.error.type)) || j.message || j.detail || msg;
    } catch (e) {
      if (text) msg += ' ' + U.truncate(text.replace(/<[^>]+>/g, ' ').trim(), 200);
    }
    return msg;
  }

  function plainRequest(method, url, headers, body) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open(method, url, true);
      if (body) xhr.setRequestHeader('Content-Type', 'application/json');
      Object.keys(headers || {}).forEach(k => { try { xhr.setRequestHeader(k, headers[k]); } catch (e) {} });
      xhr.timeout = 30000;
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          try { resolve(JSON.parse(xhr.responseText)); } catch (e) { resolve(xhr.responseText); }
        } else reject(new Error(extractError(xhr.responseText, xhr.status)));
      };
      xhr.onerror = () => reject(new Error('网络请求失败'));
      xhr.ontimeout = () => reject(new Error('请求超时'));
      xhr.send(body ? JSON.stringify(body) : null);
    });
  }

  /* ---------- 附件 → 各协议格式 ---------- */
  function textWithFiles(msg) {
    let text = msg.content || '';
    (msg.attachments || []).forEach(a => {
      if (a.kind === 'text') {
        text += '\n\n[附件文件 ' + a.name + (a.path ? '，工作区路径 ' + a.path : '') + ']\n```\n' + a.content + '\n```';
      } else if (a.kind === 'image' && a.path) {
        text += '\n\n[附件图片 ' + (a.name || 'image') + '，工作区路径 ' + a.path + ']';
      }
    });
    return text;
  }
  function imagesOf(msg) {
    return (msg.attachments || []).filter(a => a.kind === 'image' && a.dataUrl);
  }
  function splitDataUrl(dataUrl) {
    const m = /^data:([^;]+);base64,(.*)$/.exec(dataUrl);
    return m ? { mime: m[1], data: m[2] } : null;
  }
  function normalizeUsage(raw) {
    raw = raw || {};
    const input = Number(raw.input_tokens != null ? raw.input_tokens : (raw.prompt_tokens != null ? raw.prompt_tokens : raw.inputTokens)) || 0;
    const output = Number(raw.output_tokens != null ? raw.output_tokens : (raw.completion_tokens != null ? raw.completion_tokens : raw.outputTokens)) || 0;
    const total = Number(raw.total_tokens != null ? raw.total_tokens : raw.totalTokens) || (input + output);
    return input || output || total ? { inputTokens: input, outputTokens: output, totalTokens: total, source: 'api' } : null;
  }

  /* ================= openai-chat ================= */
  function buildChatMessages(messages, systemPrompt) {
    const out = [];
    if (systemPrompt) out.push({ role: 'system', content: systemPrompt });
    messages.forEach(m => {
      if (m.role === 'user') {
        const imgs = imagesOf(m);
        const text = textWithFiles(m);
        if (imgs.length) {
          const parts = [{ type: 'text', text }];
          imgs.forEach(a => parts.push({ type: 'image_url', image_url: { url: a.dataUrl } }));
          out.push({ role: 'user', content: parts });
        } else out.push({ role: 'user', content: text });
      } else if (m.role === 'assistant') {
        const am = { role: 'assistant', content: m.content || '' };
        if (m.toolCalls && m.toolCalls.length) {
          am.tool_calls = m.toolCalls.map(t => ({
            id: t.id, type: 'function',
            function: { name: t.name, arguments: t.arguments || '{}' }
          }));
          if (!am.content) am.content = null;
        }
        out.push(am);
      } else if (m.role === 'tool') {
        out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content || '' });
      }
    });
    return out;
  }

  async function sendOpenAIChat(ctx) {
    const { provider, model, messages, tools, settings, signal, onUpdate } = ctx;
    const body = {
      model,
      messages: buildChatMessages(messages, settings.systemPrompt),
      stream: true
    };
    if (settings.temperature != null) body.temperature = settings.temperature;
    if (settings.maxTokens) body.max_tokens = settings.maxTokens;
    if (tools && tools.length) {
      body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
    }
    const st = { content: '', reasoning: '', toolCalls: [], usage: null };
    const applyJson = (msg) => {
      if (!msg) return;
      st.content += msg.content || '';
      st.reasoning += msg.reasoning_content || msg.reasoning || '';
      (msg.tool_calls || []).forEach(tc => st.toolCalls.push({ id: tc.id, name: tc.function.name, arguments: tc.function.arguments }));
    };
    await sseRequest({
      url: joinUrl(provider.baseUrl, '/chat/completions', { autoV1: true }),
      headers: authHeaders(provider),
      body, signal, onStatus: ctx.onStatus, requestKey: ctx.requestKey,
      onEvent(ev, data) {
        if (data && data.usage) st.usage = normalizeUsage(data.usage) || st.usage;
        if (ev === '__json__') { applyJson(data.choices && data.choices[0] && data.choices[0].message); onUpdate(st); return; }
        const ch = data.choices && data.choices[0];
        if (!ch) return;
        const d = ch.delta || {};
        if (d.content) st.content += d.content;
        if (d.reasoning_content) st.reasoning += d.reasoning_content;
        else if (d.reasoning) st.reasoning += d.reasoning;
        (d.tool_calls || []).forEach(tc => {
          const i = tc.index != null ? tc.index : st.toolCalls.length;
          if (!st.toolCalls[i]) st.toolCalls[i] = { id: '', name: '', arguments: '' };
          if (tc.id) st.toolCalls[i].id = tc.id;
          if (tc.function) {
            if (tc.function.name) st.toolCalls[i].name += tc.function.name;
            if (tc.function.arguments) st.toolCalls[i].arguments += tc.function.arguments;
          }
        });
        if (d.tool_calls && d.tool_calls.length) st.streamTools = st.toolCalls.filter(Boolean);
        onUpdate(st);
      }
    });
    delete st.streamTools;
    st.toolCalls = st.toolCalls.filter(Boolean).map((t, i) => ({ id: t.id || ('call_' + i), name: t.name, arguments: t.arguments || '{}' }));
    return st;
  }

  /* ================= openai-responses ================= */
  function buildResponsesInput(messages) {
    const out = [];
    messages.forEach(m => {
      if (m.role === 'user') {
        const parts = [{ type: 'input_text', text: textWithFiles(m) }];
        imagesOf(m).forEach(a => parts.push({ type: 'input_image', image_url: a.dataUrl }));
        out.push({ role: 'user', content: parts });
      } else if (m.role === 'assistant') {
        if (m.content) out.push({ role: 'assistant', content: [{ type: 'output_text', text: m.content }] });
        (m.toolCalls || []).forEach(t => out.push({ type: 'function_call', call_id: t.id, name: t.name, arguments: t.arguments || '{}' }));
      } else if (m.role === 'tool') {
        out.push({ type: 'function_call_output', call_id: m.toolCallId, output: m.content || '' });
      }
    });
    return out;
  }

  async function sendResponses(ctx) {
    const { provider, model, messages, tools, settings, signal, onUpdate } = ctx;
    const body = { model, input: buildResponsesInput(messages), stream: true };
    if (settings.systemPrompt) body.instructions = settings.systemPrompt;
    if (settings.temperature != null) body.temperature = settings.temperature;
    if (settings.maxTokens) body.max_output_tokens = settings.maxTokens;
    if (tools && tools.length) {
      body.tools = tools.map(t => ({ type: 'function', name: t.name, description: t.description, parameters: t.parameters }));
    }
    const st = { content: '', reasoning: '', toolCalls: [], usage: null };
    const pending = {}; // item_id -> toolCall
    const streamTools = () => st.toolCalls.concat(Object.keys(pending).map(k => pending[k]));
    await sseRequest({
      url: joinUrl(provider.baseUrl, '/responses', { autoV1: true }),
      headers: authHeaders(provider),
      body, signal, onStatus: ctx.onStatus, requestKey: ctx.requestKey,
      onEvent(ev, data) {
        const type = data.type || ev;
        const rawUsage = data.usage || (data.response && data.response.usage);
        if (rawUsage) st.usage = normalizeUsage(rawUsage) || st.usage;
        if (type === 'response.output_text.delta') { st.content += data.delta || ''; onUpdate(st); }
        else if (type === 'response.reasoning_summary_text.delta' || type === 'response.reasoning_text.delta') { st.reasoning += data.delta || ''; onUpdate(st); }
        else if (type === 'response.output_item.added' && data.item && data.item.type === 'function_call') {
          pending[data.item.id] = { id: data.item.call_id || data.item.id, name: data.item.name || '', arguments: data.item.arguments || '' };
          st.streamTools = streamTools();
          onUpdate(st);
        }
        else if (type === 'response.function_call_arguments.delta' && pending[data.item_id]) {
          pending[data.item_id].arguments += data.delta || '';
          st.streamTools = streamTools();
          onUpdate(st);
        }
        else if (type === 'response.output_item.done' && data.item && data.item.type === 'function_call') {
          const t = pending[data.item.id] || { id: data.item.call_id, name: data.item.name, arguments: '' };
          t.name = data.item.name || t.name;
          t.arguments = data.item.arguments || t.arguments || '{}';
          st.toolCalls.push(t); delete pending[data.item.id];
          st.streamTools = streamTools();
          onUpdate(st);
        }
        else if (type === '__json__') {
          (data.output || []).forEach(item => {
            if (item.type === 'message') (item.content || []).forEach(c => { if (c.type === 'output_text') st.content += c.text || ''; });
            if (item.type === 'function_call') st.toolCalls.push({ id: item.call_id, name: item.name, arguments: item.arguments || '{}' });
          });
          onUpdate(st);
        }
      }
    });
    Object.keys(pending).forEach(k => st.toolCalls.push(pending[k]));
    delete st.streamTools;
    return st;
  }

  /* ================= anthropic ================= */
  function buildAnthropicMessages(messages) {
    const out = [];
    messages.forEach(m => {
      if (m.role === 'user') {
        const parts = [];
        imagesOf(m).forEach(a => {
          const s = splitDataUrl(a.dataUrl);
          if (s) parts.push({ type: 'image', source: { type: 'base64', media_type: s.mime, data: s.data } });
        });
        parts.push({ type: 'text', text: textWithFiles(m) });
        out.push({ role: 'user', content: parts });
      } else if (m.role === 'assistant') {
        const parts = [];
        if (m.content) parts.push({ type: 'text', text: m.content });
        (m.toolCalls || []).forEach(t => {
          let input = {};
          try { input = JSON.parse(t.arguments || '{}'); } catch (e) {}
          parts.push({ type: 'tool_use', id: t.id, name: t.name, input });
        });
        if (parts.length) out.push({ role: 'assistant', content: parts });
      } else if (m.role === 'tool') {
        /* Anthropic 的 tool_result 放在 user 消息里；相邻的合并 */
        const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content || '' };
        const last = out[out.length - 1];
        if (last && last.role === 'user' && Array.isArray(last.content) && last.content[0] && last.content[0].type === 'tool_result') {
          last.content.push(block);
        } else out.push({ role: 'user', content: [block] });
      }
    });
    return out;
  }

  function anthropicUrl(base) {
    base = normBase(base);
    if (base.endsWith('#')) return base.slice(0, -1);
    if (/\/v1$/.test(base)) return base + '/messages';
    return base + '/v1/messages';
  }

  async function sendAnthropic(ctx) {
    const { provider, model, messages, tools, settings, signal, onUpdate } = ctx;
    const body = {
      model,
      messages: buildAnthropicMessages(messages),
      max_tokens: settings.maxTokens || 8192,
      stream: true
    };
    if (settings.systemPrompt) body.system = settings.systemPrompt;
    if (settings.temperature != null) body.temperature = settings.temperature;
    if (tools && tools.length) {
      body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    }
    const headers = {
      'x-api-key': provider.apiKey || '',
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    };
    const st = { content: '', reasoning: '', toolCalls: [], usage: null };
    const blocks = {}; // index -> {type, tool}
    const streamTools = () => st.toolCalls.concat(Object.keys(blocks).map(k => blocks[k]).filter(b => b && b.tool).map(b => b.tool));
    await sseRequest({
      url: anthropicUrl(provider.baseUrl),
      headers, body, signal, onStatus: ctx.onStatus, requestKey: ctx.requestKey,
      onEvent(ev, data) {
        const type = data.type || ev;
        const rawUsage = data.usage || (data.message && data.message.usage);
        if (rawUsage) {
          const usage = normalizeUsage(rawUsage);
          if (usage) {
            st.usage = st.usage || { inputTokens: 0, outputTokens: 0, totalTokens: 0, source: 'api' };
            if (usage.inputTokens) st.usage.inputTokens = usage.inputTokens;
            if (usage.outputTokens) st.usage.outputTokens = usage.outputTokens;
            st.usage.totalTokens = st.usage.inputTokens + st.usage.outputTokens;
          }
        }
        if (type === 'content_block_start') {
          const b = data.content_block || {};
          blocks[data.index] = b.type === 'tool_use'
            ? { type: 'tool_use', tool: { id: b.id, name: b.name, arguments: '' } }
            : { type: b.type };
          if (b.type === 'tool_use') {
            st.streamTools = streamTools();
            onUpdate(st);
          }
        } else if (type === 'content_block_delta') {
          const d = data.delta || {}, blk = blocks[data.index] || {};
          if (d.type === 'text_delta') st.content += d.text || '';
          else if (d.type === 'thinking_delta') st.reasoning += d.thinking || '';
          else if (d.type === 'input_json_delta' && blk.tool) {
            blk.tool.arguments += d.partial_json || '';
            st.streamTools = streamTools();
          }
          onUpdate(st);
        } else if (type === 'content_block_stop') {
          const blk = blocks[data.index];
          delete blocks[data.index];
          if (blk && blk.tool) {
            st.toolCalls.push(blk.tool);
            st.streamTools = streamTools();
            onUpdate(st);
          }
        } else if (type === '__json__') {
          (data.content || []).forEach(b => {
            if (b.type === 'text') st.content += b.text || '';
            if (b.type === 'tool_use') st.toolCalls.push({ id: b.id, name: b.name, arguments: JSON.stringify(b.input || {}) });
          });
          onUpdate(st);
        }
      }
    });
    delete st.streamTools;
    st.toolCalls.forEach(t => { if (!t.arguments) t.arguments = '{}'; });
    return st;
  }

  /* ================= openai-completions ================= */
  async function sendCompletions(ctx) {
    const { provider, model, messages, settings, signal, onUpdate } = ctx;
    let prompt = '';
    if (settings.systemPrompt) prompt += settings.systemPrompt + '\n\n';
    messages.forEach(m => {
      if (m.role === 'user') prompt += 'User: ' + textWithFiles(m) + '\n';
      else if (m.role === 'assistant' && m.content) prompt += 'Assistant: ' + m.content + '\n';
    });
    prompt += 'Assistant:';
    const body = { model, prompt, stream: true, max_tokens: settings.maxTokens || 2048 };
    if (settings.temperature != null) body.temperature = settings.temperature;
    const st = { content: '', reasoning: '', toolCalls: [], usage: null };
    await sseRequest({
      url: joinUrl(provider.baseUrl, '/completions', { autoV1: true }),
      headers: authHeaders(provider),
      body, signal, onStatus: ctx.onStatus, requestKey: ctx.requestKey,
      onEvent(ev, data) {
        if (data && data.usage) st.usage = normalizeUsage(data.usage) || st.usage;
        const ch = data.choices && data.choices[0];
        if (ch && ch.text) { st.content += ch.text; onUpdate(st); }
        if (ev === '__json__' && ch && ch.text) { st.content = ch.text; onUpdate(st); }
      }
    });
    return st;
  }

  function authHeaders(provider) {
    const h = {};
    if (provider.apiKey) h['Authorization'] = 'Bearer ' + provider.apiKey;
    (provider.extraHeaders || []).forEach(x => { if (x.k) h[x.k] = x.v || ''; });
    return h;
  }

  /* ---------- 对外接口 ---------- */
  function send(ctx) {
    switch (ctx.provider.api) {
      case 'openai-responses': return sendResponses(ctx);
      case 'anthropic': return sendAnthropic(ctx);
      case 'openai-completions': return sendCompletions(ctx);
      default: return sendOpenAIChat(ctx);
    }
  }

  async function listModelsDetailed(provider) {
    let url, headers;
    if (provider.api === 'anthropic') {
      const base = normBase(provider.baseUrl);
      url = (/\/v1$/.test(base) ? base : base + '/v1') + '/models';
      headers = { 'x-api-key': provider.apiKey || '', 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    } else {
      url = joinUrl(provider.baseUrl, '/models', { autoV1: true });
      headers = authHeaders(provider);
    }
    const res = await plainRequest('GET', url, headers);
    const arr = Array.isArray(res) ? res : ((res && (res.data || res.models)) || []);
    return arr.slice().sort((a, b) => {
      const ai = typeof a === 'string' ? a : (a && (a.id || a.name || a.model)) || '';
      const bi = typeof b === 'string' ? b : (b && (b.id || b.name || b.model)) || '';
      return String(ai).localeCompare(String(bi));
    });
  }

  async function listModels(provider) {
    const arr = await listModelsDetailed(provider);
    return arr.map(m => typeof m === 'string' ? m : (m && (m.id || m.name || m.model))).filter(Boolean);
  }

  return { API_TYPES, send, listModels, listModelsDetailed, supportsTools: p => p.api !== 'openai-completions' };
})();

window.API = API;
