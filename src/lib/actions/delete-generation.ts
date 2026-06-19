'use server';

import { revalidatePath } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export type DeleteState = { ok?: boolean; error?: string };

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

/**
 * Exclui uma geração do usuário: remove o arquivo do Storage (quando hospedado
 * no nosso bucket) e apaga a linha em `generations`. Sempre filtra por user_id
 * para garantir que ninguém apague geração de outro usuário.
 */
export async function deleteGenerationAction(
  _prev: DeleteState,
  formData: FormData,
): Promise<DeleteState> {
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: 'invalid id' };

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return { error: 'unauthorized' };

  const service = createServiceClient();

  // Busca a geração (confirmando posse) para pegar a URL antes de apagar.
  const { data: gen, error: fetchErr } = await service
    .from('generations')
    .select('id, output_url, input_urls')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();
  if (fetchErr) return { error: fetchErr.message };
  if (!gen) return { error: 'not found' };

  // Remove os arquivos do nosso bucket (output + inputs hospedados localmente).
  const keys = [gen.output_url, ...((gen.input_urls as string[] | null) ?? [])]
    .map(storageKeyFromUrl)
    .filter((k): k is string => Boolean(k));
  if (keys.length) {
    await service.storage.from(BUCKET).remove(keys);
  }

  const { error: delErr } = await service
    .from('generations')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id);
  if (delErr) return { error: delErr.message };

  revalidatePath('/dashboard');
  revalidatePath('/dashboard/history');
  return { ok: true };
}
