'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { savePromptFromImageAction } from '@/lib/actions/admin-prompt-from-image';

// Downscale + re-encode in the browser before upload. Heavy phone photos
// (often 25MB+) otherwise blow past the server action bodySizeLimit and fail
// before our own validation runs. The server resizes again — this just keeps
// the payload small. Falls back to the original file if anything goes wrong.
async function downscaleImage(file: File, maxDim = 1536, quality = 0.85): Promise<Blob> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  try {
    const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(bitmap, 0, 0, w, h);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error('toBlob failed'))),
        'image/jpeg',
        quality
      )
    );
  } finally {
    bitmap.close();
  }
}

type JobStatus = 'queued' | 'processing' | 'done' | 'error';

type Job = {
  id: string;
  name: string;
  previewUrl: string;
  status: JobStatus;
  message?: string;
  prompt?: string;
  imageUrl?: string;
  promptId?: string;
};

// Cap concurrent Vision calls so a big batch doesn't trip OpenAI rate limits;
// extras wait their turn but the input never blocks.
const MAX_CONCURRENT = 3;

export default function PromptFromImage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const jobsRef = useRef(jobs);
  jobsRef.current = jobs;

  const activeRef = useRef(0);
  const queueRef = useRef<Array<() => void>>([]);

  // Revoke every object URL we created when the component unmounts.
  useEffect(() => {
    return () => {
      for (const j of jobsRef.current) URL.revokeObjectURL(j.previewUrl);
    };
  }, []);

  const patch = (id: string, next: Partial<Job>) =>
    setJobs((prev) => prev.map((j) => (j.id === id ? { ...j, ...next } : j)));

  function schedule(task: () => Promise<void>) {
    const tryRun = () => {
      if (activeRef.current >= MAX_CONCURRENT) {
        queueRef.current.push(tryRun);
        return;
      }
      activeRef.current += 1;
      task().finally(() => {
        activeRef.current -= 1;
        const next = queueRef.current.shift();
        if (next) next();
      });
    };
    tryRun();
  }

  function enqueue(file: File) {
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${file.name}-${file.size}-${jobsRef.current.length}`;
    const previewUrl = URL.createObjectURL(file);
    setJobs((prev) => [{ id, name: file.name, previewUrl, status: 'queued' }, ...prev]);

    schedule(async () => {
      patch(id, { status: 'processing' });
      let blob: Blob;
      try {
        blob = await downscaleImage(file);
      } catch {
        // Couldn't decode/resize in the browser — let the server try the original.
        blob = file;
      }
      try {
        const fd = new FormData();
        fd.set('image', blob, 'upload.jpg');
        fd.set('active', 'on');
        const res = await savePromptFromImageAction({}, fd);
        if (res.error) {
          patch(id, { status: 'error', message: res.error });
        } else {
          patch(id, {
            status: 'done',
            message: res.info,
            prompt: res.prompt,
            imageUrl: res.imageUrl,
            promptId: res.promptId,
          });
        }
      } catch {
        patch(id, { status: 'error', message: 'Falha ao processar a imagem.' });
      }
    });
  }

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    for (const f of files) {
      if (!f.type.startsWith('image/')) continue;
      enqueue(f);
    }
    // Reset so picking the same file again re-triggers onChange.
    e.target.value = '';
  }

  function clearDone() {
    setJobs((prev) => {
      const removed = prev.filter((j) => j.status === 'done' || j.status === 'error');
      for (const j of removed) URL.revokeObjectURL(j.previewUrl);
      return prev.filter((j) => j.status !== 'done' && j.status !== 'error');
    });
  }

  const pendingCount = jobs.filter((j) => j.status === 'queued' || j.status === 'processing').length;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <div className="space-y-4">
        <label className="block">
          <span className="text-[11px] font-bold tracking-widest text-bone-mute uppercase">Imagens</span>
          <input
            name="image"
            type="file"
            accept="image/*"
            multiple
            onChange={onPick}
            className="mt-1.5 block w-full text-sm text-bone-dim file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-lime file:text-ink-900 hover:file:brightness-110 file:cursor-pointer"
          />
        </label>

        <div className="card !p-3 flex flex-wrap items-center gap-2 text-[11px]">
          <span className="text-bone-mute uppercase tracking-widest font-bold">Padrões</span>
          <span className="bg-lime/15 text-lime px-2 py-1 rounded-md border border-lime/30 font-bold tracking-widest">
            gpt-image-2
          </span>
          <span className="bg-ink-900/80 text-bone px-2 py-1 rounded-md border border-white/10 font-bold tracking-widest">
            TEXT → IMG
          </span>
          <span className="bg-ink-900/80 text-bone px-2 py-1 rounded-md border border-white/10 font-bold tracking-widest">
            IMG → IMG
          </span>
        </div>

        <p className="text-xs text-bone-mute">
          Cada imagem é reduzida no navegador, enviada à OpenAI Vision para extrair o prompt e salva na
          biblioteca pública. Pode escolher várias de uma vez — não precisa esperar uma terminar para
          mandar a próxima.
        </p>
        {pendingCount > 0 && (
          <p className="text-xs text-lime font-semibold">
            {pendingCount} {pendingCount === 1 ? 'imagem em processamento…' : 'imagens em processamento…'}
          </p>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-widest text-bone-mute uppercase">Fila</span>
          {jobs.some((j) => j.status === 'done' || j.status === 'error') && (
            <button onClick={clearDone} className="btn-ghost !py-1 !px-2 text-[11px]">
              Limpar concluídos
            </button>
          )}
        </div>

        {jobs.length === 0 ? (
          <div className="card text-sm text-bone-dim h-40 flex items-center justify-center text-center">
            Os prompts salvos aparecerão aqui.
          </div>
        ) : (
          <div className="space-y-3 max-h-[70vh] overflow-auto pr-1">
            {jobs.map((job) => (
              <JobCard key={job.id} job={job} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: JobStatus }) {
  const map: Record<JobStatus, { label: string; cls: string }> = {
    queued: { label: 'NA FILA', cls: 'bg-ink-900/80 text-bone-dim border-white/10' },
    processing: { label: 'PROCESSANDO', cls: 'bg-lime/15 text-lime border-lime/30' },
    done: { label: 'SALVO', cls: 'bg-lime/15 text-lime border-lime/30' },
    error: { label: 'ERRO', cls: 'bg-ember/15 text-ember border-ember/30' },
  };
  const { label, cls } = map[status];
  return (
    <span className={`px-2 py-0.5 rounded-md border text-[10px] font-bold tracking-widest ${cls}`}>
      {label}
    </span>
  );
}

function JobCard({ job }: { job: Job }) {
  const busy = job.status === 'queued' || job.status === 'processing';
  return (
    <div className="card !p-3 space-y-2">
      <div className="flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={job.imageUrl ?? job.previewUrl}
          alt=""
          className={`h-12 w-12 rounded-lg object-cover border border-white/10 ${busy ? 'opacity-60' : ''}`}
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs text-bone-dim truncate">{job.name}</p>
          <div className="mt-1">
            <StatusBadge status={job.status} />
          </div>
        </div>
      </div>

      {job.status === 'error' && job.message && <p className="text-xs text-ember">{job.message}</p>}

      {job.status === 'done' && (
        <>
          <div className="flex items-center gap-3">
            <Link href="/admin/prompts" className="btn-ghost !py-1 !px-2 text-[11px]">
              Ver na biblioteca
            </Link>
            {job.promptId && (
              <Link href={`/admin/prompts/${job.promptId}`} className="btn-ghost !py-1 !px-2 text-[11px]">
                Editar prompt
              </Link>
            )}
          </div>
          {job.prompt && (
            <pre className="card !p-3 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words max-h-60 overflow-auto">
              {job.prompt}
            </pre>
          )}
        </>
      )}
    </div>
  );
}
