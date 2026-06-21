'use client';
import { useEffect, useState } from 'react';
import { t, type Lang } from '@/lib/i18n';

type GalleryItem = {
  id: string;
  url: string;
  kind: string;
  prompt: string | null;
  created_at: string;
};

/**
 * Modal that lists the signed-in user's previously generated images
 * (from /api/my-generations) so they can pick one — or several — as the input
 * for a new generation, edit or video. No download/re-upload needed. Videos are
 * already excluded server-side.
 *
 * `multiple` turns on multi-select: clicking toggles the selection and a footer
 * button confirms the batch. `maxSelect` caps how many can be chosen at once.
 * In single mode a click picks immediately (legacy behaviour).
 */
export default function GalleryPicker({
  lang,
  onPick,
  onClose,
  multiple = false,
  maxSelect = 1,
}: {
  lang: Lang;
  onPick: (urls: string[]) => void;
  onClose: () => void;
  multiple?: boolean;
  maxSelect?: number;
}) {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [error, setError] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/my-generations?limit=100', { cache: 'no-store' });
        if (!res.ok) throw new Error('failed');
        const data = await res.json();
        if (!cancelled) setItems(Array.isArray(data.items) ? data.items : []);
      } catch {
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Close on Escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const cap = Math.max(1, maxSelect);

  const toggle = (url: string) => {
    if (!multiple) {
      onPick([url]);
      return;
    }
    setSelected((prev) => {
      if (prev.includes(url)) return prev.filter((u) => u !== url);
      if (prev.length >= cap) return prev; // respeita o limite de slots restantes
      return [...prev, url];
    });
  };

  const addLabel =
    lang === 'pt' ? 'Adicionar' : lang === 'es' ? 'Añadir' : 'Add';

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-black/80 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="card !p-0 w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-4">
          <div>
            <h2 className="text-base font-bold">{t('pickFromHistoryTitle', lang)}</h2>
            <p className="text-xs text-bone-dim mt-0.5">
              {multiple
                ? lang === 'pt'
                  ? `Selecione até ${cap} imagem(ns)`
                  : lang === 'es'
                  ? `Selecciona hasta ${cap} imagen(es)`
                  : `Select up to ${cap} image(s)`
                : t('pickFromHistorySub', lang)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="text-bone-dim hover:text-bone text-2xl leading-none -mt-1 px-1"
          >
            ×
          </button>
        </div>

        <div className="overflow-y-auto p-6">
          {error ? (
            <p className="text-center text-sm text-red-400 py-12">{t('galleryError', lang)}</p>
          ) : items === null ? (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i} className="aspect-square rounded-xl bg-ink-900 animate-pulse" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <p className="text-center text-sm text-bone-dim py-12">{t('galleryEmpty', lang)}</p>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
              {items.map((it) => {
                const idx = selected.indexOf(it.url);
                const isSel = idx >= 0;
                return (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => toggle(it.url)}
                    className={`group relative aspect-square overflow-hidden rounded-xl border bg-ink-900 transition-colors ${
                      isSel ? 'border-lime ring-2 ring-lime' : 'border-white/10 hover:border-lime'
                    }`}
                    title={it.prompt ?? undefined}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={it.url}
                      alt=""
                      loading="lazy"
                      className="w-full h-full object-cover transition-transform group-hover:scale-105"
                    />
                    {multiple ? (
                      <span
                        className={`absolute top-2 right-2 w-6 h-6 grid place-items-center rounded-full text-xs font-bold transition-colors ${
                          isSel ? 'bg-lime text-ink-900' : 'bg-ink-900/70 text-bone backdrop-blur-sm'
                        }`}
                      >
                        {isSel ? idx + 1 : '+'}
                      </span>
                    ) : (
                      <span className="absolute inset-0 grid place-items-center bg-ink-900/60 opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold text-lime">
                        {t('reuse', lang)} →
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {multiple && (
          <div className="border-t border-white/10 px-6 py-4 flex items-center justify-between gap-4">
            <span className="text-xs text-bone-dim">
              {selected.length}/{cap}
            </span>
            <button
              type="button"
              disabled={selected.length === 0}
              onClick={() => onPick(selected)}
              className="btn-primary text-sm disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {addLabel} {selected.length > 0 ? `(${selected.length})` : ''} →
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
