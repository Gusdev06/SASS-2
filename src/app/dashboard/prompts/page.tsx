import { fetchAllPrompts } from '@/lib/promptsApi';
import { getLang } from '@/lib/lang';
import type { Lang } from '@/lib/i18n';
import PromptCard from '@/components/PromptCard';
import PromptsSearch from '@/components/PromptsSearch';

export const revalidate = 600;

const COPY: Record<Lang, {
  eyebrow: string;
  title: string;
  subtitle: string;
  searchPlaceholder: string;
  searchHint: string;
  noResults: string;
  searching: string;
  copy: string;
  copied: string;
  empty: string;
  loadError: string;
}> = {
  pt: {
    eyebrow: 'Biblioteca',
    title: 'Prompts prontos',
    subtitle: 'Centenas de prompts validados. Clique no card para copiar.',
    searchPlaceholder: 'Buscar prompts (ex: outono, lingerie, fitness)…',
    searchHint: 'Digite para buscar em toda a biblioteca.',
    noResults: 'Nada encontrado.',
    searching: 'Buscando…',
    copy: 'copiar prompt',
    copied: 'copiado',
    empty: 'Nenhum prompt na biblioteca.',
    loadError: 'Não conseguimos carregar os prompts agora. Tente recarregar.',
  },
  en: {
    eyebrow: 'Library',
    title: 'Ready-made prompts',
    subtitle: 'Hundreds of validated prompts. Click a card to copy.',
    searchPlaceholder: 'Search prompts (e.g. autumn, lingerie, fitness)…',
    searchHint: 'Type to search the full library.',
    noResults: 'Nothing found.',
    searching: 'Searching…',
    copy: 'copy prompt',
    copied: 'copied',
    empty: 'No prompts in the library.',
    loadError: 'We could not load prompts right now. Try reloading.',
  },
  es: {
    eyebrow: 'Biblioteca',
    title: 'Prompts listos',
    subtitle: 'Cientos de prompts validados. Haz clic en una tarjeta para copiar.',
    searchPlaceholder: 'Buscar prompts (ej: otoño, lencería, fitness)…',
    searchHint: 'Escribe para buscar en toda la biblioteca.',
    noResults: 'Nada encontrado.',
    searching: 'Buscando…',
    copy: 'copiar prompt',
    copied: 'copiado',
    empty: 'Sin prompts en la biblioteca.',
    loadError: 'No pudimos cargar los prompts ahora. Intenta recargar.',
  },
};

export default async function PromptsPage() {
  const lang = await getLang();
  const c = COPY[lang];

  let prompts;
  try {
    prompts = await fetchAllPrompts();
  } catch {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">{c.title}</h1>
        <div className="card text-sm text-bone-dim">{c.loadError}</div>
      </div>
    );
  }

  return (
    <div className="space-y-10">
      <header className="pb-6 border-b border-white/10">
        <p className="text-xs font-bold tracking-widest text-bone-mute uppercase mb-3">{c.eyebrow}</p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">{c.title}</h1>
        <p className="text-sm text-bone-dim mt-3 max-w-[640px]">{c.subtitle}</p>
      </header>

      <PromptsSearch
        strings={{
          placeholder: c.searchPlaceholder,
          emptyHint: c.searchHint,
          noResults: c.noResults,
          searching: c.searching,
          copy: c.copy,
          copied: c.copied,
        }}
      />

      {prompts.length === 0 ? (
        <p className="text-center text-sm text-bone-mute py-12">{c.empty}</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
          {prompts.map((p) => (
            <PromptCard key={p.id} prompt={p} copyLabel={c.copy} copiedLabel={c.copied} />
          ))}
        </div>
      )}
    </div>
  );
}
