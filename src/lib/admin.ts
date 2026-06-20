import 'server-only';
import { cache } from 'react';
import { getUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Admin é controlado pelo banco: `profiles.is_admin = true`. Vários usuários
 * podem ser admin ao mesmo tempo — promova/remova pela tela /admin/users.
 *
 * O ADMIN_EMAIL (lista separada por vírgula) continua valendo apenas como
 * "break-glass" de bootstrap: garante acesso mesmo que nenhum admin tenha sido
 * marcado no banco ainda, evitando lockout. A fonte de verdade é o banco.
 */
function bootstrapEmails(): string[] {
  return (process.env.ADMIN_EMAIL ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = bootstrapEmails();
  return list.length > 0 && list.includes(email.toLowerCase());
}

/**
 * Request-deduplicated admin user. Retorna o usuário autenticado quando ele é
 * admin no banco (`profiles.is_admin`) ou via bootstrap (ADMIN_EMAIL); senão null.
 */
export const getAdminUser = cache(async () => {
  const user = await getUser();
  if (!user) return null;

  const service = createServiceClient();
  const { data } = await service
    .from('profiles')
    .select('is_admin')
    .eq('user_id', user.id)
    .maybeSingle();
  if (data?.is_admin === true) return user;

  // Break-glass: e-mail no ADMIN_EMAIL segue admin mesmo sem flag no banco.
  if (isAdminEmail(user.email)) return user;
  return null;
});
