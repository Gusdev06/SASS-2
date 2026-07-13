'use server';

import sharp from 'sharp';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { cookies } from 'next/headers';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import {
  generateImage,
  SEEDREAM_SIZES,
  SEEDREAM_ASPECT_RATIOS,
  type SeedreamOptions,
} from '@/lib/replicate';
import {
  generateImage as generateNanoBanana,
  NANO_BANANA_MODELS,
  ASPECT_RATIOS,
  IMAGE_SIZES,
  type NanoBananaOptions,
} from '@/lib/vertex-image';
import { generateImage as generateGptImage, type GptImageOptions } from '@/lib/gpt-image';
import { generateImage as generateKie, KIE_MODELS, type KieOptions } from '@/lib/kie-image';
import { generateUndress } from '@/lib/n8ked';
import { queueKlingVideo } from '@/lib/kie-video';
import { queueRun, uploadAsset } from '@/lib/comfydeploy';
import { persistGeneration, uploadBufferToSupabase } from '@/lib/storage';
import { consumeFreeQuota, refundFreeQuota, type FreeBucket } from '@/lib/free-quota';
import {
  imageCost,
  ENHANCE_PROMPT,
  UNDRESS_PROMPT,
  FACESWAP_PROMPT,
  VIDEO_DURATIONS,
  DEFAULT_VIDEO_DURATION,
  videoCost,
  videoFrames,
  type VideoDuration,
} from '@/lib/prompts';

async function watermarkRemote(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('failed to fetch render');
  const buf = Buffer.from(await res.arrayBuffer());
  const meta = await sharp(buf).metadata();
  const W = meta.width ?? 1024;
  const H = meta.height ?? 1024;
  const diag = Math.sqrt(W * W + H * H);
  const tileFont = Math.max(28, Math.floor(W / 22));
  const centerFont = Math.max(72, Math.floor(W / 8));
  const subFont = Math.max(22, Math.floor(centerFont / 3.2));
  const cornerFont = Math.max(18, Math.floor(W / 36));

  const tileText = 'goz.ai · FREE PREVIEW · ';
  const charsPerLine = Math.ceil((diag * 2.5) / (tileFont * 0.55));
  const tileLine = tileText.repeat(Math.ceil(charsPerLine / tileText.length));
  const step = Math.floor(tileFont * 3.2);
  const lines: string[] = [];
  for (let y = -Math.floor(diag); y < diag; y += step) {
    lines.push(
      `<text x="${-Math.floor(diag)}" y="${y}" font-family="Georgia, serif" font-weight="900" font-size="${tileFont}" fill="rgba(255,255,255,0.32)" stroke="rgba(0,0,0,0.55)" stroke-width="${Math.max(1, tileFont / 18)}">${tileLine}</text>`
    );
  }

  const cx = Math.floor(W / 2);
  const cy = Math.floor(H / 2);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <g transform="rotate(-30 ${cx} ${cy})">${lines.join('')}</g>
    <g transform="rotate(-18 ${cx} ${cy})">
      <text x="${cx}" y="${cy - Math.floor(centerFont * 0.25)}" text-anchor="middle" font-family="Georgia, serif" font-weight="900" font-size="${centerFont}" fill="rgba(255,61,46,0.92)" stroke="rgba(0,0,0,0.92)" stroke-width="${Math.max(3, centerFont / 14)}" paint-order="stroke">goz.ai</text>
      <text x="${cx}" y="${cy + Math.floor(centerFont * 0.55)}" text-anchor="middle" font-family="Menlo, monospace" font-weight="700" font-size="${subFont}" fill="rgba(244,237,228,0.98)" stroke="rgba(0,0,0,0.92)" stroke-width="${Math.max(1.5, subFont / 10)}" paint-order="stroke" letter-spacing="4">FREE PREVIEW · NOT FOR USE</text>
    </g>
    <text x="${cornerFont * 1.2}" y="${cornerFont * 2}" font-family="Menlo, monospace" font-weight="700" font-size="${cornerFont}" fill="rgba(255,255,255,0.95)" stroke="rgba(0,0,0,0.9)" stroke-width="1" paint-order="stroke" letter-spacing="3">goz.ai / sign up to unlock</text>
    <text x="${W - cornerFont * 1.2}" y="${H - cornerFont * 1.2}" text-anchor="end" font-family="Menlo, monospace" font-weight="700" font-size="${cornerFont}" fill="rgba(255,255,255,0.95)" stroke="rgba(0,0,0,0.9)" stroke-width="1" paint-order="stroke" letter-spacing="3">FREE PREVIEW</text>
  </svg>`;

  const out = await sharp(buf)
    .composite([{ input: Buffer.from(svg), top: 0, left: 0 }])
    .jpeg({ quality: 88 })
    .toBuffer();
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

const MAX_FILE_BYTES = 12 * 1024 * 1024;
const ANON_COOKIE = 'anon_used';
type Kind = 'undress' | 'faceswap' | 'enhance' | 'edit' | 'video' | 'video_kling' | 'create';

const NANO_BANANA_VALUES = new Set<string>(Object.values(NANO_BANANA_MODELS));
const ASPECT_VALUES = new Set<string>(ASPECT_RATIOS);
const SIZE_VALUES = new Set<string>(IMAGE_SIZES);
const SEEDREAM_SIZE_VALUES = new Set<string>(SEEDREAM_SIZES);
const SEEDREAM_ASPECT_VALUES = new Set<string>(SEEDREAM_ASPECT_RATIOS);

/** GPT Image (OpenAI) — selectable on the `create` tab. Model is fixed. */
const GPT_IMAGE_MODEL = 'gpt-image-2';
/** Nsfw — uncensored Replicate (Seedream) engine on the `create` tab. */
const NSFW_MODEL = 'nsfw';
const GPT_SIZE_VALUES = new Set<string>([
  '1024x1024',
  '1536x1024',
  '1024x1536',
  '864x1536',
  '1536x864',
]);
const GPT_QUALITY_VALUES = new Set<string>(['low', 'medium', 'high']);

type CreateOpts =
  | { engine: 'nano'; nano: NanoBananaOptions }
  | { engine: 'gpt'; gpt: GptImageOptions }
  | { engine: 'replicate'; replicate: SeedreamOptions };

/**
 * Teto de imagens de referência por fluxo/engine, alinhado ao limite de cada API:
 * GPT Image 16 (endpoint /edits), Nano Banana Pro/2 14, Seedream (NSFW) 10. A aba
 * `edit` roda no Seedream e aceita várias referências; os demais têm contagem fixa.
 */
function maxInputImages(kind: Kind, opts?: CreateOpts): number {
  if (kind === 'create') {
    if (opts?.engine === 'gpt') return 16;
    if (opts?.engine === 'replicate') return 10;
    return 14; // nano banana pro/2
  }
  if (kind === 'edit') return 10;
  return kind === 'faceswap' ? 2 : 1;
}

export type GenResult =
  | { ok: true; outputUrl: string; remaining: number; watermarked?: boolean }
  | { ok: true; isVideo: true; runId: string; remaining: number }
  | { ok: true; isAsync: true; genId: string; remaining: number }
  | { ok: false; error: string; refunded?: boolean };

function pickPrompt(kind: Kind, customPrompt: string | null): string {
  if (kind === 'undress') return UNDRESS_PROMPT;
  if (kind === 'faceswap') return FACESWAP_PROMPT;
  if (kind === 'enhance') return ENHANCE_PROMPT;
  return (customPrompt ?? '').trim();
}

/**
 * Picks the image engine. The SFW `create` tab can use the Nano Banana models
 * (Vertex AI / Gemini) or GPT Image (OpenAI); every other image flow stays on
 * Replicate (Seedream).
 */
async function runPrimaryEngine(
  kind: Kind,
  prompt: string,
  inputUrls: string[],
  opts?: CreateOpts
): Promise<string> {
  // Undress roda na API de deepnude da n8ked (assíncrona, sem prompt) — não na
  // Replicate. Se a n8ked falhar por qualquer motivo (402/sem créditos, timeout,
  // 5xx, etc.), o fallback universal do `runImageEngine` cai pro Replicate/Seedream
  // usando o UNDRESS_PROMPT (já resolvido em `prompt`). As demais engines/flows
  // seguem o roteamento abaixo.
  if (kind === 'undress') {
    return generateUndress(inputUrls);
  }
  if (kind === 'create') {
    if (opts?.engine === 'gpt') return generateGptImage(prompt, inputUrls, opts.gpt);
    if (opts?.engine === 'replicate') return generateImage(prompt, inputUrls, opts.replicate);
    return generateNanoBanana(prompt, inputUrls, opts?.engine === 'nano' ? opts.nano : undefined);
  }
  // Face Swap com NSFW desligado roda no Nano Banana Pro (2K); ligado cai no
  // Replicate. Os demais flows seguem sempre no Replicate.
  if (kind === 'faceswap' && opts?.engine === 'nano') {
    return generateNanoBanana(prompt, inputUrls, opts.nano);
  }
  return generateImage(prompt, inputUrls);
}

/**
 * O fallback kie.ai cobre SOMENTE os fluxos que rodam no Nano Banana (Pro/2):
 * o tab `create` com engine `nano` e o Face Swap com NSFW desligado. Devolve as
 * opções do fallback (Nano Banana 2 -> `nano-banana-2`, senão `nano-banana-pro`)
 * ou `null` quando o engine primário não é Nano Banana.
 */
function kieFallbackOpts(kind: Kind, opts?: CreateOpts): KieOptions | null {
  if (opts?.engine !== 'nano') return null;
  if (kind !== 'create' && kind !== 'faceswap') return null;
  return {
    model: opts.nano.model === NANO_BANANA_MODELS.v2 ? KIE_MODELS.v2 : KIE_MODELS.pro,
    aspectRatio: opts.nano.aspectRatio,
    resolution: opts.nano.imageSize,
  };
}

/**
 * Diz se o engine primário do fluxo JÁ é o Replicate/Seedream — nesse caso não
 * faz sentido cair no fallback do Seedream (seria repetir a mesma API). Cobre:
 * `create` com engine `replicate` (NSFW), Face Swap com NSFW ligado, e os fluxos
 * `edit`/`enhance` que rodam sempre no Seedream. Undress roda no n8ked, então
 * NÃO é Seedream e deve ter fallback.
 */
function primaryIsSeedream(kind: Kind, opts?: CreateOpts): boolean {
  if (kind === 'create') return opts?.engine === 'replicate';
  if (kind === 'faceswap') return opts?.engine !== 'nano';
  return kind === 'edit' || kind === 'enhance';
}

/**
 * Opções do Seedream para o fallback, preservando o aspect ratio quando dá.
 * A engine `replicate` já traz opções nativas; do Nano Banana reaproveitamos só
 * o aspect ratio (o `generateImage` valida e cai no default se não for suportado).
 * GPT/undress não têm aspect ratio compatível -> default do Seedream.
 */
function seedreamFallbackOpts(opts?: CreateOpts): SeedreamOptions | undefined {
  if (opts?.engine === 'replicate') return opts.replicate;
  if (opts?.engine === 'nano') return { aspectRatio: opts.nano.aspectRatio };
  return undefined;
}

/**
 * Último degrau de fallback: gera a imagem no Replicate (Seedream). Se ele também
 * falhar, re-lança combinando o motivo anterior com o do Seedream pra que a causa
 * real apareça em generations.error / no painel admin.
 */
async function runSeedreamFallback(
  kind: Kind,
  prompt: string,
  inputUrls: string[],
  opts: CreateOpts | undefined,
  priorReason: string
): Promise<string> {
  console.error('[generate] fallback pro Replicate/Seedream', { kind, priorReason });
  try {
    return await generateImage(prompt, inputUrls, seedreamFallbackOpts(opts));
  } catch (seedErr) {
    const seedReason = seedErr instanceof Error ? seedErr.message : String(seedErr);
    console.error('[generate] fallback Replicate/Seedream também falhou', { kind, priorReason, seedReason });
    throw new Error(`${priorReason}; fallback Replicate/Seedream falhou (${seedReason})`);
  }
}

/**
 * Roda o engine primário. Se ele falhar por QUALQUER motivo, cai no Replicate
 * (Seedream) como fallback universal — cobre GPT Image, Nano Banana e undress
 * (n8ked). O Nano Banana (Pro/2) ainda tenta o kie.ai antes de descer pro
 * Seedream. Quando o próprio primário já é o Seedream (NSFW/edit/enhance/faceswap
 * NSFW), re-lança o erro original em vez de repetir a mesma API.
 */
async function runImageEngine(
  kind: Kind,
  prompt: string,
  inputUrls: string[],
  opts?: CreateOpts
): Promise<string> {
  try {
    return await runPrimaryEngine(kind, prompt, inputUrls, opts);
  } catch (primaryErr) {
    const primaryReason = primaryErr instanceof Error ? primaryErr.message : String(primaryErr);

    // Nano Banana (Pro/2) tem um fallback intermediário no kie.ai antes do Seedream.
    const kieOpts = kieFallbackOpts(kind, opts);
    if (kieOpts) {
      console.error('[generate] nano banana failed, falling back to kie.ai', { kind, primaryReason });
      try {
        return await generateKie(prompt, inputUrls, kieOpts);
      } catch (kieErr) {
        const kieReason = kieErr instanceof Error ? kieErr.message : String(kieErr);
        return runSeedreamFallback(
          kind,
          prompt,
          inputUrls,
          opts,
          `Nano Banana falhou (${primaryReason}); kie.ai falhou (${kieReason})`
        );
      }
    }

    // Se o primário já é o Seedream, não adianta repetir — re-lança o erro original.
    if (primaryIsSeedream(kind, opts)) throw primaryErr;

    // Demais engines (GPT Image, undress/n8ked) caem direto no Seedream.
    return runSeedreamFallback(kind, prompt, inputUrls, opts, primaryReason);
  }
}

/**
 * Mapeia a geração para o bucket de cota grátis diária (compradores do curso).
 *   create + Nano Banana Pro -> nano_pro
 *   create + Nano Banana 2   -> nano_v2
 *   create + Replicate/NSFW  -> replicate
 *   undress / edit / faceswap -> bucket de mesmo nome (2/dia cada)
 * GPT Image, enhance e video NÃO têm cota grátis (sempre créditos).
 */
function freeBucketFor(kind: Kind, opts?: CreateOpts): FreeBucket | null {
  if (kind === 'undress') return 'undress';
  if (kind === 'edit') return 'edit';
  if (kind === 'faceswap') return 'faceswap';
  if (kind === 'create' && opts) {
    if (opts.engine === 'nano') {
      return opts.nano.model === NANO_BANANA_MODELS.v2 ? 'nano_v2' : 'nano_pro';
    }
    if (opts.engine === 'replicate') return 'replicate';
  }
  return null; // gpt / enhance / video
}

async function filesToDataUris(files: File[]): Promise<string[]> {
  const uris: string[] = [];
  for (const f of files) {
    if (!(f instanceof File) || f.size === 0) continue;
    if (f.size > MAX_FILE_BYTES) {
      throw new Error(`imagem muito grande (max ${MAX_FILE_BYTES / 1024 / 1024}MB)`);
    }
    const buf = Buffer.from(await f.arrayBuffer());
    const mime = f.type || 'image/jpeg';
    uris.push(`data:${mime};base64,${buf.toString('base64')}`);
  }
  return uris;
}

export async function generateAction(formData: FormData): Promise<GenResult> {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;

  const kind = String(formData.get('kind') ?? '') as Kind;
  if (!['undress', 'faceswap', 'enhance', 'edit', 'video', 'video_kling', 'create'].includes(kind)) {
    return { ok: false, error: 'Tipo inválido.' };
  }
  // Os dois tabs de vídeo: `video` (ComfyDeploy/NSFW) e `video_kling` (Kling via kie).
  const isVideoKind = kind === 'video' || kind === 'video_kling';

  const customPrompt = formData.get('prompt') ? String(formData.get('prompt')) : null;
  // Imagens reaproveitadas do histórico/galeria. `create`/`edit` aceitam várias;
  // os fluxos de 1 imagem (e vídeo) usam só a primeira.
  const reusedUrls = formData.getAll('reused_url').map((v) => String(v)).filter(Boolean);
  const prompt = pickPrompt(kind, customPrompt);

  // Duração do vídeo (segundos) -> nº de frames + custo. Só vale no tab `video`.
  const rawDuration = formData.get('duration') ? Number(formData.get('duration')) : NaN;
  const videoDuration: VideoDuration = (VIDEO_DURATIONS as readonly number[]).includes(rawDuration)
    ? (rawDuration as VideoDuration)
    : DEFAULT_VIDEO_DURATION;

  // Model / quality / aspect-ratio — only honored for the SFW `create` tab.
  const rawModel = formData.get('model') ? String(formData.get('model')) : null;
  let createOpts: CreateOpts | undefined;
  if (kind === 'create') {
    if (rawModel === GPT_IMAGE_MODEL) {
      const rawGptSize = formData.get('gpt_size') ? String(formData.get('gpt_size')) : null;
      const rawGptQuality = formData.get('gpt_quality') ? String(formData.get('gpt_quality')) : null;
      createOpts = {
        engine: 'gpt',
        gpt: {
          size: rawGptSize && GPT_SIZE_VALUES.has(rawGptSize)
            ? (rawGptSize as GptImageOptions['size'])
            : undefined,
          quality: rawGptQuality && GPT_QUALITY_VALUES.has(rawGptQuality)
            ? (rawGptQuality as GptImageOptions['quality'])
            : undefined,
        },
      };
    } else if (rawModel === NSFW_MODEL) {
      const rawAspect = formData.get('aspect_ratio') ? String(formData.get('aspect_ratio')) : null;
      const rawSize = formData.get('image_size') ? String(formData.get('image_size')) : null;
      createOpts = {
        engine: 'replicate',
        replicate: {
          aspectRatio: rawAspect && SEEDREAM_ASPECT_VALUES.has(rawAspect) ? rawAspect : undefined,
          size: rawSize && SEEDREAM_SIZE_VALUES.has(rawSize) ? rawSize : undefined,
        },
      };
    } else {
      const rawAspect = formData.get('aspect_ratio') ? String(formData.get('aspect_ratio')) : null;
      const rawSize = formData.get('image_size') ? String(formData.get('image_size')) : null;
      createOpts = {
        engine: 'nano',
        nano: {
          model: rawModel && NANO_BANANA_VALUES.has(rawModel) ? rawModel : undefined,
          aspectRatio: rawAspect && ASPECT_VALUES.has(rawAspect) ? rawAspect : undefined,
          imageSize: rawSize && SIZE_VALUES.has(rawSize) ? rawSize : undefined,
        },
      };
    }
  } else if (kind === 'faceswap') {
    // Toggle NSFW (oculta a engine do usuário): desligado -> Nano Banana Pro
    // em 2K; ligado -> Replicate (createOpts fica undefined e cai no Seedream).
    const nsfw = formData.get('nsfw') === '1';
    if (!nsfw) {
      createOpts = {
        engine: 'nano',
        nano: { model: NANO_BANANA_MODELS.pro, imageSize: '2K' },
      };
    }
  }

  if (!prompt) {
    return { ok: false, error: 'Digite um prompt.' };
  }

  let inputUrls: string[] = [];
  let videoInputUrl: string | null = null;

  if (isVideoKind) {
    // Vídeo usa UMA imagem: prioriza a reaproveitada (galeria/histórico), senão
    // sobe a primeira foto enviada.
    if (reusedUrls[0]) {
      videoInputUrl = reusedUrls[0];
    } else {
      const files = formData.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
      const f = files[0];
      if (!f) return { ok: false, error: 'Envie 1 foto.' };
      if (f.size > MAX_FILE_BYTES) {
        return { ok: false, error: `imagem muito grande (max ${MAX_FILE_BYTES / 1024 / 1024}MB)` };
      }
      try {
        const buf = new Uint8Array(await f.arrayBuffer());
        videoInputUrl =
          kind === 'video'
            ? await uploadAsset(buf, f.type || 'image/jpeg', f.name || 'input.jpg')
            : // Kling (kie) busca a imagem por URL pública -> sobe pro Supabase Storage.
              await uploadBufferToSupabase(buf, `${user?.id ?? 'anon'}/video-input`, f.type || 'image/jpeg');
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : 'Falha na leitura da imagem.' };
      }
    }
  } else {
    // Imagem: combina as reaproveitadas (galeria/histórico) com os uploads, na
    // ordem, respeitando o teto da engine/fluxo.
    const files = formData.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
    const cap = maxInputImages(kind, createOpts);
    try {
      const uploaded = files.length ? await filesToDataUris(files.slice(0, cap)) : [];
      inputUrls = [...reusedUrls, ...uploaded].slice(0, cap);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Falha na leitura da imagem.' };
    }
    // `create` aceita referência opcional; os demais exigem suas entradas.
    const expected = kind === 'create' ? 0 : kind === 'faceswap' ? 2 : 1;
    if (inputUrls.length < expected) {
      return { ok: false, error: `Envie ${expected} foto(s).` };
    }
  }

  if (!user) {
    if (isVideoKind) {
      return { ok: false, error: 'Vídeo requer conta. Cadastre-se para continuar.' };
    }
    const jar = await cookies();
    if (jar.get(ANON_COOKIE)?.value === '1') {
      return { ok: false, error: 'Free preview já utilizado. Cadastre-se para continuar.' };
    }
    try {
      const rawUrl = await runImageEngine(kind, prompt, inputUrls, createOpts);
      const outputUrl = await watermarkRemote(rawUrl);
      jar.set(ANON_COOKIE, '1', {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        httpOnly: true,
        sameSite: 'lax',
      });
      return { ok: true, outputUrl, remaining: 0, watermarked: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Falha na geração.' };
    }
  }

  const service = createServiceClient();

  // Cota grátis diária (compradores do curso) cobre as gerações do tab `create`
  // antes de tocar nos créditos. Esgotou a cota -> cai para créditos. Os demais
  // flows nunca têm bucket, então seguem direto no débito.
  const freeBucket = freeBucketFor(kind, createOpts);
  const usedFree = freeBucket ? await consumeFreeQuota(user.id, freeBucket) : false;

  const cost = usedFree ? 0 : isVideoKind ? videoCost(videoDuration) : imageCost(kind, rawModel);
  if (!usedFree) {
    const { data: debited, error: debitErr } = await service.rpc('debit_credits', {
      p_user_id: user.id,
      p_amount: cost,
    });
    if (debitErr) return { ok: false, error: debitErr.message };
    if (!debited) return { ok: false, error: 'Créditos insuficientes.' };
  }

  // Insert pending row up-front so every debit has an auditable counterpart.
  const { data: genRow, error: insertErr } = await service
    .from('generations')
    .insert({
      user_id: user.id,
      prompt,
      credits_spent: cost,
      output_url: null,
      input_urls: [],
      kind,
      status: 'pending',
    })
    .select('id')
    .single();
  if (insertErr || !genRow) {
    await service.rpc('add_credits', { p_user_id: user.id, p_amount: cost });
    return { ok: false, error: insertErr?.message ?? 'Falha ao registrar a geração.', refunded: true };
  }
  const genId = genRow.id as string;

  // `create` (Nano Banana) runs in the background so the client can poll
  // /api/image-status/:genId instead of holding a long synchronous request.
  if (kind === 'create') {
    after(async () => {
      const bg = createServiceClient();
      try {
        const rawUrl = await runImageEngine('create', prompt, inputUrls, createOpts);
        const outputUrl = await persistGeneration(rawUrl, `${user.id}/create`);
        await bg
          .from('generations')
          .update({ output_url: outputUrl, status: 'succeeded' })
          .eq('id', genId);
      } catch (err) {
        const reason = err instanceof Error ? err.message : 'Falha na geração.';
        await bg.rpc('refund_generation', { p_gen_id: genId, p_reason: reason });
        // Geração grátis falhou -> devolve a unidade da cota (não houve crédito).
        if (usedFree && freeBucket) await refundFreeQuota(user.id, freeBucket);
      }
    });
    const { data: profile } = await service
      .from('profiles')
      .select('credits')
      .eq('user_id', user.id)
      .single();
    return { ok: true, isAsync: true, genId, remaining: profile?.credits ?? 0 };
  }

  try {
    if (kind === 'video') {
      if (!videoInputUrl) throw new Error('Imagem de entrada ausente.');
      // O input externo `duration` do deployment é o `length` (nº de FRAMES) do
      // WanImageToVideo — o workflow NÃO converte. Então mandamos segundos × 16.
      const runId = await queueRun({
        input_image: videoInputUrl,
        prompt,
        duration: videoFrames(videoDuration),
      });
      await service
        .from('generations')
        .update({ input_urls: [`run:${runId}`] })
        .eq('id', genId);
      const { data: profile } = await service
        .from('profiles')
        .select('credits')
        .eq('user_id', user.id)
        .single();
      return { ok: true, isVideo: true, runId, remaining: profile?.credits ?? 0 };
    }

    if (kind === 'video_kling') {
      if (!videoInputUrl) throw new Error('Imagem de entrada ausente.');
      // Kling V3 Turbo via kie.ai — assíncrono, sem fallback. Marcador `kie:<taskId>`.
      const taskId = await queueKlingVideo({
        imageUrl: videoInputUrl,
        prompt,
        duration: videoDuration,
      });
      await service
        .from('generations')
        .update({ input_urls: [`kie:${taskId}`] })
        .eq('id', genId);
      const { data: profile } = await service
        .from('profiles')
        .select('credits')
        .eq('user_id', user.id)
        .single();
      return { ok: true, isVideo: true, runId: taskId, remaining: profile?.credits ?? 0 };
    }

    const rawUrl = await runImageEngine(kind, prompt, inputUrls, createOpts);
    const outputUrl = await persistGeneration(rawUrl, `${user.id}/${kind}`);
    await service
      .from('generations')
      .update({ output_url: outputUrl, status: 'succeeded' })
      .eq('id', genId);
    const { data: profile } = await service
      .from('profiles')
      .select('credits')
      .eq('user_id', user.id)
      .single();
    revalidatePath('/dashboard');
    return { ok: true, outputUrl, remaining: profile?.credits ?? 0 };
  } catch (err) {
    const reason = err instanceof Error ? err.message : 'Falha na geração.';
    // Visível nos logs de prod (antes a falha síncrona só voltava pra tela).
    console.error('[generate] sync generation failed', {
      kind,
      genId,
      reason,
      stack: err instanceof Error ? err.stack : undefined,
    });
    const { data: refunded } = await service.rpc('refund_generation', {
      p_gen_id: genId,
      p_reason: reason,
    });
    // Geração grátis falhou -> devolve a unidade da cota (não houve crédito).
    if (usedFree && freeBucket) await refundFreeQuota(user.id, freeBucket);
    return { ok: false, error: reason, refunded: Boolean(refunded) };
  }
}
