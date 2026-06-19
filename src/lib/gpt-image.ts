/**
 * GPT Image engine — OpenAI `/v1/images/generations`.
 *
 * Drop-in sibling of the Replicate / Vertex engines: exposes the same
 * `generateImage(prompt, imageInput?, opts?)` signature and `ImageEngineError`
 * contract, so callers in `actions/generate.ts` are unchanged.
 *
 *   POST https://api.openai.com/v1/images/generations
 *   header: Authorization: Bearer $OPENAI_API_KEY
 *   body:   { model: 'gpt-image-2', prompt, n, size, ... }
 *   resp:   { created, data: [{ b64_json }], usage }
 *
 * GPT image models always return base64 (never a URL), so we return a
 * `data:image/<fmt>;base64,...` URI — the same shape Vertex returns.
 *
 * NOTE: the `/generations` endpoint is text → image only and does NOT accept
 * input images (that is the separate `/images/edits` endpoint). `imageInput`
 * is therefore ignored here.
 */

const API_URL = 'https://api.openai.com/v1/images/generations';
const API_KEY = process.env.OPENAI_API_KEY ?? '';

/** Fixed model — not configurable per request. */
const MODEL = 'gpt-image-2';

/**
 * Standard sizes (plus `auto`). `gpt-image-2` also accepts arbitrary
 * `WIDTHxHEIGHT` strings — both divisible by 16, aspect ratio between 1:3
 * and 3:1 — so the `size` option below allows any string.
 */
export const GPT_IMAGE_SIZES = ['auto', '1024x1024', '1536x1024', '1024x1536'] as const;
export type GptImageSize = (typeof GPT_IMAGE_SIZES)[number] | (string & {});

export const GPT_IMAGE_QUALITIES = ['auto', 'low', 'medium', 'high'] as const;
export type GptImageQuality = (typeof GPT_IMAGE_QUALITIES)[number];

export const GPT_IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const;
export type GptImageFormat = (typeof GPT_IMAGE_FORMATS)[number];

export const GPT_IMAGE_BACKGROUNDS = ['auto', 'transparent', 'opaque'] as const;
export type GptImageBackground = (typeof GPT_IMAGE_BACKGROUNDS)[number];

export type GptImageOptions = {
  size?: GptImageSize;
  quality?: GptImageQuality;
  outputFormat?: GptImageFormat;
  background?: GptImageBackground;
  /** 0-100, only for jpeg/webp. */
  outputCompression?: number;
  /** 'low' loosens content filtering; 'auto' is the default. */
  moderation?: 'low' | 'auto';
};

// Per-attempt cap. Must stay below the calling route's maxDuration (300s) — a
// single slow gpt-image-2 render rarely exceeds this; a timed-out attempt may
// still retry once, so keep this well under the function budget.
const GENERATION_TIMEOUT_MS = 180_000;
const MAX_ATTEMPTS = 2;
const BACKOFF_BASE_MS = 1500;

export type ImageEngineErrorCode =
  | 'timeout'
  | 'auth_missing'
  | 'rate_limited'
  | 'content_rejected'
  | 'invalid_input'
  | 'upstream_5xx'
  | 'network'
  | 'unexpected_response'
  | 'unknown';

export class ImageEngineError extends Error {
  code: ImageEngineErrorCode;
  attempts: number;
  detail?: string;
  constructor(code: ImageEngineErrorCode, message: string, attempts: number, detail?: string) {
    super(message);
    this.name = 'ImageEngineError';
    this.code = code;
    this.attempts = attempts;
    this.detail = detail;
  }
}

const TRANSIENT = new Set<ImageEngineErrorCode>([
  'timeout',
  'upstream_5xx',
  'network',
  'unexpected_response',
  'rate_limited',
]);

function classifyStatus(status: number, body: string): { code: ImageEngineErrorCode; message: string } {
  if (status === 401 || status === 403) return { code: 'auth_missing', message: `openai auth ${status}` };
  if (status === 429) return { code: 'rate_limited', message: 'openai rate limit (429)' };
  if (status === 400 || status === 422) {
    if (/safety|moderation|policy|rejected|content_policy|sensitive|flagged|blocked/i.test(body)) {
      return { code: 'content_rejected', message: 'content rejected by provider' };
    }
    return { code: 'invalid_input', message: `openai rejected input (${status})` };
  }
  if (status >= 500) return { code: 'upstream_5xx', message: `openai ${status}` };
  return { code: 'unknown', message: `openai ${status}: ${body.slice(0, 200)}` };
}

const MIME_BY_FORMAT: Record<GptImageFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

async function callOpenAI(prompt: string, opts: GptImageOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  const format: GptImageFormat = opts.outputFormat ?? 'png';
  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        prompt,
        n: 1,
        size: opts.size ?? '1024x1024',
        ...(opts.quality ? { quality: opts.quality } : {}),
        ...(opts.background ? { background: opts.background } : {}),
        ...(opts.moderation ? { moderation: opts.moderation } : {}),
        output_format: format,
        ...(typeof opts.outputCompression === 'number' && format !== 'png'
          ? { output_compression: opts.outputCompression }
          : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const { code, message } = classifyStatus(res.status, body);
      throw new ImageEngineError(code, message, 0, body.slice(0, 300));
    }

    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string }>;
      output_format?: GptImageFormat;
    };
    const b64 = json.data?.[0]?.b64_json;
    if (!b64) {
      throw new ImageEngineError('unexpected_response', 'no image in openai response', 0);
    }
    const mime = MIME_BY_FORMAT[json.output_format ?? format] ?? 'image/png';
    return `data:${mime};base64,${b64}`;
  } finally {
    clearTimeout(timer);
  }
}

function classifyThrown(err: unknown): { code: ImageEngineErrorCode; message: string } {
  if (err instanceof ImageEngineError) return { code: err.code, message: err.message };
  const msg = err instanceof Error ? err.message : String(err);
  if (err instanceof Error && err.name === 'AbortError') {
    return { code: 'timeout', message: 'generation timed out' };
  }
  if (/network|fetch failed|ENOTFOUND|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket/i.test(msg)) {
    return { code: 'network', message: msg };
  }
  return { code: 'unknown', message: msg };
}

/**
 * Generate an image from a text prompt with GPT Image (`gpt-image-2`).
 * Returns a `data:image/<fmt>;base64,...` URI.
 *
 * `imageInput` is accepted for signature parity with the other engines but
 * ignored — the `/generations` endpoint is text-only.
 */
export async function generateImage(
  prompt: string,
  _imageInput?: string[],
  opts: GptImageOptions = {}
): Promise<string> {
  if (!API_KEY) throw new ImageEngineError('auth_missing', 'OPENAI_API_KEY not set', 0);

  let lastCode: ImageEngineErrorCode = 'unknown';
  let lastMessage = 'unknown';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callOpenAI(prompt, opts);
    } catch (err) {
      const { code, message } = classifyThrown(err);
      lastCode = code;
      lastMessage = message;

      console.error('[gpt-image] attempt fail', { attempt, code, message });

      const isLast = attempt === MAX_ATTEMPTS;
      if (!TRANSIENT.has(code) || isLast) {
        throw new ImageEngineError(code, message, attempt);
      }

      const backoff = BACKOFF_BASE_MS * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 400);
      await new Promise((r) => setTimeout(r, backoff));
    }
  }

  throw new ImageEngineError(lastCode, lastMessage, MAX_ATTEMPTS);
}
