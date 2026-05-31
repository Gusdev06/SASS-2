const TMPFILES_UPLOAD = 'https://tmpfiles.org/api/v1/upload';

function toDownloadUrl(viewUrl: string): string {
  return viewUrl.replace(/^(https?:\/\/tmpfiles\.org)\/(?!dl\/)/i, '$1/dl/');
}

function extFromContentType(ct: string | null): string {
  if (!ct) return 'jpg';
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('mp4')) return 'mp4';
  return 'jpg';
}

export async function proxyToTmpfiles(
  remoteUrl: string,
  filenameHint = 'image'
): Promise<string> {
  const res = await fetch(remoteUrl);
  if (!res.ok) throw new Error('storage_fetch_failed');
  const ct = res.headers.get('content-type');
  const ext = extFromContentType(ct);
  const bytes = new Uint8Array(await res.arrayBuffer());

  const form = new FormData();
  form.append(
    'file',
    new Blob([bytes as unknown as ArrayBuffer], { type: ct ?? 'image/jpeg' }),
    `${filenameHint}.${ext}`
  );

  const up = await fetch(TMPFILES_UPLOAD, { method: 'POST', body: form });
  if (!up.ok) throw new Error(`storage_upload_failed_${up.status}`);
  const json = (await up.json()) as { status?: string; data?: { url?: string } };
  const view = json?.data?.url;
  if (!view) throw new Error('storage_upload_no_url');
  return toDownloadUrl(view);
}
