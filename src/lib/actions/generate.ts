'use server';

import { revalidatePath } from 'next/cache';
import { cookies } from 'next/headers';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { generateImage } from '@/lib/image-engine';
import { queueRun, uploadAsset } from '@/lib/comfydeploy';
import { uploadToSupabase } from '@/lib/storage';
import { applyWatermark } from '@/lib/watermark';
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
  const out = await applyWatermark(buf);
  return `data:image/jpeg;base64,${out.toString('base64')}`;
}

const MAX_PROMPT = 2000;
const MAX_FILE_BYTES = 12 * 1024 * 1024;
const ANON_COOKIE = 'anon_used';
type Kind = 'undress' | 'faceswap' | 'enhance' | 'edit' | 'video';

export type GenResult =
  | { ok: true; outputUrl: string; remaining: number; watermarked?: boolean }
  | { ok: true; isVideo: true; runId: string; remaining: number }
  | { ok: false; error: string; refunded?: boolean };

function pickPrompt(kind: Kind, customPrompt: string | null): string {
  if (kind === 'undress') return UNDRESS_PROMPT;
  if (kind === 'faceswap') return FACESWAP_PROMPT;
  if (kind === 'enhance') return ENHANCE_PROMPT;
  return (customPrompt ?? '').trim();
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
  if (!['undress', 'faceswap', 'enhance', 'edit', 'video'].includes(kind)) {
    return { ok: false, error: 'Tipo inválido.' };
  }

  const customPrompt = formData.get('prompt') ? String(formData.get('prompt')) : null;
  const reusedUrl = formData.get('reused_url') ? String(formData.get('reused_url')) : null;
  const prompt = pickPrompt(kind, customPrompt);

  if (!prompt || prompt.length < 2 || prompt.length > MAX_PROMPT) {
    return { ok: false, error: 'Prompt inválido.' };
  }

  let inputUrls: string[] = [];
  let videoInputUrl: string | null = null;
  if (reusedUrl) {
    inputUrls = [reusedUrl];
    if (kind === 'video') videoInputUrl = reusedUrl;
  } else {
    const files = formData.getAll('images').filter((f): f is File => f instanceof File && f.size > 0);
    const expected = kind === 'faceswap' ? 2 : 1;
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
      const rawUrl = await generateImage(prompt, inputUrls);
      const outputUrl = await watermarkRemote(rawUrl);
      jar.set(ANON_COOKIE, '1', {
        path: '/',
        maxAge: 60 * 60 * 24 * 365,
        httpOnly: true,
        sameSite: 'lax',
      });
      return { ok: true, outputUrl, remaining: 0, watermarked: true };
    } catch (err) {
      console.error('[generate] anon fail', err);
      return { ok: false, error: 'Falha na geração.' };
    }
  }

  const service = createServiceClient();
  const cost = kind === 'video' ? CREDITS_PER_VIDEO : CREDITS_PER_IMAGE;
  const { data: debited, error: debitErr } = await service.rpc('debit_credits', {
    p_user_id: user.id,
    p_amount: cost,
  });
  if (debitErr) return { ok: false, error: debitErr.message };
  if (!debited) return { ok: false, error: 'Créditos insuficientes.' };

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

    const rawUrl = await generateImage(prompt, inputUrls);
    const outputUrl = await uploadToSupabase(rawUrl, `generations/${user.id}/${genId}`);
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
    console.error('[generate] auth fail', err);
    const reason = 'Falha na geração.';
    const { data: refunded } = await service.rpc('refund_generation', {
      p_gen_id: genId,
      p_reason: reason,
    });
    return { ok: false, error: reason, refunded: Boolean(refunded) };
  }
}
