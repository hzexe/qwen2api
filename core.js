/**
 * 核心业务逻辑 - 所有平台共用
 * 
 * 改动历史：
 * - 2026-03-28: 新增 thinking/search 后缀路由支持
 *   参考文档: doc/search-feature/
 */

// ============================================
// 模型后缀解析 (2026-03-28 新增)
// ============================================

/**
 * 迭代剥离模型名后缀，支持多后缀并存
 * @param {string} rawModel 原始模型名
 * @returns {{ cleanModel: string, enableThinking: boolean, enableSearch: boolean }}
 */
function parseModelSuffix(rawModel) {
  const flags = { enableThinking: false, enableSearch: false };
  const SUFFIX_MAP = {
    '-thinking': () => { flags.enableThinking = true; },
    '-search':   () => { flags.enableSearch = true; },
  };

  let model = rawModel;
  let changed = true;
  while (changed) {
    changed = false;
    for (const [suffix, setter] of Object.entries(SUFFIX_MAP)) {
      if (model.endsWith(suffix)) {
        setter();
        model = model.slice(0, -suffix.length);
        changed = true;
        break; // 每次只剥一个，重新从头扫
      }
    }
  }

  return { cleanModel: model, ...flags };
}

/**
 * 解析 thinking 开关和 budget，按优先级链处理
 * 优先级：后缀 > enable_thinking > reasoning_effort > 环境变量
 * @param {object} body 请求体
 * @param {{ enableThinking: boolean }} suffixFlags 后缀解析结果
 * @param {object} env 环境变量
 * @returns {{ thinkingEnabled: boolean, thinkingBudget: number|undefined }}
 */
function resolveThinking(body, suffixFlags, env) {
  // budget 优先级
  let budget = undefined;
  if (body.thinking_budget != null) {
    budget = parseInt(body.thinking_budget);
  } else if (body.reasoning_effort) {
    const budgetMap = { low: 2000, medium: 8000, high: 20000 };
    budget = budgetMap[body.reasoning_effort];
  } else if (env?.THINKING_BUDGET || process?.env?.THINKING_BUDGET) {
    budget = parseInt(env?.THINKING_BUDGET || process?.env?.THINKING_BUDGET);
  }

  // enabled 优先级
  let enabled;
  if (suffixFlags.enableThinking) {
    // 1. model 后缀 -thinking
    enabled = true;
  } else if (body.enable_thinking != null) {
    // 2. Qwen 官方参数
    enabled = !!body.enable_thinking;
  } else if (body.reasoning_effort != null) {
    // 3. OpenAI reasoning_effort
    enabled = body.reasoning_effort !== 'none';
  } else {
    // 4. 环境变量兜底
    enabled = (env?.ENABLE_THINKING || process?.env?.ENABLE_THINKING || '').toLowerCase() === 'true';
  }

  return { thinkingEnabled: enabled, thinkingBudget: budget };
}

/**
 * 解析 search 开关，双入口控制
 * 入口1：模型后缀 -search
 * 入口2：extra_body.enable_search
 * 兜底：环境变量 ENABLE_SEARCH
 * @param {object} body 请求体
 * @param {{ enableSearch: boolean }} suffixFlags 后缀解析结果
 * @param {object} env 环境变量
 * @returns {boolean}
 */
function resolveSearch(body, suffixFlags, env) {
  // 入口 1：model 后缀
  if (suffixFlags.enableSearch) return true;
  // 入口 2：extra_body.enable_search
  if (body.extra_body?.enable_search === true) return true;
  // 兜底：全局环境变量
  return (env?.ENABLE_SEARCH || process?.env?.ENABLE_SEARCH || '').toLowerCase() === 'true';
}

// ============================================
// UUID 生成 (内联，避免 ESM 问题)
// ============================================

function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ============================================
// 配置
// ============================================

const BAXIA_VERSION = '2.5.36';
const CACHE_TTL = 4 * 60 * 1000;
const QWEN_BASE_URL = 'https://chat.qwen.ai';
const QWEN_WEB_REFERER = `${QWEN_BASE_URL}/`;
const QWEN_GUEST_REFERER = `${QWEN_BASE_URL}/c/guest`;
const WEB_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const WEB_ACCEPT_LANGUAGE = 'zh-CN,zh;q=0.9,en;q=0.8';
let tokenCache = null;
let tokenCacheTime = 0;

// ============================================
// Baxia Token 生成
// ============================================

function randomString(length) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let result = '';
  const randomBytes = cryptoRandomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[randomBytes[i] % chars.length];
  }
  return result;
}

function cryptoRandomBytes(length) {
  // Node.js 环境 (包括 Vercel/Netlify)
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return require('crypto').randomBytes(length);
  }
  // Cloudflare Workers / 浏览器
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

function cryptoHash(data) {
  // Node.js 环境 (包括 Vercel/Netlify)
  if (typeof process !== 'undefined' && process.versions && process.versions.node) {
    return require('crypto').createHash('md5').update(data).digest('base64').substring(0, 32);
  }
  // Cloudflare Workers / 浏览器 - 返回随机字符串
  return randomString(32);
}

function generateWebGLFingerprint() {
  const renderers = [
    'ANGLE (Intel, Intel(R) UHD Graphics 630, OpenGL 4.6)',
    'ANGLE (NVIDIA, NVIDIA GeForce GTX 1080, OpenGL 4.6)',
    'ANGLE (AMD, AMD Radeon RX 580, OpenGL 4.6)',
  ];
  return { renderer: renderers[Math.floor(Math.random() * renderers.length)], vendor: 'Google Inc. (Intel)' };
}

async function collectFingerprintData() {
  const platforms = ['Win32', 'Linux x86_64', 'MacIntel'];
  const languages = ['en-US', 'zh-CN', 'en-GB'];
  const canvas = cryptoHash(cryptoRandomBytes(32));
  
  return {
    p: platforms[Math.floor(Math.random() * platforms.length)],
    l: languages[Math.floor(Math.random() * languages.length)],
    hc: 4 + Math.floor(Math.random() * 12),
    dm: [4, 8, 16, 32][Math.floor(Math.random() * 4)],
    to: [-480, -300, 0, 60, 480][Math.floor(Math.random() * 5)],
    sw: 1920 + Math.floor(Math.random() * 200),
    sh: 1080 + Math.floor(Math.random() * 100),
    cd: 24,
    pr: [1, 1.25, 1.5, 2][Math.floor(Math.random() * 4)],
    wf: generateWebGLFingerprint().renderer.substring(0, 20),
    cf: canvas,
    af: (124.04347527516074 + Math.random() * 0.001).toFixed(14),
    ts: Date.now(),
    r: Math.random(),
  };
}

function encodeBaxiaToken(data) {
  const jsonStr = JSON.stringify(data);
  let encoded;
  if (typeof Buffer === 'undefined') {
    encoded = btoa(unescape(encodeURIComponent(jsonStr)));
  } else {
    encoded = Buffer.from(jsonStr).toString('base64');
  }
  return `${BAXIA_VERSION.replace(/\./g, '')}!${encoded}`;
}

async function getBaxiaTokens() {
  const now = Date.now();
  if (tokenCache && (now - tokenCacheTime) < CACHE_TTL) {
    return tokenCache;
  }
  
  const bxUa = encodeBaxiaToken(await collectFingerprintData());
  let bxUmidToken;
  try {
    const resp = await fetch('https://sg-wum.alibaba.com/w/wu.json', {
      headers: { 'User-Agent': WEB_USER_AGENT }
    });
    bxUmidToken = resp.headers.get('etag') || 'T2gA' + randomString(40);
  } catch { bxUmidToken = 'T2gA' + randomString(40); }
  
  const result = { bxUa, bxUmidToken, bxV: BAXIA_VERSION };
  tokenCache = result;
  tokenCacheTime = now;
  return result;
}

// ============================================
// 认证
// ============================================

function getApiTokens(env) {
  const tokens = env?.API_TOKENS || process?.env?.API_TOKENS;
  if (!tokens) return [];
  return tokens.split(',').map(t => t.trim()).filter(t => t);
}

function validateToken(authHeader, env) {
  const tokens = getApiTokens(env);
  if (tokens.length === 0) return true;
  const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  return tokens.includes(token);
}

// ============================================
// 响应工具
// ============================================

function createResponse(body, status = 200, headers = {}) {
  return {
    statusCode: status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      ...headers,
    },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  };
}

function createStreamResponse(body) {
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    },
    body,
  };
}

function previewBody(rawText, maxLen = 240) {
  const text = normalizeInputString(rawText || '');
  if (!text) return '';
  return text.length > maxLen ? `${text.slice(0, maxLen)}...` : text;
}

async function safeReadJson(response) {
  const status = response?.status;
  const rawText = await response.text().catch(() => '');
  if (!rawText) {
    return { ok: false, status, data: null, rawText: '', parseError: new Error('Empty response body') };
  }
  try {
    return { ok: true, status, data: JSON.parse(rawText), rawText, parseError: null };
  } catch (parseError) {
    return { ok: false, status, data: null, rawText, parseError };
  }
}

function logChatDetail(runtime, event, detail = {}) {
  const rawFlag = (typeof process !== 'undefined' && process?.env?.CHAT_DETAIL_LOG) || '';
  const enabled = ['1', 'true', 'yes', 'on'].includes(String(rawFlag).toLowerCase());
  if (!enabled) return;
  const prefix = `[qwen2api][${runtime}][chat]`;
  try {
    console.log(`${prefix} ${event}`, JSON.stringify(detail));
  } catch {
    console.log(`${prefix} ${event}`);
  }
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeMimeType(mimeType) {
  return (mimeType || 'application/octet-stream').toLowerCase();
}

function inferFileCategory(mimeType, explicitType) {
  if (explicitType === 'image' || explicitType === 'audio' || explicitType === 'video' || explicitType === 'document') {
    return explicitType;
  }
  const mime = normalizeMimeType(mimeType);
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('audio/')) return 'audio';
  if (mime.startsWith('video/')) return 'video';
  return 'document';
}

function fileExtensionFromMime(mimeType) {
  const mime = normalizeMimeType(mimeType);
  const mapping = {
    'image/png': 'png',
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'image/bmp': 'bmp',
    'image/svg+xml': 'svg',
    'application/pdf': 'pdf',
    'text/plain': 'txt',
    'text/markdown': 'md',
    'application/json': 'json',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
    'video/mp4': 'mp4',
    'video/webm': 'webm',
    'video/quicktime': 'mov',
    'video/x-matroska': 'mkv',
    'video/avi': 'avi',
  };
  return mapping[mime] || 'bin';
}

function decodeBase64ToBytes(base64) {
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function parseDataUrl(dataUrl) {
  if (typeof dataUrl !== 'string') return null;
  const matched = dataUrl.match(/^data:([^;,]+)?;base64,(.+)$/i);
  if (!matched) return null;
  return {
    mimeType: normalizeMimeType(matched[1] || 'application/octet-stream'),
    bytes: decodeBase64ToBytes(matched[2]),
  };
}

function inferFilename(rawFilename, mimeType) {
  const name = normalizeInputString(rawFilename);
  if (name) {
    return name;
  }
  return `attachment-${uuidv4()}.${fileExtensionFromMime(mimeType)}`;
}

function normalizeInputString(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed) return '';
  const lower = trimmed.toLowerCase();
  if (lower === '[undefined]' || lower === 'undefined' || lower === '[null]' || lower === 'null') {
    return '';
  }
  return trimmed;
}

function normalizeReasoningFragments(value) {
  if (typeof value === 'string') {
    const text = normalizeReasoningString(value);
    return text ? [text] : [];
  }
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const item of value) {
    if (typeof item === 'string') {
      const text = normalizeReasoningString(item);
      if (text) out.push(text);
    } else if (item && typeof item === 'object') {
      const text = normalizeReasoningString(item.text || item.content || item.value);
      if (text) out.push(text);
    }
  }
  return out;
}

function normalizeReasoningString(value) {
  if (typeof value !== 'string') return '';
  const lowered = value.trim().toLowerCase();
  if (lowered === '[undefined]' || lowered === 'undefined' || lowered === '[null]' || lowered === 'null') {
    return '';
  }
  return value;
}

function extractReasoningContentFromDelta(delta) {
  if (!delta || typeof delta !== 'object') return '';
  const direct = normalizeReasoningString(delta.reasoning_content || delta.reasoning || '');
  if (direct) return direct;
  const phase = typeof delta.phase === 'string' ? delta.phase : '';
  if (phase !== 'thinking_summary') return '';
  const thoughtContent = normalizeReasoningFragments(delta?.extra?.summary_thought?.content);
  if (thoughtContent.length > 0) return thoughtContent.join('\n');
  return '';
}

function mapUpstreamDeltaToOpenAI(delta) {
  if (!delta || typeof delta !== 'object') return null;
  const mapped = {};
  // OpenAI API 规范: 流式响应中 delta.role 只能是 "assistant" 或不设置
  // 当上游返回 "function" 等角色时，不设置 role 字段
  if (delta.role === 'assistant') mapped.role = delta.role;
  if (typeof delta.content === 'string') mapped.content = delta.content;
  const reasoningContent = extractReasoningContentFromDelta(delta);
  if (reasoningContent) mapped.reasoning_content = reasoningContent;
  return Object.keys(mapped).length > 0 ? mapped : null;
}

function parseQwenSsePayload(rawPayload) {
  const payload = typeof rawPayload === 'string' ? rawPayload : '';
  const events = [];
  const contentParts = [];
  const reasoningParts = [];
  let usage = null;

  for (const line of payload.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      if (parsed?.usage && typeof parsed.usage === 'object') {
        usage = parsed.usage;
      }
      const upstreamDelta = parsed?.choices?.[0]?.delta;
      const delta = mapUpstreamDeltaToOpenAI(upstreamDelta);
      const finishReason = parsed?.choices?.[0]?.finish_reason || null;
      if (delta || finishReason) {
        events.push({ delta: delta || {}, finish_reason: finishReason });
      }
      if (delta?.content) contentParts.push(delta.content);
      if (delta?.reasoning_content) reasoningParts.push(delta.reasoning_content);
    } catch (parseError) {
      void parseError;
    }
  }

  return {
    events,
    content: contentParts.join(''),
    reasoning_content: reasoningParts.join(''),
    usage,
  };
}

function mapUsageToOpenAI(usage) {
  const inputTokens = Number(usage?.input_tokens || 0);
  const outputTokens = Number(usage?.output_tokens || 0);
  const totalTokens = Number(usage?.total_tokens || (inputTokens + outputTokens));
  const mapped = {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: totalTokens,
  };
  const inputDetails = usage?.input_tokens_details && typeof usage.input_tokens_details === 'object'
    ? { ...usage.input_tokens_details }
    : null;
  const outputDetails = usage?.output_tokens_details && typeof usage.output_tokens_details === 'object'
    ? { ...usage.output_tokens_details }
    : null;
  if (inputDetails && Object.keys(inputDetails).length > 0) {
    mapped.prompt_tokens_details = inputDetails;
  }
  if (outputDetails && Object.keys(outputDetails).length > 0) {
    mapped.completion_tokens_details = outputDetails;
  }
  return mapped;
}

function tryParseOpenAiImageSize(size) {
  const text = normalizeInputString(size);
  if (!text) return null;
  const m = text.toLowerCase().match(/^(\d{2,5})\s*x\s*(\d{2,5})$/);
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  return { width, height };
}

function tryParseRatioString(size) {
  const text = normalizeInputString(size);
  if (!text) return null;
  const m = text.toLowerCase().match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return null;
  const w = Number(m[1]);
  const h = Number(m[2]);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;
  return `${w}:${h}`;
}

function mapOpenAiImageSizeToQwenRatio(size) {
  // Qwen Web t2i 在抓包中使用 ratio 文本，例如 "16:9"。
  // 支持两种格式：
  // 1. 直接比例字符串："1:1", "16:9", "9:16", "4:3", "3:4"
  // 2. OpenAI 格式："1024x1024" (映射到最接近的比例)
  
  // 首先尝试直接解析比例字符串
  const ratio = tryParseRatioString(size);
  if (ratio) {
    // 验证是否为支持的比例
    const validRatios = ['1:1', '16:9', '9:16', '4:3', '3:4'];
    if (validRatios.includes(ratio)) {
      return ratio;
    }
  }
  
  // 否则尝试解析 OpenAI 尺寸格式并映射到最近比例
  const parsed = tryParseOpenAiImageSize(size);
  if (!parsed) return '1:1';
  const { width, height } = parsed;
  const r = width / height;

  // 常见目标比例
  const candidates = [
    { key: '1:1', r: 1 },
    { key: '16:9', r: 16 / 9 },
    { key: '9:16', r: 9 / 16 },
    { key: '4:3', r: 4 / 3 },
    { key: '3:4', r: 3 / 4 },
  ];

  let best = candidates[0];
  let bestDiff = Infinity;
  for (const c of candidates) {
    const diff = Math.abs(r - c.r);
    if (diff < bestDiff) {
      best = c;
      bestDiff = diff;
    }
  }
  return best.key;
}

function extractImageUrlsFromUpstreamSse(rawPayload) {
  const payload = typeof rawPayload === 'string' ? rawPayload : '';
  const urls = [];

  for (const line of payload.split('\n')) {
    const trimmed = line.trimStart();
    if (!trimmed.startsWith('data:')) continue;
    const data = trimmed.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      const delta = parsed?.choices?.[0]?.delta;
      if (!delta || typeof delta !== 'object') continue;
      const phase = typeof delta.phase === 'string' ? delta.phase : '';
      if (phase !== 'image_gen') continue;
      const content = delta.content;
      if (typeof content !== 'string') continue;
      const url = content.trim();
      if (!url) continue;
      if (!/^https?:\/\//i.test(url)) continue;
      urls.push(url);
    } catch {
      // ignore
    }
  }

  // 去重但保持顺序
  const seen = new Set();
  const out = [];
  for (const u of urls) {
    if (seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

async function fetchImageAsBase64(url) {
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch image: HTTP ${resp.status}`);
  }
  const arrayBuffer = await resp.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);
  return bytes.toString('base64');
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes || new Uint8Array());
  } catch {
    return '';
  }
}

function extractInlineTextFromAttachment(source, mimeType, filename) {
  const mime = normalizeMimeType(mimeType);
  const isTextLike = mime.startsWith('text/') || mime === 'application/json' || mime === 'application/xml' || mime === 'text/markdown';
  if (!isTextLike) return '';
  const parsed = parseDataUrl(source);
  if (!parsed) return '';
  const text = normalizeInputString(decodeUtf8(parsed.bytes));
  if (!text) return '';
  const label = normalizeInputString(filename) || 'unnamed.txt';
  const capped = text.length > 12000 ? `${text.slice(0, 12000)}\n...[truncated]` : text;
  return `[附件文本 ${label}]\n${capped}`;
}

function pushTextPart(parts, value) {
  const text = normalizeInputString(value);
  if (text) {
    parts.push(text);
  }
}

function normalizeContentParts(content) {
  if (typeof content === 'string') {
    const text = normalizeInputString(content);
    return {
      text,
      attachments: [],
    };
  }

  if (!Array.isArray(content)) {
    return {
      text: '',
      attachments: [],
    };
  }

  const textParts = [];
  const attachments = [];

  for (const part of content) {
    if (!part) continue;
    if (typeof part === 'string') {
      pushTextPart(textParts, part);
      continue;
    }

    const type = part.type || '';
    if (type === 'text' || type === 'input_text') {
      pushTextPart(textParts, part.text || part.input_text);
      continue;
    }

    if (type === 'image_url' || type === 'input_image') {
      const imageUrl = normalizeInputString(
        part.image_url?.url ||
        part.image_url ||
        part.url ||
        part.file_url ||
        part.file_data
      );
      if (imageUrl) {
        attachments.push({
          source: imageUrl,
          filename: normalizeInputString(part.filename) || normalizeInputString(part.name),
          mimeType: normalizeInputString(part.mime_type) || normalizeInputString(part.content_type),
          explicitType: 'image',
        });
      }
      continue;
    }

    if (type === 'file' || type === 'input_file' || type === 'audio' || type === 'input_audio' || type === 'video' || type === 'input_video') {
      const fileSource = normalizeInputString(part.file_data || part.url || part.file_url || part.data);
      if (fileSource) {
        const normalizedFilename = normalizeInputString(part.filename) || normalizeInputString(part.name);
        const normalizedMimeType = normalizeInputString(part.mime_type) || normalizeInputString(part.content_type);
        const explicitType = type.includes('audio') ? 'audio' : (type.includes('video') ? 'video' : undefined);
        attachments.push({
          source: fileSource,
          filename: normalizedFilename,
          mimeType: normalizedMimeType,
          explicitType,
        });
      }
      continue;
    }

    if (typeof part.text === 'string') {
      pushTextPart(textParts, part.text);
    }
  }

  return {
    text: textParts.join('\n'),
    attachments,
  };
}

function normalizeLegacyFiles(message) {
  const attachments = [];
  const candidates = [...toArray(message?.attachments), ...toArray(message?.files)];
  for (const item of candidates) {
    if (!item) continue;
    const source = normalizeInputString(item.data || item.file_data || item.url || item.file_url);
    if (!source) continue;
    attachments.push({
      source,
      filename: normalizeInputString(item.filename) || normalizeInputString(item.name),
      mimeType: normalizeInputString(item.mime_type) || normalizeInputString(item.content_type) || normalizeInputString(item.type),
      explicitType: item.type,
    });
  }
  return attachments;
}

function parseIncomingMessages(messages) {
  const safeMessages = Array.isArray(messages) ? messages : [];
  const normalized = safeMessages.map(message => {
    const parsed = normalizeContentParts(message?.content);
    return {
      role: message?.role || 'user',
      text: parsed.text,
      attachments: [...parsed.attachments, ...normalizeLegacyFiles(message)],
    };
  });

  if (normalized.length === 0) {
    return { content: '', attachments: [] };
  }

  const last = normalized[normalized.length - 1];
  const history = normalized.slice(0, -1)
    .map(m => {
      if (!m.text) return '';
      const role = m.role === 'assistant' ? 'Assistant' : m.role === 'system' ? 'System' : 'User';
      return `[${role}]: ${m.text}`;
    })
    .filter(Boolean)
    .join('\n\n');

  const lastText = last.text || (last.attachments.length > 0 ? '请结合附件内容回答。' : '');
  const merged = history
    ? `${history}\n\n[User]: ${lastText}`
    : lastText;

  return {
    content: merged,
    attachments: last.attachments,
  };
}

async function getAttachmentBytes(attachment) {
  const dataParsed = parseDataUrl(attachment.source);
  if (dataParsed) {
    return {
      bytes: dataParsed.bytes,
      mimeType: attachment.mimeType || dataParsed.mimeType,
      filename: inferFilename(attachment.filename, attachment.mimeType || dataParsed.mimeType),
    };
  }

  if (/^https?:\/\//i.test(attachment.source)) {
    const resp = await fetch(attachment.source);
    if (!resp.ok) {
      throw new Error(`Failed to fetch attachment URL: ${resp.status}`);
    }
    const mimeType = attachment.mimeType || resp.headers.get('content-type') || 'application/octet-stream';
    const bytes = new Uint8Array(await resp.arrayBuffer());
    return {
      bytes,
      mimeType,
      filename: inferFilename(attachment.filename, mimeType),
    };
  }

  const maybeBase64 = attachment.source.replace(/\s+/g, '');
  const bytes = decodeBase64ToBytes(maybeBase64);
  const mimeType = attachment.mimeType || 'application/octet-stream';
  return {
    bytes,
    mimeType,
    filename: inferFilename(attachment.filename, mimeType),
  };
}

async function requestUploadToken(file, baxiaTokens) {
  const filetype = inferFileCategory(file.mimeType, file.explicitType);
  const resp = await fetch(`${QWEN_BASE_URL}/api/v2/files/getstsToken`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'bx-ua': baxiaTokens.bxUa,
      'bx-umidtoken': baxiaTokens.bxUmidToken,
      'bx-v': baxiaTokens.bxV,
      'source': 'web',
      'timezone': new Date().toUTCString(),
      'Referer': QWEN_WEB_REFERER,
      'x-request-id': uuidv4(),
    },
    body: JSON.stringify({
      filename: file.filename,
      filesize: file.bytes.length,
      filetype,
    }),
  });

  const data = await resp.json();
  if (!resp.ok || !data?.success || !data?.data?.file_url) {
    throw new Error(`Failed to get upload token: ${resp.status}`);
  }

  return {
    tokenData: data.data,
    filetype,
  };
}

function toHex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

function formatOssDate(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const ss = String(date.getUTCSeconds()).padStart(2, '0');
  return `${yyyy}${mm}${dd}T${hh}${mi}${ss}Z`;
}

function formatOssDateScope(date = new Date()) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  return `${yyyy}${mm}${dd}`;
}

function getWebCrypto() {
  if (globalThis.crypto && globalThis.crypto.subtle) {
    return globalThis.crypto;
  }
  if (typeof require === 'function') {
    const nodeCrypto = require('crypto');
    if (nodeCrypto.webcrypto && nodeCrypto.webcrypto.subtle) {
      return nodeCrypto.webcrypto;
    }
  }
  throw new Error('WebCrypto is not available');
}

async function sha256Hex(input) {
  const cryptoApi = getWebCrypto();
  const bytes = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const hash = await cryptoApi.subtle.digest('SHA-256', bytes);
  return toHex(new Uint8Array(hash));
}

async function hmacSha256(keyBytes, content) {
  const cryptoApi = getWebCrypto();
  const cryptoKey = await cryptoApi.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const message = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  const signature = await cryptoApi.subtle.sign('HMAC', cryptoKey, message);
  return new Uint8Array(signature);
}

async function buildOssSignedHeaders(uploadUrl, tokenData, file) {
  const parsedUrl = new URL(uploadUrl);
  const query = parsedUrl.searchParams;
  const credentialFromQuery = decodeURIComponent(query.get('x-oss-credential') || '');
  const credentialParts = credentialFromQuery.split('/');

  const dateScope = credentialParts[1] || formatOssDateScope();
  const region = credentialParts[2] || 'ap-southeast-1';
  const xOssDate = query.get('x-oss-date') || formatOssDate();

  const hostParts = parsedUrl.hostname.split('.');
  const bucket = hostParts.length > 0 ? hostParts[0] : '';
  const objectPath = parsedUrl.pathname || '/';
  const canonicalUri = bucket ? `/${bucket}${objectPath}` : objectPath;
  const xOssUserAgent = 'aliyun-sdk-js/6.23.0';
  const canonicalHeaders = [
    `content-type:${file.mimeType}`,
    'x-oss-content-sha256:UNSIGNED-PAYLOAD',
    `x-oss-date:${xOssDate}`,
    `x-oss-security-token:${tokenData.security_token}`,
    `x-oss-user-agent:${xOssUserAgent}`,
  ].join('\n') + '\n';
  const canonicalRequest = [
    'PUT',
    canonicalUri,
    '',
    canonicalHeaders,
    '',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const credentialScope = `${dateScope}/${region}/oss/aliyun_v4_request`;
  const stringToSign = [
    'OSS4-HMAC-SHA256',
    xOssDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmacSha256(new TextEncoder().encode(`aliyun_v4${tokenData.access_key_secret}`), dateScope);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, 'oss');
  const kSigning = await hmacSha256(kService, 'aliyun_v4_request');
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  return {
    'Accept': '*/*',
    'Content-Type': file.mimeType,
    'authorization': `OSS4-HMAC-SHA256 Credential=${tokenData.access_key_id}/${credentialScope},Signature=${signature}`,
    'x-oss-content-sha256': 'UNSIGNED-PAYLOAD',
    'x-oss-date': xOssDate,
    'x-oss-security-token': tokenData.security_token,
    'x-oss-user-agent': xOssUserAgent,
    'Referer': QWEN_WEB_REFERER,
  };
}

async function uploadFileToQwenOss(file, tokenData) {
  const uploadUrl = typeof tokenData.file_url === 'string' ? tokenData.file_url.split('?')[0] : '';
  if (!uploadUrl) {
    throw new Error('Upload failed: missing upload URL');
  }
  const signedHeaders = await buildOssSignedHeaders(tokenData.file_url, tokenData, file);
  const resp = await fetch(uploadUrl, {
    method: 'PUT',
    headers: signedHeaders,
    body: file.bytes,
  });
  if (!resp.ok) {
    const detail = await resp.text().catch(() => '');
    throw new Error(`Upload failed with status ${resp.status}${detail ? `: ${detail}` : ''}`);
  }
}

async function parseDocumentIfNeeded(qwenFilePayload, filetype, file, baxiaTokens) {
  if (filetype !== 'document') return;
  const resp = await fetch(`${QWEN_BASE_URL}/api/v2/files/parse`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json, text/plain, */*',
      'Content-Type': 'application/json',
      'bx-ua': baxiaTokens.bxUa,
      'bx-umidtoken': baxiaTokens.bxUmidToken,
      'bx-v': baxiaTokens.bxV,
      'source': 'web',
      'timezone': new Date().toUTCString(),
      'Referer': QWEN_WEB_REFERER,
      'x-request-id': uuidv4(),
    },
    body: JSON.stringify({ file_id: qwenFilePayload.id }),
  });
  const detail = await resp.text().catch(() => '');
  if (!resp.ok) {
    logChatDetail('core', 'attachments.parse.document.skip', {
      fileId: qwenFilePayload.id,
      filename: file.filename,
      status: resp.status,
      detail,
    });
    throw new Error(`Document parse failed with status ${resp.status}${detail ? `: ${detail}` : ''}`);
  }
  let payload = {};
  try {
    payload = detail ? JSON.parse(detail) : {};
  } catch {}
  if (payload && payload.success === false) {
    logChatDetail('core', 'attachments.parse.document.skip', {
      fileId: qwenFilePayload.id,
      filename: file.filename,
      status: resp.status,
      detail,
    });
    throw new Error(`Document parse rejected${payload?.msg ? `: ${payload.msg}` : ''}`);
  }
  logChatDetail('core', 'attachments.parse.document.done', {
    fileId: qwenFilePayload.id,
    filename: file.filename,
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureUploadStatusForNonVideo(filetype, baxiaTokens) {
  if (filetype === 'video') return;
  const maxAttempts = 6;
  let lastPayload = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch(`${QWEN_BASE_URL}/api/v2/users/status`, {
      method: 'POST',
      headers: {
        'Accept': 'application/json, text/plain, */*',
        'Content-Type': 'application/json',
        'bx-v': baxiaTokens.bxV,
        'source': 'web',
        'timezone': new Date().toUTCString(),
        'Referer': QWEN_WEB_REFERER,
        'x-request-id': uuidv4(),
      },
      body: JSON.stringify({
        typarms: {
          typarm1: 'web',
          typarm2: '',
          typarm3: 'prod',
          typarm4: 'qwen_chat',
          typarm5: 'product',
          orgid: 'tongyi',
        }
      }),
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`Upload status check failed with status ${resp.status}${detail ? `: ${detail}` : ''}`);
    }
    const payload = await resp.json().catch(() => ({}));
    lastPayload = payload;
    if (payload?.data === true) {
      return;
    }
    if (attempt < maxAttempts) {
      await sleep(400);
    }
  }
  throw new Error(`Upload status not ready for non-video file${lastPayload ? `: ${JSON.stringify(lastPayload)}` : ''}`);
}

function extractUploadedFileId(fileUrl) {
  try {
    const pathname = decodeURIComponent(new URL(fileUrl).pathname);
    const filename = pathname.split('/').pop() || '';
    if (filename.includes('_')) {
      return filename.split('_')[0];
    }
  } catch {}
  return uuidv4();
}

function buildQwenFilePayload(file, tokenData, filetype) {
  const now = Date.now();
  const id = normalizeInputString(tokenData?.file_id) || extractUploadedFileId(tokenData.file_url);
  const isDocument = filetype === 'document';
  const showType = isDocument ? 'file' : filetype;
  const fileClass = isDocument ? 'document' : (filetype === 'image' ? 'vision' : filetype);
  const fileSize = file.bytes.length;
  const fileMimeType = file.mimeType;
  const uploadTaskId = uuidv4();
  return {
    type: showType,
    file: {
      created_at: now,
      data: {},
      filename: file.filename,
      hash: null,
      id,
      meta: {
        name: file.filename,
        size: fileSize,
        content_type: fileMimeType,
      },
      update_at: now,
    },
    id,
    url: tokenData.file_url,
    name: file.filename,
    collection_name: '',
    progress: 0,
    status: 'uploaded',
    is_uploading: false,
    error: '',
    showType,
    file_class: fileClass,
    itemId: uuidv4(),
    greenNet: 'success',
    size: fileSize,
    file_type: fileMimeType,
    uploadTaskId,
  };
}

async function uploadAttachments(attachments, baxiaTokens) {
  logChatDetail('core', 'attachments.upload.start', { count: attachments.length });
  const files = [];
  for (let i = 0; i < attachments.length; i++) {
    const rawAttachment = attachments[i];
    const loaded = await getAttachmentBytes(rawAttachment);
    loaded.explicitType = rawAttachment.explicitType;
    logChatDetail('core', 'attachments.upload.file.prepare', {
      index: i,
      filename: loaded.filename,
      mimeType: loaded.mimeType,
      size: loaded.bytes.length,
    });
    const { tokenData, filetype } = await requestUploadToken(loaded, baxiaTokens);
    await uploadFileToQwenOss(loaded, tokenData);
    const qwenFilePayload = buildQwenFilePayload(loaded, tokenData, filetype);
    await ensureUploadStatusForNonVideo(filetype, baxiaTokens);
    await parseDocumentIfNeeded(qwenFilePayload, filetype, loaded, baxiaTokens);
    if (filetype === 'document') {
      await ensureUploadStatusForNonVideo(filetype, baxiaTokens);
    }
    files.push(qwenFilePayload);
    logChatDetail('core', 'attachments.upload.file.done', {
      index: i,
      filetype,
      filename: loaded.filename,
    });
  }
  logChatDetail('core', 'attachments.upload.done', { uploaded: files.length });
  return files;
}

// ============================================
// API Handlers
// ============================================

async function handleModels(authHeader, env) {
  if (!validateToken(authHeader, env)) {
    return createResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }
  try {
    const resp = await fetch(`${QWEN_BASE_URL}/api/models`, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'Mozilla/5.0' }
    });
    return createResponse(await resp.json());
  } catch {
    return createResponse({ error: { message: 'Failed to fetch models', type: 'api_error' } }, 500);
  }
}

async function handleImageGenerations(body, authHeader, env) {
  // OpenAI Images API compatible: POST /v1/images/generations
  // Request fields: prompt (required), model (optional), n (optional), size (optional), response_format (optional)
  if (!validateToken(authHeader, env)) {
    return createResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }

  const prompt = normalizeInputString(body?.prompt);
  if (!prompt) {
    return createResponse({ error: { message: 'prompt is required', type: 'invalid_request_error' } }, 400);
  }

  const actualModel = normalizeInputString(body?.model) || 'qwen3.5-plus';
  const nRaw = body?.n;
  let n = Number.isFinite(nRaw) ? Number(nRaw) : Number.parseInt(String(nRaw || ''), 10);
  if (!Number.isFinite(n) || n <= 0) n = 1;
  if (n > 10) n = 10;

  const responseFormat = normalizeInputString(body?.response_format) || 'url';
  if (responseFormat !== 'url' && responseFormat !== 'b64_json') {
    return createResponse({ error: { message: 'response_format must be one of url or b64_json', type: 'invalid_request_error' } }, 400);
  }

  const qwenRatio = mapOpenAiImageSizeToQwenRatio(body?.size);
  const { bxUa, bxUmidToken, bxV } = await getBaxiaTokens();

  // 创建 t2i 会话
  const createResp = await fetch(`${QWEN_BASE_URL}/api/v2/chats/new`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'bx-ua': bxUa,
      'bx-umidtoken': bxUmidToken,
      'bx-v': bxV,
      'Referer': QWEN_GUEST_REFERER,
      'source': 'web',
      'User-Agent': WEB_USER_AGENT,
      'Accept-Language': WEB_ACCEPT_LANGUAGE,
      'x-request-id': uuidv4(),
    },
    body: JSON.stringify({
      title: '新建对话',
      models: [actualModel],
      chat_mode: 'guest',
      chat_type: 't2i',
      timestamp: Date.now(),
      project_id: '',
    }),
  });
  const createParsed = await safeReadJson(createResp);
  if (!createParsed.ok) {
    return createResponse({
      error: {
        message: `Failed to create image chat session: upstream returned non-JSON response (HTTP ${createResp.status}).`,
        type: 'api_error',
      },
    }, createResp.ok ? 502 : createResp.status);
  }
  const createData = createParsed.data;
  if (!createData?.success || !createData?.data?.id) {
    return createResponse({ error: { message: 'Failed to create image chat session', type: 'api_error' } }, 500);
  }
  const chatId = createData.data.id;

  // 尽力把 n 映射给上游：上游未发现显式参数，只能通过 prompt 提示。
  const finalPrompt = n === 1 ? prompt : `${prompt}\n\n(Generate ${n} images.)`;

  const chatResp = await fetch(`${QWEN_BASE_URL}/api/v2/chat/completions?chat_id=${chatId}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'bx-ua': bxUa,
      'bx-umidtoken': bxUmidToken,
      'bx-v': bxV,
      'source': 'web',
      'version': '0.2.9',
      'Referer': QWEN_GUEST_REFERER,
      'User-Agent': WEB_USER_AGENT,
      'Accept-Language': WEB_ACCEPT_LANGUAGE,
      'x-request-id': uuidv4(),
    },
    body: JSON.stringify({
      stream: true,
      version: '2.1',
      incremental_output: true,
      chat_id: chatId,
      chat_mode: 'guest',
      model: actualModel,
      parent_id: null,
      messages: [{
        fid: uuidv4(),
        parentId: null,
        childrenIds: [uuidv4()],
        role: 'user',
        content: finalPrompt,
        user_action: 'chat',
        files: [],
        timestamp: Date.now(),
        models: [actualModel],
        chat_type: 't2i',
        feature_config: {
          thinking_enabled: true,
          output_schema: 'phase',
          research_mode: 'normal',
          auto_thinking: true,
          thinking_mode: 'Auto',
          thinking_format: 'summary',
          auto_search: true,
        },
        extra: { meta: { subChatType: 't2i' } },
        sub_chat_type: 't2i',
        parent_id: null,
      }],
      timestamp: Date.now(),
      size: qwenRatio,
    }),
  });

  if (!chatResp.ok) {
    const errorText = await chatResp.text().catch(() => '');
    return createResponse({ error: { message: errorText || `HTTP ${chatResp.status}`, type: 'api_error' } }, chatResp.status);
  }

  const reader = chatResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  const urls = extractImageUrlsFromUpstreamSse(buffer);
  if (!urls || urls.length === 0) {
    return createResponse({ error: { message: 'Upstream returned no image URLs', type: 'api_error' } }, 502);
  }

  const created = Math.floor(Date.now() / 1000);
  if (responseFormat === 'url') {
    return createResponse({
      created,
      data: urls.slice(0, n).map((u) => ({ url: u })),
    });
  }

  // b64_json
  try {
    const b64List = [];
    for (const u of urls.slice(0, n)) {
      b64List.push(await fetchImageAsBase64(u));
    }
    return createResponse({
      created,
      data: b64List.map((b64) => ({ b64_json: b64 })),
    });
  } catch (err) {
    const message = err && err.message ? err.message : 'Failed to fetch image bytes';
    return createResponse({ error: { message, type: 'api_error' } }, 502);
  }
}

async function handleChatCompletions(body, authHeader, env, streamWriter) {
  logChatDetail('core', 'request.entry', {
    hasAuthHeader: !!authHeader,
    bodyType: typeof body,
    hasMessages: !!body?.messages,
  });

  if (!validateToken(authHeader, env)) {
    logChatDetail('core', 'request.auth.failed', {});
    return createResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }

  const { model, messages, stream = true, tools } = body;
  if (!messages?.length) {
    logChatDetail('core', 'request.validation.failed', { reason: 'Messages are required' });
    return createResponse({ error: { message: 'Messages are required', type: 'invalid_request_error' } }, 400);
  }

  logChatDetail('core', 'request.received', {
    stream: !!stream,
    model: model || 'qwen3.5-plus',
    messageCount: Array.isArray(messages) ? messages.length : 0,
    hasTools: !!(tools && Array.isArray(tools) && tools.length > 0),
  });

  // 解析模型后缀，获取 cleanModel 和功能 flag
  const { cleanModel, enableThinking: suffixThinking, enableSearch: suffixSearch } = parseModelSuffix(model || 'qwen3.5-plus');
  
  // 解析 thinking 和 search 开关
  const { thinkingEnabled, thinkingBudget } = resolveThinking(body, { enableThinking: suffixThinking }, env);
  const enableSearch = resolveSearch(body, { enableSearch: suffixSearch }, env);
  
  const actualModel = cleanModel;
  const chatType = enableSearch ? 'search' : 't2t';
  
  logChatDetail('core', 'request.config', { 
    rawModel: model, 
    cleanModel: actualModel, 
    chatType, 
    enableSearch, 
    thinkingEnabled,
    thinkingBudget 
  });

  // 创建会话
  const createResp = await fetch(`${QWEN_BASE_URL}/api/v2/chats/new`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json', 'Content-Type': 'application/json',
      'bx-ua': bxUa, 'bx-umidtoken': bxUmidToken, 'bx-v': bxV,
      'Referer': QWEN_GUEST_REFERER, 'source': 'web',
      'User-Agent': WEB_USER_AGENT,
      'Accept-Language': WEB_ACCEPT_LANGUAGE,
      'x-request-id': uuidv4()
    },
    body: JSON.stringify({
      title: '新建对话', models: [actualModel], chat_mode: 'guest', chat_type: chatType,
      timestamp: Date.now(), project_id: ''
    })
  });
  const createParsed = await safeReadJson(createResp);
  if (!createParsed.ok) {
    logChatDetail('core', 'chat.create.parse.error', {
      status: createResp.status,
      contentType: createResp.headers.get('content-type') || '',
      bodyPreview: previewBody(createParsed.rawText),
      parseError: createParsed.parseError?.message || '',
    });
    return createResponse({
      error: {
        message: `Failed to create chat session: upstream returned non-JSON response (HTTP ${createResp.status}).`,
        type: 'api_error'
      }
    }, createResp.ok ? 502 : createResp.status);
  }
  const createData = createParsed.data;
  logChatDetail('core', 'chat.create.response', {
    status: createResp.status,
    success: !!createData?.success,
    hasChatId: !!createData?.data?.id,
  });
  if (!createData.success || !createData.data?.id) {
    return createResponse({ error: { message: 'Failed to create chat session', type: 'api_error' } }, 500);
  }
  const chatId = createData.data.id;

  // 解析 OpenAI 兼容消息与附件
  const parsedMessages = parseIncomingMessages(messages);
  const content = parsedMessages.content;
  logChatDetail('core', 'message.parsed', {
    contentLength: content.length,
    attachmentCount: parsedMessages.attachments.length,
  });
  const uploadedFiles = parsedMessages.attachments.length > 0
    ? await uploadAttachments(parsedMessages.attachments, { bxUa, bxUmidToken, bxV })
    : [];
  logChatDetail('core', 'message.ready', {
    uploadedFileCount: uploadedFiles.length,
  });

  // 发送请求
  const chatResp = await fetch(`${QWEN_BASE_URL}/api/v2/chat/completions?chat_id=${chatId}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json', 'Content-Type': 'application/json',
      'bx-ua': bxUa, 'bx-umidtoken': bxUmidToken, 'bx-v': bxV,
      'source': 'web', 'version': '0.2.9', 'Referer': QWEN_GUEST_REFERER,
      'User-Agent': WEB_USER_AGENT,
      'Accept-Language': WEB_ACCEPT_LANGUAGE,
      'x-request-id': uuidv4()
    },
    body: JSON.stringify({
      stream: true, version: '2.1', incremental_output: true,
      chat_id: chatId, chat_mode: 'guest', model: actualModel, parent_id: null,
      messages: [{
        fid: uuidv4(), parentId: null, childrenIds: [uuidv4()], role: 'user', content,
        user_action: 'chat', files: uploadedFiles, timestamp: Date.now(), models: [actualModel], chat_type: chatType,
        feature_config: { 
          thinking_enabled: thinkingEnabled, 
          output_schema: 'phase', 
          research_mode: 'normal', 
          auto_thinking: thinkingEnabled, 
          thinking_format: 'summary', 
          auto_search: enableSearch,
          ...(thinkingBudget != null ? { thinking_budget: thinkingBudget } : {})
        },
        extra: { meta: { subChatType: chatType } }, sub_chat_type: chatType, parent_id: null
      }],
      timestamp: Date.now()
    })
  });

  if (!chatResp.ok) {
    const errorText = await chatResp.text().catch(() => '');
    logChatDetail('core', 'chat.completion.error', { status: chatResp.status, chatId, error: errorText });
    return createResponse({ error: { message: errorText || `HTTP ${chatResp.status}`, type: 'api_error' } }, chatResp.status);
  }
  logChatDetail('core', 'chat.completion.started', { status: chatResp.status, chatId, stream: !!stream });

  const responseId = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);

  // 如果有流写入器 (Express)，使用真正的流式
  if (streamWriter && stream) {
    logChatDetail('core', 'stream.proxy.express', { chatId, model: actualModel });
    return streamWriter(chatResp, actualModel, responseId, created);
  }

  // 默认：收集完整响应
  const reader = chatResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  const parsedSse = parseQwenSsePayload(buffer);
  logChatDetail('core', 'chat.completion.collected', {
    chunkCount: parsedSse.events.length,
    outputLength: parsedSse.content.length,
    stream: !!stream,
  });
  logChatDetail('core', 'stream.content.full', {
    content: parsedSse.content,
  });

  if (stream) {
    logChatDetail('core', 'stream.repack.start', { chunkCount: parsedSse.events.length });
    const streamBody = parsedSse.events.map((event) => `data: ${JSON.stringify({
      id: responseId, object: 'chat.completion.chunk', created, model: actualModel,
      choices: [{ index: 0, delta: event.delta, finish_reason: event.finish_reason || null }]
    })}\n\n`).join('') + 'data: [DONE]\n\n';
    logChatDetail('core', 'stream.repack.done', { responseId });
    return createStreamResponse(streamBody);
  }

  return createResponse({
    id: responseId, object: 'chat.completion', created, model: actualModel,
    choices: [{ index: 0, message: { role: 'assistant', content: parsedSse.content, ...(parsedSse.reasoning_content ? { reasoning_content: parsedSse.reasoning_content } : {}) }, finish_reason: 'stop' }],
    usage: mapUsageToOpenAI(parsedSse.usage)
  });
}

function handleRoot() {
  const html = '<html><head><title>200 OK</title></head><body><center><h1>200 OK</h1></center><hr><center>nginx</center></body></html>';
  return createResponse(html, 200, { 'Content-Type': 'text/html' });
}

// Chat HTML 缓存 (开发模式禁用缓存)
let chatHtmlCache = null;

function getChatHtml() {
  const fs = require('fs');
  const path = require('path');
  const htmlPath = path.join(__dirname, 'chat.html');
  // 开发模式下每次都重新读取文件
  chatHtmlCache = fs.readFileSync(htmlPath, 'utf-8');
  return chatHtmlCache;
}

function handleChatPage() {
  const html = getChatHtml();
  return createResponse(html, 200, { 'Content-Type': 'text/html; charset=utf-8' });
}

// ============================================
// 视频下载 (yt-dlp)
// ============================================

let ytdlpEnsurePromise = null;

function isTruthyFlag(value, defaultValue = false) {
  if (value === undefined || value === null || value === '') return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, {
    ...options,
    signal: controller.signal,
  }).finally(() => {
    clearTimeout(timer);
  });
}

function resolveYtDlpAsset(platform, arch) {
  if (platform === 'win32') {
    if (arch === 'arm64') return { assetName: 'yt-dlp_arm64.exe', binaryName: 'yt-dlp.exe' };
    if (arch === 'ia32') return { assetName: 'yt-dlp_x86.exe', binaryName: 'yt-dlp.exe' };
    return { assetName: 'yt-dlp.exe', binaryName: 'yt-dlp.exe' };
  }
  if (platform === 'darwin') {
    return { assetName: 'yt-dlp_macos', binaryName: 'yt-dlp' };
  }
  if (platform === 'linux') {
    if (arch === 'arm64') return { assetName: 'yt-dlp_linux_aarch64', binaryName: 'yt-dlp' };
    return { assetName: 'yt-dlp_linux', binaryName: 'yt-dlp' };
  }
  throw new Error(`Unsupported platform for auto-install yt-dlp: ${platform}/${arch}`);
}

function canRunYtDlp(binaryPath) {
  const { spawnSync } = require('child_process');
  const result = spawnSync(binaryPath, ['--version'], {
    stdio: 'ignore',
    shell: false,
  });
  return result.status === 0;
}

async function ensureYtDlpAvailable(sendLog) {
  const fs = require('fs');
  const path = require('path');
  const os = require('os');
  const log = typeof sendLog === 'function' ? sendLog : () => {};
  const platform = process.platform;
  const arch = process.arch;
  const configuredPath = (process.env.YT_DLP_PATH || '').trim();
  if (configuredPath) {
    if (!canRunYtDlp(configuredPath)) {
      throw new Error(`YT_DLP_PATH is set but not executable: ${configuredPath}`);
    }
    return configuredPath;
  }

  if (canRunYtDlp('yt-dlp')) {
    return 'yt-dlp';
  }

  const autoDownload = isTruthyFlag(process.env.YT_DLP_AUTO_DOWNLOAD, true);
  if (!autoDownload) {
    throw new Error('yt-dlp not found and auto-download is disabled (YT_DLP_AUTO_DOWNLOAD=false).');
  }

  if (ytdlpEnsurePromise) {
    return ytdlpEnsurePromise;
  }

  ytdlpEnsurePromise = (async () => {
    const { assetName, binaryName } = resolveYtDlpAsset(platform, arch);
    const baseDir = path.join(os.tmpdir(), 'qwen2api_bin', 'yt-dlp');
    const binaryPath = path.join(baseDir, binaryName);
    const tempPath = `${binaryPath}.tmp-${process.pid}-${Date.now()}`;
    const downloadUrl = `https://github.com/yt-dlp/yt-dlp/releases/latest/download/${assetName}`;

    if (fs.existsSync(binaryPath) && canRunYtDlp(binaryPath)) {
      log('video.ytdlp.ready', { source: 'cached', binaryPath, platform, arch });
      return binaryPath;
    }

    log('video.ytdlp.download.start', { platform, arch, assetName, downloadUrl });
    fs.mkdirSync(baseDir, { recursive: true });

    let response;
    try {
      response = await fetchWithTimeout(downloadUrl, { method: 'GET' }, 45000);
    } catch (err) {
      throw new Error(`Failed to download yt-dlp: ${err.message}`);
    }

    if (!response.ok) {
      throw new Error(`Failed to download yt-dlp: HTTP ${response.status}`);
    }

    let bytes;
    try {
      const arrayBuffer = await response.arrayBuffer();
      bytes = Buffer.from(arrayBuffer);
      fs.writeFileSync(tempPath, bytes);

      if (platform !== 'win32') {
        fs.chmodSync(tempPath, 0o755);
      }

      fs.renameSync(tempPath, binaryPath);
    } finally {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {}
    }

    if (!canRunYtDlp(binaryPath)) {
      try {
        if (fs.existsSync(binaryPath)) {
          fs.unlinkSync(binaryPath);
        }
      } catch (cleanupErr) {
        log('video.ytdlp.cleanup.failed', { error: cleanupErr.message, binaryPath });
      }
      throw new Error(`yt-dlp downloaded but execution failed: ${binaryPath}`);
    }

    log('video.ytdlp.download.done', {
      binaryPath,
      size: bytes.length,
      platform,
      arch,
      assetName,
    });

    return binaryPath;
  })();

  try {
    return await ytdlpEnsurePromise;
  } finally {
    ytdlpEnsurePromise = null;
  }
}

function resolveMinVideoResolutionFromInput(rawValue) {
  const allowed = new Set([360, 480, 720]);
  if (rawValue === undefined || rawValue === null) return null;
  const text = String(rawValue).trim().toLowerCase();
  if (!text || text === 'default') return null;
  const numeric = Number.parseInt(text, 10);
  if (!Number.isFinite(numeric)) return null;
  return allowed.has(numeric) ? numeric : null;
}

function getEffectiveMinResolution(preferredResolution) {
  const fromWeb = resolveMinVideoResolutionFromInput(preferredResolution);
  if (fromWeb) {
    return { minResolution: fromWeb, source: 'web' };
  }
  const fromEnv = resolveMinVideoResolutionFromInput(process.env.MIN_VIDEO_RESOLUTION || '480');
  if (fromEnv) {
    return { minResolution: fromEnv, source: 'env' };
  }
  return { minResolution: 480, source: 'fallback' };
}

async function downloadVideoWithYtDlp(videoUrl, sendLog, preferredResolution) {
  const { spawn } = require('child_process');
  const path = require('path');
  const fs = require('fs');
  const os = require('os');

  // 从环境变量获取最低分辨率，默认 480p
  const resolutionInfo = getEffectiveMinResolution(preferredResolution);
  const minResolution = resolutionInfo.minResolution;

  return new Promise((resolve, reject) => {
    const tmpDir = path.join(os.tmpdir(), 'qwen2api_videos');
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }

    const outputFile = path.join(tmpDir, `video_${Date.now()}.mp4`);
    
    // 格式选择：优先选不高于目标高度的可用流，避免精确高度导致部分站点误判“格式不可用”
    // 兜底链：<=目标高度的视频音频分离 -> <=目标高度的单文件 -> 任意可用分离流 -> 任意 best
    const formatSelector = `bestvideo[height<=${minResolution}][vcodec!=none][acodec=none]+bestaudio[acodec!=none]/best[height<=${minResolution}]/bestvideo[vcodec!=none][acodec=none]+bestaudio[acodec!=none]/best`;

    sendLog('video.download.running', {
      videoUrl,
      minResolution: minResolution + 'p',
      minResolutionHint: 'height',
      resolutionSource: resolutionInfo.source,
      requestedResolution: preferredResolution === undefined ? null : String(preferredResolution),
      formatSelector,
    });

    let ytdlpBinary = 'yt-dlp';
    ensureYtDlpAvailable(sendLog).then((resolvedBinary) => {
      ytdlpBinary = resolvedBinary;
      const ytdlp = spawn(ytdlpBinary, [
        '-f', formatSelector,
        '--no-playlist',
        '--max-filesize', '100M',
        '-o', outputFile,
        '--no-warnings',
        '--merge-output-format', 'mp4',
        videoUrl
      ]);

      let stderr = '';
      
      ytdlp.stderr.on('data', (data) => {
        stderr += data.toString();
        // 解析下载进度
        const progressMatch = stderr.match(/(\d+\.?\d*)%/);
        if (progressMatch) {
          sendLog('video.download.progress', { progress: progressMatch[1] + '%' });
        }
      });

      ytdlp.on('close', (code) => {
        if (code !== 0) {
          // 失败时清理临时文件
          try {
            if (fs.existsSync(outputFile)) {
              fs.unlinkSync(outputFile);
            }
          } catch {}
          reject(new Error(`yt-dlp exited with code ${code}: ${stderr}`));
          return;
        }

        if (!fs.existsSync(outputFile)) {
          reject(new Error('Video file not found after download'));
          return;
        }

        try {
          const stats = fs.statSync(outputFile);
          const bytes = fs.readFileSync(outputFile);
          const sizeMB = (stats.size / 1024 / 1024).toFixed(2);
          
          sendLog('video.download.finished', {
            filepath: outputFile,
            size: stats.size,
            sizeMB: sizeMB + ' MB'
          });

          // 创建附件对象，格式与网页上传的一致
          const base64 = bytes.toString('base64');
          const dataUrl = `data:video/mp4;base64,${base64}`;
          
        const attachment = {
          source: dataUrl,
          filename: path.basename(outputFile),
          mimeType: 'video/mp4',
          explicitType: 'video',
          size: stats.size,
          sizeMB: sizeMB + ' MB',
          _tempFilePath: outputFile, // 保留临时文件路径，后续删除
        };

          resolve(attachment);
        } catch (err) {
          reject(err);
        }
      });

      ytdlp.on('error', (err) => {
        // 错误时清理临时文件
        try {
          if (fs.existsSync(outputFile)) {
            fs.unlinkSync(outputFile);
          }
        } catch (cleanupErr) {
          sendLog('video.download.cleanup.failed', { error: cleanupErr.message, outputFile });
        }
        if (err.code === 'ENOENT') {
          reject(new Error(`yt-dlp not found after ensure step. binary=${ytdlpBinary}`));
        } else {
          reject(err);
        }
      });
    }).catch((err) => {
      sendLog('video.ytdlp.ensure.failed', { error: err && err.message ? err.message : String(err) });
      reject(err);
    });
  });
}

// ============================================
// 带日志流式返回的 Chat Completions
// ============================================

function createLogStreamWriter(writer, onDone = null) {
  // writer 是一个对象，包含 write/log/end 方法
  return async (response, model, responseId, created, logStream) => {
    const reader = response.body?.getReader ? response.body.getReader() : null;
    const decoder = new TextDecoder();
    let buffer = '';
    let doneWritten = false;

    if (!reader) {
      throw new Error('Upstream response has no readable body');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trimStart();
          if (!trimmed.startsWith('data:')) continue;
          const data = trimmed.slice(5).trim();
          if (data === '[DONE]') {
            writer.write('data: [DONE]\n\n');
            doneWritten = true;
            continue;
          }

          try {
            const parsed = JSON.parse(data);
            if (parsed?.error) {
              const upstreamError = typeof parsed.error === 'string' ? { message: parsed.error } : parsed.error;
              const errorMsg = upstreamError.message || upstreamError.details || '请求失败';
              // 内容安全警告作为正常输出而不是错误
              if (upstreamError.code === 'data_inspection_failed' || upstreamError.details) {
                const warningChunk = {
                  id: responseId,
                  object: 'chat.completion.chunk',
                  created,
                  model,
                  choices: [{
                    index: 0,
                    delta: { role: 'assistant', content: errorMsg },
                    finish_reason: 'stop',
                  }],
                };
                writer.write(`data: ${JSON.stringify(warningChunk)}\n\n`);
                doneWritten = true;
                writer.write('data: [DONE]\n\n');
                continue;
              }
              const errObj = {
                error: {
                  message: errorMsg,
                  type: upstreamError.type || 'api_error',
                  code: upstreamError.code,
                }
              };
              writer.write(`data: ${JSON.stringify(errObj)}\n\n`);
              continue;
            }

            const delta = mapUpstreamDeltaToOpenAI(parsed?.choices?.[0]?.delta);
            if (delta || parsed?.choices?.[0]?.finish_reason) {
              const chunk = {
                id: responseId,
                object: 'chat.completion.chunk',
                created,
                model,
                choices: [{
                  index: 0,
                  delta: delta || {},
                  finish_reason: parsed?.choices?.[0]?.finish_reason || null,
                }],
              };
              writer.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
          } catch {}
        }
      }
    } catch (err) {
      const message = err && err.message ? err.message : 'stream proxy error';
      writer.write(`data: ${JSON.stringify({ error: { message, type: 'api_error' } })}\n\n`);
    } finally {
      if (!doneWritten) {
        writer.write('data: [DONE]\n\n');
      }
      writer.end();
      // 执行清理回调
      if (onDone) {
        try {
          onDone();
        } catch {}
      }
    }
  };
}

async function handleChatCompletionsWithLogs(body, authHeader, env, streamWriter) {
  logChatDetail('core', 'request.entry', {
    hasAuthHeader: !!authHeader,
    bodyType: typeof body,
    hasMessages: !!body?.messages,
  });

  // 验证 token
  if (!validateToken(authHeader, env)) {
    logChatDetail('core', 'request.auth.failed', {});
    return createResponse({ error: { message: 'Incorrect API key provided.', type: 'invalid_request_error' } }, 401);
  }

  const { model, messages, stream = true, tools } = body;
  if (!messages?.length) {
    logChatDetail('core', 'request.validation.failed', { reason: 'Messages are required' });
    return createResponse({ error: { message: 'Messages are required', type: 'invalid_request_error' } }, 400);
  }

  // 日志辅助函数
  const sendLog = (event, detail = {}) => {
    const logData = JSON.stringify({ event, timestamp: Date.now(), ...detail });
    if (streamWriter && streamWriter.log) {
      streamWriter.log(logData);
    }
  };

  logChatDetail('core', 'request.received', {
    stream: !!stream,
    model: model || 'qwen3.5-plus',
    messageCount: Array.isArray(messages) ? messages.length : 0,
    hasTools: !!(tools && Array.isArray(tools) && tools.length > 0),
  });
  sendLog('request.received', { model: model || 'qwen3.5-plus', messageCount: messages.length });

  // 解析模型后缀，获取 cleanModel 和功能 flag
  const { cleanModel, enableThinking: suffixThinking, enableSearch: suffixSearch } = parseModelSuffix(model || 'qwen3.5-plus');
  
  // 解析 thinking 和 search 开关
  const { thinkingEnabled, thinkingBudget } = resolveThinking(body, { enableThinking: suffixThinking }, env);
  const enableSearch = resolveSearch(body, { enableSearch: suffixSearch }, env);
  
  const actualModel = cleanModel;
  const chatType = enableSearch ? 'search' : 't2t';
  
  logChatDetail('core', 'request.config', { 
    rawModel: model, 
    cleanModel: actualModel, 
    chatType, 
    enableSearch, 
    thinkingEnabled,
    thinkingBudget 
  });
  sendLog('config.ready', { model: actualModel, chatType, enableSearch, thinkingEnabled });

  // 创建会话
  sendLog('chat.creating', {});
  const createResp = await fetch(`${QWEN_BASE_URL}/api/v2/chats/new`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json', 'Content-Type': 'application/json',
      'bx-ua': bxUa, 'bx-umidtoken': bxUmidToken, 'bx-v': bxV,
      'Referer': QWEN_GUEST_REFERER, 'source': 'web',
      'User-Agent': WEB_USER_AGENT,
      'Accept-Language': WEB_ACCEPT_LANGUAGE,
      'x-request-id': uuidv4()
    },
    body: JSON.stringify({
      title: '新建对话', models: [actualModel], chat_mode: 'guest', chat_type: chatType,
      timestamp: Date.now(), project_id: ''
    })
  });
  const createParsed = await safeReadJson(createResp);
  if (!createParsed.ok) {
    const bodyPreview = previewBody(createParsed.rawText);
    const looksLikeHtmlBlock = /^\s*<!doctype|^\s*<html/i.test(createParsed.rawText || '');
    logChatDetail('core', 'chat.create.parse.error', {
      status: createResp.status,
      contentType: createResp.headers.get('content-type') || '',
      bodyPreview,
      parseError: createParsed.parseError?.message || '',
    });
    sendLog('chat.create.failed', {
      status: createResp.status,
      error: 'non-json-response',
      contentType: createResp.headers.get('content-type') || '',
      bodyPreview,
      blockedLikely: looksLikeHtmlBlock,
    });
    return createResponse({
      error: {
        message: `Failed to create chat session: upstream returned non-JSON response (HTTP ${createResp.status}).`,
        type: 'api_error'
      }
    }, createResp.ok ? 502 : createResp.status);
  }
  const createData = createParsed.data;
  logChatDetail('core', 'chat.create.response', {
    status: createResp.status,
    success: !!createData?.success,
    hasChatId: !!createData?.data?.id,
  });
  if (!createResp.ok || !createData.success || !createData.data?.id) {
    const errorMsg = createData?.message || createData?.msg || createData?.error || `HTTP ${createResp.status}`;
    logChatDetail('core', 'chat.create.error', { status: createResp.status, error: errorMsg });
    sendLog('chat.create.failed', { status: createResp.status, error: errorMsg, response: createData });
    return createResponse({ error: { message: `Failed to create chat session: ${errorMsg}`, type: 'api_error' } }, createResp.ok ? 500 : createResp.status);
  }
  const chatId = createData.data.id;
  sendLog('chat.created', { chatId });

  // 解析消息与附件
  const parsedMessages = parseIncomingMessages(messages);
  const content = parsedMessages.content;
  logChatDetail('core', 'message.parsed', {
    contentLength: content.length,
    attachmentCount: parsedMessages.attachments.length,
  });
  sendLog('message.parsed', { contentLength: content.length, attachmentCount: parsedMessages.attachments.length });

  // 临时文件路径收集（用于后续清理）
  const tempFilesToClean = [];

  // 处理视频链接下载
  const videoUrl = body.video_url;
  const preferredResolution = body?.min_video_resolution;
  if (videoUrl) {
    sendLog('video.download.start', {
      videoUrl,
      preferredResolution: preferredResolution === undefined ? null : String(preferredResolution),
    });
    try {
      const videoAttachment = await downloadVideoWithYtDlp(videoUrl, sendLog, preferredResolution);
      if (videoAttachment) {
        parsedMessages.attachments.push(videoAttachment);
        // 记录临时文件路径
        if (videoAttachment._tempFilePath) {
          tempFilesToClean.push(videoAttachment._tempFilePath);
        }
        sendLog('video.download.completed', {
          filename: videoAttachment.filename,
          size: videoAttachment.size || 0,
          sizeMB: videoAttachment.sizeMB || '',
        });
      }
    } catch (err) {
      const errorMessage = err && err.message ? err.message : String(err);
      sendLog('video.download.failed', { error: errorMessage });
      return createResponse({
        error: {
          message: `Video download failed: ${errorMessage}`,
          type: 'api_error'
        }
      }, 500);
    }
  }

  // 上传附件
  let uploadedFiles = [];
  if (parsedMessages.attachments.length > 0) {
    sendLog('attachments.upload.start', { count: parsedMessages.attachments.length });
    for (let i = 0; i < parsedMessages.attachments.length; i++) {
      const rawAttachment = parsedMessages.attachments[i];
      sendLog('attachment.uploading', { index: i + 1, filename: rawAttachment.filename || 'unknown' });
      
      try {
        const loaded = await getAttachmentBytes(rawAttachment);
        loaded.explicitType = rawAttachment.explicitType;
        const { tokenData, filetype } = await requestUploadToken(loaded, { bxUa, bxUmidToken, bxV });
        await uploadFileToQwenOss(loaded, tokenData);
        const qwenFilePayload = buildQwenFilePayload(loaded, tokenData, filetype);
        await ensureUploadStatusForNonVideo(filetype, { bxUa, bxUmidToken, bxV });
        await parseDocumentIfNeeded(qwenFilePayload, filetype, loaded, { bxUa, bxUmidToken, bxV });
        if (filetype === 'document') {
          await ensureUploadStatusForNonVideo(filetype, { bxUa, bxUmidToken, bxV });
        }
        uploadedFiles.push(qwenFilePayload);
        sendLog('attachment.uploaded', { index: i + 1, filetype, filename: loaded.filename });
      } catch (err) {
        const errorMessage = err && err.message ? err.message : String(err);
        sendLog('attachment.upload.failed', { index: i + 1, error: errorMessage });
        return createResponse({
          error: {
            message: `Attachment upload failed (index ${i + 1}): ${errorMessage}`,
            type: 'api_error'
          }
        }, 500);
      }
    }
    sendLog('attachments.upload.done', { uploadedCount: uploadedFiles.length });
  }

  logChatDetail('core', 'message.ready', {
    uploadedFileCount: uploadedFiles.length,
  });

  // 发送请求
  sendLog('chat.sending', { chatId });
  const chatResp = await fetch(`${QWEN_BASE_URL}/api/v2/chat/completions?chat_id=${chatId}`, {
    method: 'POST',
    headers: {
      'Accept': 'application/json', 'Content-Type': 'application/json',
      'bx-ua': bxUa, 'bx-umidtoken': bxUmidToken, 'bx-v': bxV,
      'source': 'web', 'version': '0.2.9', 'Referer': QWEN_GUEST_REFERER,
      'User-Agent': WEB_USER_AGENT,
      'Accept-Language': WEB_ACCEPT_LANGUAGE,
      'x-request-id': uuidv4()
    },
    body: JSON.stringify({
      stream: true, version: '2.1', incremental_output: true,
      chat_id: chatId, chat_mode: 'guest', model: actualModel, parent_id: null,
      messages: [{
        fid: uuidv4(), parentId: null, childrenIds: [uuidv4()], role: 'user', content,
        user_action: 'chat', files: uploadedFiles, timestamp: Date.now(), models: [actualModel], chat_type: chatType,
        feature_config: { 
          thinking_enabled: thinkingEnabled, 
          output_schema: 'phase', 
          research_mode: 'normal', 
          auto_thinking: thinkingEnabled, 
          thinking_format: 'summary', 
          auto_search: enableSearch,
          ...(thinkingBudget != null ? { thinking_budget: thinkingBudget } : {})
        },
        extra: { meta: { subChatType: chatType } }, sub_chat_type: chatType, parent_id: null
      }],
      timestamp: Date.now()
    })
  });

  if (!chatResp.ok) {
    const errorText = await chatResp.text().catch(() => '');
    logChatDetail('core', 'chat.completion.error', { status: chatResp.status, chatId, error: errorText });
    sendLog('chat.response.failed', { status: chatResp.status, error: errorText });
    return createResponse({ error: { message: errorText || `HTTP ${chatResp.status}`, type: 'api_error' } }, chatResp.status);
  }

  logChatDetail('core', 'chat.completion.started', { status: chatResp.status, chatId, stream: !!stream });
  sendLog('chat.streaming', {});

  const responseId = `chatcmpl-${uuidv4()}`;
  const created = Math.floor(Date.now() / 1000);

  // 清理临时视频文件的函数
  const cleanupTempFiles = () => {
    const fs = require('fs');
    for (const tempFile of tempFilesToClean) {
      try {
        if (fs.existsSync(tempFile)) {
          fs.unlinkSync(tempFile);
          sendLog('video.tempfile.cleaned', { file: tempFile });
        }
      } catch {}
    }
  };

  // 如果有流写入器，使用流式处理
  if (streamWriter && stream) {
    logChatDetail('core', 'stream.proxy.express', { chatId, model: actualModel });
    const logAwareWriter = createLogStreamWriter(streamWriter, cleanupTempFiles);
    return logAwareWriter(chatResp, actualModel, responseId, created);
  }

  // 非 Express 环境：收集完整响应
  const reader = chatResp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
  }
  const parsedSse = parseQwenSsePayload(buffer);

  logChatDetail('core', 'chat.completion.collected', {
    chunkCount: parsedSse.events.length,
    outputLength: parsedSse.content.length,
    stream: !!stream,
  });
  logChatDetail('core', 'stream.content.full', {
    content: parsedSse.content,
  });
  sendLog('chat.completed', { outputLength: parsedSse.content.length });

  // 清理临时视频文件
  cleanupTempFiles();

  if (stream) {
    logChatDetail('core', 'stream.repack.start', { chunkCount: parsedSse.events.length });
    const streamBody = parsedSse.events.map((event) => `data: ${JSON.stringify({
      id: responseId, object: 'chat.completion.chunk', created, model: actualModel,
      choices: [{ index: 0, delta: event.delta, finish_reason: event.finish_reason || null }]
    })}\n\n`).join('') + 'data: [DONE]\n\n';
    logChatDetail('core', 'stream.repack.done', { responseId });
    return createStreamResponse(streamBody);
  }

  return createResponse({
    id: responseId, object: 'chat.completion', created, model: actualModel,
    choices: [{ index: 0, message: { role: 'assistant', content: parsedSse.content, ...(parsedSse.reasoning_content ? { reasoning_content: parsedSse.reasoning_content } : {}) }, finish_reason: 'stop' }],
    usage: mapUsageToOpenAI(parsedSse.usage)
  });
}

// ============================================
// 导出
// ============================================

module.exports = {
  handleModels,
  handleChatCompletions,
  handleChatCompletionsWithLogs,
  handleImageGenerations,
  handleRoot,
  handleChatPage,
  createResponse,
  validateToken,
  getBaxiaTokens,
  mapUpstreamDeltaToOpenAI,
  parseQwenSsePayload,
  mapUsageToOpenAI,
  uuidv4,
};
