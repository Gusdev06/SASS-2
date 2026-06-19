'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import { getAdminUser } from '@/lib/admin';
import { FLAT_SECTION } from '@/lib/promptsApi';

export type PromptFormState = { error?: string; info?: string };

function parse(formData: FormData) {
  return {
    id: String(formData.get('id') ?? '').trim(),
    type: String(formData.get('type') ?? '').trim() || 'text_to_image,image_to_image',
    prompt: String(formData.get('prompt') ?? '').trim(),
    image_url: String(formData.get('image_url') ?? '').trim() || null,
    thumbnail_url: String(formData.get('thumbnail_url') ?? '').trim() || null,
    ai_model: String(formData.get('ai_model') ?? '').trim() || null,
    sort_order: Number(formData.get('sort_order') ?? 0) || 0,
    active: String(formData.get('active') ?? '') === 'on' || String(formData.get('active') ?? '') === 'true',
  };
}

function revalidatePrompts() {
  revalidatePath('/admin/prompts');
  revalidatePath('/dashboard/prompts');
}

/**
 * Create or update a prompt. The thumbnail falls back to the main image when
 * left blank. Returns to /admin/prompts on success.
 */
export async function savePromptAction(_prev: PromptFormState, formData: FormData): Promise<PromptFormState> {
  if (!(await getAdminUser())) return { error: 'Não autorizado.' };

  const v = parse(formData);
  if (!v.prompt) return { error: 'O prompt não pode ficar vazio.' };

  const service = createServiceClient();
  const row = {
    section_id: FLAT_SECTION.id,
    section_slug: FLAT_SECTION.slug,
    section_title: FLAT_SECTION.title,
    section_icon: null,
    category_id: FLAT_SECTION.categoryId,
    category_title: FLAT_SECTION.categoryTitle,
    title: '',
    type: v.type,
    prompt: v.prompt,
    image_url: v.image_url,
    thumbnail_url: v.thumbnail_url ?? v.image_url,
    ai_model: v.ai_model,
    sort_order: v.sort_order,
    active: v.active,
    updated_at: new Date().toISOString(),
  };

  if (v.id) {
    const { error } = await service.from('prompts').update(row).eq('id', v.id);
    if (error) return { error: error.message };
  } else {
    const { error } = await service.from('prompts').insert(row);
    if (error) return { error: error.message };
  }

  revalidatePrompts();
  redirect('/admin/prompts');
}

export async function deletePromptAction(_prev: PromptFormState, formData: FormData): Promise<PromptFormState> {
  if (!(await getAdminUser())) return { error: 'Não autorizado.' };
  const id = String(formData.get('id') ?? '').trim();
  if (!id) return { error: 'Prompt inválido.' };

  const service = createServiceClient();
  const { error } = await service.from('prompts').delete().eq('id', id);
  if (error) return { error: error.message };

  revalidatePrompts();
  return { info: 'Prompt excluído.' };
}

export async function togglePromptActiveAction(_prev: PromptFormState, formData: FormData): Promise<PromptFormState> {
  if (!(await getAdminUser())) return { error: 'Não autorizado.' };
  const id = String(formData.get('id') ?? '').trim();
  const active = String(formData.get('active') ?? '') === 'true';
  if (!id) return { error: 'Prompt inválido.' };

  const service = createServiceClient();
  const { error } = await service
    .from('prompts')
    .update({ active, updated_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { error: error.message };

  revalidatePrompts();
  return { info: active ? 'Prompt ativado.' : 'Prompt ocultado.' };
}
