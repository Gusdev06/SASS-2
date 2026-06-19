import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 60;

const STATUS_STYLES: Record<string, string> = {
  succeeded: 'bg-lime/10 text-lime',
  pending: 'bg-yellow-400/10 text-yellow-300',
  failed: 'bg-ember/15 text-ember',
  refunded: 'bg-white/10 text-bone-dim',
};

export default async function AdminGenerationsPage() {
  const service = createServiceClient();

  const { data: gens, error } = await service
    .from('generations')
    .select('id, user_id, prompt, kind, status, credits_spent, output_url, created_at')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  return (
    <div className="space-y-8">
      <header className="pb-6 border-b border-white/10">
        <p className="text-xs font-bold tracking-widest text-bone-mute uppercase mb-3">Admin</p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Gerações</h1>
        <p className="text-sm text-bone-dim mt-3">Últimas {PAGE_SIZE} gerações na plataforma.</p>
      </header>

      {error && <p className="text-sm text-ember">Erro ao carregar gerações: {error.message}</p>}

      {!error && (gens?.length ?? 0) === 0 && (
        <p className="text-sm text-bone-dim">Nenhuma geração ainda.</p>
      )}

      <section className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {(gens ?? []).map((g) => (
          <div key={g.id} className="card flex gap-3">
            {g.output_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={g.output_url}
                alt=""
                className="w-16 h-16 rounded-lg object-cover shrink-0 bg-ink-700"
              />
            ) : (
              <div className="w-16 h-16 rounded-lg shrink-0 bg-ink-700 flex items-center justify-center text-bone-mute text-[10px]">
                {g.kind ?? '—'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-bone-mute">
                  {g.kind ?? 'render'}
                </span>
                <span
                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    STATUS_STYLES[g.status] ?? 'bg-white/10 text-bone-dim'
                  }`}
                >
                  {g.status}
                </span>
              </div>
              <p className="text-sm text-bone-dim mt-1 line-clamp-2">{g.prompt}</p>
              <p className="text-[10px] text-bone-mute mt-1.5 font-mono truncate">
                {g.user_id} • {g.credits_spent}cr • {new Date(g.created_at).toLocaleString('pt-BR')}
              </p>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
