import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 48;

const STATUS_STYLES: Record<string, string> = {
  succeeded: 'bg-lime/10 text-lime',
  pending: 'bg-yellow-400/10 text-yellow-300',
  failed: 'bg-ember/15 text-ember',
  refunded: 'bg-white/10 text-bone-dim',
};

const STATUSES = ['pending', 'succeeded', 'failed', 'refunded'] as const;
const KINDS = ['create', 'undress', 'faceswap', 'edit', 'enhance', 'video', 'video_kling'] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Gen = {
  id: string;
  user_id: string;
  prompt: string | null;
  kind: string | null;
  status: string;
  credits_spent: number | null;
  output_url: string | null;
  error: string | null;
  created_at: string;
};

type Search = {
  status?: string;
  kind?: string;
  q?: string;
  page?: string;
};

export default async function AdminGenerationsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const sp = await searchParams;
  const status = STATUSES.includes(sp.status as (typeof STATUSES)[number]) ? sp.status! : '';
  const kind = KINDS.includes(sp.kind as (typeof KINDS)[number]) ? sp.kind! : '';
  const q = (sp.q ?? '').trim();
  const page = Math.max(0, Number.parseInt(sp.page ?? '0', 10) || 0);

  const service = createServiceClient();

  // Contadores globais por status (monitoramento), independentes dos filtros.
  const countFor = (s?: string) => {
    let query = service.from('generations').select('id', { count: 'exact', head: true });
    if (s) query = query.eq('status', s);
    return query;
  };
  const [totalRes, ...statusRes] = await Promise.all([
    countFor(),
    ...STATUSES.map((s) => countFor(s)),
  ]);
  const counts: Record<string, number> = { total: totalRes.count ?? 0 };
  STATUSES.forEach((s, i) => {
    counts[s] = statusRes[i].count ?? 0;
  });

  // Filtro por e-mail / user_id. E-mail é resolvido para user_ids via profiles.
  let userIdFilter: string[] | null = null;
  if (q) {
    if (UUID_RE.test(q)) {
      userIdFilter = [q];
    } else {
      const { data: matched } = await service
        .from('profiles')
        .select('user_id')
        .ilike('email', `%${q}%`)
        .limit(500);
      userIdFilter = (matched ?? []).map((m) => m.user_id as string);
    }
  }

  // Lista filtrada + total para paginação.
  let listError: string | null = null;
  let gens: Gen[] = [];
  let filteredTotal = 0;

  if (userIdFilter !== null && userIdFilter.length === 0) {
    // Busca por e-mail sem nenhum usuário correspondente -> lista vazia.
    filteredTotal = 0;
  } else {
    let query = service
      .from('generations')
      .select('id, user_id, prompt, kind, status, credits_spent, output_url, error, created_at', {
        count: 'exact',
      })
      .order('created_at', { ascending: false })
      .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
    if (status) query = query.eq('status', status);
    if (kind) query = query.eq('kind', kind);
    if (userIdFilter) query = query.in('user_id', userIdFilter);

    const { data, error, count } = await query;
    if (error) listError = error.message;
    gens = (data ?? []) as Gen[];
    filteredTotal = count ?? 0;
  }

  // Mapa user_id -> email para exibir quem gerou.
  const emailMap = new Map<string, string>();
  const ids = Array.from(new Set(gens.map((g) => g.user_id)));
  if (ids.length) {
    const { data: profs } = await service
      .from('profiles')
      .select('user_id, email')
      .in('user_id', ids);
    for (const p of profs ?? []) emailMap.set(p.user_id as string, (p.email as string) ?? '');
  }

  const totalPages = Math.max(1, Math.ceil(filteredTotal / PAGE_SIZE));
  const buildQuery = (overrides: Partial<Search>) => {
    const params = new URLSearchParams();
    const merged = { status, kind, q, page: String(page), ...overrides };
    if (merged.status) params.set('status', merged.status);
    if (merged.kind) params.set('kind', merged.kind);
    if (merged.q) params.set('q', merged.q);
    if (merged.page && merged.page !== '0') params.set('page', merged.page);
    const s = params.toString();
    return s ? `?${s}` : '/admin/generations';
  };

  return (
    <div className="space-y-8">
      <header className="pb-6 border-b border-white/10">
        <p className="text-xs font-bold tracking-widest text-bone-mute uppercase mb-3">Admin</p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Gerações</h1>
        <p className="text-sm text-bone-dim mt-3">
          Acompanhe o status das gerações e as imagens de todos os usuários.
        </p>
      </header>

      {/* Resumo por status (global) */}
      <section className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <StatCard label="Total" value={counts.total} active={!status} href={buildQuery({ status: '', page: '0' })} />
        {STATUSES.map((s) => (
          <StatCard
            key={s}
            label={STATUS_LABELS[s]}
            value={counts[s]}
            active={status === s}
            href={buildQuery({ status: s, page: '0' })}
            tone={s}
          />
        ))}
      </section>

      {/* Filtros */}
      <form className="flex flex-col md:flex-row md:items-end gap-3">
        <label className="flex flex-col gap-1.5 flex-1">
          <span className="field-label">Buscar por e-mail ou user_id</span>
          <input name="q" defaultValue={q} placeholder="email@exemplo.com" className="input !py-2.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Tipo</span>
          <select name="kind" defaultValue={kind} className="input !py-2.5 text-sm">
            <option value="">Todos</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="field-label">Status</span>
          <select name="status" defaultValue={status} className="input !py-2.5 text-sm">
            <option value="">Todos</option>
            {STATUSES.map((s) => (
              <option key={s} value={s}>{STATUS_LABELS[s]}</option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn-ghost !py-2.5 text-sm">Filtrar</button>
      </form>

      {listError && <p className="text-sm text-ember">Erro ao carregar gerações: {listError}</p>}

      {!listError && gens.length === 0 && (
        <p className="text-sm text-bone-dim">Nenhuma geração encontrada com esses filtros.</p>
      )}

      <section className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {gens.map((g) => {
          const email = emailMap.get(g.user_id) || g.user_id;
          return (
            <div key={g.id} className="card !p-3 flex flex-col gap-2">
              <div className="relative aspect-square rounded-lg overflow-hidden bg-ink-700">
                {g.output_url ? (
                  <a href={g.output_url} target="_blank" rel="noreferrer" className="block w-full h-full">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={g.output_url} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </a>
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-bone-mute text-xs">
                    {g.status === 'pending' ? 'gerando…' : 'sem imagem'}
                  </div>
                )}
                <span
                  className={`absolute top-1.5 left-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                    STATUS_STYLES[g.status] ?? 'bg-white/10 text-bone-dim'
                  }`}
                >
                  {g.status}
                </span>
              </div>

              <div className="min-w-0">
                <span className="text-[10px] font-bold uppercase tracking-wider text-bone-mute">
                  {g.kind ?? 'render'}
                </span>
                {g.prompt && <p className="text-xs text-bone-dim mt-0.5 line-clamp-2">{g.prompt}</p>}
                {g.status === 'failed' && g.error && (
                  <p className="text-[10px] text-ember mt-1 line-clamp-2">⚠ {g.error}</p>
                )}
                <p className="text-[10px] text-bone-mute mt-1.5 truncate" title={email}>{email}</p>
                <p className="text-[10px] text-bone-mute font-mono">
                  {g.credits_spent ?? 0}cr • {new Date(g.created_at).toLocaleString('pt-BR')}
                </p>
              </div>
            </div>
          );
        })}
      </section>

      {/* Paginação */}
      {filteredTotal > 0 && (
        <div className="flex items-center justify-between gap-3 pt-2">
          <span className="text-xs text-bone-mute">
            Página {page + 1} de {totalPages} • {filteredTotal} no total
          </span>
          <div className="flex items-center gap-2">
            {page > 0 ? (
              <Link href={buildQuery({ page: String(page - 1) })} className="btn-ghost !py-2 text-sm">← Anterior</Link>
            ) : (
              <span className="btn-ghost !py-2 text-sm opacity-40 pointer-events-none">← Anterior</span>
            )}
            {page + 1 < totalPages ? (
              <Link href={buildQuery({ page: String(page + 1) })} className="btn-ghost !py-2 text-sm">Próxima →</Link>
            ) : (
              <span className="btn-ghost !py-2 text-sm opacity-40 pointer-events-none">Próxima →</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendentes',
  succeeded: 'Concluídas',
  failed: 'Falhas',
  refunded: 'Estornadas',
};

function StatCard({
  label,
  value,
  href,
  active,
  tone,
}: {
  label: string;
  value: number;
  href: string;
  active: boolean;
  tone?: string;
}) {
  const toneColor =
    tone === 'failed'
      ? 'text-ember'
      : tone === 'pending'
        ? 'text-yellow-300'
        : tone === 'succeeded'
          ? 'text-lime'
          : 'text-bone';
  return (
    <Link
      href={href}
      className={`card !p-4 transition-colors ${active ? 'border-lime/40 bg-lime/[0.04]' : 'hover:border-white/20'}`}
    >
      <p className="text-[11px] font-bold uppercase tracking-wider text-bone-mute">{label}</p>
      <p className={`text-2xl font-bold mt-1 ${toneColor}`}>{value.toLocaleString('pt-BR')}</p>
    </Link>
  );
}
