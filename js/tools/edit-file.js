/* WepChat Tool - edit_file */
'use strict';

(() => {

  const T = window.WepChatTools;
  const { ensureWorkspace, safeName, textMime, diffText, notFoundError } = T.workspace;
  const { MAX_FILE } = T;

  function regexReplace(before, find, replace, args) {
    let flags = String(args.flags || args.regexFlags || '').replace(/[^gimsuy]/g, '');
    flags = flags.replace(/g/g, '');
    if (args.all) flags += 'g';
    let re;
    try { re = new RegExp(find, flags); }
    catch (e) { throw new Error('正则表达式无效: ' + e.message); }
    if (!re.test(before)) throw notFoundError(before);
    re.lastIndex = 0;
    return before.replace(re, replace);
  }
  
  function whitespaceIndex(text) {
    const chars = [], map = [];
    String(text || '').split('').forEach((ch, i) => {
      if (!/\s/.test(ch)) {
        chars.push(ch);
        map.push(i);
      }
    });
    return { text: chars.join(''), map };
  }
  
  function replaceIgnoringWhitespace(before, find, replace, all) {
    const hay = whitespaceIndex(before);
    const needle = String(find || '').replace(/\s+/g, '');
    if (!needle) throw new Error('ignoreWhitespace 模式下 find 不能只包含空白字符');
    const spans = [];
    let pos = 0;
    while (pos <= hay.text.length) {
      const idx = hay.text.indexOf(needle, pos);
      if (idx < 0) break;
      spans.push([hay.map[idx], hay.map[idx + needle.length - 1] + 1]);
      if (!all) break;
      pos = idx + Math.max(needle.length, 1);
    }
    if (!spans.length) throw notFoundError(before);
    let out = '', last = 0;
    spans.forEach(span => {
      out += before.slice(last, span[0]) + replace;
      last = span[1];
    });
    return out + before.slice(last);
  }
  
  function fEditFile(session, args) {
    ensureWorkspace(session);
    const name = safeName(args.path);
    const f = session.files[name];
    if (!f) throw new Error('文件不存在: ' + name + '。请先 list_files 或 write_file。');
    if (f.dataUrl && !f.content) throw new Error('该文件是二进制文件，无法以文本修改');
    const find = String(args.find == null ? '' : args.find);
    const replace = String(args.replace == null ? '' : args.replace);
    if (!find) throw new Error('缺少 find 参数');
    if (args.useRegex && args.ignoreWhitespace) throw new Error('useRegex 和 ignoreWhitespace 不能同时使用，请二选一');
    const before = String(f.content || '');
    let after;
    if (args.useRegex) after = regexReplace(before, find, replace, args);
    else if (args.ignoreWhitespace) after = replaceIgnoringWhitespace(before, find, replace, !!args.all);
    else {
      if (!before.includes(find)) throw notFoundError(before);
      after = args.all ? before.split(find).join(replace) : before.replace(find, replace);
    }
    if (after.length > MAX_FILE) throw new Error('内容超过 ' + U.fmtSize(MAX_FILE) + ' 上限');
    f.content = after;
    f.size = after.length;
    f.mtime = U.now();
    f.mime = f.mime || textMime(name);
    const mode = args.useRegex ? '正则' : (args.ignoreWhitespace ? '忽略空白' : '精确');
    return '已修改 ' + name + '（' + mode + '，' + (args.all ? '全部匹配' : '首个匹配') + '）\n\n' + diffText(name, before, after);
  }

  T.register({
    name: 'edit_file',
    definition: {
  "name": "edit_file",
  "description": "修改当前会话工作区中的已有文本文件。先 read_file 获取最新内容，再用 find/replace 做小范围改动。默认精确匹配；匹配失败会返回文件前 200 字符帮助修正。可传 useRegex: true 使用正则，或 ignoreWhitespace: true 忽略空白差异。",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {
        "type": "string",
        "description": "工作区文件路径"
      },
      "find": {
        "type": "string",
        "description": "要查找的原文片段。默认必须精确匹配；useRegex 为 true 时是 JavaScript 正则表达式；ignoreWhitespace 为 true 时会忽略空格、制表和换行差异。"
      },
      "replace": {
        "type": "string",
        "description": "替换后的文本"
      },
      "all": {
        "type": "boolean",
        "description": "是否替换全部匹配，默认 false"
      },
      "useRegex": {
        "type": "boolean",
        "description": "可选，true 时按 JavaScript 正则表达式匹配 find"
      },
      "regexFlags": {
        "type": "string",
        "description": "可选正则 flags，例如 i、m、s。all 为 true 时会自动使用 g。"
      },
      "ignoreWhitespace": {
        "type": "boolean",
        "description": "可选，true 时忽略 find 与文件内容之间的空白差异，适合缩进或换行不确定的小改动。不要和 useRegex 同时使用。"
      }
    },
    "required": [
      "path",
      "find",
      "replace"
    ]
  }
},
    execute(args, ctx) {
      return fEditFile(ctx.session, args);
    }
  });
})();
