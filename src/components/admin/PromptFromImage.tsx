'use client';

import { useActionState, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  savePromptFromImageAction,
  type PromptFromImageState,
} from '@/lib/actions/admin-prompt-from-image';

export default function PromptFromImage() {
  const [state, action, pending] = useActionState<PromptFromImageState, FormData>(
    savePromptFromImageAction,
    {}
  );
  const [preview, setPreview] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  // Clear the preview after a successful save so the next image starts clean.
  useEffect(() => {
    if (state.info) {
      setPreview((p) => {
        if (p) URL.revokeObjectURL(p);
        return null;
      });
    }
  }, [state.info]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <form action={action} className="space-y-4">
        <label className="block">
          <span className="text-[11px] font-bold tracking-widest text-bone-mute uppercase">Imagem</span>
          <input
            name="image"
            type="file"
            accept="image/*"
            required
            onChange={onPick}
            className="mt-1.5 block w-full text-sm text-bone-dim file:mr-4 file:py-2.5 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-lime file:text-ink-900 hover:file:brightness-110 file:cursor-pointer"
          />
        </label>

        {preview && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview} alt="" className="rounded-xl max-h-72 w-auto border border-white/10" />
        )}

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

        <button type="submit" disabled={pending} className="btn-primary text-sm disabled:opacity-50">
          {pending ? 'Extraindo e salvando…' : 'Extrair prompt e salvar'}
        </button>

        {state.error && <p className="text-sm text-ember">{state.error}</p>}
        <p className="text-xs text-bone-mute">
          A imagem é reduzida, enviada à OpenAI Vision para extrair o prompt e salva na biblioteca pública
          junto com a imagem.
        </p>
      </form>

      <div className="space-y-3">
        <span className="text-[11px] font-bold tracking-widest text-bone-mute uppercase">Resultado</span>

        {state.info ? (
          <div className="space-y-3">
            <div className="card !p-3 border-lime/30">
              <p className="text-sm text-lime font-semibold">{state.info}</p>
              <div className="flex items-center gap-3 mt-2">
                <Link href="/admin/prompts" className="btn-ghost !py-1.5 !px-3 text-xs">
                  Ver na biblioteca
                </Link>
                {state.promptId && (
                  <Link
                    href={`/admin/prompts/${state.promptId}`}
                    className="btn-ghost !py-1.5 !px-3 text-xs"
                  >
                    Editar prompt
                  </Link>
                )}
              </div>
            </div>
            {state.imageUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={state.imageUrl}
                alt=""
                className="rounded-xl max-h-72 w-auto border border-white/10"
              />
            )}
            {state.prompt && (
              <pre className="card !p-4 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words max-h-[50vh] overflow-auto">
                {state.prompt}
              </pre>
            )}
          </div>
        ) : (
          <div className="card text-sm text-bone-dim h-40 flex items-center justify-center text-center">
            {pending ? 'Extraindo e salvando…' : 'O prompt salvo aparecerá aqui.'}
          </div>
        )}
      </div>
    </div>
  );
}
