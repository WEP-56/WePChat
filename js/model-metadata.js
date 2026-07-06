/* WepChat - model metadata registry and client-side token estimates */
'use strict';

const MODEL_META = (() => {
  const DEFAULT_CONTEXT = 128000;
  const DEFAULT_MAX_OUTPUT = 8192;

  const CAP_DEFAULTS = {
    text: true,
    vision: false,
    reasoning: false,
    tools: true,
    imageGeneration: false,
    imageEdit: false,
    structuredOutput: true
  };

  const SOURCES = [
    'https://platform.openai.com/docs/models',
    'https://docs.anthropic.com/en/docs/about-claude/models',
    'https://api-docs.deepseek.com/quick_start/pricing',
    'https://api-docs.deepseek.com/',
    'https://help.aliyun.com/zh/model-studio/models',
    'https://help.aliyun.com/en/model-studio/coding-plan',
    'https://docs.qwencloud.com/developer-guides/getting-started/vision-models',
    'https://docs.bigmodel.cn/cn/guide/models',
    'https://platform.moonshot.cn/docs/pricing/chat',
    'https://help.aliyun.com/en/model-studio/kimi-api-by-moonshot-ai',
    'https://www.minimaxi.com/document/platform/overview',
    'https://platform.minimaxi.com/docs/api-reference/api-overview',
    'https://www.volcengine.com/docs/82379',
    'https://developer.volcengine.com/articles/7518983626017472553',
    'https://ai.google.dev/gemini-api/docs/models',
    'https://www.llama.com/models/',
    'https://github.com/ollama/ollama/blob/main/docs/api.md'
  ];

  const BUILTIN = [
    /* OpenAI */
    m('gpt-5.6-sol', 'OpenAI', 400000, 128000, { vision: true, reasoning: true }),
    m('gpt-5.6-sol-preview', 'OpenAI', 400000, 128000, { vision: true, reasoning: true }),
    m('gpt-5.5', 'OpenAI', 400000, 128000, { vision: true, reasoning: true }),
    m('gpt-5.5-codex', 'OpenAI', 400000, 128000, { vision: true, reasoning: true }),
    m('gpt-5', 'OpenAI', 400000, 128000, { vision: true, reasoning: true }),
    m('gpt-5-mini', 'OpenAI', 400000, 128000, { vision: true, reasoning: true }),
    m('gpt-5-nano', 'OpenAI', 400000, 128000, { vision: true, reasoning: true }),
    m('gpt-4.1', 'OpenAI', 1047576, 32768, { vision: true }),
    m('gpt-4.1-mini', 'OpenAI', 1047576, 32768, { vision: true }),
    m('gpt-4.1-nano', 'OpenAI', 1047576, 32768, { vision: true }),
    m('gpt-4o', 'OpenAI', 128000, 16384, { vision: true }),
    m('gpt-4o-mini', 'OpenAI', 128000, 16384, { vision: true }),
    m('o3', 'OpenAI', 200000, 100000, { vision: true, reasoning: true }),
    m('o3-mini', 'OpenAI', 200000, 100000, { reasoning: true }),
    m('o4-mini', 'OpenAI', 200000, 100000, { vision: true, reasoning: true }),
    m('dall-e-3', 'OpenAI', 4000, 0, { tools: false, structuredOutput: false, imageGeneration: true }),
    m('gpt-image-2', 'OpenAI', 32000, 0, { vision: true, tools: false, structuredOutput: false, imageGeneration: true, imageEdit: true }),
    m('gpt-image-1', 'OpenAI', 32000, 0, { vision: true, tools: false, structuredOutput: false, imageGeneration: true, imageEdit: true }),

    /* Anthropic */
    m('claude-fable-5', 'Anthropic', 500000, 128000, { vision: true, reasoning: true }),
    m('claude-sonnet-5', 'Anthropic', 500000, 128000, { vision: true, reasoning: true }),
    m('claude-opus-4-8', 'Anthropic', 500000, 128000, { vision: true, reasoning: true }),
    m('claude-opus-4.8', 'Anthropic', 500000, 128000, { vision: true, reasoning: true }),
    m('claude-haiku-4-5', 'Anthropic', 200000, 64000, { vision: true, reasoning: true }),
    m('claude-opus-4-1', 'Anthropic', 200000, 32000, { vision: true, reasoning: true }),
    m('claude-opus-4-20250514', 'Anthropic', 200000, 32000, { vision: true, reasoning: true }),
    m('claude-sonnet-4-5', 'Anthropic', 200000, 64000, { vision: true, reasoning: true }),
    m('claude-sonnet-4-20250514', 'Anthropic', 200000, 64000, { vision: true, reasoning: true }),
    m('claude-3-7-sonnet-latest', 'Anthropic', 200000, 64000, { vision: true, reasoning: true }),
    m('claude-3-5-sonnet-latest', 'Anthropic', 200000, 8192, { vision: true }),
    m('claude-3-5-haiku-latest', 'Anthropic', 200000, 8192, { vision: true }),

    /* DeepSeek */
    m('deepseek-v4-pro', 'DeepSeek', 64000, 8192, { reasoning: true }),
    m('deepseek-v4-flash', 'DeepSeek', 64000, 8192, { reasoning: true }),
    m('deepseek-chat', 'DeepSeek', 64000, 8192, {}),
    m('deepseek-reasoner', 'DeepSeek', 64000, 32768, { reasoning: true }),
    m('deepseek-v3.2', 'DeepSeek', 64000, 8192, { reasoning: true }),
    m('deepseek-v3.2-exp', 'DeepSeek', 64000, 8192, { reasoning: true }),
    m('deepseek-v3.2-speciale', 'DeepSeek', 64000, 8192, { reasoning: true, tools: false }),
    m('deepseek-v3.1-terminus', 'DeepSeek', 64000, 8192, { reasoning: true }),
    m('deepseek-r1-0528', 'DeepSeek', 64000, 32768, { reasoning: true }),
    m('deepseek-v3', 'DeepSeek', 64000, 8192, {}),
    m('deepseek-r1', 'DeepSeek', 64000, 32768, { reasoning: true }),

    /* Qwen / Alibaba Model Studio */
    m('qwen3.7-max-2026-06-08', 'Qwen', 1000000, 65536, { vision: true, reasoning: true }),
    m('qwen3.7-max', 'Qwen', 1000000, 65536, { vision: true, reasoning: true }),
    m('qwen3.7-plus', 'Qwen', 1000000, 65536, { vision: true, reasoning: true }),
    m('qwen3.6-plus', 'Qwen', 1000000, 65536, { vision: true, reasoning: true }),
    m('qwen3.6-flash', 'Qwen', 1000000, 65536, { vision: true, reasoning: true }),
    m('qwen3.5-plus', 'Qwen', 1000000, 65536, { vision: true, reasoning: true }),
    m('qwen3.5-flash', 'Qwen', 1000000, 65536, { vision: true, reasoning: true }),
    m('qwen3-max-2026-01-23', 'Qwen', 262144, 32768, { reasoning: true }),
    m('qwen-max', 'Qwen', 131072, 8192, {}),
    m('qwen-plus', 'Qwen', 131072, 8192, {}),
    m('qwen-turbo', 'Qwen', 1000000, 8192, {}),
    m('qwen-long', 'Qwen', 10000000, 8192, {}),
    m('qwen3-max', 'Qwen', 262144, 32768, { reasoning: true }),
    m('qwen3-235b-a22b', 'Qwen', 131072, 32768, { reasoning: true }),
    m('qwen3-coder-next', 'Qwen', 262144, 65536, { reasoning: true }),
    m('qwen3-coder-plus', 'Qwen', 1000000, 65536, { reasoning: true }),
    m('qwen3-coder-flash', 'Qwen', 1000000, 65536, { reasoning: true }),
    m('qwen3.5-omni', 'Qwen', 262144, 32768, { vision: true, reasoning: true }),
    m('qwen3-omni', 'Qwen', 262144, 32768, { vision: true, reasoning: true }),
    m('qwen3-vl', 'Qwen', 262144, 32768, { vision: true }),
    m('qwen2.5-vl-72b-instruct', 'Qwen', 131072, 8192, { vision: true }),
    m('qwen-vl-max', 'Qwen', 32768, 8192, { vision: true }),
    m('qwen-image', 'Qwen', 4096, 0, { tools: false, structuredOutput: false, imageGeneration: true, imageEdit: true }),

    /* Zhipu GLM */
    m('glm-5.2', 'Zhipu GLM', 128000, 96000, { reasoning: true }),
    m('glm-5.2-air', 'Zhipu GLM', 128000, 96000, { reasoning: true }),
    m('glm-5.2v', 'Zhipu GLM', 128000, 32768, { vision: true, reasoning: true }),
    m('glm-4.5', 'Zhipu GLM', 128000, 96000, { reasoning: true }),
    m('glm-4.5-air', 'Zhipu GLM', 128000, 96000, { reasoning: true }),
    m('glm-4-plus', 'Zhipu GLM', 128000, 4096, {}),
    m('glm-4-air', 'Zhipu GLM', 128000, 4096, {}),
    m('glm-4v-plus', 'Zhipu GLM', 64000, 8192, { vision: true }),
    m('glm-z1-air', 'Zhipu GLM', 128000, 32000, { reasoning: true }),

    /* Moonshot / Kimi */
    m('kimi-k2.7-code', 'Moonshot Kimi', 256000, 32768, { vision: true, reasoning: true }),
    m('kimi-k2.7-code-highspeed', 'Moonshot Kimi', 256000, 32768, { vision: true, reasoning: true }),
    m('kimi-k2.6', 'Moonshot Kimi', 256000, 32768, { vision: true, reasoning: true }),
    m('kimi-k2.5', 'Moonshot Kimi', 256000, 32768, { vision: true, reasoning: true }),
    m('kimi/kimi-k2.7-code', 'Moonshot Kimi', 256000, 32768, { vision: true, reasoning: true }),
    m('kimi/kimi-k2.7-code-highspeed', 'Moonshot Kimi', 256000, 32768, { vision: true, reasoning: true }),
    m('kimi/kimi-k2.6', 'Moonshot Kimi', 256000, 32768, { vision: true, reasoning: true }),
    m('kimi/kimi-k2.5', 'Moonshot Kimi', 256000, 32768, { vision: true, reasoning: true }),
    m('kimi-k2.5-2026-01-29', 'Moonshot Kimi', 256000, 32768, { vision: true, reasoning: true }),
    m('kimi-k2-0905-preview', 'Moonshot Kimi', 256000, 32768, {}),
    m('kimi-k2-0905', 'Moonshot Kimi', 256000, 32768, {}),
    m('kimi-k2.5-preview', 'Moonshot Kimi', 256000, 32768, { vision: true }),
    m('kimi-k2-0711-preview', 'Moonshot Kimi', 128000, 16384, {}),
    m('kimi-latest', 'Moonshot Kimi', 128000, 16384, {}),
    m('kimi-thinking-preview', 'Moonshot Kimi', 128000, 32768, { reasoning: true }),
    m('moonshot-v1-8k', 'Moonshot Kimi', 8192, 4096, {}),
    m('moonshot-v1-32k', 'Moonshot Kimi', 32768, 4096, {}),
    m('moonshot-v1-128k', 'Moonshot Kimi', 128000, 4096, {}),

    /* MiniMax */
    m('MiniMax-M3', 'MiniMax', 1000000, 65536, { vision: true, reasoning: true }),
    m('minimax-m3', 'MiniMax', 1000000, 65536, { vision: true, reasoning: true }),
    m('MiniMax-M2.7', 'MiniMax', 204800, 65536, { reasoning: true }),
    m('MiniMax-M2.7-highspeed', 'MiniMax', 204800, 65536, { reasoning: true }),
    m('minimax-m2.7', 'MiniMax', 204800, 65536, { reasoning: true }),
    m('minimax-m2.7-highspeed', 'MiniMax', 204800, 65536, { reasoning: true }),
    m('MiniMax-M2.5', 'MiniMax', 204800, 65536, { reasoning: true }),
    m('MiniMax-M2.5-highspeed', 'MiniMax', 204800, 65536, { reasoning: true }),
    m('minimax-m2.5', 'MiniMax', 1000000, 80000, { reasoning: true }),
    m('minimax-m2.5-highspeed', 'MiniMax', 204800, 65536, { reasoning: true }),
    m('minimax-m2', 'MiniMax', 1000000, 80000, { reasoning: true }),
    m('minimax-text-01', 'MiniMax', 1000000, 8192, {}),
    m('minimax-m1', 'MiniMax', 1000000, 80000, { reasoning: true }),
    m('abab6.5s-chat', 'MiniMax', 245760, 8192, {}),
    m('abab6.5g-chat', 'MiniMax', 8192, 8192, {}),
    m('minimax-image-01', 'MiniMax', 4096, 0, { tools: false, structuredOutput: false, imageGeneration: true }),

    /* ByteDance Doubao / Volcano Ark */
    m('doubao-seed-2.0-pro', 'Doubao', 256000, 32768, { vision: true, reasoning: true }),
    m('doubao-seed-2.0-lite', 'Doubao', 256000, 16384, { vision: true, reasoning: true }),
    m('doubao-seed-1.8', 'Doubao', 256000, 16384, { vision: true, reasoning: true }),
    m('doubao-seed-1-6', 'Doubao', 256000, 32768, { reasoning: true }),
    m('doubao-seed-1-6-thinking', 'Doubao', 256000, 32768, { reasoning: true }),
    m('doubao-seed-1-6-flash', 'Doubao', 256000, 16384, { vision: true, reasoning: true }),
    m('doubao-seed-1-6-vision', 'Doubao', 256000, 65536, { vision: true, reasoning: true }),
    m('doubao-seed-1-6-251015', 'Doubao', 256000, 16384, { vision: true, reasoning: true }),
    m('doubao-seed-1-6-thinking-250715', 'Doubao', 256000, 16384, { vision: true, reasoning: true }),
    m('doubao-seed-1-6-flash-250828', 'Doubao', 256000, 16384, { vision: true, reasoning: true }),
    m('doubao-seed-1-6-vision-250815', 'Doubao', 256000, 65536, { vision: true, reasoning: true }),
    m('doubao-seed-1.6-250615', 'Doubao', 256000, 16384, { vision: true, reasoning: true }),
    m('doubao-1.5-pro-256k', 'Doubao', 256000, 12288, {}),
    m('doubao-1.5-pro-32k', 'Doubao', 32768, 12288, {}),
    m('doubao-1.5-lite-32k', 'Doubao', 32768, 4096, {}),
    m('doubao-vision-pro', 'Doubao', 32768, 4096, { vision: true }),

    /* Google Gemini */
    m('gemini-3.5-flash', 'Google Gemini', 1048576, 65536, { vision: true, reasoning: true }),
    m('gemini-3.1-pro', 'Google Gemini', 1048576, 65536, { vision: true, reasoning: true }),
    m('gemini-3.0-pro', 'Google Gemini', 1048576, 65536, { vision: true, reasoning: true }),
    m('gemini-2.5-pro', 'Google Gemini', 1048576, 65536, { vision: true, reasoning: true }),
    m('gemini-2.5-flash', 'Google Gemini', 1048576, 65536, { vision: true, reasoning: true }),
    m('gemini-2.5-flash-lite', 'Google Gemini', 1048576, 65536, { vision: true, reasoning: true }),
    m('gemini-2.0-flash', 'Google Gemini', 1048576, 8192, { vision: true }),
    m('gemini-2.0-flash-lite', 'Google Gemini', 1048576, 8192, { vision: true }),
    m('gemini-1.5-pro', 'Google Gemini', 2097152, 8192, { vision: true }),
    m('gemini-1.5-flash', 'Google Gemini', 1048576, 8192, { vision: true }),
    m('imagen-4.0-generate', 'Google Gemini', 4096, 0, { tools: false, structuredOutput: false, imageGeneration: true }),
    m('imagen-4.0-ultra-generate', 'Google Gemini', 4096, 0, { tools: false, structuredOutput: false, imageGeneration: true }),
    m('gemini-2.0-flash-preview-image-generation', 'Google Gemini', 32768, 8192, { vision: true, tools: false, imageGeneration: true, imageEdit: true }),

    /* Meta */
    m('llama-4-maverick', 'Meta Llama', 1000000, 8192, { vision: true }),
    m('llama-4-scout', 'Meta Llama', 10000000, 8192, { vision: true }),
    m('llama-3.3-70b-instruct', 'Meta Llama', 128000, 8192, {}),
    m('llama-3.1-405b-instruct', 'Meta Llama', 128000, 8192, {}),
    m('llama-3.1-70b-instruct', 'Meta Llama', 128000, 8192, {}),
    m('llama-3.2-vision', 'Meta Llama', 128000, 8192, { vision: true }),

    /* Common Ollama names. Runtime num_ctx can override the model card. */
    m('llama3.3', 'Ollama', 8192, 8192, { contextConfigurable: true }),
    m('llama3.2', 'Ollama', 8192, 8192, { contextConfigurable: true }),
    m('llama3.2-vision', 'Ollama', 8192, 8192, { vision: true, contextConfigurable: true }),
    m('qwen3', 'Ollama', 8192, 8192, { reasoning: true, contextConfigurable: true }),
    m('qwen2.5-coder', 'Ollama', 8192, 8192, { contextConfigurable: true }),
    m('deepseek-r1', 'Ollama', 8192, 8192, { reasoning: true, contextConfigurable: true }),
    m('mistral-small', 'Ollama', 32768, 8192, { contextConfigurable: true })
  ];

  const EXACT = {};
  BUILTIN.forEach(item => { EXACT[cleanId(item.id)] = item; });

  function m(id, provider, contextWindow, maxOutputTokens, capabilities) {
    return {
      id,
      provider,
      contextWindow,
      maxOutputTokens,
      capabilities: Object.assign({}, CAP_DEFAULTS, capabilities || {}),
      source: 'builtin-2026-07-06'
    };
  }

  function cleanId(id) {
    return String(id || '').trim().toLowerCase()
      .replace(/[:@].*$/, '')
      .replace(/-\d{8}$/, '')
      .replace(/-\d{4}-\d{2}-\d{2}$/, '');
  }

  function modelId(model) {
    return typeof model === 'string' ? model : (model && (model.id || model.name || model.model)) || '';
  }

  function toInt(v) {
    if (v == null || v === '') return null;
    const n = Number(String(v).replace(/[,_\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? Math.round(n) : null;
  }

  function normalizeCapabilities(input) {
    const caps = Object.assign({}, CAP_DEFAULTS);
    if (!input) return caps;
    if (Array.isArray(input)) {
      input.forEach(x => {
        const k = String(x || '').toLowerCase();
        if (/vision|image|multimodal|vl/.test(k)) caps.vision = true;
        if (/reason|thinking|cot/.test(k)) caps.reasoning = true;
        if (/tool|function/.test(k)) caps.tools = true;
        if (/image_generation|text-to-image|txt2img/.test(k)) caps.imageGeneration = true;
        if (/image_edit|inpaint|edit/.test(k)) caps.imageEdit = true;
      });
      return caps;
    }
    Object.keys(input).forEach(k => {
      if (k in caps) caps[k] = !!input[k];
    });
    return caps;
  }

  function infer(id, providerName) {
    id = String(id || '').trim();
    if (!id) return null;
    const low = cleanId(id);
    const exact = EXACT[low] || EXACT[low.replace(/^models\//, '')];
    let out = exact ? cloneMeta(exact) : {
      id,
      contextWindow: DEFAULT_CONTEXT,
      maxOutputTokens: DEFAULT_MAX_OUTPUT,
      capabilities: Object.assign({}, CAP_DEFAULTS),
      source: 'heuristic'
    };
    out.id = id;

    const hay = [id, providerName || '', out.provider || ''].join(' ').toLowerCase();
    if (/vision|[-_.]vl|multimodal|gpt-4o|gpt-4\.1|gpt-5|claude|gemini|llava/.test(hay)) out.capabilities.vision = true;
    if (/reason|thinking|deepseek-r1|deepseek-reasoner|qwq|qwen3|glm-[45]|glm-z1|gemini-[23]\.|o[134]|gpt-5/.test(hay)) out.capabilities.reasoning = true;
    if (/image|dall-e|imagen|flux|stable-diffusion|sdxl/.test(hay)) {
      out.capabilities.imageGeneration = true;
      out.capabilities.tools = false;
      out.capabilities.structuredOutput = false;
      if (/edit|inpaint|gpt-image|qwen-image/.test(hay)) out.capabilities.imageEdit = true;
    }
    if (/completion/.test(hay)) out.capabilities.tools = false;
    if (/ollama|localhost:11434/.test(hay)) out.capabilities.contextConfigurable = true;
    return out;
  }

  function cloneMeta(meta) {
    const out = Object.assign({}, meta || {});
    out.capabilities = Object.assign({}, CAP_DEFAULTS, meta && meta.capabilities || {});
    return out;
  }

  function mergeMeta(a, b) {
    const out = cloneMeta(a || {});
    b = b || {};
    Object.keys(b).forEach(k => {
      if (k === 'capabilities') return;
      if (b[k] !== undefined && b[k] !== null && b[k] !== '') out[k] = b[k];
    });
    out.capabilities = Object.assign({}, CAP_DEFAULTS, out.capabilities || {}, b.capabilities || {});
    out.contextWindow = toInt(out.contextWindow) || DEFAULT_CONTEXT;
    out.maxOutputTokens = toInt(out.maxOutputTokens);
    if (out.maxOutputTokens == null) out.maxOutputTokens = DEFAULT_MAX_OUTPUT;
    return out;
  }

  function fromApiModel(raw) {
    if (typeof raw === 'string') return { id: raw };
    raw = raw || {};
    const info = raw.model_info || raw.modelInfo || {};
    const details = raw.details || {};
    const id = raw.id || raw.name || raw.model || raw.model_id || '';
    const caps = normalizeCapabilities(raw.capabilities || raw.supported_capabilities || raw.features);
    const params = raw.supported_parameters || raw.supportedParams || [];
    if (Array.isArray(params) && params.some(x => /tool|function/.test(String(x).toLowerCase()))) caps.tools = true;
    if (Array.isArray(params) && params.some(x => /response_format|json_schema|json/.test(String(x).toLowerCase()))) caps.structuredOutput = true;
    const ctx = toInt(raw.contextWindow || raw.context_window || raw.context_length || raw.contextLength ||
      raw.max_context_length || raw.maxContextLength || raw.input_token_limit || raw.inputTokenLimit ||
      info.context_length || info['llama.context_length'] || details.context_length);
    const out = toInt(raw.maxOutputTokens || raw.max_output_tokens || raw.output_token_limit ||
      raw.outputTokenLimit || raw.max_tokens || raw.max_completion_tokens);
    return {
      id,
      label: raw.display_name || raw.displayName || raw.name || '',
      contextWindow: ctx,
      maxOutputTokens: out,
      capabilities: caps,
      raw,
      source: 'api'
    };
  }

  function isImageGenerationMeta(meta) {
    const caps = meta && meta.capabilities || {};
    return !!(caps.imageGeneration || (meta.image && meta.image.generation));
  }

  function normalizeProvider(provider) {
    provider = provider || {};
    const models = [];
    const imageModels = [];
    const modelMeta = Object.assign({}, provider.modelMeta || {});
    const imageModelMeta = Object.assign({}, provider.imageModelMeta || {});
    function add(target, id) {
      id = modelId(id).trim();
      if (id && !target.includes(id)) target.push(id);
    }
    (provider.models || []).forEach(item => {
      const id = modelId(item).trim();
      if (!id) return;
      if (typeof item === 'object') modelMeta[id] = mergeMeta(modelMeta[id], item);
      const meta = mergeMeta(infer(id, provider.name), modelMeta[id]);
      if (isImageGenerationMeta(meta)) add(imageModels, id);
      else add(models, id);
    });
    (provider.imageModels || []).forEach(item => {
      const id = modelId(item).trim();
      if (!id) return;
      if (typeof item === 'object') imageModelMeta[id] = mergeMeta(imageModelMeta[id], item);
      add(imageModels, id);
    });
    imageModels.forEach(id => {
      const meta = mergeMeta(infer(id, provider.name), imageModelMeta[id] || modelMeta[id]);
      imageModelMeta[id] = mergeMeta(meta, { capabilities: { imageGeneration: true, tools: false, structuredOutput: false } });
      const i = models.indexOf(id);
      if (i >= 0) models.splice(i, 1);
      delete modelMeta[id];
    });
    provider.models = models;
    provider.imageModels = imageModels;
    provider.modelMeta = {};
    models.forEach(id => {
      provider.modelMeta[id] = mergeMeta(infer(id, provider.name), modelMeta[id]);
    });
    provider.imageModelMeta = {};
    imageModels.forEach(id => {
      provider.imageModelMeta[id] = mergeMeta(infer(id, provider.name), imageModelMeta[id]);
    });
    return provider;
  }

  function applyApiModels(provider, apiModels) {
    provider = normalizeProvider(provider || {});
    const ids = [];
    const imageIds = [];
    const meta = Object.assign({}, provider.modelMeta || {});
    const imageMeta = Object.assign({}, provider.imageModelMeta || {});
    (apiModels || []).forEach(raw => {
      const got = fromApiModel(raw);
      const id = modelId(got).trim();
      if (!id || ids.includes(id) || imageIds.includes(id)) return;
      const merged = mergeMeta(infer(id, provider.name), got);
      if (isImageGenerationMeta(merged)) {
        imageIds.push(id);
        imageMeta[id] = merged;
      } else {
        ids.push(id);
        meta[id] = merged;
      }
    });
    provider.models = ids;
    provider.imageModels = imageIds;
    provider.modelMeta = {};
    ids.forEach(id => { provider.modelMeta[id] = mergeMeta(infer(id, provider.name), meta[id]); });
    provider.imageModelMeta = {};
    imageIds.forEach(id => { provider.imageModelMeta[id] = mergeMeta(infer(id, provider.name), imageMeta[id]); });
    return provider;
  }

  function get(provider, id) {
    provider = normalizeProvider(Object.assign({}, provider || {}));
    id = String(id || provider.models[0] || (provider.imageModels && provider.imageModels[0]) || '').trim();
    const meta = (provider.modelMeta && provider.modelMeta[id]) || (provider.imageModelMeta && provider.imageModelMeta[id]);
    return mergeMeta(infer(id, provider.name), meta);
  }

  function capLabels(meta) {
    const c = meta && meta.capabilities || {};
    const out = [];
    if (c.vision) out.push('视觉');
    if (c.reasoning) out.push('思考');
    if (c.tools) out.push('工具');
    if (c.imageGeneration) out.push('生图');
    if (c.imageEdit) out.push('改图');
    return out.length ? out : ['文本'];
  }

  function fmtTokens(n) {
    n = toInt(n) || 0;
    if (n >= 1000000) return (n / 1000000).toFixed(n % 1000000 ? 1 : 0) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(n % 1000 ? 1 : 0) + 'k';
    return String(n);
  }

  function estimateTokens(text) {
    text = String(text || '');
    if (!text) return 0;
    const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const ascii = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, '');
    const words = (ascii.match(/[A-Za-z0-9_]+|[^\sA-Za-z0-9_]/g) || []).length;
    return Math.max(1, Math.ceil(cjk * 1.15 + words * 0.75));
  }

  return {
    DEFAULT_CONTEXT,
    DEFAULT_MAX_OUTPUT,
    SOURCES,
    BUILTIN,
    modelId,
    normalizeProvider,
    applyApiModels,
    fromApiModel,
    infer,
    get,
    mergeMeta,
    isImageGenerationMeta,
    capLabels,
    fmtTokens,
    estimateTokens,
    toInt
  };
})();

window.MODEL_META = MODEL_META;
