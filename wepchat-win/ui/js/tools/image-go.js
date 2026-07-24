/* WePChat Tools — image_go (chat-mode image generation) */
'use strict';

(() => {
  const T = window.WepChatTools;

  const IMAGE_EXT = /\.(?:png|jpe?g|webp|gif|bmp|svg|avif|ico|tiff?|heic|heif)$/i;
  const DIRECT_IMAGE_REF_RE = /(?:这张|这幅|这个图|上一张|前一张|刚才那张|刚发的图|上传(?:的)?(?:图|图片|照片)|附件(?:图|图片|照片)|原图|源图|以图生图|image\s*to\s*image|img2img|reference image|uploaded image|previous image)/i;
  const IMAGE_REF_PHRASE_RE = /(?:(?:基于|根据|照着|仿照|参考).{0,12}(?:图|图片|照片|画面|原图|源图|上传|附件|image|photo|picture)|(?:图|图片|照片|画面|原图|源图|上传|附件|image|photo|picture).{0,12}(?:参考|基于|根据|照着|仿照))/i;
  const EDIT_WITH_IMAGE_TARGET_RE = /(?:(?:改|修改|编辑|重绘|替换|换成|去掉|删除|增加|添加|保留|保持).{0,12}(?:图|图片|照片|画面|主体|人物|背景|构图|姿势|风格|它|其|this image|photo|picture)|(?:图|图片|照片|画面|主体|人物|背景|构图|姿势|风格|它|其|this image|photo|picture).{0,12}(?:改|修改|编辑|重绘|替换|换成|去掉|删除|增加|添加|保留|保持))/i;
  const RECENT_IMAGE_EDIT_RE = /(?:同款|同风格|变体|保持(?:主体|人物|构图|姿势|风格)|make (?:a )?variant|same style)/i;

  function uniq(paths) {
    const out = [];
    const seen = new Set();
    (paths || []).forEach((path) => {
      const p = String(path || '').trim().replace(/\\/g, '/').replace(/^\/+/, '');
      if (!p || seen.has(p)) return;
      seen.add(p);
      out.push(p);
    });
    return out;
  }

  function pathsFromMessage(message) {
    const out = [];
    (message?.attachments || []).forEach((att) => {
      const path = String(att?.path || '').trim();
      const mime = String(att?.mime || '');
      if (att?.kind === 'image' || mime.startsWith('image/') || IMAGE_EXT.test(path)) out.push(path);
    });
    (message?.referenceFiles || []).forEach((path) => {
      if (IMAGE_EXT.test(String(path || ''))) out.push(path);
    });
    (message?.images || []).forEach((image) => {
      const path = String(image?.path || '').trim();
      if (path) out.push(path);
    });
    return out;
  }

  function latestUserImagePaths(session) {
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i];
      if (message?.role !== 'user') continue;
      const paths = uniq(pathsFromMessage(message));
      if (paths.length) return paths;
      break;
    }
    return [];
  }

  function recentImagePaths(session) {
    const messages = Array.isArray(session?.messages) ? session.messages : [];
    const out = [];
    for (let i = messages.length - 1; i >= 0 && out.length < 8; i--) {
      out.push(...pathsFromMessage(messages[i]));
    }
    return uniq(out).slice(0, 8);
  }

  function latestUserText(ctx) {
    return ctx?.session?.messages?.slice?.().reverse?.().find?.((m) => m?.role === 'user')?.content || '';
  }

  function referenceIntent(args, ctx, recentPaths) {
    const hay = [
      args.prompt,
      args.reason,
      latestUserText(ctx),
    ].filter(Boolean).join('\n');
    const hasRecentImages = Array.isArray(recentPaths) && recentPaths.length > 0;
    const explicitImageReference = DIRECT_IMAGE_REF_RE.test(hay);
    const contextualEdit = hasRecentImages && (
      IMAGE_REF_PHRASE_RE.test(hay) ||
      EDIT_WITH_IMAGE_TARGET_RE.test(hay) ||
      RECENT_IMAGE_EDIT_RE.test(hay) ||
      String(args.mode || '').toLowerCase() === 'edit'
    );
    return {
      useReference: explicitImageReference || contextualEdit || String(args.mode || '').toLowerCase() === 'edit',
      requireReference: explicitImageReference || String(args.mode || '').toLowerCase() === 'edit',
    };
  }

  function normalizeArgs(args, ctx) {
    const next = Object.assign({}, args || {});
    next.referenceFiles = uniq(next.referenceFiles || next.references || next.inputFiles || []);
    const recentPaths = recentImagePaths(ctx?.session);
    const intent = referenceIntent(next, ctx, recentPaths);
    if (!next.referenceFiles.length && intent.useReference) {
      next.referenceFiles = latestUserImagePaths(ctx?.session);
      if (!next.referenceFiles.length) next.referenceFiles = recentPaths;
    }
    if (!next.referenceFiles.length && String(next.mode || '').toLowerCase() === 'edit') {
      next.referenceFiles = recentPaths;
    }
    if (next.referenceFiles.length) next.mode = 'edit';
    else if (intent.requireReference) next.referenceMissing = true;
    return next;
  }

  T.register({
    name: 'image_go',
    aliases: ['image_generation'],
    definition: {
      name: 'image_go',
      description: '当用户明确想生成图片、以图生图或改图时，整理用户意图并交给图片模型。没有参考图时用 generate；用户上传/粘贴/提到工作区图片并要求“参考、基于这张图、修改、变体、同款、保持主体”等时用 edit，并把当前会话工作区图片路径填入 referenceFiles。若用户刚发送了图片但你不确定路径，可仍调用 edit，工具会自动使用最近用户图片附件。不要用于单纯图片分析或提示词建议。',
      parameters: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: '完整图片提示词，保留用户关键要求并补充必要视觉细节' },
          mode: { type: 'string', enum: ['generate', 'edit'], description: 'generate 文生图；edit/以图生图基于 referenceFiles 中的工作区图片。用户要求改图、参考图、基于上传图片继续生成时使用 edit。' },
          size: { type: 'string', description: '图片尺寸。优先使用明确尺寸。' },
          count: { type: 'integer', description: '生成数量，通常 1' },
          style: { type: 'string', description: '可选风格' },
          stylePresetId: { type: 'string', description: '可选，生图模式内置风格预设 id' },
          referenceFiles: {
            type: 'array',
            items: { type: 'string' },
            description: 'edit/以图生图时填写，当前会话工作区中的参考图片路径，例如 attachments/xxx.png 或 images/xxx.png。只能用工作区相对路径，不要用外部绝对路径。',
          },
          targetFile: { type: 'string', description: '可选，期望保存到工作区的文件名或路径' },
          reason: { type: 'string', description: '为什么判断需要生图' },
        },
        required: ['prompt'],
      },
    },
    async execute(args, ctx) {
      if (!window.ImageMode || typeof window.ImageMode.imageGoTool !== 'function') {
        return '错误：生图模块未加载';
      }
      const normalized = normalizeArgs(args || {}, ctx || {});
      if (normalized.referenceMissing) {
        return '错误：用户意图需要参考图片，但当前会话没有找到可用的工作区图片。请先让用户上传/粘贴图片，或用 referenceFiles 指定工作区图片路径。';
      }
      delete normalized.referenceMissing;
      return window.ImageMode.imageGoTool(normalized, ctx || {});
    },
  });
})();
