/* WepChat - Markdown 渲染管线：marked + highlight.js + DOMPurify */
'use strict';

const MD = (() => {
  const PREVIEWABLE = /^(html|htm|xml|svg|vue)$/i;

  const renderer = {
    code(code, infostring) {
      const lang = (infostring || '').trim().split(/\s+/)[0] || '';
      let body = '';
      try {
        if (lang && hljs.getLanguage(lang)) {
          body = hljs.highlight(code, { language: lang, ignoreIllegals: true }).value;
        } else {
          body = U.escapeHtml(code);
        }
      } catch (e) { body = U.escapeHtml(code); }
      const canPreview = PREVIEWABLE.test(lang);
      return '<div class="code-block">' +
        '<div class="code-head"><span class="code-lang">' + U.escapeHtml(lang || 'text') + '</span>' +
        '<span class="code-actions">' +
        (canPreview ? '<button type="button" class="code-btn" data-act="preview">运行</button>' : '') +
        '<button type="button" class="code-btn" data-act="copy">复制</button>' +
        '</span></div>' +
        '<pre><code class="hljs">' + body + '</code></pre></div>';
    },
    link(href, title, text) {
      const t = title ? ' title="' + U.escapeHtml(title) + '"' : '';
      return '<a class="md-link" href="' + U.escapeHtml(href || '') + '"' + t + '>' + text +
        '<svg class="lnk-ic" viewBox="0 0 24 24" width="12" height="12"><path fill="currentColor" d="M14 3h7v7h-2V6.4l-9.3 9.3-1.4-1.4L17.6 5H14V3zM5 5h6v2H7v10h10v-4h2v6H5V5z"/></svg></a>';
    },
    image(href, title, text) {
      return '<img class="md-img" loading="lazy" src="' + U.escapeHtml(href || '') + '" alt="' + U.escapeHtml(text || '') + '"' +
        (title ? ' title="' + U.escapeHtml(title) + '"' : '') + '>';
    },
    table(header, body) {
      return '<div class="tbl-wrap"><table><thead>' + header + '</thead><tbody>' + body + '</tbody></table></div>';
    },
    checkbox(checked) {
      return '<input class="task-list-checkbox" type="checkbox" disabled=""' +
        (checked ? ' checked=""' : '') + '>';
    }
  };

  marked.use({ renderer, breaks: true, gfm: true, mangle: false, headerIds: false });

  const PURIFY_CFG = {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);|[^a-z+.\-:]|$)/i,
    ADD_TAGS: ['button', 'svg', 'path'],
    ADD_ATTR: ['data-act', 'viewBox', 'width', 'height', 'fill', 'd', 'loading', 'target']
  };

  function renderMath(root) {
    if (!root) return;
    root.querySelectorAll('input.task-list-checkbox, li > input[type="checkbox"]').forEach((input) => {
      input.classList.add('task-list-checkbox');
      input.type = 'checkbox';
      input.disabled = true;
      const item = input.closest('li');
      item?.classList.add('task-list-item');
      item?.parentElement?.classList.add('contains-task-list');
    });
    if (typeof renderMathInElement !== 'function') return;
    try {
      renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '\\[', right: '\\]', display: true },
          { left: '\\(', right: '\\)', display: false },
          { left: '$', right: '$', display: false },
        ],
        throwOnError: false,
        trust: false,
        strict: 'ignore',
      });
    } catch (e) {
      console.warn('render math', e);
    }
  }

  function prepareMarkdown(text) {
    const lines = String(text).split(/\r?\n/);
    const out = [];
    let fence = null;
    let mathBlock = null;

    const prepareLine = (line) => {
      // marked 会吞掉 \(...\) / \[...\] 的反斜杠；实体写入 DOM 后会还原，供 KaTeX 识别。
      let prepared = line.replace(/\\([()[\]])/g, '&#92;$1');
      // GFM 不把完全空的 `1. [ ]` 当任务项；补零宽字符保持视觉为空并触发任务列表语法。
      if (/^\s{0,3}(?:[-+*]|\d+[.)])\s+\[[ xX]\]\s*$/.test(prepared)) prepared += ' \u200b';
      return prepared;
    };

    const finishMathBlock = () => {
      const tex = U.escapeHtml(mathBlock.lines.join(' ').trim());
      const left = mathBlock.kind === 'bracket' ? '\\[' : '$$';
      const right = mathBlock.kind === 'bracket' ? '\\]' : '$$';
      // 单个 HTML 文本节点避免 breaks:true 插入 <br>，KaTeX 才能跨原始多行内容匹配。
      out.push(`<div class="math-source">${left}${tex}${right}</div>`);
      mathBlock = null;
    };

    for (const line of lines) {
      if (mathBlock) {
        const closed = mathBlock.kind === 'bracket'
          ? /^\s*\\\]\s*$/.test(line)
          : /^\s*\$\$\s*$/.test(line);
        if (closed) finishMathBlock();
        else mathBlock.lines.push(line);
        continue;
      }

      const match = line.match(/^\s{0,3}(`{3,}|~{3,})/);
      if (match) {
        const marker = match[1][0];
        const length = match[1].length;
        if (!fence) fence = { marker, length };
        else if (fence.marker === marker && length >= fence.length) fence = null;
        out.push(line);
        continue;
      }
      if (fence) {
        out.push(line);
        continue;
      }
      if (/^\s*\\\[\s*$/.test(line)) {
        mathBlock = { kind: 'bracket', lines: [] };
        continue;
      }
      if (/^\s*\$\$\s*$/.test(line)) {
        mathBlock = { kind: 'dollar', lines: [] };
        continue;
      }
      out.push(prepareLine(line));
    }

    if (mathBlock) {
      out.push(mathBlock.kind === 'bracket' ? '&#92;[' : '$$', ...mathBlock.lines.map(prepareLine));
    }
    return out.join('\n');
  }

  function render(text) {
    if (!text) return '';
    let html = '';
    try { html = marked.parse(prepareMarkdown(text)); }
    catch (e) { html = '<p>' + U.escapeHtml(String(text)) + '</p>'; }
    return DOMPurify.sanitize(html, PURIFY_CFG);
  }

  /* 流式过程中的轻量渲染：闭合未完成的代码围栏避免闪烁 */
  function renderStreaming(text) {
    if (!text) return '';
    const fences = (String(text).match(/```/g) || []).length;
    if (fences % 2 === 1) text += '\n```';
    return render(text);
  }

  /* 顶层块拆分：供流式期间的块级缓存使用。
   * 内容 append-only 时除末块外 raw 都稳定，逐块比对即可跳过已完成块。 */
  function lexBlocks(text) {
    const src = String(text || '');
    if (!src) return [];
    let tokens;
    try { tokens = marked.lexer(src); }
    catch (e) { return [{ raw: src, type: 'paragraph', lang: '', text: '' }]; }
    return tokens.map((t) => ({
      raw: t.raw || '',
      type: t.type || '',
      lang: t.type === 'code' ? String(t.lang || '').trim().split(/\s+/)[0] : '',
      text: t.type === 'code' ? String(t.text || '') : '',
    }));
  }

  /* 渲染单个顶层块（parse + sanitize）。引用式链接等跨块语法在完成态的整篇渲染中兜底。 */
  function renderBlock(raw) {
    return render(raw);
  }

  function isPreviewableLang(lang) {
    return PREVIEWABLE.test(String(lang || ''));
  }

  return { render, renderStreaming, renderMath, lexBlocks, renderBlock, isPreviewableLang };
})();

window.MD = MD;
