import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/server';
import { findVideoMarker, resolveVideoMarker } from '@/lib/video';
import { persistGeneration } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// Pending videos older than this with no terminal status get reconciled / refunded.
const STALE_AFTER_MS = 8 * 60 * 1000;
// Hard cap so a single invocation never runs away.
const MAX_PER_RUN = 50;

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
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const { data: rows, error } = await service
    .from('generations')
    .select('id, user_id, input_urls, created_at')
    .in('kind', ['video', 'video_kling'])
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_RUN);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const results = { checked: 0, succeeded: 0, refunded: 0, stillPending: 0, errors: 0 };

  for (const row of rows ?? []) {
    results.checked += 1;
    const marker = findVideoMarker(row.input_urls);
    if (!marker) {
      const { data: refunded } = await service.rpc('refund_generation', {
        p_gen_id: row.id,
        p_reason: 'missing run id',
      });
      if (refunded) results.refunded += 1;
      continue;
    }

    try {
      const res = await resolveVideoMarker(marker);
      if (res.status === 'success') {
        const storedUrl = await persistGeneration(res.url, `${row.user_id}/video`);
        await service
          .from('generations')
          .update({ output_url: storedUrl, status: 'succeeded' })
          .eq('id', row.id);
        results.succeeded += 1;
      } else if (res.status === 'success_no_output') {
        const { data: refunded } = await service.rpc('refund_generation', {
          p_gen_id: row.id,
          p_reason: 'success without output',
        });
        if (refunded) results.refunded += 1;
      } else if (res.status === 'failed') {
        const { data: refunded } = await service.rpc('refund_generation', {
          p_gen_id: row.id,
          p_reason: res.reason,
        });
        if (refunded) results.refunded += 1;
      } else {
        results.stillPending += 1;
      }
    } catch {
      results.errors += 1;
    }
  }

  return NextResponse.json({ ok: true, ...results });
}
