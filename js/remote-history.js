/* WepChat - Codex remote history normalization */
'use strict';

(function () {
  function text(value, depth) {
    if (value == null || depth > 5) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(v => text(v, depth + 1)).filter(Boolean).join('\n\n');
    if (typeof value !== 'object') return '';

    ['text', 'message', 'content', 'delta'].some(key => {
      if (typeof value[key] === 'string') {
        value = value[key];
        return true;
      }
      return false;
    });
    if (typeof value === 'string') return value;

    const nested = ['text', 'message', 'content', 'text_elements', 'parts', 'items', 'input', 'output', 'messages'];
    for (const key of nested) {
      if (value[key] != null) {
        const found = text(value[key], depth + 1);
        if (found) return found;
      }
    }
    return '';
  }

  function role(item) {
    item = item || {};
    const raw = String(item.role || item.type || item.kind || item.name || '').toLowerCase();
    if (/user|input/.test(raw) && !/assistant|agent/.test(raw)) return 'user';
    if (/assistant|agent/.test(raw)) return 'assistant';
    return '';
  }

  function time(util, item) {
    const raw = item && (item.createdAt || item.updatedAt || item.timestamp || item.at);
    if (!raw) return util.now();
    if (typeof raw === 'number') return raw > 100000000000 ? raw : raw * 1000;
    const parsed = Date.parse(raw);
    return Number.isFinite(parsed) ? parsed : util.now();
  }

  function message(util, msgRole, content, at) {
    const msg = {
      id: util.uuid(),
      role: msgRole,
      content: String(content || '').trim(),
      attachments: [],
      createdAt: at || util.now()
    };
    if (msgRole === 'assistant') {
      msg.status = 'done';
      msg.model = 'Codex';
      msg.toolCalls = [];
      msg.previews = [];
    }
    return msg;
  }

  function turns(source) {
    const roots = [source, source && source.read, source && source.resumed, source && source.thread, source && source.data].filter(Boolean);
    const out = [];
    roots.forEach(root => {
      if (Array.isArray(root.turns)) out.push(...root.turns);
      if (root.thread && Array.isArray(root.thread.turns)) out.push(...root.thread.turns);
    });
    const seen = new Set();
    return out.filter(t => {
      const key = t && (t.id || t.turnId || JSON.stringify(t).slice(0, 80));
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function messagesFromResult(util, source) {
    const out = [];
    turns(source).forEach(turn => {
      const at = time(util, turn);
      const rows = Array.isArray(turn.messages) ? turn.messages : (Array.isArray(turn.items) ? turn.items : []);
      if (rows.length) {
        rows.forEach(item => {
          const itemRole = role(item);
          if (itemRole !== 'user' && itemRole !== 'assistant') return;
          const itemText = text(item, 0);
          if (itemText && itemText.trim()) out.push(message(util, itemRole, itemText, time(util, item) || at));
        });
        return;
      }

      const userText = text(turn.input || turn.userMessage || turn.user_message || turn.prompt || turn.request, 0);
      if (userText && userText.trim()) out.push(message(util, 'user', userText, at));

      const outputRows = Array.isArray(turn.output) ? turn.output : (Array.isArray(turn.response) ? turn.response : []);
      if (outputRows.length) {
        let pushedAssistant = false;
        outputRows.forEach(item => {
          if (role(item) !== 'assistant') return;
          const itemText = text(item, 0);
          if (itemText && itemText.trim()) {
            out.push(message(util, 'assistant', itemText, time(util, item) || at));
            pushedAssistant = true;
          }
        });
        if (pushedAssistant) return;
      }

      const assistantText = text(turn.output || turn.response || turn.assistantMessage || turn.assistant_message || turn.agentMessage || turn.agent_message, 0);
      if (assistantText && assistantText.trim()) out.push(message(util, 'assistant', assistantText, at));
    });
    return out.filter(m => m.content);
  }

  window.RemoteHistory = {
    threadLabel(util, thread) {
      thread = thread || {};
      return util.truncate(thread.name || thread.preview || thread.id || 'Codex 会话', 18);
    },
    threadMeta(util, thread) {
      thread = thread || {};
      const rawTime = thread.updatedAt || thread.recencyAt || thread.createdAt || 0;
      const parts = [];
      if (rawTime) parts.push(util.fmtTime(typeof rawTime === 'number' && rawTime < 100000000000 ? rawTime * 1000 : rawTime));
      if (thread.cwd) parts.push(thread.cwd);
      return parts.join(' · ');
    },
    messagesFromResult
  };
})();
