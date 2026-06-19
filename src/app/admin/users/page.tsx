import { createServiceClient } from '@/lib/supabase/server';
import UserRow, { type AdminUser } from '@/components/admin/UserRow';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 50;

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const search = (q ?? '').trim();

  const service = createServiceClient();
  let query = service
    .from('profiles')
    .select('user_id, email, username, credits, banned, created_at')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  if (search) {
    query = query.or(`email.ilike.%${search}%,username.ilike.%${search}%`);
  }

  const { data: users, error } = await query;

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <p className="text-xs font-bold tracking-widest text-bone-mute uppercase mb-3">Admin</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Usuários</h1>
          <p className="text-sm text-bone-dim mt-3">Ajuste créditos e gerencie acessos.</p>
        </div>
        <form className="flex items-center gap-2">
          <input
            name="q"
            defaultValue={search}
            placeholder="Buscar por email ou usuário"
            className="input !py-2.5 w-full md:w-72 text-sm"
          />
          <button type="submit" className="btn-ghost !py-2.5 text-sm">Buscar</button>
        </form>
      </header>

      {error && <p className="text-sm text-ember">Erro ao carregar usuários: {error.message}</p>}

      {!error && (users?.length ?? 0) === 0 && (
        <p className="text-sm text-bone-dim">Nenhum usuário encontrado.</p>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {(users ?? []).map((u) => (
          <UserRow key={u.user_id} user={u as AdminUser} />
        ))}
      </section>

      {(users?.length ?? 0) === PAGE_SIZE && (
        <p className="text-xs text-bone-mute">Mostrando os primeiros {PAGE_SIZE}. Refine a busca para ver mais.</p>
      )}
    </div>
  );
}
