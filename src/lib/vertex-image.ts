/**
 * Vertex AI image engine — drop-in replacement for the Replicate engine.
 *
 * Talks to the self-hosted Vertex proxy backend (NestJS) which fronts Google
 * Vertex AI (Gemini Image) with GCP account rotation. We use the Gemini
 * endpoint because every flow here edits a reference photo (undress / faceswap
 * / enhance / edit), and Gemini accepts input images and returns base64.
 *
 *   POST {VERTEX_API_URL}/api/image/generate-gemini
 *   header: x-api-key
 *   body:   { prompt, model, images: [{ base64, mime_type }] }
 *   resp:   { parts: [{ type: 'image', base64, mimeType }, ...] }
 *
 * Exposes the same `generateImage(prompt, imageInput?)` signature and
 * `ImageEngineError` contract as the previous engine, so callers are unchanged.
 * Returns a `data:<mime>;base64,...` URI of the generated image.
 */

const BASE_URL = (process.env.VERTEX_API_URL ?? '').replace(/\/+$/, '');
const API_KEY = process.env.VERTEX_API_KEY ?? '';

/** Nano Banana model line — both routed through the Gemini (editing) endpoint. */
export const NANO_BANANA_MODELS = {
  pro: 'gemini-3-pro-image-preview', // Nano Banana Pro
  v2: 'gemini-3.1-flash-image-preview', // Nano Banana 2
} as const;

export type NanoBananaModel = (typeof NANO_BANANA_MODELS)[keyof typeof NANO_BANANA_MODELS];

const ALLOWED_MODELS = new Set<string>(Object.values(NANO_BANANA_MODELS));
const DEFAULT_MODEL: NanoBananaModel = NANO_BANANA_MODELS.pro;

/** Aspect ratios accepted by the Gemini image endpoint. */
export const ASPECT_RATIOS = ['1:1', '3:2', '2:3', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'] as const;
export type AspectRatio = (typeof ASPECT_RATIOS)[number];

/** Output resolution (quality). */
export const IMAGE_SIZES = ['1K', '2K', '4K'] as const;
export type ImageSize = (typeof IMAGE_SIZES)[number];

export type NanoBananaOptions = {
  model?: string;
  aspectRatio?: string;
  imageSize?: string;
  mimeType?: string;
};

function resolveModel(model?: string): NanoBananaModel {
  return (model && ALLOWED_MODELS.has(model) ? model : DEFAULT_MODEL) as NanoBananaModel;
}

const GENERATION_TIMEOUT_MS = 110_000;
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

type InlineImage = { base64: string; mime_type: string };

/** Accepts a `data:` URI or an http(s) URL and returns base64 + mime for Vertex. */
async function toInlineImage(src: string): Promise<InlineImage> {
  const dataMatch = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(src);
  if (dataMatch) {
    return { mime_type: dataMatch[1] || 'image/jpeg', base64: dataMatch[2] };
  }
  // Remote URL (e.g. a previously generated/hosted asset): fetch + encode.
  const res = await fetch(src);
  if (!res.ok) throw new Error(`failed to fetch reference image (${res.status})`);
  const buf = Buffer.from(await res.arrayBuffer());
  const mime = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
  return { mime_type: mime, base64: buf.toString('base64') };
}

function classifyStatus(status: number, body: string): { code: ImageEngineErrorCode; message: string } {
  if (status === 401 || status === 403) return { code: 'auth_missing', message: `vertex auth ${status}` };
  if (status === 422) return { code: 'invalid_input', message: 'vertex rejected input (422)' };
  if (status === 429) return { code: 'rate_limited', message: 'vertex rate limit (429)' };
  if (status === 400) {
    if (/safety|nsfw|moderation|policy|sensitive|flagged|blocked/i.test(body)) {
      return { code: 'content_rejected', message: 'content rejected by provider' };
    }
    return { code: 'invalid_input', message: 'vertex bad request (400)' };
  }
  if (status === 503) return { code: 'upstream_5xx', message: 'vertex accounts unavailable (503)' };
  if (status >= 500) return { code: 'upstream_5xx', message: `vertex ${status}` };
  return { code: 'unknown', message: `vertex ${status}: ${body.slice(0, 200)}` };
}

async function callGemini(
  prompt: string,
  images: InlineImage[],
  opts: { model: NanoBananaModel; aspectRatio?: string; imageSize?: string; mimeType?: string }
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GENERATION_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/image/generate-gemini`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': API_KEY },
      body: JSON.stringify({
        prompt,
        model: opts.model,
        person_generation: 'ALLOW_ALL',
        ...(opts.aspectRatio ? { aspect_ratio: opts.aspectRatio } : {}),
        ...(opts.imageSize ? { image_size: opts.imageSize } : {}),
        ...(opts.mimeType ? { mime_type: opts.mimeType } : {}),
        ...(images.length ? { images } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const { code, message } = classifyStatus(res.status, body);
      throw new ImageEngineError(code, message, 0, body.slice(0, 300));
    }

    const json = (await res.json()) as {
      parts?: Array<{ type: string; base64?: string; mimeType?: string; text?: string }>;
    };
    const image = json.parts?.find((p) => p.type === 'image' && p.base64);
    if (!image?.base64) {
      throw new ImageEngineError('content_rejected', 'no image generated', 0);
    }
    return `data:${image.mimeType || 'image/png'};base64,${image.base64}`;
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

export async function generateImage(
  prompt: string,
  imageInput?: string[],
  opts: NanoBananaOptions = {}
): Promise<string> {
  if (!BASE_URL) throw new ImageEngineError('auth_missing', 'VERTEX_API_URL not set', 0);
  if (!API_KEY) throw new ImageEngineError('auth_missing', 'VERTEX_API_KEY not set', 0);

  const callOpts = {
    model: resolveModel(opts.model),
    aspectRatio: opts.aspectRatio,
    imageSize: opts.imageSize,
    mimeType: opts.mimeType,
  };
  let images: InlineImage[] = [];
  if (imageInput?.length) {
    try {
      images = await Promise.all(imageInput.map(toInlineImage));
    } catch (err) {
      throw new ImageEngineError('invalid_input', err instanceof Error ? err.message : 'bad reference image', 0);
    }
  }

  let lastCode: ImageEngineErrorCode = 'unknown';
  let lastMessage = 'unknown';

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      return await callGemini(prompt, images, callOpts);
    } catch (err) {
      const { code, message } = classifyThrown(err);
      lastCode = code;
      lastMessage = message;

      console.error('[vertex-image] attempt fail', { attempt, code, message });

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
