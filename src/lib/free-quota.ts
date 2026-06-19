import 'server-only';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Cota grátis diária dos compradores do curso (paralela aos créditos).
 * Só o tab `create` (Nano Banana Pro / Nano Banana 2 / Replicate-NSFW) consome
 * cota grátis; esgotou, cai para créditos. Os demais flows são só créditos.
 * Toda a lógica atômica (reset 24h, gate de entitlement) vive nas RPCs do
 * arquivo supabase/free-quota.sql.
 */

export type FreeBucket = 'nano_pro' | 'nano_v2' | 'replicate';

export const FREE_LIMITS: Record<FreeBucket, number> = {
  nano_pro: 5,
  nano_v2: 5,
  replicate: 2,
};

export type FreeBucketState = { used: number; limit: number; remaining: number };

export type FreeQuotaState =
  | { entitled: false }
  | { entitled: true; resetAt: string | null; buckets: Record<FreeBucket, FreeBucketState> };

type ConsumeResult =
  | { allowed: true; bucket: FreeBucket; used: number; limit: number; remaining: number; reset_at: string }
  | { allowed: false; reason: string; reset_at?: string };

/** Leitura da cota (para a UI). Devolve `{ entitled:false }` se não for comprador. */
export async function getFreeQuota(userId: string): Promise<FreeQuotaState> {
  const service = createServiceClient();
  const { data, error } = await service.rpc('get_free_quota', { p_user_id: userId });
  if (error || !data || !data.entitled) return { entitled: false };
  return {
    entitled: true,
    resetAt: data.reset_at ?? null,
    buckets: data.buckets as Record<FreeBucket, FreeBucketState>,
  };
}

/** Consome 1 unidade da cota grátis do bucket. `allowed:false` => use créditos. */
export async function consumeFreeQuota(userId: string, bucket: FreeBucket): Promise<boolean> {
  const service = createServiceClient();
  const { data, error } = await service.rpc('consume_free_quota', {
    p_user_id: userId,
    p_bucket: bucket,
  });
  if (error || !data) return false;
  return (data as ConsumeResult).allowed === true;
}

/** Devolve 1 unidade da cota grátis (quando a geração falha). */
export async function refundFreeQuota(userId: string, bucket: FreeBucket): Promise<void> {
  const service = createServiceClient();
  await service.rpc('refund_free_quota', { p_user_id: userId, p_bucket: bucket });
}
