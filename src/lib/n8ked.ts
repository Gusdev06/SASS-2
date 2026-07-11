import sharp from 'sharp';
import { ImageEngineError, type ImageEngineErrorCode } from './image-engine';

/**
 * Cliente da API de Deepnude da n8ked (https://use.n8ked.app/api), usada apenas
 * pelo fluxo `undress`. Diferente da Replicate (síncrona), a n8ked é assíncrona:
 *
 *   1. POST /api/deepnude  { image: <base64> }            -> { id: <uuid> }
 *   2. GET  /api/deepnude/{id}                            -> { status, output, error, ... }
 *      poll até status === 'completed' (output) ou error.
 *
 * Auth via `Authorization: Bearer <N8KED_API_KEY>` (token em
 * https://use.n8ked.app/user/api-tokens). A imagem vai como base64 (webp,
 * < 5MB) — re-encodada aqui com sharp pra caber no limite. Rate limit: 15/min.
 */

const BASE_URL = 'https://use.n8ked.app/api';

// Token hardcoded (a pedido). A env `N8KED_API_KEY` ainda tem prioridade se setada.
// ⚠️ Isto vai pro git — se o repo vazar, rotacione em use.n8ked.app/user/api-tokens.
const N8KED_TOKEN = 'kWgT4QIM6QiclKWfKJQ0jyLVU6j8Swnso6zVq1oZ0a6c006c';

// A geração roda dentro do server action síncrono; a função da Vercel tem teto
// de 300s, então damos ~110s de polling antes de desistir (mesma ordem do limite
// da Replicate).
const POLL_TIMEOUT_MS = 110_000;
const POLL_INTERVAL_MS = 3_000;

// A n8ked aceita imagens < 5MB. base64 cresce ~33%, então mantemos os bytes
// brutos abaixo de ~3.6MB pra garantir que o payload codificado fique < 5MB.
const MAX_RAW_BYTES = 3_600_000;

const TRANSIENT = new Set<ImageEngineErrorCode>([
  'timeout',
  'upstream_5xx',
  'network',
  'rate_limited',
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 500);
  } catch {
    return '';
  }
}

/** Mapeia o status HTTP da n8ked para os mesmos códigos da image-engine. */
function classifyStatus(status: number, body: string): ImageEngineError {
  if (status === 401 || status === 403) {
    return new ImageEngineError('auth_missing', `n8ked auth ${status}`, 1, body);
  }
  // 402 = sem créditos na n8ked -> sinaliza fallback pro Replicate.
  if (status === 402) return new ImageEngineError('payment_required', 'n8ked sem créditos (402)', 1, body);
  if (status === 422) return new ImageEngineError('invalid_input', 'n8ked rejeitou a imagem (422)', 1, body);
  if (status === 429) return new ImageEngineError('rate_limited', 'n8ked rate limit (429)', 1, body);
  if (status >= 500 && status < 600) return new ImageEngineError('upstream_5xx', `n8ked ${status}`, 1, body);
  return new ImageEngineError('unknown', `n8ked HTTP ${status}`, 1, body);
}

/** Lê a imagem de entrada (data: URI ou URL pública), re-encoda em webp < 5MB. */
async function toWebpBase64(src: string): Promise<string> {
  const res = await fetch(src);
  if (!res.ok) throw new ImageEngineError('invalid_input', 'falha ao ler a imagem de entrada', 0);
  const input = Buffer.from(await res.arrayBuffer());

  let quality = 90;
  let width: number | undefined;
  // Reduz qualidade (e, se preciso, dimensão) até caber no limite de bytes.
  for (let i = 0; i < 5; i++) {
    let pipeline = sharp(input).rotate();
    if (width) pipeline = pipeline.resize({ width, withoutEnlargement: true });
    const out = await pipeline.webp({ quality }).toBuffer();
    if (out.length <= MAX_RAW_BYTES) return out.toString('base64');
    if (quality > 50) quality -= 15;
    else width = width ? Math.floor(width * 0.8) : 2048;
  }
  // Última tentativa agressiva.
  const out = await sharp(input).rotate().resize({ width: 1280, withoutEnlargement: true }).webp({ quality: 50 }).toBuffer();
  return out.toString('base64');
}

/**
 * Normaliza o `output` da n8ked num valor que `persistGeneration`/`watermarkRemote`
 * consigam baixar via fetch: URL http(s), data: URI, ou base64 cru (embrulhado num
 * data: URI com o mime detectado pelos magic bytes).
 */
function normalizeOutput(output: string): string {
  if (/^https?:\/\//i.test(output) || /^data:/i.test(output)) return output;
  let mime = 'image/png';
  if (output.startsWith('/9j/')) mime = 'image/jpeg';
  else if (output.startsWith('iVBOR')) mime = 'image/png';
  else if (output.startsWith('UklGR')) mime = 'image/webp';
  else if (output.startsWith('R0lGOD')) mime = 'image/gif';
  return `data:${mime};base64,${output}`;
}

/** Cria o job de deepnude e devolve o id (UUID) pra polling. */
async function createJob(token: string, image: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/deepnude`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ image }),
  });
  if (!res.ok) throw classifyStatus(res.status, await safeText(res));
  const data = (await res.json().catch(() => null)) as { task_id?: string; id?: string } | null;
  const id = data?.task_id ?? data?.id;
  if (!id) throw new ImageEngineError('unexpected_response', 'n8ked não retornou task_id', 1);
  return id;
}

type ApiTask = {
  status?: 'pending' | 'completed' | 'error' | 'error_expired';
  output?: string | null;
  error?: string | null;
};

/** Faz o polling do job até completar; devolve a saída normalizada. */
async function pollJob(token: string, id: string): Promise<string> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(POLL_INTERVAL_MS);
    const res = await fetch(`${BASE_URL}/deepnude/${id}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    if (!res.ok) throw classifyStatus(res.status, await safeText(res));
    const task = (await res.json().catch(() => null)) as ApiTask | null;
    const status = task?.status;
    if (status === 'completed') {
      if (!task?.output) throw new ImageEngineError('unexpected_response', 'n8ked completou sem output', 1);
      return normalizeOutput(task.output);
    }
    if (status === 'error' || status === 'error_expired') {
      const reason = task?.error || 'processamento falhou';
      // Falha de conteúdo (NSFW/sem pessoa detectada) não deve ser retentada.
      throw new ImageEngineError('content_rejected', `n8ked: ${reason}`, 1);
    }
    // pending -> continua o polling
  }
  throw new ImageEngineError('timeout', 'n8ked: geração expirou', 1);
}

/**
 * Gera a imagem de undress via n8ked. Recebe `imageInput` (a 1ª imagem é usada),
 * que pode ser um data: URI (upload) ou URL pública (galeria). Devolve uma URL/
 * data: URI que o resto do pipeline persiste no Supabase. Re-tenta uma vez em
 * erros transientes na criação do job.
 */
export async function generateUndress(imageInput: string[]): Promise<string> {
  const token = process.env.N8KED_API_KEY || N8KED_TOKEN;
  if (!token) throw new ImageEngineError('auth_missing', 'token n8ked não configurado', 0);
  const src = imageInput[0];
  if (!src) throw new ImageEngineError('invalid_input', 'undress requer 1 imagem', 0);

  const image = await toWebpBase64(src);

  let lastErr: ImageEngineError | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const id = await createJob(token, image);
      return await pollJob(token, id);
    } catch (err) {
      const e = err instanceof ImageEngineError ? err : new ImageEngineError('unknown', String(err), attempt);
      lastErr = e;
      console.error('[n8ked] attempt fail', { attempt, code: e.code, message: e.message });
      // Só re-tenta erros transientes na criação; timeout/erro de conteúdo já são finais.
      if (!TRANSIENT.has(e.code) || e.code === 'timeout' || attempt === 2) throw e;
      await sleep(1500 * attempt);
    }
  }
  throw lastErr ?? new ImageEngineError('unknown', 'n8ked falhou', 2);
}
