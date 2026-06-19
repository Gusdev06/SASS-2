'use client';
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { generateAction, type GenResult } from '@/lib/actions/generate';
import Lightbox from './Lightbox';
import WatermarkedResult from './WatermarkedResult';
import GalleryPicker from './GalleryPicker';
import { t, type Lang } from '@/lib/i18n';
import type { FreeBucket, FreeQuotaState } from '@/lib/free-quota';

const ANON_KEY = 'goz_free_used';

// Modelo do tab `create` -> bucket de cota grátis. GPT Image não tem cota.
const MODEL_BUCKET: Record<string, FreeBucket | undefined> = {
  'gemini-3-pro-image-preview': 'nano_pro',
  'gemini-3.1-flash-image-preview': 'nano_v2',
  nsfw: 'replicate',
};

// Tabs que têm cota grátis própria (2/dia cada). Os demais (enhance/video) não.
const KIND_BUCKET: Partial<Record<Kind, FreeBucket>> = {
  undress: 'undress',
  edit: 'edit',
  faceswap: 'faceswap',
};

type Kind = 'enhance' | 'undress' | 'faceswap' | 'edit' | 'video' | 'create';

const TABS: { id: Kind; en: string; pt: string; es: string; icon: string }[] = [
  { id: 'create', en: 'Create', pt: 'Criar', es: 'Crear', icon: '🍌' },
  { id: 'undress', en: 'Undress', pt: 'Undress', es: 'Undress', icon: '🔥' },
  { id: 'faceswap', en: 'Face Swap', pt: 'Face Swap', es: 'Face Swap', icon: '🎭' },
  { id: 'edit', en: 'Edit', pt: 'Editar', es: 'Editar', icon: '✏️' },
  { id: 'video', en: 'Video', pt: 'Vídeo', es: 'Video', icon: '🎬' },
];

// SFW image models. Only shown on the `create` tab.
// `engine` selects which backend the server action routes to.
const GPT_IMAGE_MODEL = 'gpt-image-2';
const NSFW_MODEL = 'nsfw';
const MODEL_OPTIONS: {
  id: string;
  icon: string;
  engine: 'nano' | 'gpt' | 'replicate';
  label: string;
  hint: { en: string; pt: string; es: string };
}[] = [
  { id: 'gemini-3-pro-image-preview', icon: '🍌', engine: 'nano', label: 'Nano Banana Pro', hint: { en: 'Highest quality', pt: 'Máxima qualidade', es: 'Máxima calidad' } },
  { id: 'gemini-3.1-flash-image-preview', icon: '🍌', engine: 'nano', label: 'Nano Banana 2', hint: { en: 'Faster', pt: 'Mais rápido', es: 'Más rápido' } },
  { id: GPT_IMAGE_MODEL, icon: '🎨', engine: 'gpt', label: 'GPT Image', hint: { en: 'OpenAI · sharp text', pt: 'OpenAI · texto nítido', es: 'OpenAI · texto nítido' } },
  { id: NSFW_MODEL, icon: '🔥', engine: 'replicate', label: 'NSFW', hint: { en: 'Uncensored', pt: 'Sem censura', es: 'Sin censura' } },
];

// GPT Image sizes (the only ones the GPT image models accept).
const GPT_SIZE_OPTIONS: { id: string; label: { en: string; pt: string; es: string } }[] = [
  { id: '1024x1024', label: { en: 'Square 1:1', pt: 'Quadrado 1:1', es: 'Cuadrado 1:1' } },
  { id: '1024x1536', label: { en: 'Portrait 2:3', pt: 'Retrato 2:3', es: 'Retrato 2:3' } },
  { id: '1536x1024', label: { en: 'Landscape 3:2', pt: 'Paisagem 3:2', es: 'Paisaje 3:2' } },
  { id: '864x1536', label: { en: 'Story 9:16', pt: 'Story 9:16', es: 'Story 9:16' } },
  { id: '1536x864', label: { en: 'Wide 16:9', pt: 'Wide 16:9', es: 'Wide 16:9' } },
];

const GPT_QUALITY_OPTIONS: { id: string; label: { en: string; pt: string; es: string } }[] = [
  { id: 'low', label: { en: 'Low · fast', pt: 'Baixa · rápido', es: 'Baja · rápido' } },
  { id: 'medium', label: { en: 'Medium', pt: 'Média', es: 'Media' } },
  { id: 'high', label: { en: 'High · max', pt: 'Alta · máx', es: 'Alta · máx' } },
];

// Aspect ratios accepted by the Gemini endpoint, with a friendly label.
const ASPECT_OPTIONS: { id: string; label: { en: string; pt: string; es: string } }[] = [
  { id: '1:1', label: { en: 'Square 1:1', pt: 'Quadrado 1:1', es: 'Cuadrado 1:1' } },
  { id: '4:5', label: { en: 'Portrait 4:5', pt: 'Retrato 4:5', es: 'Retrato 4:5' } },
  { id: '3:4', label: { en: 'Portrait 3:4', pt: 'Retrato 3:4', es: 'Retrato 3:4' } },
  { id: '9:16', label: { en: 'Story 9:16', pt: 'Story 9:16', es: 'Story 9:16' } },
  { id: '4:3', label: { en: 'Landscape 4:3', pt: 'Paisagem 4:3', es: 'Paisaje 4:3' } },
  { id: '3:2', label: { en: 'Landscape 3:2', pt: 'Paisagem 3:2', es: 'Paisaje 3:2' } },
  { id: '16:9', label: { en: 'Wide 16:9', pt: 'Wide 16:9', es: 'Wide 16:9' } },
  { id: '21:9', label: { en: 'Cinema 21:9', pt: 'Cinema 21:9', es: 'Cine 21:9' } },
];

// Output resolution (quality).
const QUALITY_OPTIONS: { id: string; label: { en: string; pt: string; es: string } }[] = [
  { id: '1K', label: { en: '1K · fast', pt: '1K · rápido', es: '1K · rápido' } },
  { id: '2K', label: { en: '2K · balanced', pt: '2K · equilibrado', es: '2K · equilibrado' } },
  { id: '4K', label: { en: '4K · max', pt: '4K · máx', es: '4K · máx' } },
];

const labelFor = (tab: typeof TABS[number], lang: Lang) =>
  lang === 'pt' ? tab.pt : lang === 'es' ? tab.es : tab.en;

export default function GenPanel({
  lang,
  credits,
  isAnon = false,
  freeQuota,
  resume,
}: {
  lang: Lang;
  credits: number;
  isAnon?: boolean;
  freeQuota?: FreeQuotaState;
  resume?: { kind: 'video'; runId: string } | { kind: 'image'; genId: string } | null;
}) {
  const [kind, setKind] = useState<Kind>('create');
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].id);
  const [aspect, setAspect] = useState<string>('1:1');
  const [quality, setQuality] = useState<string>('2K');
  const [gptSize, setGptSize] = useState<string>('1024x1024');
  const [gptQuality, setGptQuality] = useState<string>('high');
  const [editPrompt, setEditPrompt] = useState('');
  const [reusedUrl, setReusedUrl] = useState<string | null>(null);
  const [result, setResult] = useState<GenResult | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [drag, setDrag] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [freeUsed, setFreeUsed] = useState(false);
  const [videoPoll, setVideoPoll] = useState<{
    runId: string;
    remaining: number;
    status: string;
    progress: number;
    liveStatus: string | null;
  } | null>(null);
  const [imagePoll, setImagePoll] = useState<{ genId: string; remaining: number } | null>(null);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAnon && typeof window !== 'undefined') {
      setFreeUsed(window.localStorage.getItem(ANON_KEY) === '1');
    }
  }, [isAnon]);

  useEffect(() => {
    if (!videoPoll || result?.ok) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      try {
        const res = await fetch(`/api/video-status/${videoPoll.runId}`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;

        if (data.status === 'success' && data.outputUrl) {
          setResult({ ok: true, outputUrl: data.outputUrl, remaining: videoPoll.remaining });
          setVideoPoll(null);
          router.refresh();
          return;
        }
        if (data.status === 'failed' || data.status === 'cancelled' || data.status === 'timeout') {
          setResult({
            ok: false,
            error: data.error || `Run ${data.status}`,
            refunded: Boolean(data.refunded),
          });
          setVideoPoll(null);
          router.refresh();
          return;
        }

        setVideoPoll((prev) =>
          prev
            ? {
                ...prev,
                status: data.status ?? prev.status,
                progress: typeof data.progress === 'number' ? data.progress : prev.progress,
                liveStatus: data.liveStatus ?? prev.liveStatus,
              }
            : prev
        );
        timer = setTimeout(tick, 4000);
      } catch {
        if (cancelled) return;
        timer = setTimeout(tick, 6000);
      }
    };

    timer = setTimeout(tick, 2000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [videoPoll, result, router]);

  // Poll background image generations (SFW `create` tab).
  useEffect(() => {
    if (!imagePoll || result?.ok) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const MAX_MS = 4 * 60 * 1000;

    const tick = async () => {
      try {
        const res = await fetch(`/api/image-status/${imagePoll.genId}`, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;

        if (data.status === 'success' && data.outputUrl) {
          setResult({ ok: true, outputUrl: data.outputUrl, remaining: imagePoll.remaining });
          setImagePoll(null);
          router.refresh();
          return;
        }
        if (data.status === 'failed') {
          setResult({
            ok: false,
            error: data.error || 'Generation failed',
            refunded: Boolean(data.refunded),
          });
          setImagePoll(null);
          router.refresh();
          return;
        }
        if (Date.now() - startedAt > MAX_MS) {
          setResult({
            ok: false,
            error:
              lang === 'pt'
                ? 'A geração demorou demais. Tente novamente.'
                : lang === 'es'
                ? 'La generación tardó demasiado. Inténtalo de nuevo.'
                : 'Generation took too long. Please try again.',
          });
          setImagePoll(null);
          return;
        }
        timer = setTimeout(tick, 2500);
      } catch {
        if (cancelled) return;
        timer = setTimeout(tick, 4000);
      }
    };

    timer = setTimeout(tick, 2000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [imagePoll, result, router, lang]);

  // Religa o acompanhamento de uma geração em andamento depois de um refresh
  // (o estado do poll vive só na memória; aqui reidratamos a partir do servidor).
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || !resume) return;
    resumedRef.current = true;
    if (resume.kind === 'video') {
      setVideoPoll({
        runId: resume.runId,
        remaining: credits,
        status: 'processing',
        progress: 0,
        liveStatus: null,
      });
    } else {
      setImagePoll({ genId: resume.genId, remaining: credits });
    }
  }, [resume, credits]);

  const engine = (MODEL_OPTIONS.find((m) => m.id === model) ?? MODEL_OPTIONS[0]).engine;
  const isGpt = engine === 'gpt';
  const expectedFiles = kind === 'faceswap' ? 2 : 1;
  const cost = kind === 'video' ? 25 : 5;

  // Cota grátis diária (compradores do curso). Só vale no tab `create` p/ os
  // modelos Nano/Replicate. Esgotou -> a geração passa a custar créditos.
  const entitled = !isAnon && freeQuota?.entitled === true;
  const currentBucket = kind === 'create' ? MODEL_BUCKET[model] : KIND_BUCKET[kind];
  const bucketState =
    freeQuota?.entitled && currentBucket ? freeQuota.buckets[currentBucket] : null;
  const freeRemaining = bucketState?.remaining ?? 0;
  const resetAt = freeQuota?.entitled ? freeQuota.resetAt : null;
  const willBeFree = !isAnon && freeRemaining > 0; // esta geração não gasta crédito
  const bucketExhausted = entitled && Boolean(currentBucket) && freeRemaining === 0;
  // Reusing a prior generation as input works for every single-image flow.
  // Face Swap needs two distinct inputs, so it stays upload-only.
  const canPickHistory = !isAnon && kind !== 'faceswap';
  const showUpload = !(canPickHistory && reusedUrl);
  const blockedAnon = isAnon && (freeUsed || kind === 'video');
  const insufficient = !isAnon && !willBeFree && credits < cost;
  const needsPrompt = kind === 'edit' || kind === 'video' || kind === 'create';
  const promptOk = editPrompt.trim().length > 1;
  const canSubmit =
    !pending &&
    !videoPoll &&
    !imagePoll &&
    !insufficient &&
    !blockedAnon &&
    (kind === 'create'
      ? promptOk // reference image optional
      : needsPrompt
      ? promptOk && (reusedUrl || files.length >= 1)
      : reusedUrl || files.length >= expectedFiles);

  function handleFiles(list: FileList | File[]) {
    const arr = Array.from(list).filter((f) => f.type.startsWith('image/'));
    setFiles(arr.slice(0, expectedFiles));
    setReusedUrl(null);
    setResult(null);
  }

  function pickFromHistory(url: string) {
    setReusedUrl(url);
    setFiles([]);
    setResult(null);
    setShowGallery(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set('kind', kind);
    if (kind === 'edit' || kind === 'video' || kind === 'create') {
      fd.set('prompt', editPrompt);
    }
    // A reused image (from history or a prior result) is a valid input for
    // every single-image flow except Face Swap, which needs two inputs.
    if (reusedUrl && kind !== 'faceswap') fd.set('reused_url', reusedUrl);
    if (kind === 'create') {
      fd.set('model', model);
      if (isGpt) {
        fd.set('gpt_size', gptSize);
        fd.set('gpt_quality', gptQuality);
      } else if (engine === 'nano') {
        fd.set('aspect_ratio', aspect);
        fd.set('image_size', quality);
      }
    }
    for (const f of files) fd.append('images', f);
    start(async () => {
      const r = await generateAction(fd);
      if (r.ok && 'isVideo' in r && r.isVideo) {
        setResult(null);
        setVideoPoll({
          runId: r.runId,
          remaining: r.remaining,
          status: 'queued',
          progress: 0,
          liveStatus: null,
        });
        setFiles([]);
        router.refresh();
        return;
      }
      if (r.ok && 'isAsync' in r && r.isAsync) {
        setResult(null);
        setImagePoll({ genId: r.genId, remaining: r.remaining });
        setFiles([]);
        router.refresh();
        return;
      }
      setResult(r);
      if (r.ok && 'outputUrl' in r) {
        setReusedUrl(r.outputUrl);
        setFiles([]);
        if (isAnon && typeof window !== 'undefined') {
          window.localStorage.setItem(ANON_KEY, '1');
          setFreeUsed(true);
        }
        if (!isAnon) router.refresh();
      }
    });
  }

  function resetKind(id: Kind) {
    setKind(id);
    setResult(null);
    setFiles([]);
  }

  const uploadHint =
    kind === 'create'
      ? lang === 'pt'
        ? 'Imagem de referência (opcional)'
        : lang === 'es'
        ? 'Imagen de referencia (opcional)'
        : 'Reference image (optional)'
      : kind === 'faceswap'
      ? t('uploadTwoFace', lang)
      : kind === 'enhance'
      ? t('uploadOneEnhance', lang)
      : t('uploadOne', lang);

  return (
    <section className="card !p-0 overflow-hidden">
      {/* tabs */}
      <div className="border-b border-white/10 px-2 pt-2 flex gap-1 overflow-x-auto">
        {TABS.map((tb) => {
          const active = kind === tb.id;
          const tabBucket = KIND_BUCKET[tb.id];
          const tabFree =
            entitled && tabBucket && freeQuota?.entitled
              ? freeQuota.buckets[tabBucket].remaining
              : null;
          return (
            <button
              key={tb.id}
              type="button"
              onClick={() => resetKind(tb.id)}
              className={`relative px-4 py-3 text-sm font-semibold rounded-t-lg transition-colors whitespace-nowrap ${
                active
                  ? 'bg-ink-700 text-bone border-b-2 border-lime'
                  : 'text-bone-dim hover:text-bone hover:bg-white/5'
              }`}
            >
              <span className="mr-2">{tb.icon}</span>
              {labelFor(tb, lang)}
              {tabFree !== null && (
                <span
                  className={`ml-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full align-middle ${
                    tabFree > 0 ? 'bg-lime/20 text-lime' : 'bg-white/10 text-bone-mute'
                  }`}
                >
                  {tabFree > 0 ? `${tabFree} ${lang === 'en' ? 'free' : 'grátis'}` : '0'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <form onSubmit={handleSubmit} className="p-6 md:p-8 grid lg:grid-cols-[1fr_300px] gap-8">
        {/* input area */}
        <div className="space-y-5">
          {kind === 'create' && (
            <div>
              <label className="field-label">
                {lang === 'pt' ? 'Modelo' : lang === 'es' ? 'Modelo' : 'Model'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {MODEL_OPTIONS.map((m) => {
                  const active = model === m.id;
                  const b = MODEL_BUCKET[m.id];
                  const fr =
                    entitled && b && freeQuota?.entitled ? freeQuota.buckets[b].remaining : null;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModel(m.id)}
                      className={`relative text-left rounded-xl border px-4 py-3 transition-colors ${
                        active
                          ? 'border-lime bg-lime/10'
                          : 'border-white/10 bg-ink-900 hover:border-white/30'
                      }`}
                    >
                      {fr !== null && (
                        <span
                          className={`absolute top-2 right-2 text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                            fr > 0 ? 'bg-lime/20 text-lime' : 'bg-white/10 text-bone-mute'
                          }`}
                        >
                          {fr > 0
                            ? `${fr} ${lang === 'en' ? 'free' : 'grátis'}`
                            : lang === 'pt' ? 'sem grátis' : lang === 'es' ? 'sin gratis' : 'no free'}
                        </span>
                      )}
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <span aria-hidden>{m.icon}</span>
                        {m.label}
                      </div>
                      <div className="text-[11px] text-bone-dim mt-0.5">{m.hint[lang]}</div>
                    </button>
                  );
                })}
              </div>

              {isGpt ? (
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <label className="field-label">
                      {lang === 'pt' ? 'Tamanho' : lang === 'es' ? 'Tamaño' : 'Size'}
                    </label>
                    <select value={gptSize} onChange={(e) => setGptSize(e.target.value)} className="input">
                      {GPT_SIZE_OPTIONS.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.label[lang]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">
                      {lang === 'pt' ? 'Qualidade' : lang === 'es' ? 'Calidad' : 'Quality'}
                    </label>
                    <select value={gptQuality} onChange={(e) => setGptQuality(e.target.value)} className="input">
                      {GPT_QUALITY_OPTIONS.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.label[lang]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : engine === 'nano' ? (
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <label className="field-label">
                      {lang === 'pt' ? 'Proporção' : lang === 'es' ? 'Proporción' : 'Aspect ratio'}
                    </label>
                    <select value={aspect} onChange={(e) => setAspect(e.target.value)} className="input">
                      {ASPECT_OPTIONS.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label[lang]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="field-label">
                      {lang === 'pt' ? 'Qualidade' : lang === 'es' ? 'Calidad' : 'Quality'}
                    </label>
                    <select value={quality} onChange={(e) => setQuality(e.target.value)} className="input">
                      {QUALITY_OPTIONS.map((q) => (
                        <option key={q.id} value={q.id}>
                          {q.label[lang]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : null}
            </div>
          )}

          {showUpload && (
            <div>
              <label className="field-label">{uploadHint}</label>

              <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
                onClick={() => inputRef.current?.click()}
                className={`relative border-2 border-dashed cursor-pointer transition-all rounded-2xl p-10 grid place-items-center min-h-[280px] ${
                  drag ? 'border-lime bg-lime/10' : 'border-lime/50 bg-lime/5 hover:border-lime hover:bg-lime/5'
                }`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  multiple={expectedFiles > 1}
                  className="hidden"
                  onChange={(e) => e.target.files && handleFiles(e.target.files)}
                />
                {files.length === 0 ? (
                  <div className="text-center">
                    <div className="text-4xl mb-2">📤</div>
                    <p className="font-bold text-base mb-1.5">
                      {lang === 'pt' ? 'Arraste sua imagem aqui ou clique' : lang === 'es' ? 'Arrastra tu imagen aquí o haz clic' : 'Drag your image here or click'}
                    </p>
                    <p className="text-xs text-bone-dim">
                      {expectedFiles > 1
                        ? lang === 'pt'
                          ? '2 imagens — rosto + corpo/cena'
                          : lang === 'es'
                          ? '2 imágenes — rostro + cuerpo/escena'
                          : '2 images — face + body/scene'
                        : 'JPG · PNG · WEBP — max 8MB'}
                    </p>
                  </div>
                ) : (
                  <div className={`grid ${files.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-3 w-full`}>
                    {files.map((f, i) => (
                      <div key={i} className="relative aspect-square overflow-hidden bg-ink-900 border border-white/10 rounded-xl">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                        <div className="absolute top-2 left-2 text-[10px] font-bold tracking-widest bg-ink-900/80 backdrop-blur-sm px-2 py-1 rounded">
                          {expectedFiles > 1 ? (i === 0 ? 'FACE' : 'TARGET') : '01'}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {canPickHistory && (
                <button
                  type="button"
                  onClick={() => setShowGallery(true)}
                  className="mt-3 w-full rounded-xl border border-white/10 bg-ink-900 hover:border-lime hover:bg-lime/5 transition-colors px-4 py-3 text-sm font-semibold text-bone flex items-center justify-center gap-2"
                >
                  <span aria-hidden>🗂️</span>
                  {t('pickFromHistory', lang)}
                </button>
              )}
            </div>
          )}

          {!showUpload && reusedUrl && (
            <div>
              <label className="field-label">{uploadHint}</label>
              <div className="relative rounded-2xl border border-lime/40 bg-lime/5 p-4 flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={reusedUrl}
                  alt=""
                  className="w-20 h-20 object-cover rounded-xl border border-white/10 shrink-0"
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-bold text-lime flex items-center gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-lime" />
                    {t('usingFromHistory', lang)}
                  </div>
                  <div className="mt-2 flex gap-4 text-xs">
                    <button
                      type="button"
                      onClick={() => setShowGallery(true)}
                      className="text-lime font-semibold hover:underline"
                    >
                      {t('change', lang)}
                    </button>
                    <button
                      type="button"
                      onClick={() => setReusedUrl(null)}
                      className="text-bone-dim font-semibold hover:underline"
                    >
                      {t('remove', lang)}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {needsPrompt && (
            <div>
              <label className="field-label">
                {kind === 'video'
                  ? lang === 'pt'
                    ? 'Descreva o que deve acontecer no vídeo.'
                    : lang === 'es'
                    ? 'Describe lo que debe pasar en el video.'
                    : 'Describe what should happen in the video.'
                  : kind === 'create'
                  ? lang === 'pt'
                    ? 'Descreva a imagem que você quer criar.'
                    : lang === 'es'
                    ? 'Describe la imagen que quieres crear.'
                    : 'Describe the image you want to create.'
                  : t('editHint', lang)}
              </label>
              <textarea
                value={editPrompt}
                onChange={(e) => setEditPrompt(e.target.value)}
                rows={kind === 'video' ? 4 : 3}
                placeholder={
                  kind === 'video'
                    ? lang === 'pt'
                      ? 'Ex: a mulher caminha lentamente em direção à câmera, balançando os cabelos'
                      : lang === 'es'
                      ? 'Ej: la mujer camina lentamente hacia la cámara, balanceando el pelo'
                      : 'Ex: the woman walks slowly toward the camera, swaying her hair'
                    : kind === 'create'
                    ? lang === 'pt'
                      ? 'Ex: um filhote de golden retriever brincando num parque ensolarado, foto realista'
                      : lang === 'es'
                      ? 'Ej: un cachorro golden retriever jugando en un parque soleado, fotorrealista'
                      : 'Ex: a golden retriever puppy playing in a sunny park, photorealistic'
                    : lang === 'pt'
                    ? 'Ex: troque o fundo por uma praia ao entardecer'
                    : lang === 'es'
                    ? 'Ej: cambia el fondo por una playa al atardecer'
                    : 'Ex: change the background to a beach at sunset'
                }
                className="input resize-none"
              />
            </div>
          )}

          {bucketExhausted && (
            <div className="border border-lime/30 bg-lime/5 rounded-xl p-4 text-sm space-y-2">
              <div className="font-bold text-lime flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-lime animate-pulse" />
                {lang === 'pt'
                  ? 'Cota grátis de hoje usada nesse modelo'
                  : lang === 'es'
                  ? 'Cuota gratis de hoy usada en este modelo'
                  : "Today's free quota used on this model"}
              </div>
              <p className="text-bone-dim">
                {lang === 'pt' ? (
                  <>Recarrega em <Countdown resetAt={resetAt} />. Quer continuar agora? Cada imagem custa <strong className="text-bone">{cost} cr</strong>.</>
                ) : lang === 'es' ? (
                  <>Se recarga en <Countdown resetAt={resetAt} />. ¿Seguir ahora? Cada imagen cuesta <strong className="text-bone">{cost} cr</strong>.</>
                ) : (
                  <>Resets in <Countdown resetAt={resetAt} />. Keep going now? Each image costs <strong className="text-bone">{cost} cr</strong>.</>
                )}
              </p>
              {credits < cost && (
                <Link href="/pricing" className="btn-primary text-xs mt-1">
                  {lang === 'pt' ? 'Comprar créditos' : lang === 'es' ? 'Comprar créditos' : 'Buy credits'} →
                </Link>
              )}
            </div>
          )}

          {insufficient && (
            <div className="border border-red-500/30 bg-red-500/10 rounded-xl p-4 text-sm space-y-2">
              <div className="font-bold text-red-400">⚠ {t('insufficient', lang)}</div>
              <p className="text-bone-dim">
                {lang === 'pt' ? 'Compre um pacote para liberar renders.' : lang === 'es' ? 'Compra un paquete para liberar renders.' : 'Buy a pack to unlock renders.'}
              </p>
              <Link href="/pricing" className="btn-primary text-xs mt-1">{t('buy', lang)}</Link>
            </div>
          )}

          {blockedAnon && (
            <div className="border border-lime/30 bg-lime/10 rounded-xl p-4 text-sm space-y-2">
              <div className="font-bold text-lime">🔒 {lang === 'pt' ? 'Free preview usado' : lang === 'es' ? 'Free preview usado' : 'Free preview used'}</div>
              <p className="text-bone-dim">
                {lang === 'pt' ? 'Você já usou seu render grátis. Cadastre-se para mais.' : lang === 'es' ? 'Ya usaste tu render gratis. Crea tu cuenta para más.' : 'You\'ve used your free render. Sign up for more.'}
              </p>
              <Link href="/signup" className="btn-primary text-xs">{t('signupCta', lang)} →</Link>
            </div>
          )}

          {videoPoll && (
            <div className="border border-lime/30 bg-lime/5 rounded-xl p-4 text-sm space-y-3">
              <div className="flex items-center justify-between">
                <div className="font-bold text-lime flex items-center gap-2">
                  <span className="inline-block w-2 h-2 rounded-full bg-lime animate-pulse" />
                  {videoPoll.status === 'queued'
                    ? lang === 'pt' ? 'Vídeo na fila' : lang === 'es' ? 'Video en cola' : 'Video queued'
                    : lang === 'pt' ? 'Gerando vídeo' : lang === 'es' ? 'Generando video' : 'Generating video'}
                </div>
                <span className="font-mono text-xs text-bone-dim">{Math.round((videoPoll.progress ?? 0) * 100)}%</span>
              </div>
              <div className="h-2 bg-ink-900 rounded-full overflow-hidden">
                <div
                  className="h-full bg-lime transition-all duration-500"
                  style={{ width: `${Math.max(2, Math.round((videoPoll.progress ?? 0) * 100))}%` }}
                />
              </div>
              {videoPoll.liveStatus && (
                <p className="text-[11px] text-bone-mute font-mono truncate">{videoPoll.liveStatus}</p>
              )}
              <p className="text-xs text-bone-dim">
                {lang === 'pt'
                  ? 'Você pode fechar a aba — o vídeo aparece no histórico quando ficar pronto.'
                  : lang === 'es'
                  ? 'Puedes cerrar la pestaña — el video aparece en el historial cuando esté listo.'
                  : 'You can close this tab — the video will appear in your history when ready.'}
              </p>
            </div>
          )}

          {imagePoll && (
            <div className="border border-lime/30 bg-lime/5 rounded-xl p-4 text-sm space-y-3">
              <div className="font-bold text-lime flex items-center gap-2">
                <span className="inline-block w-2 h-2 rounded-full bg-lime animate-pulse" />
                {lang === 'pt' ? 'Gerando imagem' : lang === 'es' ? 'Generando imagen' : 'Generating image'}
              </div>
              <div className="h-2 bg-ink-900 rounded-full overflow-hidden">
                <div className="h-full w-1/3 bg-lime/70 rounded-full animate-pulse" />
              </div>
              <p className="text-xs text-bone-dim">
                {lang === 'pt'
                  ? 'Pode deixar rodando — a imagem aparece aqui e no histórico quando ficar pronta.'
                  : lang === 'es'
                  ? 'Puedes dejarlo corriendo — la imagen aparece aquí y en el historial cuando esté lista.'
                  : 'Leave it running — the image appears here and in your history when ready.'}
              </p>
            </div>
          )}

          {result?.ok === false && (
            <div className="border border-red-500/30 bg-red-500/10 rounded-xl p-4 text-sm text-red-400 space-y-1.5">
              <div>{result.error}</div>
              {result.refunded && (
                <div className="text-lime text-xs font-semibold">
                  ✓{' '}
                  {lang === 'pt'
                    ? 'Créditos devolvidos automaticamente ao seu saldo.'
                    : lang === 'es'
                    ? 'Créditos devueltos automáticamente a tu saldo.'
                    : 'Credits automatically refunded to your balance.'}
                </div>
              )}
            </div>
          )}
        </div>

        {/* summary panel */}
        <aside className="bg-ink-900 border border-white/10 rounded-2xl p-5 flex flex-col">
          <div className="text-xs font-bold tracking-widest text-bone-mute uppercase mb-4">
            {lang === 'pt' ? 'Resumo' : lang === 'es' ? 'Resumen' : 'Summary'}
          </div>

          <div className="space-y-3.5 text-sm">
            <Row label={lang === 'pt' ? 'Motor' : lang === 'es' ? 'Motor' : 'Engine'} value={labelFor(TABS.find((x) => x.id === kind)!, lang)} />
            <Row label={lang === 'pt' ? 'Entradas' : lang === 'es' ? 'Entradas' : 'Inputs'} value={`${reusedUrl && kind !== 'faceswap' ? 1 : files.length}/${expectedFiles}`} />
            {isAnon ? (
              <>
                <Row label={lang === 'pt' ? 'Custo' : lang === 'es' ? 'Costo' : 'Cost'} value="FREE" accent />
                <Row label={lang === 'pt' ? 'Restante' : lang === 'es' ? 'Restante' : 'Remaining'} value={freeUsed ? '0' : '1'} />
                <Row label={lang === 'pt' ? 'Saída' : lang === 'es' ? 'Salida' : 'Output'} value={lang === 'pt' ? 'com marca' : lang === 'es' ? 'con marca' : 'watermarked'} />
              </>
            ) : willBeFree ? (
              <>
                <Row label={lang === 'pt' ? 'Custo' : lang === 'es' ? 'Costo' : 'Cost'} value={lang === 'en' ? 'FREE' : 'GRÁTIS'} accent />
                <Row label={lang === 'pt' ? 'Grátis hoje' : lang === 'es' ? 'Gratis hoy' : 'Free today'} value={`${freeRemaining}/${bucketState?.limit ?? 0}`} />
                <Row label={lang === 'pt' ? 'Saldo' : lang === 'es' ? 'Saldo' : 'Balance'} value={`${credits} cr`} />
              </>
            ) : (
              <>
                <Row label={lang === 'pt' ? 'Custo' : lang === 'es' ? 'Costo' : 'Cost'} value={`${cost} cr`} accent />
                <Row label={lang === 'pt' ? 'Saldo' : lang === 'es' ? 'Saldo' : 'Balance'} value={`${credits} cr`} />
                <Row label={lang === 'pt' ? 'Após render' : lang === 'es' ? 'Después del render' : 'After render'} value={`${Math.max(0, credits - cost)} cr`} />
              </>
            )}
          </div>

          <div className="mt-auto pt-6">
            <button type="submit" disabled={!canSubmit} className="btn-primary w-full">
              {pending || videoPoll || imagePoll ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-ink-900/30 border-t-ink-900 rounded-full animate-spin" />
                  {videoPoll
                    ? videoPoll.status === 'queued'
                      ? lang === 'pt' ? 'Na fila…' : lang === 'es' ? 'En cola…' : 'Queued…'
                      : `${Math.round((videoPoll.progress ?? 0) * 100)}%`
                    : imagePoll
                    ? lang === 'pt' ? 'Gerando…' : lang === 'es' ? 'Generando…' : 'Generating…'
                    : null}
                </span>
              ) : isAnon || willBeFree ? (
                <>{lang === 'pt' ? 'Gerar grátis' : lang === 'es' ? 'Generar gratis' : 'Render free'} →</>
              ) : (
                <>{t('generate', lang)} → {cost} CR</>
              )}
            </button>
            {videoPoll && videoPoll.liveStatus && (
              <p className="text-[11px] text-bone-mute mt-2 text-center font-mono truncate">
                {videoPoll.liveStatus}
              </p>
            )}
            <p className="text-xs text-bone-mute mt-2.5 text-center">
              {kind === 'video'
                ? lang === 'pt' ? '~ 2 a 3 min' : lang === 'es' ? '~ 2 a 3 min' : '~ 2 to 3 min'
                : lang === 'pt' ? '~ 30 a 60s' : lang === 'es' ? '~ 30 a 60s' : '~ 30 to 60s'}
            </p>
          </div>
        </aside>

        {/* result */}
        {result?.ok && 'outputUrl' in result && result.watermarked && (
          <div className="lg:col-span-2 border-t border-lime/40 pt-8 mt-2">
            <div className="flex items-center justify-between mb-4">
              <div className="text-xs font-bold tracking-widest text-lime uppercase">
                {lang === 'pt' ? 'Free preview entregue' : lang === 'es' ? 'Free preview entregado' : 'Free preview delivered'}
              </div>
              <span className="pill">FREE</span>
            </div>
            <WatermarkedResult src={result.outputUrl} lang={lang} onOpen={() => setOpen(result.outputUrl)} />
          </div>
        )}

        {result?.ok && 'outputUrl' in result && !result.watermarked && (() => {
          const isVid = /\.(mp4|webm|mov)(\?|$)/i.test(result.outputUrl);
          return (
            <div className="lg:col-span-2 border-t border-white/10 pt-8 mt-2">
              <div className="flex items-center justify-between mb-4">
                <div className="text-xs font-bold tracking-widest text-bone-mute uppercase">
                  {isVid
                    ? lang === 'pt' ? 'Vídeo entregue' : lang === 'es' ? 'Video entregado' : 'Video delivered'
                    : lang === 'pt' ? 'Render entregue' : lang === 'es' ? 'Render entregado' : 'Render delivered'}
                </div>
                <span className="text-xs text-bone-dim">↓ {result.remaining} CR remaining</span>
              </div>
              {isVid ? (
                <video
                  src={result.outputUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  className="max-h-[700px] w-auto mx-auto rounded-2xl border border-white/10"
                />
              ) : (
                <button type="button" onClick={() => setOpen(result.outputUrl)} className="block w-full">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.outputUrl} alt="" className="max-h-[700px] w-auto mx-auto rounded-2xl border border-white/10" />
                </button>
              )}
              <div className="mt-4 flex flex-col items-center gap-3">
                <div className="text-center text-[11px] text-lime/90 font-semibold uppercase tracking-widest">
                  {lang === 'pt'
                    ? '✓ Salvo no seu histórico'
                    : lang === 'es'
                    ? '✓ Guardado en tu historial'
                    : '✓ Saved to your history'}
                </div>
                <div className="flex justify-center gap-3">
                  <a href={result.outputUrl} download className="btn-primary text-xs">↓ {t('download', lang)}</a>
                  {!isVid && (
                    <button type="button" onClick={() => { setKind('edit'); setReusedUrl(result.outputUrl); setResult(null); }} className="btn-ghost text-xs">
                      ↻ {t('reuse', lang)}
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })()}
      </form>

      <Lightbox src={open} onClose={() => setOpen(null)} />
      {showGallery && (
        <GalleryPicker lang={lang} onPick={pickFromHistory} onClose={() => setShowGallery(false)} />
      )}
    </section>
  );
}

/** Contagem regressiva HH:MM:SS até `resetAt` (reset da cota grátis de 24h). */
function Countdown({ resetAt }: { resetAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  if (!resetAt) return <span className="font-mono text-bone">24h</span>;
  const ms = Math.max(0, new Date(resetAt).getTime() - now);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return <span className="font-mono text-bone">{`${pad(h)}:${pad(m)}:${pad(s)}`}</span>;
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-bone-mute text-xs uppercase tracking-wide">{label}</span>
      <span className={`font-mono text-sm font-semibold ${accent ? 'text-lime' : 'text-bone'}`}>{value}</span>
    </div>
  );
}
