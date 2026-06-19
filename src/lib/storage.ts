import { createServiceClient } from '@/lib/supabase/server';

function extFromContentType(ct: string | null): string {
  if (!ct) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('mp4')) return 'mp4';
  return 'jpg';
}

export async function uploadToSupabase(
  remoteUrl: string,
  pathHint = 'image'
): Promise<string> {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error('storage_fetch_failed');
  const ct = res.headers.get('content-type');
  const bytes = new Uint8Array(await res.arrayBuffer());
  return uploadBufferToSupabase(bytes, pathHint, ct ?? 'image/jpeg');
}

/**
 * Uploads a raw image/video buffer (e.g. a re-encoded upload) to the storage
 * bucket and returns the permanent public URL. Use this when the bytes are
 * already in hand and there is no remote URL to fetch from.
 */
export async function uploadBufferToSupabase(
  bytes: Uint8Array,
  pathHint = 'image',
  contentType = 'image/jpeg'
): Promise<string> {
  const ext = extFromContentType(contentType);
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'generations';
  const key = `${pathHint}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const supabase = createServiceClient();
  const { error } = await supabase.storage.from(bucket).upload(key, bytes, {
    contentType,
    upsert: false,
  });
  if (error) throw new Error(`storage_upload_failed_${error.message}`);

  const { data } = supabase.storage.from(bucket).getPublicUrl(key);
  if (!data?.publicUrl) throw new Error('storage_upload_no_url');
  return data.publicUrl;
}

/**
 * Persists a generation output (remote URL or data: URI) to the bucket and
 * returns the permanent public URL. If the upload fails for any reason, falls
 * back to the original source so a successful generation is never lost.
 */
export async function persistGeneration(srcUrl: string, pathHint = 'image'): Promise<string> {
  try {
    return await uploadToSupabase(srcUrl, pathHint);
  } catch (err) {
    console.error('[storage] persist failed, falling back to source url', err instanceof Error ? err.message : err);
    return srcUrl;
  }
}
