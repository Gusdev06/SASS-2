'use client';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { generateAction, type GenResult } from '@/lib/actions/generate';
import { createClient as createBrowserSupabase } from '@/lib/supabase/client';
import Lightbox from './Lightbox';
import WatermarkedResult from './WatermarkedResult';
import GalleryPicker from './GalleryPicker';
import { t, type Lang } from '@/lib/i18n';
import { readRenderUrl } from '@/lib/dnd';
import {
  imageCost,
  VIDEO_DURATIONS,
  DEFAULT_VIDEO_DURATION,
  videoCost,
  spicyVideoCost,
} from '@/lib/prompts';

const ANON_KEY = 'goz_free_used';

/**
 * Sobe a imagem de entrada DIRETO no Supabase Storage (via signed URL) e devolve
 * a URL pública. Não passa pela serverless function, então não esbarra no limite
 * de ~4.5MB do corpo da requisição — e sobe os bytes ORIGINAIS, sem recompressão
 * (qualidade intacta). O server action recebe apenas o link.
 */
async function uploadInputImage(file: File): Promise<string> {
  const res = await fetch('/api/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contentType: file.type || 'image/jpeg' }),
  });
  if (!res.ok) throw new Error('Falha ao preparar o upload da imagem.');
  const { bucket, path, token, publicUrl } = await res.json();
  const supabase = createBrowserSupabase();
  const { error } = await supabase.storage
    .from(bucket)
    .uploadToSignedUrl(path, token, file, { contentType: file.type || 'image/jpeg' });
  if (error) throw new Error(`Falha no upload da imagem: ${error.message}`);
  return publicUrl as string;
}

type Kind = 'enhance' | 'undress' | 'faceswap' | 'edit' | 'video' | 'video_kling' | 'create';

const TABS: { id: Kind; en: string; pt: string; es: string; icon: string }[] = [
  { id: 'create', en: 'Create', pt: 'Criar', es: 'Crear', icon: '🍌' },
  { id: 'undress', en: 'Undress', pt: 'Undress', es: 'Undress', icon: '🔥' },
  { id: 'faceswap', en: 'Face Swap', pt: 'Face Swap', es: 'Face Swap', icon: '🎭' },
  { id: 'edit', en: 'Edit', pt: 'Editar', es: 'Editar', icon: '✏️' },
  { id: 'video_kling', en: 'Video', pt: 'Vídeo', es: 'Video', icon: '🎬' },
  { id: 'video', en: 'Video NSFW', pt: 'Vídeo NSFW', es: 'Video NSFW', icon: '🔞' },
];

// SFW image models. Only shown on the `create` tab.
// `engine` selects which backend the server action routes to.
const GPT_IMAGE_MODEL = 'gpt-image-2';
const NSFW_MODEL = 'nsfw';
// Máx. de imagens de referência por engine na aba `create`, alinhado ao limite
// de cada API: GPT Image aceita 16 (endpoint /edits); Nano Banana Pro/2 aceitam
// 14; Seedream (NSFW) seguramos em 10. A aba `edit` (Seedream) usa EDIT_MAX_IMAGES.
const ENGINE_MAX_IMAGES: Record<'nano' | 'gpt' | 'replicate', number> = {
  gpt: 16,
  nano: 14,
  replicate: 10,
};
const EDIT_MAX_IMAGES = 10;
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

// NSFW (Seedream/Replicate) — aspect ratios aceitos pelo modelo. Inclui
// `match_input_image` (útil quando há foto de referência anexada).
const NSFW_ASPECT_OPTIONS: { id: string; label: { en: string; pt: string; es: string } }[] = [
  { id: 'match_input_image', label: { en: 'Match image', pt: 'Igual à imagem', es: 'Igual a la imagen' } },
  { id: '1:1', label: { en: 'Square 1:1', pt: 'Quadrado 1:1', es: 'Cuadrado 1:1' } },
  { id: '4:5', label: { en: 'Portrait 4:5', pt: 'Retrato 4:5', es: 'Retrato 4:5' } },
  { id: '3:4', label: { en: 'Portrait 3:4', pt: 'Retrato 3:4', es: 'Retrato 3:4' } },
  { id: '2:3', label: { en: 'Portrait 2:3', pt: 'Retrato 2:3', es: 'Retrato 2:3' } },
  { id: '9:16', label: { en: 'Story 9:16', pt: 'Story 9:16', es: 'Story 9:16' } },
  { id: '4:3', label: { en: 'Landscape 4:3', pt: 'Paisagem 4:3', es: 'Paisaje 4:3' } },
  { id: '3:2', label: { en: 'Landscape 3:2', pt: 'Paisagem 3:2', es: 'Paisaje 3:2' } },
  { id: '16:9', label: { en: 'Wide 16:9', pt: 'Wide 16:9', es: 'Wide 16:9' } },
  { id: '21:9', label: { en: 'Cinema 21:9', pt: 'Cinema 21:9', es: 'Cine 21:9' } },
];

// NSFW (Seedream V5.0 Pro Edit / WaveSpeed) aceita os tiers 1K e 2K.
const NSFW_SIZE_OPTIONS: { id: string; label: { en: string; pt: string; es: string } }[] = [
  { id: '1K', label: { en: '1K · fast', pt: '1K · rápido', es: '1K · rápido' } },
  { id: '2K', label: { en: '2K · max', pt: '2K · máx', es: '2K · máx' } },
];

const labelFor = (tab: typeof TABS[number], lang: Lang) =>
  lang === 'pt' ? tab.pt : lang === 'es' ? tab.es : tab.en;

// Slot de upload de uma única imagem. Usado para separar o Face Swap em dois
// campos distintos (rosto da influencer + cena alvo), deixando claro o que vai
// em cada um em vez de um único dropzone que aceita 2 fotos na ordem certa.
function UploadSlot({
  label,
  hint,
  badge,
  file,
  onFile,
  lang,
}: {
  label: string;
  hint: string;
  badge: string;
  file: File | null;
  onFile: (f: File | null) => void;
  lang: Lang;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const pick = (list: FileList | null) => {
    const f = list && Array.from(list).find((x) => x.type.startsWith('image/'));
    if (f) onFile(f);
  };
  return (
    <div>
      <label className="field-label">{label}</label>
      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files); }}
        onClick={() => ref.current?.click()}
        className={`relative border-2 border-dashed cursor-pointer transition-all rounded-2xl p-6 grid place-items-center min-h-[220px] ${
          drag ? 'border-lime bg-lime/10' : 'border-lime/50 bg-lime/5 hover:border-lime hover:bg-lime/5'
        }`}
      >
        <input
          ref={ref}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => pick(e.target.files)}
        />
        {file ? (
          <div className="relative w-full aspect-square overflow-hidden bg-ink-900 border border-white/10 rounded-xl">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={URL.createObjectURL(file)} alt="" className="w-full h-full object-cover" />
            <div className="absolute top-2 left-2 text-[10px] font-bold tracking-widest bg-ink-900/80 backdrop-blur-sm px-2 py-1 rounded">
              {badge}
            </div>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onFile(null); }}
              className="absolute top-2 right-2 w-6 h-6 grid place-items-center rounded-full bg-ink-900/80 backdrop-blur-sm text-bone hover:text-white text-xs font-bold"
            >
              ✕
            </button>
          </div>
        ) : (
          <div className="text-center">
            <div className="text-4xl mb-2">📤</div>
            <p className="font-bold text-base mb-1.5">
              {lang === 'pt' ? 'Arraste ou clique' : lang === 'es' ? 'Arrastra o haz clic' : 'Drag or click'}
            </p>
            <p className="text-xs text-bone-dim">{hint}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Uma geração em background (imagem do `create` ou vídeo). Cada job faz seu
// próprio polling, então o usuário pode disparar vários ao mesmo tempo.
type Job =
  | { id: string; type: 'video'; runId: string; remaining: number }
  | { id: string; type: 'image'; genId: string; remaining: number };

function GenJob({
  job,
  lang,
  onDone,
  onOpenImage,
}: {
  job: Job;
  lang: Lang;
  onDone: (id: string) => void;
  onOpenImage: (url: string) => void;
}) {
  const router = useRouter();
  const [status, setStatus] = useState<string>(job.type === 'video' ? 'queued' : 'processing');
  const [progress, setProgress] = useState(0);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refunded, setRefunded] = useState(false);
  const [doneUrl, setDoneUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const startedAt = Date.now();
    const isVideo = job.type === 'video';
    const MAX_MS = isVideo ? 8 * 60 * 1000 : 4 * 60 * 1000;
    const url = isVideo ? `/api/video-status/${job.runId}` : `/api/image-status/${job.genId}`;

    const tick = async () => {
      try {
        const res = await fetch(url, { cache: 'no-store' });
        const data = await res.json();
        if (cancelled) return;

        if (data.status === 'success' && data.outputUrl) {
          setDoneUrl(data.outputUrl);
          router.refresh();
          return;
        }
        if (data.status === 'failed' || data.status === 'cancelled' || data.status === 'timeout') {
          setError(data.error || `Run ${data.status}`);
          setRefunded(Boolean(data.refunded));
          router.refresh();
          return;
        }
        if (Date.now() - startedAt > MAX_MS) {
          setError(
            lang === 'pt'
              ? 'A geração demorou demais. Tente novamente.'
              : lang === 'es'
              ? 'La generación tardó demasiado. Inténtalo de nuevo.'
              : 'Generation took too long. Please try again.'
          );
          return;
        }
        if (isVideo) {
          setStatus(data.status ?? 'processing');
          if (typeof data.progress === 'number') setProgress(data.progress);
          setLiveStatus(data.liveStatus ?? null);
        }
        timer = setTimeout(tick, isVideo ? 4000 : 2500);
      } catch {
        if (cancelled) return;
        timer = setTimeout(tick, isVideo ? 6000 : 4000);
      }
    };
    timer = setTimeout(tick, 2000);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [job.id]);

  // Entregue: media + download, com ✕ para dispensar o card.
  if (doneUrl) {
    const isVid = job.type === 'video' || /\.(mp4|webm|mov)(\?|$)/i.test(doneUrl);
    return (
      <div className="border border-lime/40 bg-lime/5 rounded-xl p-3 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-[11px] font-bold tracking-widest text-lime uppercase">
            {isVid
              ? lang === 'pt' ? 'Vídeo pronto' : lang === 'es' ? 'Video listo' : 'Video ready'
              : lang === 'pt' ? 'Imagem pronta' : lang === 'es' ? 'Imagen lista' : 'Image ready'}
          </div>
          <button
            type="button"
            onClick={() => onDone(job.id)}
            aria-label="dismiss"
            className="text-bone-mute hover:text-bone text-sm font-bold"
          >
            ✕
          </button>
        </div>
        {isVid ? (
          <video src={doneUrl} controls loop playsInline className="max-h-72 w-auto mx-auto rounded-lg border border-white/10" />
        ) : (
          <button type="button" onClick={() => onOpenImage(doneUrl)} className="block w-full">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={doneUrl} alt="" className="max-h-72 w-auto mx-auto rounded-lg border border-white/10" />
          </button>
        )}
        <div className="flex justify-center">
          <a href={doneUrl} download className="btn-primary text-xs">↓ {t('download', lang)}</a>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="border border-red-500/30 bg-red-500/10 rounded-xl p-4 text-sm text-red-400 space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => onDone(job.id)}
            aria-label="dismiss"
            className="text-bone-mute hover:text-bone text-sm font-bold shrink-0"
          >
            ✕
          </button>
        </div>
        {refunded && (
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
    );
  }

  if (job.type === 'video') {
    return (
      <div className="border border-lime/30 bg-lime/5 rounded-xl p-4 text-sm space-y-3">
        <div className="flex items-center justify-between">
          <div className="font-bold text-lime flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-lime animate-pulse" />
            {status === 'queued'
              ? lang === 'pt' ? 'Vídeo na fila' : lang === 'es' ? 'Video en cola' : 'Video queued'
              : lang === 'pt' ? 'Gerando vídeo' : lang === 'es' ? 'Generando video' : 'Generating video'}
          </div>
          <span className="font-mono text-xs text-bone-dim">{Math.round(progress * 100)}%</span>
        </div>
        <div className="h-2 bg-ink-900 rounded-full overflow-hidden">
          <div className="h-full bg-lime transition-all duration-500" style={{ width: `${Math.max(2, Math.round(progress * 100))}%` }} />
        </div>
        {liveStatus && <p className="text-[11px] text-bone-mute font-mono truncate">{liveStatus}</p>}
        <p className="text-xs text-bone-dim">
          {lang === 'pt'
            ? 'Pode gerar outros — o vídeo aparece aqui e no histórico quando ficar pronto.'
            : lang === 'es'
            ? 'Puedes generar otros — el video aparece aquí y en el historial cuando esté listo.'
            : 'You can start more — the video appears here and in your history when ready.'}
        </p>
      </div>
    );
  }

  return (
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
          ? 'Pode gerar outras — a imagem aparece aqui e no histórico quando ficar pronta.'
          : lang === 'es'
          ? 'Puedes generar otras — la imagen aparece aquí y en el historial cuando esté lista.'
          : 'You can start more — the image appears here and in your history when ready.'}
      </p>
    </div>
  );
}

export default function GenPanel({
  lang,
  credits,
  isAnon = false,
  resume,
}: {
  lang: Lang;
  credits: number;
  isAnon?: boolean;
  resume?: { kind: 'video'; runId: string } | { kind: 'image'; genId: string } | null;
}) {
  const [kind, setKind] = useState<Kind>('create');
  const [model, setModel] = useState<string>(MODEL_OPTIONS[0].id);
  const [aspect, setAspect] = useState<string>('9:16');
  const [quality, setQuality] = useState<string>('2K');
  const [gptSize, setGptSize] = useState<string>('864x1536');
  const [gptQuality, setGptQuality] = useState<string>('high');
  const [nsfwAspect, setNsfwAspect] = useState<string>('9:16');
  const [nsfwSize, setNsfwSize] = useState<string>('2K');
  // Duração do vídeo em segundos (vira nº de frames + custo no backend).
  const [duration, setDuration] = useState<number>(DEFAULT_VIDEO_DURATION);
  // Modo do tab NSFW (`video`): `wan` (padrão) ou `ltx-spicy` (LTX 2.3 Spicy).
  const [videoModel, setVideoModel] = useState<'wan' | 'ltx-spicy'>('wan');
  // Opções exclusivas do LTX 2.3 Spicy: duração livre (3–20s), resolução e preset.
  const [ltxDuration, setLtxDuration] = useState<number>(5);
  const [ltxResolution, setLtxResolution] = useState<'480p' | '720p' | '1080p'>('480p');
  const [ltxPreset, setLtxPreset] = useState<'tuned' | 'original'>('tuned');
  const [editPrompt, setEditPrompt] = useState('');
  // Imagens reaproveitadas do histórico/galeria (URLs). Fluxos de 1 imagem usam
  // só a primeira; `create`/`edit` aceitam várias e combinam com os uploads.
  const [reusedUrls, setReusedUrls] = useState<string[]>([]);
  const [result, setResult] = useState<GenResult | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  // Face Swap usa dois slots distintos: rosto da influencer + cena alvo.
  const [faceFile, setFaceFile] = useState<File | null>(null);
  const [targetFile, setTargetFile] = useState<File | null>(null);
  // Toggle NSFW do Face Swap (a engine usada por trás fica oculta do usuário).
  const [faceswapNsfw, setFaceswapNsfw] = useState(false);
  const [drag, setDrag] = useState(false);
  const [showGallery, setShowGallery] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [freeUsed, setFreeUsed] = useState(false);
  // Jobs em background (imagens do `create` e vídeos). Vários podem rodar juntos.
  const [jobs, setJobs] = useState<Job[]>([]);
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const removeJob = useCallback(
    (id: string) => setJobs((prev) => prev.filter((j) => j.id !== id)),
    []
  );
  // Adiciona um job só se ainda não estiver na lista. Evita card duplicado
  // quando o `router.refresh()` do submit faz o servidor reenviar `resume`
  // para uma geração que já estamos acompanhando.
  const addJob = useCallback(
    (job: Job) =>
      setJobs((prev) => (prev.some((j) => j.id === job.id) ? prev : [job, ...prev])),
    []
  );

  useEffect(() => {
    if (isAnon && typeof window !== 'undefined') {
      setFreeUsed(window.localStorage.getItem(ANON_KEY) === '1');
    }
  }, [isAnon]);

  // Religa o acompanhamento de uma geração em andamento depois de um refresh
  // (o estado do job vive só na memória; aqui reidratamos a partir do servidor).
  const resumedRef = useRef(false);
  useEffect(() => {
    if (resumedRef.current || !resume) return;
    resumedRef.current = true;
    if (resume.kind === 'video') {
      addJob({ id: resume.runId, type: 'video', runId: resume.runId, remaining: credits });
    } else {
      addJob({ id: resume.genId, type: 'image', genId: resume.genId, remaining: credits });
    }
  }, [resume, credits, addJob]);

  const engine = (MODEL_OPTIONS.find((m) => m.id === model) ?? MODEL_OPTIONS[0]).engine;
  const isGpt = engine === 'gpt';
  const expectedFiles = kind === 'faceswap' ? 2 : 1;
  // `create` aceita várias imagens de referência (todas opcionais) até o limite
  // da engine escolhida; `edit` aceita várias (combina referências); os demais
  // fluxos têm contagem fixa (faceswap = 2, resto = 1).
  const maxFiles =
    kind === 'create'
      ? ENGINE_MAX_IMAGES[engine]
      : kind === 'edit'
      ? EDIT_MAX_IMAGES
      : expectedFiles;
  // Fluxos multi-imagem combinam uploads + imagens da galeria; os de 1 imagem
  // são exclusivos (escolher na galeria substitui o upload e vice-versa).
  const isMulti = maxFiles > 1;
  const totalInputs = reusedUrls.length + files.length;
  // Os dois tabs de vídeo (Kling = `video_kling` e NSFW/ComfyDeploy = `video`)
  // compartilham a mesma UI: prompt + 1 imagem + duração.
  const isVideoKind = kind === 'video' || kind === 'video_kling';
  // LTX Spicy tem sua própria duração (5–20s) e preço por resolução; WAN/Kling
  // usam os presets 2s/5s com videoCost.
  const isLtxSpicy = kind === 'video' && videoModel === 'ltx-spicy';
  const cost = isVideoKind
    ? isLtxSpicy
      ? spicyVideoCost(ltxDuration, ltxResolution)
      : videoCost(duration)
    : imageCost(kind, model);

  // Reusing a prior generation as input works for every single-image flow.
  // Face Swap needs two distinct inputs, so it stays upload-only.
  const canPickHistory = !isAnon && kind !== 'faceswap';
  // Multi-imagem mostra upload + galeria juntos; 1-imagem esconde o upload quando
  // já há uma escolha da galeria (são mutuamente exclusivos).
  const showUpload = isMulti || !(canPickHistory && reusedUrls.length > 0);
  // Quantos slots ainda cabem ao abrir a galeria (respeita o teto da engine).
  const remainingSlots = Math.max(1, maxFiles - files.length - (isMulti ? reusedUrls.length : 0));
  const blockedAnon = isAnon && (freeUsed || isVideoKind);
  const insufficient = !isAnon && credits < cost;
  const needsPrompt = kind === 'edit' || isVideoKind || kind === 'create';
  const promptOk = editPrompt.trim().length > 1;
  const canSubmit =
    !pending &&
    !insufficient &&
    !blockedAnon &&
    (kind === 'create'
      ? promptOk // reference image optional
      : kind === 'faceswap'
      ? Boolean(faceFile && targetFile)
      : needsPrompt
      ? promptOk && totalInputs >= 1
      : totalInputs >= expectedFiles);

  function handleFiles(list: FileList | File[]) {
    const arr = Array.from(list).filter((f) => f.type.startsWith('image/'));
    if (maxFiles === 1) {
      // 1-imagem: o upload substitui o anterior e zera a escolha da galeria.
      setFiles(arr.slice(0, 1));
      setReusedUrls([]);
    } else {
      // Multi-imagem: acumula uploads respeitando o teto (descontando a galeria).
      setFiles((prev) => [...prev, ...arr].slice(0, Math.max(0, maxFiles - reusedUrls.length)));
    }
    setResult(null);
  }

  function removeFile(index: number) {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }

  // Drop no dropzone: arquivos do sistema viram upload; uma imagem arrastada
  // dos "Renders recentes" entra como imagem de referência (via URL).
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDrag(false);
    if (e.dataTransfer.files?.length) {
      handleFiles(e.dataTransfer.files);
      return;
    }
    if (!canPickHistory) return;
    const url = readRenderUrl(e.dataTransfer);
    if (url) pickFromHistory([url]);
  }

  function pickFromHistory(urls: string[]) {
    setResult(null);
    setShowGallery(false);
    if (maxFiles === 1) {
      // 1-imagem: a galeria substitui o upload (são exclusivos).
      setReusedUrls(urls.slice(0, 1));
      setFiles([]);
      return;
    }
    // Multi-imagem: acumula sem duplicar, respeitando o teto (descontando uploads).
    setReusedUrls((prev) => {
      const merged = [...prev];
      for (const u of urls) if (!merged.includes(u)) merged.push(u);
      return merged.slice(0, Math.max(0, maxFiles - files.length));
    });
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set('kind', kind);
    if (kind === 'edit' || isVideoKind || kind === 'create') {
      fd.set('prompt', editPrompt);
    }
    if (isVideoKind) fd.set('duration', String(isLtxSpicy ? ltxDuration : duration));
    // Modo do tab NSFW (`video`): escolhe entre WAN (ComfyDeploy) e LTX Spicy (WaveSpeed).
    if (kind === 'video') {
      fd.set('video_model', videoModel);
      if (isLtxSpicy) {
        fd.set('resolution', ltxResolution);
        fd.set('preset', ltxPreset);
      }
    }
    // Reused images (from history/gallery or a prior result) são entradas válidas
    // em todo fluxo menos o Face Swap (que usa dois slots dedicados).
    if (kind !== 'faceswap') for (const u of reusedUrls) fd.append('reused_url', u);
    if (kind === 'create') {
      fd.set('model', model);
      if (isGpt) {
        fd.set('gpt_size', gptSize);
        fd.set('gpt_quality', gptQuality);
      } else if (engine === 'nano') {
        fd.set('aspect_ratio', aspect);
        fd.set('image_size', quality);
      } else if (engine === 'replicate') {
        fd.set('aspect_ratio', nsfwAspect);
        fd.set('image_size', nsfwSize);
      }
    }
    if (kind === 'faceswap' && faceswapNsfw) fd.set('nsfw', '1');
    start(async () => {
      try {
        // TODA imagem de input sobe DIRETO no storage (signed URL) e o server
        // action recebe só o link — evita o limite de ~4.5MB do corpo da request
        // (FUNCTION_PAYLOAD_TOO_LARGE) e preserva os bytes originais sem recompressão.
        if (kind === 'faceswap') {
          // Ordem importa no backend: [0] = rosto, [1] = cena alvo.
          const slots = [faceFile, targetFile].filter((f): f is File => f instanceof File);
          const urls = await Promise.all(slots.map(uploadInputImage));
          for (const u of urls) fd.append('reused_url', u);
        } else if (isVideoKind) {
          // Vídeo usa 1 imagem; se não veio da galeria, sobe a enviada.
          if (reusedUrls.length === 0 && files[0]) {
            fd.append('reused_url', await uploadInputImage(files[0]));
          }
        } else if (files.length) {
          // create / edit / undress / enhance: sobe cada upload mantendo a ordem.
          const urls = await Promise.all(files.map(uploadInputImage));
          for (const u of urls) fd.append('reused_url', u);
        }
      } catch (err) {
        setResult({ ok: false, error: err instanceof Error ? err.message : 'Falha no upload da imagem.' });
        return;
      }
      const r = await generateAction(fd);
      if (r.ok && 'isVideo' in r && r.isVideo) {
        addJob({ id: r.runId, type: 'video', runId: r.runId, remaining: r.remaining });
        setFiles([]);
        router.refresh();
        return;
      }
      if (r.ok && 'isAsync' in r && r.isAsync) {
        addJob({ id: r.genId, type: 'image', genId: r.genId, remaining: r.remaining });
        setFiles([]);
        setFaceFile(null);
        setTargetFile(null);
        router.refresh();
        return;
      }
      setResult(r);
      if (r.ok && 'outputUrl' in r) {
        setReusedUrls([r.outputUrl]);
        setFiles([]);
        setFaceFile(null);
        setTargetFile(null);
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
    setReusedUrls([]);
    setFaceFile(null);
    setTargetFile(null);
  }

  const uploadHint =
    kind === 'create'
      ? lang === 'pt'
        ? 'Imagens de referência (opcional)'
        : lang === 'es'
        ? 'Imágenes de referencia (opcional)'
        : 'Reference images (optional)'
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
              ) : engine === 'replicate' ? (
                <div className="grid grid-cols-2 gap-3 mt-4">
                  <div>
                    <label className="field-label">
                      {lang === 'pt' ? 'Proporção' : lang === 'es' ? 'Proporción' : 'Aspect ratio'}
                    </label>
                    <select value={nsfwAspect} onChange={(e) => setNsfwAspect(e.target.value)} className="input">
                      {NSFW_ASPECT_OPTIONS.map((a) => (
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
                    <select value={nsfwSize} onChange={(e) => setNsfwSize(e.target.value)} className="input">
                      {NSFW_SIZE_OPTIONS.map((q) => (
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

          {showUpload && kind === 'faceswap' && (
            <div className="space-y-4">
            <button
              type="button"
              onClick={() => setFaceswapNsfw((v) => !v)}
              role="switch"
              aria-checked={faceswapNsfw}
              className={`w-full flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 transition-colors ${
                faceswapNsfw
                  ? 'border-rose-500/60 bg-rose-500/10'
                  : 'border-white/10 bg-ink-900 hover:border-white/20'
              }`}
            >
              <span className="flex items-center gap-2 text-sm font-bold">
                <span aria-hidden>🔞</span>
                NSFW
                <span className="font-medium text-bone-dim text-xs">
                  {lang === 'pt'
                    ? 'conteúdo sem censura'
                    : lang === 'es'
                    ? 'contenido sin censura'
                    : 'uncensored content'}
                </span>
              </span>
              <span
                className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                  faceswapNsfw ? 'bg-rose-500' : 'bg-white/15'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
                    faceswapNsfw ? 'translate-x-5' : 'translate-x-0.5'
                  }`}
                />
              </span>
            </button>
            <div className="grid sm:grid-cols-2 gap-4">
              <UploadSlot
                lang={lang}
                file={faceFile}
                onFile={(f) => { setFaceFile(f); setResult(null); }}
                badge="FACE"
                label={lang === 'pt' ? '1 · Foto da influencer (rosto)' : lang === 'es' ? '1 · Foto de la influencer (rostro)' : '1 · Influencer photo (face)'}
                hint={lang === 'pt' ? 'O rosto que será usado' : lang === 'es' ? 'El rostro que se usará' : 'The face to use'}
              />
              <UploadSlot
                lang={lang}
                file={targetFile}
                onFile={(f) => { setTargetFile(f); setResult(null); }}
                badge="CENA"
                label={lang === 'pt' ? '2 · Imagem da cena (alvo)' : lang === 'es' ? '2 · Imagen de la escena (objetivo)' : '2 · Scene image (target)'}
                hint={lang === 'pt' ? 'A cena onde o rosto entra' : lang === 'es' ? 'La escena donde entra el rostro' : 'The scene to place the face in'}
              />
            </div>
            </div>
          )}

          {showUpload && kind !== 'faceswap' && (
            <div>
              <label className="field-label">{uploadHint}</label>

              <div
                onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
                onDragLeave={() => setDrag(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                className={`relative border-2 border-dashed cursor-pointer transition-all rounded-2xl p-10 grid place-items-center min-h-[280px] ${
                  drag ? 'border-lime bg-lime/10' : 'border-lime/50 bg-lime/5 hover:border-lime hover:bg-lime/5'
                }`}
              >
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/*"
                  multiple={maxFiles > 1}
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
                        : maxFiles > 1
                        ? lang === 'pt'
                          ? `Até ${maxFiles} imagens de referência (opcional) · JPG · PNG · WEBP`
                          : lang === 'es'
                          ? `Hasta ${maxFiles} imágenes de referencia (opcional) · JPG · PNG · WEBP`
                          : `Up to ${maxFiles} reference images (optional) · JPG · PNG · WEBP`
                        : 'JPG · PNG · WEBP — max 8MB'}
                    </p>
                    {canPickHistory && (
                      <p className="text-[11px] text-lime/70 mt-1.5">
                        {lang === 'pt'
                          ? '🖼️ ou arraste um dos Renders recentes'
                          : lang === 'es'
                          ? '🖼️ o arrastra uno de los Renders recientes'
                          : '🖼️ or drag one from Recent renders'}
                      </p>
                    )}
                  </div>
                ) : (
                  <div className={`grid ${files.length > 2 ? 'grid-cols-3' : files.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-3 w-full`}>
                    {files.map((f, i) => (
                      <div key={i} className="relative aspect-square overflow-hidden bg-ink-900 border border-white/10 rounded-xl">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={URL.createObjectURL(f)} alt="" className="w-full h-full object-cover" />
                        <div className="absolute top-2 left-2 text-[10px] font-bold tracking-widest bg-ink-900/80 backdrop-blur-sm px-2 py-1 rounded">
                          {expectedFiles > 1
                            ? i === 0
                              ? 'FACE'
                              : 'TARGET'
                            : String(i + 1).padStart(2, '0')}
                        </div>
                        {maxFiles > 1 && (
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                            className="absolute top-2 right-2 w-6 h-6 grid place-items-center rounded-full bg-ink-900/80 backdrop-blur-sm text-bone hover:text-white text-xs font-bold"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                    {maxFiles > 1 && files.length < maxFiles && (
                      <div className="grid place-items-center aspect-square rounded-xl border-2 border-dashed border-lime/40 text-lime/70 hover:border-lime hover:text-lime transition-colors">
                        <div className="text-center">
                          <div className="text-3xl leading-none">＋</div>
                          <div className="mt-1 text-[10px] font-bold tracking-widest">
                            {files.length}/{maxFiles}
                          </div>
                        </div>
                      </div>
                    )}
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

          {/* 1-imagem: card único da escolha da galeria (upload fica escondido). */}
          {!isMulti && !showUpload && reusedUrls[0] && (
            <div>
              <label className="field-label">{uploadHint}</label>
              <div className="relative rounded-2xl border border-lime/40 bg-lime/5 p-4 flex items-center gap-4">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={reusedUrls[0]}
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
                      onClick={() => setReusedUrls([])}
                      className="text-bone-dim font-semibold hover:underline"
                    >
                      {t('remove', lang)}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Multi-imagem: grade das imagens reaproveitadas da galeria, removíveis. */}
          {isMulti && reusedUrls.length > 0 && (
            <div>
              <label className="field-label">
                {lang === 'pt'
                  ? `Da galeria (${reusedUrls.length})`
                  : lang === 'es'
                  ? `De la galería (${reusedUrls.length})`
                  : `From gallery (${reusedUrls.length})`}
              </label>
              <div className={`grid ${reusedUrls.length > 2 ? 'grid-cols-3' : reusedUrls.length > 1 ? 'grid-cols-2' : 'grid-cols-1'} gap-3`}>
                {reusedUrls.map((u) => (
                  <div key={u} className="relative aspect-square overflow-hidden bg-ink-900 border border-lime/40 rounded-xl">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={u} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => setReusedUrls((prev) => prev.filter((x) => x !== u))}
                      className="absolute top-2 right-2 w-6 h-6 grid place-items-center rounded-full bg-ink-900/80 backdrop-blur-sm text-bone hover:text-white text-xs font-bold"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {needsPrompt && (
            <div>
              <label className="field-label">
                {isVideoKind
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
                rows={isVideoKind ? 4 : 3}
                placeholder={
                  isVideoKind
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

          {kind === 'video' && (
            <div>
              <label className="field-label">
                {lang === 'pt' ? 'Modelo' : lang === 'es' ? 'Modelo' : 'Model'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {([
                  {
                    id: 'wan' as const,
                    icon: '🔞',
                    label: 'WAN',
                    hint: { en: 'Default', pt: 'Padrão', es: 'Predeterminado' },
                  },
                  {
                    id: 'ltx-spicy' as const,
                    icon: '🌶️',
                    label: 'LTX Spicy',
                    hint: { en: 'LTX 2.3 · spicier', pt: 'LTX 2.3 · mais quente', es: 'LTX 2.3 · más picante' },
                  },
                ]).map((m) => {
                  const active = videoModel === m.id;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setVideoModel(m.id)}
                      className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                        active ? 'border-lime bg-lime/10' : 'border-white/10 bg-ink-900 hover:border-white/30'
                      }`}
                    >
                      <div className="flex items-center gap-2 font-bold text-sm">
                        <span aria-hidden>{m.icon}</span>
                        {m.label}
                      </div>
                      <div className="text-[11px] text-bone-dim mt-0.5">{m.hint[lang]}</div>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* LTX 2.3 Spicy: duração livre (3–20s), resolução e preset. */}
          {isLtxSpicy && (
            <div className="space-y-4">
              <div>
                <label className="field-label">
                  {lang === 'pt' ? 'Duração' : lang === 'es' ? 'Duración' : 'Duration'}
                </label>
                <select
                  value={ltxDuration}
                  onChange={(e) => setLtxDuration(Number(e.target.value))}
                  className="input"
                >
                  {Array.from({ length: 16 }, (_, i) => i + 5).map((s) => (
                    <option key={s} value={s}>
                      {s}s — {spicyVideoCost(s, ltxResolution)} cr
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="field-label">
                    {lang === 'pt' ? 'Resolução' : lang === 'es' ? 'Resolución' : 'Resolution'}
                  </label>
                  <select
                    value={ltxResolution}
                    onChange={(e) => setLtxResolution(e.target.value as '480p' | '720p' | '1080p')}
                    className="input"
                  >
                    <option value="480p">480p</option>
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </div>
                <div>
                  <label className="field-label">Preset</label>
                  <select
                    value={ltxPreset}
                    onChange={(e) => setLtxPreset(e.target.value as 'tuned' | 'original')}
                    className="input"
                  >
                    <option value="tuned">
                      {lang === 'pt' ? 'Tuned · recomendado' : lang === 'es' ? 'Tuned · recomendado' : 'Tuned · recommended'}
                    </option>
                    <option value="original">
                      {lang === 'pt' ? 'Original · leve' : lang === 'es' ? 'Original · ligero' : 'Original · light'}
                    </option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {isVideoKind && !isLtxSpicy && (
            <div>
              <label className="field-label">
                {lang === 'pt' ? 'Duração' : lang === 'es' ? 'Duración' : 'Duration'}
              </label>
              <div className="grid grid-cols-2 gap-2">
                {VIDEO_DURATIONS.map((s) => {
                  const active = duration === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setDuration(s)}
                      className={`rounded-xl border px-4 py-3 text-center transition-colors ${
                        active ? 'border-lime bg-lime/10' : 'border-white/10 bg-ink-900 hover:border-white/30'
                      }`}
                    >
                      <div className="font-bold text-sm">{s}s</div>
                      <div className="text-[11px] text-bone-dim mt-0.5">{videoCost(s)} cr</div>
                    </button>
                  );
                })}
              </div>
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

          {jobs.length > 0 && (
            <div className="space-y-3">
              {jobs.map((j) => (
                <GenJob key={j.id} job={j} lang={lang} onDone={removeJob} onOpenImage={setOpen} />
              ))}
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
            <Row label={lang === 'pt' ? 'Entradas' : lang === 'es' ? 'Entradas' : 'Inputs'} value={`${kind === 'faceswap' ? [faceFile, targetFile].filter(Boolean).length : totalInputs}/${maxFiles}`} />
            {isAnon ? (
              <>
                <Row label={lang === 'pt' ? 'Custo' : lang === 'es' ? 'Costo' : 'Cost'} value="FREE" accent />
                <Row label={lang === 'pt' ? 'Restante' : lang === 'es' ? 'Restante' : 'Remaining'} value={freeUsed ? '0' : '1'} />
                <Row label={lang === 'pt' ? 'Saída' : lang === 'es' ? 'Salida' : 'Output'} value={lang === 'pt' ? 'com marca' : lang === 'es' ? 'con marca' : 'watermarked'} />
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
              {pending ? (
                <span className="inline-flex items-center gap-2">
                  <span className="inline-block w-4 h-4 border-2 border-ink-900/30 border-t-ink-900 rounded-full animate-spin" />
                  {lang === 'pt' ? 'Enviando…' : lang === 'es' ? 'Enviando…' : 'Sending…'}
                </span>
              ) : isAnon ? (
                <>{lang === 'pt' ? 'Gerar grátis' : lang === 'es' ? 'Generar gratis' : 'Render free'} →</>
              ) : (
                <>{t('generate', lang)} → {cost} CR</>
              )}
            </button>
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
                    <button type="button" onClick={() => { setKind('edit'); setReusedUrls([result.outputUrl]); setFiles([]); setResult(null); }} className="btn-ghost text-xs">
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
        <GalleryPicker
          lang={lang}
          onPick={pickFromHistory}
          onClose={() => setShowGallery(false)}
          multiple={isMulti}
          maxSelect={remainingSlots}
        />
      )}
    </section>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-bone-mute text-xs uppercase tracking-wide">{label}</span>
      <span className={`font-mono text-sm font-semibold ${accent ? 'text-lime' : 'text-bone'}`}>{value}</span>
    </div>
  );
}
