/**
 * kie.ai video engine — Kling V3 Turbo (image-to-video).
 *
 * Mesma API assíncrona do kie usada nas imagens:
 *   POST {KIE_BASE}/api/v1/jobs/createTask   -> { data: { taskId } }
 *   GET  {KIE_BASE}/api/v1/jobs/recordInfo?taskId=...
 *        -> { data: { state, resultJson, failMsg } }
 *
 * Diferente das imagens, o vídeo NÃO é resolvido de forma síncrona aqui: a
 * geração leva minutos, então `queueKlingVideo` só cria a task e devolve o
 * taskId. A resolução (polling) acontece em src/lib/video.ts, consumido pelo
 * endpoint /api/video-status, pelo reconcile e pelo cron — espelhando o fluxo
 * já existente da ComfyDeploy.
 */

const BASE_URL = (process.env.KIE_API_URL ?? 'https://api.kie.ai').replace(/\/+$/, '');
const API_KEY = process.env.KIE_API_KEY ?? '';

const MODEL = 'kling/v3-turbo-image-to-video';
const CREATE_TIMEOUT_MS = 30_000;

/** Resoluções aceitas pelo Kling V3 Turbo. */
export type KlingResolution = '720p' | '1080p';

export type KlingVideoOptions = {
  imageUrl: string;
  prompt: string;
  duration?: number; // segundos (Kling aceita 3–15)
  resolution?: KlingResolution;
};

/** Cria a task de vídeo e devolve o taskId. Lança erro em qualquer falha (pra
 *  permitir fallback no chamador). */
export async function queueKlingVideo(opts: KlingVideoOptions): Promise<string> {
  if (!API_KEY) throw new Error('KIE_API_KEY not set');
  if (!opts.imageUrl) throw new Error('kling: imagem de entrada ausente');

  // Kling aceita duração de 3 a 15s (passo 1). Clampa pra faixa válida.
  const duration = Math.min(15, Math.max(3, Math.round(opts.duration ?? 5)));
  const resolution: KlingResolution = opts.resolution ?? '720p';

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CREATE_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}/api/v1/jobs/createTask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        input: {
          prompt: opts.prompt,
          image_urls: [opts.imageUrl],
          duration,
          resolution,
        },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`kling createTask ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = (await res.json()) as { code?: number; msg?: string; data?: { taskId?: string } };
    const taskId = json.data?.taskId;
    if (!taskId) throw new Error(`kling createTask: sem taskId (${json.msg ?? json.code})`);
    return taskId;
  } finally {
    clearTimeout(timer);
  }
}

export type KlingStatus =
  | { state: 'waiting' }
  | { state: 'success'; url: string | null }
  | { state: 'fail'; failMsg: string };

/** Consulta o estado de uma task de vídeo do Kling (não bloqueia/poll). */
export async function getKlingVideo(taskId: string): Promise<KlingStatus> {
  if (!API_KEY) throw new Error('KIE_API_KEY not set');
  const res = await fetch(`${BASE_URL}/api/v1/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });
  if (!res.ok) throw new Error(`kling recordInfo ${res.status}`);

  const json = (await res.json()) as {
    data?: { state?: string; resultJson?: string; failMsg?: string | null };
  };
  const state = json.data?.state;
  if (state === 'success') {
    let url: string | null = null;
    try {
      url = (JSON.parse(json.data?.resultJson ?? '{}') as { resultUrls?: string[] }).resultUrls?.[0] ?? null;
    } catch {
      url = null;
    }
    return { state: 'success', url };
  }
  if (state === 'fail') {
    return { state: 'fail', failMsg: json.data?.failMsg ?? 'kling falhou' };
  }
  return { state: 'waiting' };
}
