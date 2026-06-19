import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';
import type { PromptRow } from '@/lib/promptsApi';
import PromptRowActions from '@/components/admin/PromptRowActions';

export const dynamic = 'force-dynamic';

export default async function AdminPromptsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const search = (q ?? '').trim();

  const service = createServiceClient();
  let query = service
    .from('prompts')
    .select(
      'id, section_slug, section_title, section_icon, category_title, title, type, prompt, image_url, thumbnail_url, ai_model, sort_order, active'
    )
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false })
    .limit(1000);

  if (search) query = query.or(`prompt.ilike.%${search}%`);

  const { data, error } = await query;
  const rows = (data ?? []) as PromptRow[];

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <p className="text-xs font-bold tracking-widest text-bone-mute uppercase mb-3">Admin</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Prompts</h1>
          <p className="text-sm text-bone-dim mt-3">{rows.length} prompts na biblioteca.</p>
        </div>
        <div className="flex items-center gap-2">
          <form className="flex items-center gap-2">
            <input
              name="q"
              defaultValue={search}
              placeholder="Buscar prompt"
              className="input !py-2.5 w-44 md:w-56 text-sm"
            />
            <button type="submit" className="btn-ghost !py-2.5 text-sm">Buscar</button>
          </form>
          <Link href="/admin/prompts-from-image" className="btn-ghost text-sm whitespace-nowrap">
            + Da imagem
          </Link>
          <Link href="/admin/prompts/new" className="btn-primary text-sm whitespace-nowrap">
            + Novo
          </Link>
        </div>
      </header>

      {error && <p className="text-sm text-ember">Erro ao carregar: {error.message}</p>}
      {!error && rows.length === 0 && <p className="text-sm text-bone-dim">Nenhum prompt encontrado.</p>}

      <div className="space-y-2">
        {rows.map((p) => (
          <div
            key={p.id}
            className={`card !p-3 flex items-center gap-3 ${p.active ? '' : 'opacity-50'}`}
          >
            {p.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={p.thumbnail_url} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0 bg-ink-700" />
            ) : (
              <div className="w-12 h-12 rounded-lg shrink-0 bg-ink-700" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                {p.ai_model && (
                  <span className="text-[10px] font-bold text-lime uppercase tracking-wider">{p.ai_model}</span>
                )}
                {!p.active && (
                  <span className="text-[10px] font-bold text-bone-mute uppercase tracking-wider">oculto</span>
                )}
              </div>
              <p className="text-xs text-bone-mute truncate">{p.prompt}</p>
            </div>
            <PromptRowActions id={p.id} active={p.active} />
          </div>
        ))}
      </div>
    </div>
  );
}
