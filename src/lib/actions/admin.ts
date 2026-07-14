'use server';

import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getAdminUser } from '@/lib/admin';

export type AdminState = { error?: string; info?: string };

/**
 * Adjust a user's credit balance by a signed delta (positive grants, negative
 * deducts). Uses the atomic add_credits RPC so concurrent debits stay correct.
 */
export async function adjustCreditsAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const admin = await getAdminUser();
  if (!admin) return { error: 'Não autorizado.' };

  const userId = String(formData.get('user_id') ?? '').trim();
  const delta = Number(formData.get('delta') ?? 0);
  if (!userId) return { error: 'Usuário inválido.' };
  if (!Number.isInteger(delta) || delta === 0) return { error: 'Informe um valor inteiro diferente de zero.' };

  const service = createServiceClient();
  const { data, error } = await service.rpc('add_credits', { p_user_id: userId, p_amount: delta });
  if (error) return { error: error.message };

  revalidatePath('/admin/users');
  revalidatePath('/admin');
  return { info: `Saldo atualizado para ${data} créditos.` };
}

/**
 * Promove ou remove um usuário como admin (profiles.is_admin). Vários usuários
 * podem ser admin ao mesmo tempo. Você não pode remover o seu próprio acesso
 * (evita lockout acidental).
 */
export async function setAdminAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const admin = await getAdminUser();
  if (!admin) return { error: 'Não autorizado.' };

  const userId = String(formData.get('user_id') ?? '').trim();
  const makeAdmin = String(formData.get('is_admin') ?? '') === 'true';
  if (!userId) return { error: 'Usuário inválido.' };
  if (userId === admin.id && !makeAdmin) {
    return { error: 'Você não pode remover o seu próprio acesso de admin.' };
  }

  const service = createServiceClient();
  const { error } = await service
    .from('profiles')
    .update({ is_admin: makeAdmin, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) return { error: error.message };

  revalidatePath('/admin/users');
  return { info: makeAdmin ? 'Usuário promovido a admin.' : 'Acesso de admin removido.' };
}

/**
 * Ban or unban a user. Banned users are blocked from debiting credits by the
 * debit_credits RPC (which checks `banned = false`).
 */
export async function setBannedAction(_prev: AdminState, formData: FormData): Promise<AdminState> {
  const admin = await getAdminUser();
  if (!admin) return { error: 'Não autorizado.' };

  const userId = String(formData.get('user_id') ?? '').trim();
  const banned = String(formData.get('banned') ?? '') === 'true';
  if (!userId) return { error: 'Usuário inválido.' };

  const service = createServiceClient();
  const { error } = await service
    .from('profiles')
    .update({ banned, updated_at: new Date().toISOString() })
    .eq('user_id', userId);
  if (error) return { error: error.message };

  revalidatePath('/admin/users');
  return { info: banned ? 'Usuário banido.' : 'Usuário reativado.' };
}
