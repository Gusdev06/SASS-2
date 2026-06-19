import { createServiceClient } from '@/lib/supabase/server';

// Extensão -> content-type para os formatos que geramos (imagem e vídeo).
const EXT_TO_CT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};

function extFromContentType(ct: string | null): string | null {
  if (!ct) return null;
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('mp4')) return 'mp4';
  if (ct.includes('webm')) return 'webm';
  if (ct.includes('quicktime')) return 'mov';
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg';
  return null;
}

// Extensão a partir da URL de origem. Importante para vídeos: o S3 da
// ComfyDeploy serve os .mp4 como `application/octet-stream`, então confiar só
// no content-type salvaria o vídeo como .jpg.
function extFromUrl(url: string): string | null {
  try {
    const path = new URL(url).pathname.toLowerCase();
    const m = path.match(/\.([a-z0-9]{2,4})$/);
    return m && EXT_TO_CT[m[1]] ? m[1] : null;
  } catch {
    return null;
  }
}

export async function uploadToSupabase(
  remoteUrl: string,
  pathHint = 'image'
): Promise<string> {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error('storage_fetch_failed');
  const ctHeader = res.headers.get('content-type');
  const bytes = new Uint8Array(await res.arrayBuffer());
  // A extensão da URL tem prioridade (CDNs costumam mandar octet-stream).
  const ext = extFromUrl(remoteUrl) ?? extFromContentType(ctHeader) ?? 'jpg';
  return uploadBufferToSupabase(bytes, pathHint, EXT_TO_CT[ext], ext);
}

/**
 * Uploads a raw image/video buffer (e.g. a re-encoded upload) to the storage
 * bucket and returns the permanent public URL. Use this when the bytes are
 * already in hand and there is no remote URL to fetch from.
 */
export async function uploadBufferToSupabase(
  bytes: Uint8Array,
  pathHint = 'image',
  contentType = 'image/jpeg',
  extOverride?: string
): Promise<string> {
  const ext = extOverride ?? extFromContentType(contentType) ?? 'jpg';
  const bucket = process.env.SUPABASE_STORAGE_BUCKET || 'generations';
  const key = `${pathHint}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const supabase = createServiceClient();
  const { error } = await supabase.storage.from(bucket).upload(key, bytes, {
    contentType: contentType || EXT_TO_CT[ext] || 'application/octet-stream',
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
