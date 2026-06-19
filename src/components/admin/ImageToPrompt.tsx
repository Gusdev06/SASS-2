'use client';

import { useActionState, useEffect, useRef, useState } from 'react';
import { analyzeImageAction, type ImagePromptState } from '@/lib/actions/admin-image-prompt';

export default function ImageToPrompt() {
  const [state, action, pending] = useActionState<ImagePromptState, FormData>(analyzeImageAction, {});
  const [preview, setPreview] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    return () => {
      if (preview) URL.revokeObjectURL(preview);
    };
  }, [preview]);

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (preview) URL.revokeObjectURL(preview);
    setPreview(file ? URL.createObjectURL(file) : null);
  }

  async function copy() {
    if (!state.json) return;
    await navigator.clipboard.writeText(state.json);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <form action={action} className="space-y-4">
        <label className="block">
          <span className="text-[11px] font-bold tracking-widest text-bone-mute uppercase">Imagem</span>
          <input
            ref={fileInputRef}
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
          <img src={preview} alt="" className="rounded-xl max-h-96 w-auto border border-white/10" />
        )}

        <button type="submit" disabled={pending} className="btn-primary text-sm disabled:opacity-50">
          {pending ? 'Analisando…' : 'Extrair prompt'}
        </button>

        {state.error && <p className="text-sm text-ember">{state.error}</p>}
        <p className="text-xs text-bone-mute">
          A imagem é reduzida e enviada para a OpenAI Vision. Nada é salvo no banco.
        </p>
      </form>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-bold tracking-widest text-bone-mute uppercase">
            Prompt extraído {state.model ? `· ${state.model}` : ''}
          </span>
          {state.json && (
            <button onClick={copy} className="btn-ghost !py-1.5 !px-3 text-xs">
              {copied ? 'Copiado ✓' : 'Copiar JSON'}
            </button>
          )}
        </div>

        {state.json ? (
          <pre className="card !p-4 text-[11px] leading-relaxed font-mono whitespace-pre-wrap break-words max-h-[70vh] overflow-auto">
            {state.json}
          </pre>
        ) : (
          <div className="card text-sm text-bone-dim h-40 flex items-center justify-center text-center">
            {pending ? 'Analisando a imagem…' : 'O JSON do prompt aparecerá aqui.'}
          </div>
        )}
      </div>
    </div>
  );
}
