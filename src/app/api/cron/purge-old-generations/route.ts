import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Gerações mais antigas que isto são apagadas (linha + arquivos no Storage).
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
// Quantas linhas processar por lote (uma invocação percorre vários lotes).
const BATCH = 200;
// Teto duro para uma única execução nunca sair do controle.
const MAX_PER_RUN = 5000;

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generations';

// Extrai a key do objeto no bucket a partir da URL pública do Supabase.
// URLs externas (ex.: vídeos da ComfyDeploy) retornam null e são ignoradas.
function storageKeyFromUrl(url: string | null): string | null {
  if (!url) return null;
  const marker = `/object/public/${BUCKET}/`;
  const i = url.indexOf(marker);
  if (i === -1) return null;
  try {
    return decodeURIComponent(url.slice(i + marker.length).split('?')[0]);
  } catch {
    return url.slice(i + marker.length).split('?')[0];
  }
}

function authorized(req: NextRequest): boolean {
  const expected = process.env.CRON_SECRET;
  if (!expected) return false;
  const header = req.headers.get('authorization') ?? '';
  if (header === `Bearer ${expected}`) return true;
  // Vercel cron requests carry this header automatically.
  return req.headers.get('x-vercel-cron') === '1';
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const service = createServiceClient();
  const cutoff = new Date(Date.now() - MAX_AGE_MS).toISOString();

  const results = { deleted: 0, filesRemoved: 0, errors: 0 };

  // Percorre em lotes até esvaziar o backlog ou bater o teto da execução.
  while (results.deleted < MAX_PER_RUN) {
    const { data: rows, error } = await service
      .from('generations')
      .select('id, output_url, input_urls')
      .lt('created_at', cutoff)
      .order('created_at', { ascending: true })
      .limit(BATCH);

    if (error) {
      return NextResponse.json({ error: error.message, ...results }, { status: 500 });
    }
    if (!rows || rows.length === 0) break;

    // Remove os arquivos hospedados no nosso bucket (output + inputs locais).
    const keys = rows
      .flatMap((r) => [r.output_url, ...((r.input_urls as string[] | null) ?? [])])
      .map(storageKeyFromUrl)
      .filter((k): k is string => Boolean(k));
    if (keys.length) {
      const { error: rmErr } = await service.storage.from(BUCKET).remove(keys);
      if (rmErr) results.errors += 1;
      else results.filesRemoved += keys.length;
    }

    const ids = rows.map((r) => r.id);
    const { error: delErr } = await service.from('generations').delete().in('id', ids);
    if (delErr) {
      return NextResponse.json({ error: delErr.message, ...results }, { status: 500 });
    }
    results.deleted += ids.length;

    if (rows.length < BATCH) break;
  }

  return NextResponse.json({ ok: true, cutoff, ...results });
}
