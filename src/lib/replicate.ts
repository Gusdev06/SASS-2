// Engine de imagem Seedream — agora servido pela WaveSpeed
// (`bytedance/seedream-v5.0-pro/edit`) em vez da Replicate. O nome do arquivo e
// dos exports (`generateImage`, `SEEDREAM_*`, `SeedreamOptions`) é mantido para
// não quebrar os importadores (`@/lib/replicate`), mas por baixo é a WaveSpeed.

const WAVESPEED_ENDPOINT =
  'https://api.wavespeed.ai/api/v3/bytedance/seedream-v5.0-pro/edit';

// Chave hardcoded a pedido do dono do projeto. ATENÇÃO: é uma key `live` — se o
// repo vazar, gire a chave no dashboard da WaveSpeed. `process.env` continua
// tendo prioridade caso você queira sobrescrever por ambiente.
const WAVESPEED_API_KEY =
  process.env.WAVESPEED_API_KEY || 'wsk_live_-H4IwS1L8n5aD7vMKoYA2BvIsG84wsYECXp1MYedgDM';

const GENERATION_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 1200;

/**
 * Tiers de resolução do Seedream V5.0 Pro Edit na WaveSpeed. O modelo só cobra
 * por `1k` (mais barato) ou `2k` (mais caro) — não há mais o `4K` da Replicate.
 * Mantemos os rótulos em caixa alta (`1K`/`2K`) que a UI já usa e convertemos na
 * hora de chamar a API.
 */
export const SEEDREAM_SIZES = ['1K', '2K'] as const;

/**
 * Aspect ratios aceitos. `match_input_image` não existe na WaveSpeed — quando
 * pedido, simplesmente omitimos o campo e a API escolhe o ratio mais próximo da
 * primeira imagem de referência. Os demais são um subconjunto dos suportados.
 */
export const SEEDREAM_ASPECT_RATIOS = [
  'match_input_image',
  '1:1',
  '4:3',
  '3:4',
  '4:5',
  '5:4',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
  '21:9',
  '9:21',
] as const;

export type SeedreamOptions = {
  size?: string;
  aspectRatio?: string;
};

/** `1K` -> `1k`; `2K`/`4K` (legado) -> `2k` (tier máximo do V5.0 Pro Edit). */
function mapResolution(size?: string): '1k' | '2k' {
  return size === '1K' ? '1k' : '2k';
}

type WaveSpeedTask = {
  id?: string;
  status?: string;
  outputs?: string[];
  error?: string;
  urls?: { get?: string };
};

/** Extrai o corpo `data` (WaveSpeed embrulha tudo em `{ code, message, data }`). */
function unwrap(json: unknown): WaveSpeedTask {
  const j = json as { data?: WaveSpeedTask } & WaveSpeedTask;
  return (j?.data ?? j) as WaveSpeedTask;
}

async function pollUntilDone(getUrl: string, apiKey: string, deadline: number): Promise<string> {
  for (;;) {
    if (Date.now() > deadline) throw new Error('generation timeout');

    const res = await fetch(getUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
      cache: 'no-store',
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`WaveSpeed poll ${res.status}: ${body.slice(0, 300)}`);
    }
    const task = unwrap(await res.json());
    const status = task.status;

    if (status === 'completed') {
      const first = task.outputs?.[0];
      if (typeof first === 'string' && first) return first;
      throw new Error(`WaveSpeed completou sem outputs: ${JSON.stringify(task).slice(0, 300)}`);
    }
    if (status === 'failed') {
      throw new Error(`WaveSpeed falhou: ${task.error ?? 'sem detalhe'}`);
    }

    // created / processing -> espera e tenta de novo.
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
}

export async function generateImage(
  prompt: string,
  imageInput?: string[],
  opts: SeedreamOptions = {}
): Promise<string> {
  const apiKey = WAVESPEED_API_KEY;
  if (!apiKey) throw new Error('WAVESPEED_API_KEY not set');

  const hasImages = !!imageInput && imageInput.length > 0;

  const body: Record<string, unknown> = {
    prompt,
    images: hasImages ? imageInput : [],
    resolution: mapResolution(opts.size),
    output_format: 'jpeg',
    enable_base64_output: false,
    enable_sync_mode: false,
  };

  // Só manda aspect_ratio quando é um valor real da API. `match_input_image`
  // (ou vazio) -> omite e deixa a WaveSpeed casar com a 1ª imagem.
  const aspect = opts.aspectRatio;
  if (
    aspect &&
    aspect !== 'match_input_image' &&
    (SEEDREAM_ASPECT_RATIOS as readonly string[]).includes(aspect)
  ) {
    body.aspect_ratio = aspect;
  }

  const deadline = Date.now() + GENERATION_TIMEOUT_MS;

  const res = await fetch(WAVESPEED_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // Preserva o status no texto pra o classify() do image flow enxergar 4xx/5xx.
    const err = new Error(`WaveSpeed ${res.status}: ${detail.slice(0, 300)}`) as Error & {
      status?: number;
    };
    err.status = res.status;
    throw err;
  }

  const task = unwrap(await res.json());

  // Resultado já veio pronto (raro sem sync_mode, mas cobrimos).
  if (task.status === 'completed' && task.outputs?.[0]) return task.outputs[0];
  if (task.status === 'failed') throw new Error(`WaveSpeed falhou: ${task.error ?? 'sem detalhe'}`);

  const getUrl = task.urls?.get;
  if (!getUrl) {
    throw new Error(`Resposta inesperada da WaveSpeed: ${JSON.stringify(task).slice(0, 300)}`);
  }

  return pollUntilDone(getUrl, apiKey, deadline);
}
