/**
 * kie.ai image engine — used as a FALLBACK when the primary engine (Vertex /
 * Nano Banana, GPT Image, Replicate) fails to produce an image.
 *
 * kie.ai exposes the Nano Banana family through an async job API:
 *
 *   POST {KIE_BASE}/api/v1/jobs/createTask   -> { data: { taskId } }
 *   GET  {KIE_BASE}/api/v1/jobs/recordInfo?taskId=...
 *        -> { data: { state: 'waiting'|'success'|'fail', resultJson, failMsg } }
 *
 * We create the task, then poll `recordInfo` until it succeeds or fails.
 * Reference images must be public URLs, so `data:` URIs are first uploaded to
 * Supabase storage. Returns the hosted result URL (the same shape the other
 * engines return, ready for `persistGeneration`).
 *
 * Reuses the `ImageEngineError` contract from the Vertex engine.
 */

import { ImageEngineError, type ImageEngineErrorCode } from '@/lib/vertex-image';
import { uploadBufferToSupabase } from '@/lib/storage';

const BASE_URL = (process.env.KIE_API_URL ?? 'https://api.kie.ai').replace(/\/+$/, '');
const API_KEY = process.env.KIE_API_KEY ?? '';

/** kie.ai Nano Banana model ids (distinct from the Vertex/Gemini model names). */
export const KIE_MODELS = {
  pro: 'nano-banana-pro',
  v2: 'nano-banana-2',
} as const;

export type KieModel = (typeof KIE_MODELS)[keyof typeof KIE_MODELS];

/** Aspect ratios kie.ai accepts (Pro line). `auto` is the safe default. */
const KIE_ASPECT_RATIOS = new Set([
  '1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9', 'auto',
]);
const KIE_RESOLUTIONS = new Set(['1K', '2K', '4K']);

export type KieOptions = {
  model?: KieModel;
  aspectRatio?: string;
  resolution?: string;
  outputFormat?: 'png' | 'jpg';
};

const CREATE_TIMEOUT_MS = 30_000;
const POLL_INTERVAL_MS = 3_000;
const POLL_TIMEOUT_MS = 180_000;

function classifyStatus(status: number): { code: ImageEngineErrorCode; message: string } {
  if (status === 401 || status === 403) return { code: 'auth_missing', message: `kie auth ${status}` };
  if (status === 402) return { code: 'auth_missing', message: 'kie insufficient balance (402)' };
  if (status === 422) return { code: 'invalid_input', message: 'kie rejected input (422)' };
  if (status === 429) return { code: 'rate_limited', message: 'kie rate limit (429)' };
  if (status === 400) return { code: 'invalid_input', message: 'kie bad request (400)' };
  if (status >= 500) return { code: 'upstream_5xx', message: `kie ${status}` };
  return { code: 'unknown', message: `kie ${status}` };
}

/** kie.ai needs public URLs for reference images; upload `data:` URIs first. */
async function toPublicUrl(src: string): Promise<string> {
  if (/^https?:\/\//i.test(src)) return src;
  const dataMatch = /^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s.exec(src);
  if (!dataMatch) throw new ImageEngineError('invalid_input', 'unsupported image input for kie', 0);
  const mime = dataMatch[1] || 'image/jpeg';
  const bytes = new Uint8Array(Buffer.from(dataMatch[2], 'base64'));
  return uploadBufferToSupabase(bytes, 'kie-input', mime);
}

async function createTask(prompt: string, imageUrls: string[], opts: KieOptions): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CREATE_TIMEOUT_MS);
  try {
    const aspect = opts.aspectRatio && KIE_ASPECT_RATIOS.has(opts.aspectRatio) ? opts.aspectRatio : 'auto';
    const resolution = opts.resolution && KIE_RESOLUTIONS.has(opts.resolution) ? opts.resolution : '1K';
    const res = await fetch(`${BASE_URL}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: opts.model ?? KIE_MODELS.pro,
        input: {
          prompt,
          image_input: imageUrls,
          aspect_ratio: aspect,
          resolution,
          output_format: opts.outputFormat ?? 'png',
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      const { code, message } = classifyStatus(res.status);
      throw new ImageEngineError(code, message, 0, body.slice(0, 300));
    }
    const json = (await res.json()) as { code?: number; msg?: string; data?: { taskId?: string } };
    const taskId = json.data?.taskId;
    if (!taskId) throw new ImageEngineError('unexpected_response', `kie createTask: no taskId (${json.msg ?? json.code})`, 0);
    return taskId;
  } finally {
    clearTimeout(timer);
  }
}

async function pollTask(taskId: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (Date.now() > deadline) throw new ImageEngineError('timeout', 'kie task timed out', 0);
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));

    const res = await fetch(`${BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
      headers: { Authorization: `Bearer ${API_KEY}` },
    });
    if (!res.ok) {
      // Transient read error — keep polling until the deadline.
      if (res.status >= 500 || res.status === 429) continue;
      const { code, message } = classifyStatus(res.status);
      throw new ImageEngineError(code, message, 0);
    }

    const json = (await res.json()) as {
      data?: { state?: string; resultJson?: string; failMsg?: string | null };
    };
    const state = json.data?.state;
    if (state === 'success') {
      let urls: string[] = [];
      try {
        urls = (JSON.parse(json.data?.resultJson ?? '{}') as { resultUrls?: string[] }).resultUrls ?? [];
      } catch {
        urls = [];
      }
      const url = urls[0];
      if (!url) throw new ImageEngineError('unexpected_response', 'kie success without result url', 0);
      return url;
    }
    if (state === 'fail') {
      throw new ImageEngineError('upstream_5xx', `kie task failed: ${json.data?.failMsg ?? 'unknown'}`, 0);
    }
    // 'waiting' (or any other in-progress state) -> keep polling.
  }
}

/**
 * Generates an image via kie.ai. Same call shape as the other engines so it can
 * stand in as a fallback. Returns the hosted result URL.
 */
export async function generateImage(
  prompt: string,
  imageInput?: string[],
  opts: KieOptions = {}
): Promise<string> {
  if (!API_KEY) throw new ImageEngineError('auth_missing', 'KIE_API_KEY not set', 0);

  let imageUrls: string[] = [];
  if (imageInput?.length) {
    try {
      imageUrls = await Promise.all(imageInput.map(toPublicUrl));
    } catch (err) {
      if (err instanceof ImageEngineError) throw err;
      throw new ImageEngineError('invalid_input', err instanceof Error ? err.message : 'bad reference image', 0);
    }
  }

  const taskId = await createTask(prompt, imageUrls, opts);
  return pollTask(taskId);
}
