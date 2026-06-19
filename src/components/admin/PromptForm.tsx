'use client';

import { useActionState } from 'react';
import { savePromptAction, type PromptFormState } from '@/lib/actions/admin-prompts';

export type PromptFormValues = {
  id?: string;
  section_slug?: string;
  section_title?: string;
  section_icon?: string | null;
  category_title?: string;
  title?: string;
  type?: string;
  prompt?: string;
  image_url?: string | null;
  thumbnail_url?: string | null;
  ai_model?: string | null;
  sort_order?: number;
  active?: boolean;
};

function Field({
  label,
  name,
  defaultValue,
  placeholder,
  required,
  type = 'text',
}: {
  label: string;
  name: string;
  defaultValue?: string | number | null;
  placeholder?: string;
  required?: boolean;
  type?: string;
}) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold tracking-widest text-bone-mute uppercase">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={defaultValue ?? ''}
        placeholder={placeholder}
        required={required}
        className="input mt-1.5"
      />
    </label>
  );
}

export default function PromptForm({ values = {} }: { values?: PromptFormValues }) {
  const [state, action, pending] = useActionState<PromptFormState, FormData>(savePromptAction, {});
  const isEdit = Boolean(values.id);

  return (
    <form action={action} className="space-y-5 max-w-2xl">
      {values.id && <input type="hidden" name="id" value={values.id} />}

      <label className="block">
        <span className="text-[11px] font-bold tracking-widest text-bone-mute uppercase">Prompt</span>
        <textarea
          name="prompt"
          defaultValue={values.prompt ?? ''}
          required
          rows={10}
          className="input mt-1.5 font-mono text-xs leading-relaxed"
          placeholder="A young woman with…"
        />
      </label>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="URL da imagem" name="image_url" defaultValue={values.image_url} placeholder="https://…/img.webp" />
        <Field label="URL da thumbnail" name="thumbnail_url" defaultValue={values.thumbnail_url} placeholder="usa a imagem se vazio" />
        <Field label="Tags" name="type" defaultValue={values.type ?? 'text_to_image,image_to_image'} placeholder="text_to_image,image_to_image" />
        <Field label="Modelo de IA" name="ai_model" defaultValue={values.ai_model ?? 'gpt-image-2'} placeholder="gpt-image-2" />
        <Field label="Ordem" name="sort_order" type="number" defaultValue={values.sort_order ?? 0} />
        <label className="flex items-center gap-2 mt-6">
          <input type="checkbox" name="active" defaultChecked={values.active ?? true} className="w-4 h-4 accent-lime" />
          <span className="text-sm text-bone-dim">Ativo (visível para usuários)</span>
        </label>
      </div>

      {state.error && <p className="text-sm text-ember">{state.error}</p>}

      <div className="flex items-center gap-3 pt-2">
        <button type="submit" disabled={pending} className="btn-primary text-sm disabled:opacity-50">
          {pending ? 'Salvando…' : isEdit ? 'Salvar alterações' : 'Criar prompt'}
        </button>
        <a href="/admin/prompts" className="btn-ghost text-sm">Cancelar</a>
      </div>
    </form>
  );
}
