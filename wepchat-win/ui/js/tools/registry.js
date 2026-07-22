/* WePChat Tools — registry */
'use strict';

(() => {
  const entries = new Map();
  const definitions = [];

  const registry = {
    MAX_OUTPUT: 16 * 1024,
    MAX_FILE: 512 * 1024,
    MAX_FILES: 200,
    JS_TIMEOUT: 8000,
    RUN_JS_FS_LIMIT: 1024 * 1024,
    WEB_FETCH_TIMEOUT: 20000,
    SYSTEM_HINT: '',
    register(spec) {
      if (!spec || !spec.name || typeof spec.execute !== 'function') {
        throw new Error('无效工具注册');
      }
      const names = [spec.name].concat(spec.aliases || []);
      names.forEach((name) => {
        if (entries.has(name)) throw new Error('工具重复注册: ' + name);
        entries.set(name, spec);
      });
      if (spec.definition) {
        if (spec.definition.name !== spec.name) {
          throw new Error('工具 definition.name 不匹配: ' + spec.name);
        }
        definitions.push(spec.definition);
      }
    },
    definitions() {
      return definitions.slice();
    },
    names() {
      return Array.from(entries.keys());
    },
  };

  function resolveToolReferences(value, ctx) {
    const results = (ctx && ctx.previousResults) || [];
    if (!results.length) return value;
    if (typeof value === 'string') {
      return value.replace(/\{\{\s*prev\.result\s*\}\}/g, String(results[results.length - 1].result || ''));
    }
    if (Array.isArray(value)) return value.map((v) => resolveToolReferences(v, ctx));
    if (value && typeof value === 'object') {
      const copy = {};
      Object.keys(value).forEach((k) => {
        copy[k] = resolveToolReferences(value[k], ctx);
      });
      return copy;
    }
    return value;
  }

  /**
   * ctx: {
   *   sessionId, session, confirm(msg):Promise<bool>,
   *   openPreview, previousResults, webFetchMode,
   *   onWorkspaceChanged
   * }
   * Returns string tool result for the model.
   */
  registry.execute = async function (name, argsJson, ctx) {
    let args = {};
    try {
      args = typeof argsJson === 'string'
        ? (argsJson.trim() ? JSON.parse(argsJson) : {})
        : (argsJson || {});
    } catch (e) {
      return '错误：工具参数不是有效 JSON - ' + e.message;
    }
    args = resolveToolReferences(args, ctx || {});
    const spec = entries.get(name);
    if (!spec) return '错误：未知工具 ' + name;
    try {
      return await spec.execute(args, ctx || {});
    } catch (e) {
      return '错误：' + ((e && e.message) || String(e));
    }
  };

  window.WepChatTools = registry;
})();
