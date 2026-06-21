import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';
import { findVideoMarker, resolveVideoMarker } from '@/lib/video';
import { persistGeneration } from '@/lib/storage';

const STALE_AFTER_MS = 8 * 60 * 1000;
const MAX_PER_CALL = 3;

// Lazily reconciles a user's stale video generations on demand
// (e.g. when they load the dashboard). Complements the daily cron.
// Caps work and runs in parallel so we never block the render meaningfully.
export async function reconcileUserPendingVideos(userId: string): Promise<void> {
  const service = createServiceClient();
  const cutoff = new Date(Date.now() - STALE_AFTER_MS).toISOString();

  const { data: rows } = await service
    .from('generations')
    .select('id, input_urls')
    .eq('user_id', userId)
    .in('kind', ['video', 'video_kling'])
    .eq('status', 'pending')
    .lt('created_at', cutoff)
    .order('created_at', { ascending: true })
    .limit(MAX_PER_CALL);

  if (!rows || rows.length === 0) return;

  await Promise.allSettled(
    rows.map(async (row) => {
      const marker = findVideoMarker(row.input_urls);
      if (!marker) {
        await service.rpc('refund_generation', {
          p_gen_id: row.id,
          p_reason: 'missing run id',
        });
        return;
      }
      try {
        const res = await resolveVideoMarker(marker);
        if (res.status === 'success') {
          const storedUrl = await persistGeneration(res.url, `${userId}/video`);
          await service
            .from('generations')
            .update({ output_url: storedUrl, status: 'succeeded' })
            .eq('id', row.id);
        } else if (res.status === 'success_no_output') {
          await service.rpc('refund_generation', {
            p_gen_id: row.id,
            p_reason: 'success without output',
          });
        } else if (res.status === 'failed') {
          await service.rpc('refund_generation', {
            p_gen_id: row.id,
            p_reason: res.reason,
          });
        }
      } catch {
        /* swallow — daily cron will catch it */
      }
    })
  );
}
