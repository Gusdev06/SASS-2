'use server';

import sharp from 'sharp';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { cookies } from 'next/headers';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { generateImage } from '@/lib/replicate';
import {
  generateImage as generateNanoBanana,
  NANO_BANANA_MODELS,
  ASPECT_RATIOS,
  IMAGE_SIZES,
  type NanoBananaOptions,
} from '@/lib/vertex-image';
import { generateImage as generateGptImage, type GptImageOptions } from '@/lib/gpt-image';
import { queueRun, uploadAsset } from '@/lib/comfydeploy';
import { persistGeneration } from '@/lib/storage';
import { consumeFreeQuota, refundFreeQuota, type FreeBucket } from '@/lib/free-quota';
import {
  CREDITS_PER_IMAGE,
  CREDITS_PER_VIDEO,
  ENHANCE_PROMPT,
  UNDRESS_PROMPT,
  FACESWAP_PROMPT,
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
type Kind = 'undress' | 'faceswap' | 'enhance' | 'edit' | 'video' | 'create';

const NANO_BANANA_VALUES = new Set<string>(Object.values(NANO_BANANA_MODELS));
const ASPECT_VALUES = new Set<string>(ASPECT_RATIOS);
const SIZE_VALUES = new Set<string>(IMAGE_SIZES);

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
  | { engine: 'replicate' };

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
function runImageEngine(
  kind: Kind,
  prompt: string,
  inputUrls: string[],
  opts?: CreateOpts
): Promise<string> {
  if (kind === 'create') {
    if (opts?.engine === 'gpt') return generateGptImage(prompt, inputUrls, opts.gpt);
    if (opts?.engine === 'replicate') return generateImage(prompt, inputUrls);
    return generateNanoBanana(prompt, inputUrls, opts?.engine === 'nano' ? opts.nano : undefined);
  }
  return generateImage(prompt, inputUrls);
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
  if (!['undress', 'faceswap', 'enhance', 'edit', 'video', 'create'].includes(kind)) {
    return { ok: false, error: 'Tipo inválido.' };
  }

  const customPrompt = formData.get('prompt') ? String(formData.get('prompt')) : null;
  const reusedUrl = formData.get('reused_url') ? String(formData.get('reused_url')) : null;
  const prompt = pickPrompt(kind, customPrompt);

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
      createOpts = { engine: 'replicate' };
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
  }

  if (!prompt) {
    return { ok: false, error: 'Digite um prompt.' };
  }

  let inputUrls: string[] = [];
  let videoInputUrl: string | null = null;
  if (reusedUrl) {
    inputUrls = [reusedUrl];
    if (kind === 'video') videoInputUrl = reusedUrl;
  } else {
    const files = formData.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
    // `create` accepts an optional reference image; others require their inputs.
    const expected = kind === 'create' ? 0 : kind === 'faceswap' ? 2 : 1;
    if (files.length < expected) {
      return { ok: false, error: `Envie ${expected} foto(s).` };
    }
    try {
      if (kind === 'video') {
        const f = files[0];
        if (f.size > MAX_FILE_BYTES) {
          return { ok: false, error: `imagem muito grande (max ${MAX_FILE_BYTES / 1024 / 1024}MB)` };
        }
        const buf = new Uint8Array(await f.arrayBuffer());
        videoInputUrl = await uploadAsset(buf, f.type || 'image/jpeg', f.name || 'input.jpg');
      } else if (kind === 'create') {
        inputUrls = files.length ? await filesToDataUris(files.slice(0, 3)) : [];
      } else {
        inputUrls = await filesToDataUris(files.slice(0, expected));
      }
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Falha na leitura da imagem.' };
    }
  }

  if (!user) {
    if (kind === 'video') {
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

  const cost = usedFree ? 0 : kind === 'video' ? CREDITS_PER_VIDEO : CREDITS_PER_IMAGE;
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
      const runId = await queueRun({ input_image: videoInputUrl, prompt });
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
    const { data: refunded } = await service.rpc('refund_generation', {
      p_gen_id: genId,
      p_reason: reason,
    });
    // Geração grátis falhou -> devolve a unidade da cota (não houve crédito).
    if (usedFree && freeBucket) await refundFreeQuota(user.id, freeBucket);
    return { ok: false, error: reason, refunded: Boolean(refunded) };
  }
}
