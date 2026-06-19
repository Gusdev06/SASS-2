'use client';
import { useState, useTransition } from 'react';
import Lightbox from './Lightbox';
import { type Lang, t } from '@/lib/i18n';
import { deleteGenerationAction } from '@/lib/actions/delete-generation';
import { RENDER_DND_MIME } from '@/lib/dnd';

type Item = {
  id: string;
  prompt: string;
  output_url: string | null;
  kind: string | null;
  created_at: string;
  credits_spent: number;
};

const kindLabel: Record<string, string> = {
  enhance: 'Enhance',
  undress: 'Undress',
  faceswap: 'Face Swap',
  edit: 'Edit',
  video: 'Video',
};

const isVideoUrl = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url);

export default function HistoryGrid({
  items,
  lang,
  cols = 4,
}: {
  items: Item[];
  lang: Lang;
  cols?: number;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [removed, setRemoved] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const confirmMsg =
    lang === 'pt'
      ? 'Excluir esta geração? Esta ação não pode ser desfeita.'
      : lang === 'es'
      ? '¿Eliminar esta generación? Esta acción no se puede deshacer.'
      : 'Delete this generation? This action cannot be undone.';

  function handleDelete(id: string) {
    if (!window.confirm(confirmMsg)) return;
    setDeleting(id);
    const fd = new FormData();
    fd.set('id', id);
    start(async () => {
      const r = await deleteGenerationAction({}, fd);
      if (r.ok) {
        setRemoved((prev) => new Set(prev).add(id));
      } else {
        window.alert(r.error ?? 'Error');
      }
      setDeleting(null);
    });
  }

  const visible = items.filter((g) => !removed.has(g.id));

  if (!visible.length) {
    return (
      <div className="card py-14 text-center">
        <div className="text-5xl mb-3 opacity-40">📭</div>
        <p className="text-xl font-bold text-bone-dim">{t('emptyHistory', lang)}</p>
      </div>
    );
  }

  const colClass =
    cols === 3
      ? 'sm:grid-cols-2 md:grid-cols-3'
      : 'sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4';

  return (
    <>
      <div className={`grid ${colClass} gap-3`}>
        {visible.map((g) => {
          const draggable = !!g.output_url && !isVideoUrl(g.output_url);
          return (
          <figure
            key={g.id}
            draggable={draggable}
            onDragStart={
              draggable
                ? (e) => {
                    const url = g.output_url as string;
                    e.dataTransfer.setData(RENDER_DND_MIME, url);
                    e.dataTransfer.setData('text/uri-list', url);
                    e.dataTransfer.setData('text/plain', url);
                    e.dataTransfer.effectAllowed = 'copy';
                  }
                : undefined
            }
            className={`group relative rounded-2xl overflow-hidden border border-white/10 bg-ink-800 hover:border-lime/40 transition-colors ${
              draggable ? 'cursor-grab active:cursor-grabbing' : ''
            }`}
          >
            <button
              onClick={() => {
                if (!g.output_url) return;
                if (isVideoUrl(g.output_url)) {
                  window.open(g.output_url, '_blank');
                } else {
                  setOpen(g.output_url);
                }
              }}
              className="block aspect-square w-full overflow-hidden"
              aria-label="open"
            >
              {g.output_url ? (
                isVideoUrl(g.output_url) ? (
                  <video
                    src={g.output_url}
                    muted
                    loop
                    playsInline
                    preload="metadata"
                    onMouseEnter={(e) => e.currentTarget.play().catch(() => {})}
                    onMouseLeave={(e) => { e.currentTarget.pause(); e.currentTarget.currentTime = 0; }}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={g.output_url}
                    alt=""
                    draggable={false}
                    className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
                  />
                )
              ) : (
                <div className="w-full h-full grid place-items-center text-bone-mute text-xs">
                  {kindLabel[g.kind ?? ''] ?? '—'}
                </div>
              )}
            </button>
            <figcaption className="absolute inset-x-0 bottom-0 p-3 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
              <span className="text-[10px] font-bold tracking-widest text-bone-dim uppercase">
                {kindLabel[g.kind ?? ''] ?? '—'}
              </span>
              <div className="flex items-center gap-2">
                {g.output_url && (
                  <a
                    href={g.output_url}
                    download
                    onClick={(e) => e.stopPropagation()}
                    className="text-[10px] font-bold bg-lime text-ink-900 px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:brightness-110"
                  >
                    ↓ DOWNLOAD
                  </a>
                )}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleDelete(g.id); }}
                  disabled={pending && deleting === g.id}
                  aria-label="delete"
                  className="text-[10px] font-bold bg-rose-600 text-white px-2 py-1 rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:brightness-110 disabled:opacity-60"
                >
                  {pending && deleting === g.id ? '…' : '🗑'}
                </button>
              </div>
            </figcaption>
          </figure>
          );
        })}
      </div>
      <Lightbox src={open} onClose={() => setOpen(null)} />
    </>
  );
}
