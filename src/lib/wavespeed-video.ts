/**
 * WaveSpeed video engine — LTX 2.3 Spicy (image-to-video, NSFW).
 *
 * API assíncrona da WaveSpeed (mesmo provider do Seedream em @/lib/replicate):
 *   POST {ENDPOINT}                       -> { data: { id, status, urls: { get } } }
 *   GET  {urls.get}                       -> { data: { status, outputs: [url] } }
 *
 * Igual ao Kling/ComfyDeploy, a geração leva minutos, então `queueSpicyVideo`
 * só cria a task e devolve o marcador de polling (a URL de `get`). A resolução
 * acontece em @/lib/video.ts, consumida pelo /api/video-status, reconcile e cron.
 */

const ENDPOINT =
  'https://api.wavespeed.ai/api/v3/wavespeed-ai/ltx-2.3-spicy/image-to-video';

// Mesma key `live` hardcoded usada no engine de imagem (@/lib/replicate). Gire no
// dashboard da WaveSpeed se o repo vazar; `process.env` tem prioridade.
const API_KEY =
  process.env.WAVESPEED_API_KEY || 'wsk_live_-H4IwS1L8n5aD7vMKoYA2BvIsG84wsYECXp1MYedgDM';

const CREATE_TIMEOUT_MS = 30_000;

export type SpicyResolution = '480p' | '720p' | '1080p';
export type SpicyPreset = 'tuned' | 'original';

export const SPICY_RESOLUTIONS: readonly SpicyResolution[] = ['480p', '720p', '1080p'];
export const SPICY_PRESETS: readonly SpicyPreset[] = ['tuned', 'original'];
// LTX aceita até 20s. O WaveSpeed cobra no MÍNIMO 5s (requests menores são
// faturadas como 5s), então travamos o piso em 5s pra não pagar tempo ocioso.
export const SPICY_MIN_DURATION = 5;
export const SPICY_MAX_DURATION = 20;

export type SpicyVideoOptions = {
  imageUrl: string;
  prompt: string;
  duration?: number; // segundos (LTX aceita 3–20)
  resolution?: SpicyResolution;
  preset?: SpicyPreset;
};

type WaveSpeedTask = {
  id?: string;
  status?: string;
  outputs?: string[];
  error?: string;
  urls?: { get?: string };
};

/** WaveSpeed embrulha tudo em `{ code, message, data }`. */
function unwrap(json: unknown): WaveSpeedTask {
  const j = json as { data?: WaveSpeedTask } & WaveSpeedTask;
  return (j?.data ?? j) as WaveSpeedTask;
}

/** Endpoint de resultado da WaveSpeed a partir do id da predição. */
const resultUrl = (id: string) =>
  `https://api.wavespeed.ai/api/v3/predictions/${id}/result`;

/** Cria a task de vídeo e devolve o `id` da predição. Lança em falha. */
export async function queueSpicyVideo(opts: SpicyVideoOptions): Promise<string> {
  if (!API_KEY) throw new Error('WAVESPEED_API_KEY not set');
  if (!opts.imageUrl) throw new Error('ltx-spicy: imagem de entrada ausente');

  // LTX aceita duração de 3 a 20s. Clampa pra faixa válida.
  const duration = Math.min(
    SPICY_MAX_DURATION,
    Math.max(SPICY_MIN_DURATION, Math.round(opts.duration ?? 5))
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CREATE_TIMEOUT_MS);
  try {
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        image: opts.imageUrl,
        prompt: opts.prompt,
        preset: opts.preset ?? 'tuned',
        resolution: opts.resolution ?? '480p',
        duration,
        seed: -1,
      }),
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`ltx-spicy create ${res.status}: ${body.slice(0, 200)}`);
    }
    const task = unwrap(await res.json());
    const id = task.id;
    if (!id) throw new Error(`ltx-spicy create: sem id (${task.status ?? 'sem status'})`);
    return id;
  } finally {
    clearTimeout(timer);
  }
}

export type SpicyStatus =
  | { state: 'waiting' }
  | { state: 'success'; url: string | null }
  | { state: 'fail'; failMsg: string };

/** Consulta o estado de uma task de vídeo LTX Spicy pelo id (não bloqueia/poll). */
export async function getSpicyVideo(id: string): Promise<SpicyStatus> {
  if (!API_KEY) throw new Error('WAVESPEED_API_KEY not set');
  const res = await fetch(resultUrl(id), {
    headers: { Authorization: `Bearer ${API_KEY}` },
    cache: 'no-store',
  });
  if (!res.ok) throw new Error(`ltx-spicy status ${res.status}`);

  const task = unwrap(await res.json());
  if (task.status === 'completed') {
    const url = task.outputs?.[0] ?? null;
    return { state: 'success', url };
  }
  if (task.status === 'failed') {
    return { state: 'fail', failMsg: task.error ?? 'ltx-spicy falhou' };
  }
  // created / processing -> ainda rodando.
  return { state: 'waiting' };
}
