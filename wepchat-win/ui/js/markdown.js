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
    }
  };

  marked.use({ renderer, breaks: true, gfm: true, mangle: false, headerIds: false });

  const PURIFY_CFG = {
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel):|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);|[^a-z+.\-:]|$)/i,
    ADD_TAGS: ['button', 'svg', 'path'],
    ADD_ATTR: ['data-act', 'viewBox', 'width', 'height', 'fill', 'd', 'loading', 'target']
  };

  function render(text) {
    if (!text) return '';
    let html = '';
    try { html = marked.parse(String(text)); }
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

  return { render, renderStreaming };
})();

window.MD = MD;
