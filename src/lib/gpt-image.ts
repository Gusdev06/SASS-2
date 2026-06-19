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
 * When `imageInput` is provided we hit the separate `/images/edits` endpoint
 * (multipart, up to 16 `image[]` files) so the references are actually used;
 * with no images we fall back to text → image `/generations`.
 */

const API_URL = 'https://api.openai.com/v1/images/generations';
const EDIT_API_URL = 'https://api.openai.com/v1/images/edits';
/** OpenAI edits endpoint accepts at most 16 input images. */
const MAX_EDIT_IMAGES = 16;
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

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/webp': 'webp',
};

/** Shared response reader — both endpoints return `{ data: [{ b64_json }] }`. */
async function readImageResponse(res: Response, format: GptImageFormat): Promise<string> {
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
}

/** Turn a `data:` URI or http(s) URL into a Blob + filename for multipart upload. */
async function toBlobPart(src: string, idx: number): Promise<{ blob: Blob; filename: string }> {
  const dataMatch = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(src);
  let mime: string;
  let buf: Buffer;
  if (dataMatch) {
    mime = dataMatch[1] || 'image/png';
    buf = Buffer.from(dataMatch[2], 'base64');
  } else {
    const res = await fetch(src);
    if (!res.ok) {
      throw new ImageEngineError('invalid_input', `failed to fetch reference image (${res.status})`, 0);
    }
    mime = res.headers.get('content-type')?.split(';')[0] || 'image/png';
    buf = Buffer.from(await res.arrayBuffer());
  }
  // Node Buffer is a valid BlobPart at runtime; the cast just bridges the lib types.
  const blob = new Blob([buf as unknown as BlobPart], { type: mime });
  return { blob, filename: `image_${idx}.${EXT_BY_MIME[mime] ?? 'png'}` };
}

async function callOpenAIEdit(
  prompt: string,
  imageInput: string[],
  opts: GptImageOptions
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  const format: GptImageFormat = opts.outputFormat ?? 'png';
  try {
    const parts = await Promise.all(
      imageInput.slice(0, MAX_EDIT_IMAGES).map((src, i) => toBlobPart(src, i))
    );
    const form = new FormData();
    form.set('model', MODEL);
    form.set('prompt', prompt);
    form.set('n', '1');
    form.set('size', opts.size ?? '1024x1024');
    if (opts.quality) form.set('quality', opts.quality);
    if (opts.background) form.set('background', opts.background);
    if (opts.moderation) form.set('moderation', opts.moderation);
    form.set('output_format', format);
    if (typeof opts.outputCompression === 'number' && format !== 'png') {
      form.set('output_compression', String(opts.outputCompression));
    }
    // `image[]` lets a single request carry multiple reference images.
    for (const part of parts) form.append('image[]', part.blob, part.filename);

    const res = await fetch(EDIT_API_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${API_KEY}` }, // no Content-Type — fetch sets the multipart boundary
      body: form,
      signal: controller.signal,
    });
    return await readImageResponse(res, format);
  } finally {
    clearTimeout(timer);
  }
}

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
    return await readImageResponse(res, format);
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
 * With `imageInput` present, the references are sent to the `/images/edits`
 * endpoint (up to 16); otherwise it's a text-only `/generations` call.
 */
export async function generateImage(
  prompt: string,
  imageInput?: string[],
  opts: GptImageOptions = {}
): Promise<string> {
  if (!API_KEY) throw new ImageEngineError('auth_missing', 'OPENAI_API_KEY not set', 0);

  const hasImages = !!imageInput && imageInput.length > 0;

  let lastCode: ImageEngineErrorCode = 'unknown';
  let lastMessage = 'unknown';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return hasImages
        ? await callOpenAIEdit(prompt, imageInput!, opts)
        : await callOpenAI(prompt, opts);
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
