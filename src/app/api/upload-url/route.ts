import { NextRequest, NextResponse } from 'next/server';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const BUCKET = process.env.SUPABASE_STORAGE_BUCKET || 'generations';

const EXT_BY_CT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/**
 * Gera uma URL de upload assinada do Supabase Storage para o cliente subir a
 * imagem de entrada DIRETO no storage (sem passar pela serverless function, que
 * tem limite de ~4.5MB no corpo). Assim a imagem original sobe sem recompressão
 * e o server action recebe só o link público.
 *
 * O corpo desta requisição carrega só metadados (content-type), nunca o arquivo.
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: 'auth' }, { status: 401 });

  const body = (await req.json().catch(() => ({}))) as { contentType?: string };
  const contentType = body.contentType ?? 'image/jpeg';
  const ext = EXT_BY_CT[contentType] ?? 'jpg';

  const rand = Math.random().toString(36).slice(2, 10);
  const path = `${user.id}/uploads/${Date.now()}-${rand}.${ext}`;

  const service = createServiceClient();
  const { data, error } = await service.storage.from(BUCKET).createSignedUploadUrl(path);
  if (error || !data) {
    return NextResponse.json({ error: error?.message ?? 'sign failed' }, { status: 500 });
  }

  const { data: pub } = service.storage.from(BUCKET).getPublicUrl(path);

  return NextResponse.json({
    bucket: BUCKET,
    path: data.path,
    token: data.token,
    publicUrl: pub.publicUrl,
  });
}
