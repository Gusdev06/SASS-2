/**
 * Public generation endpoint — for the goz.ai landing page demo.
 *
 * Flow:
 *   1. Accept multipart/form-data with `image` (File)
 *   2. Validate size + MIME
 *   3. Check anon rate-limit (cookie + IP-hash header)
 *   4. Generate image (UNDRESS_PROMPT by default)
 *   5. Apply HARD watermark via sharp + SVG composite
 *   6. Return data:image/jpeg;base64 result
 *
 * CORS is open by default (Origin: *). Tighten ALLOWED_ORIGINS for prod.
 */

import { NextRequest, NextResponse } from 'next/server';
import { generateImage } from '@/lib/image-engine';
import { UNDRESS_PROMPT } from '@/lib/prompts';
import { applyWatermark } from '@/lib/watermark';

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ANON_COOKIE = 'goz_anon_used';
const ALLOWED_MIME = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];

/* Whitelist de origens permitidas. Adicione o domínio de produção da LP aqui.
   '*' significa: ecoar qualquer origin recebida (precisa pra credentials=include funcionar). */
const ALLOWED_ORIGINS: string[] = ['*'];

function corsHeaders(origin: string | null) {
  // Quando '*' está na lista, ecoamos a origin recebida (necessário para credentials=include,
  // pois browsers rejeitam ACAO='*' com credenciais).
  const allowOrigin = origin && (ALLOWED_ORIGINS.includes('*') || ALLOWED_ORIGINS.includes(origin))
    ? origin
    : '';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods': 'POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Device-Hash',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req.headers.get('origin')) });
}

/* DELETE: clears the anon-used cookie. Útil para dev/QA e para ser chamado
   pelo backend principal quando o usuário se registra (libera 1 free generation). */
export async function DELETE(req: NextRequest) {
  const r = NextResponse.json({ ok: true }, { headers: corsHeaders(req.headers.get('origin')) });
  r.cookies.set(ANON_COOKIE, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax' });
  return r;
}

function fail(req: NextRequest, status: number, error: string) {
  return NextResponse.json({ ok: false, error }, { status, headers: corsHeaders(req.headers.get('origin')) });
}


export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');

  // ---- rate limit (cookie httpOnly) ----
  const cookieHeader = req.headers.get('cookie') ?? '';
  if (cookieHeader.includes(`${ANON_COOKIE}=1`)) {
    return fail(req, 429, 'Free preview already used. Sign up to generate more.');
  }

  // ---- parse ----
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return fail(req, 400, 'Invalid form data');
  }

  const file = form.get('image');
  if (!(file instanceof File) || file.size === 0) {
    return fail(req, 400, 'Missing image');
  }
  if (file.size > MAX_FILE_BYTES) {
    return fail(req, 400, `Image too large (max ${MAX_FILE_BYTES / 1024 / 1024}MB)`);
  }
  if (!ALLOWED_MIME.includes(file.type)) {
    return fail(req, 400, 'Unsupported image type');
  }

  const customPrompt = form.get('prompt');
  const prompt =
    typeof customPrompt === 'string' && customPrompt.trim().length >= 2
      ? customPrompt.trim().slice(0, 2000)
      : UNDRESS_PROMPT;

  const t0 = Date.now();
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';

  // ---- generate image ----
  let rawUrl: string;
  try {
    const buf = Buffer.from(await file.arrayBuffer());
    const dataUri = `data:${file.type};base64,${buf.toString('base64')}`;
    rawUrl = await generateImage(prompt, [dataUri]);
  } catch (err) {
    console.error('[public-generate] generation fail', { ip, ms: Date.now() - t0, err: err instanceof Error ? err.message : err });
    return fail(req, 502, 'Generation failed');
  }

  // ---- fetch result + watermark ----
  let watermarkedB64: string;
  try {
    const res = await fetch(rawUrl);
    if (!res.ok) throw new Error('fetch_failed');
    const buf = Buffer.from(await res.arrayBuffer());
    const out = await applyWatermark(buf);
    watermarkedB64 = `data:image/jpeg;base64,${out.toString('base64')}`;
  } catch (err) {
    console.error('[public-generate] watermark fail', { ip, ms: Date.now() - t0, err: err instanceof Error ? err.message : err });
    return fail(req, 500, 'Generation failed');
  }

  console.log('[public-generate] ok', { ip, ms: Date.now() - t0, kb: Math.round(watermarkedB64.length / 1024) });

  const response = NextResponse.json(
    { ok: true, outputUrl: watermarkedB64, watermarked: true },
    { headers: corsHeaders(origin) }
  );
  // set anon-used cookie (1 year)
  response.cookies.set(ANON_COOKIE, '1', {
    path: '/',
    maxAge: 60 * 60 * 24 * 365,
    httpOnly: true,
    sameSite: 'lax',
  });
  return response;
}
