import Link from 'next/link';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { getUser, getProfile } from '@/lib/auth';
import { t } from '@/lib/i18n';
import { getLang } from '@/lib/lang';
import HistoryGrid from '@/components/HistoryGrid';

const KINDS = ['enhance', 'undress', 'faceswap', 'edit'] as const;

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const user = await getUser();
  if (!user) redirect('/login');

  const supabase = await createClient();
  const profile = await getProfile();
  const lang = await getLang(profile?.language_code);

  const sp = await searchParams;
  const kind = (KINDS as readonly string[]).includes(sp?.kind ?? '') ? sp!.kind! : null;

  let q = supabase
    .from('generations')
    .select('id, prompt, output_url, kind, created_at, credits_spent')
    .eq('user_id', user.id)
    .not('output_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(60);
  if (kind) q = q.eq('kind', kind);
  const { data: items } = await q;

  return (
    <div className="space-y-8">
      <header className="pb-6 border-b border-white/10">
        <p className="text-xs font-bold tracking-widest text-bone-mute uppercase mb-3">{t('history', lang)}</p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">
          {t('history', lang)} <span className="text-lime">{(items?.length ?? 0).toString().padStart(2, '0')}</span>
        </h1>
        <p className="text-sm text-bone-dim mt-3">
          {(items?.length ?? 0)} {lang === 'pt' ? 'entradas' : lang === 'es' ? 'entradas' : 'entries'}
        </p>
        <div className="mt-5 border border-lime/30 bg-lime/[0.06] rounded-xl px-4 py-3 text-xs text-bone-dim flex items-start gap-2">
          <span aria-hidden className="text-lime font-bold leading-none mt-px">✓</span>
          <div>
            <strong className="text-lime font-bold">
              {lang === 'pt'
                ? 'Suas gerações ficam salvas.'
                : lang === 'es'
                ? 'Tus generaciones quedan guardadas.'
                : 'Your generations are saved.'}
            </strong>{' '}
            {lang === 'pt'
              ? 'Tudo fica disponível aqui no seu histórico — baixe quando quiser.'
              : lang === 'es'
              ? 'Todo queda disponible aquí en tu historial — descarga cuando quieras.'
              : 'Everything stays here in your history — download whenever you want.'}
          </div>
        </div>
      </header>

      <section className="flex flex-wrap gap-2 items-center">
        <span className="text-xs font-bold tracking-widest text-bone-mute uppercase mr-2">{t('filters', lang)}</span>
        <FilterChip href="/dashboard/history" label={t('all', lang)} active={!kind} />
        {KINDS.map((k) => (
          <FilterChip
            key={k}
            href={`/dashboard/history?kind=${k}`}
            label={k.charAt(0).toUpperCase() + k.slice(1)}
            active={kind === k}
          />
        ))}
      </section>

      <HistoryGrid items={items ?? []} lang={lang} cols={4} />
    </div>
  );
}

function FilterChip({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      className={`px-3 py-1.5 rounded-full text-xs font-semibold transition-colors border ${
        active
          ? 'bg-lime text-ink-900 border-lime'
          : 'border-white/10 text-bone-dim hover:border-white/30 hover:text-bone'
      }`}
    >
      {label}
    </Link>
  );
}
