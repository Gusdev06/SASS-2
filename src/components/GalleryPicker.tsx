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
 * (from /api/my-generations) so they can pick one as the input for a new
 * generation, edit or video — no download/re-upload needed. Videos are
 * already excluded server-side.
 */
export default function GalleryPicker({
  lang,
  onPick,
  onClose,
}: {
  lang: Lang;
  onPick: (url: string) => void;
  onClose: () => void;
}) {
  const [items, setItems] = useState<GalleryItem[] | null>(null);
  const [error, setError] = useState(false);

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
            <p className="text-xs text-bone-dim mt-0.5">{t('pickFromHistorySub', lang)}</p>
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
              {items.map((it) => (
                <button
                  key={it.id}
                  type="button"
                  onClick={() => onPick(it.url)}
                  className="group relative aspect-square overflow-hidden rounded-xl border border-white/10 bg-ink-900 hover:border-lime transition-colors"
                  title={it.prompt ?? undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={it.url}
                    alt=""
                    loading="lazy"
                    className="w-full h-full object-cover transition-transform group-hover:scale-105"
                  />
                  <span className="absolute inset-0 grid place-items-center bg-ink-900/60 opacity-0 group-hover:opacity-100 transition-opacity text-xs font-bold text-lime">
                    {t('reuse', lang)} →
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
