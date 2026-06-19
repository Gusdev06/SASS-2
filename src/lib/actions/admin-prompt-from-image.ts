'use server';

import sharp from 'sharp';
import { revalidatePath } from 'next/cache';
import { createServiceClient } from '@/lib/supabase/server';
import { getAdminUser } from '@/lib/admin';
import { imageToPrompt, ImageToPromptError } from '@/lib/image-to-prompt';
import { uploadBufferToSupabase } from '@/lib/storage';
import { FLAT_SECTION } from '@/lib/promptsApi';

export type PromptFromImageState = {
  error?: string;
  info?: string;
  promptId?: string;
  prompt?: string;
  imageUrl?: string;
};

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB raw upload cap

// The public library is a single flat list: image → extracted prompt, tagged
// text-to-image + img-to-img, model gpt-image-2. No section/category/title.
const DEFAULT_AI_MODEL = 'gpt-image-2';
const DEFAULT_TYPE = 'text_to_image,image_to_image'; // tags: text-to-image + img-to-img

/**
 * One-shot admin tool: receive an uploaded image, reverse-engineer its prompt
 * (OpenAI Vision), persist the original image to storage, and insert it as a
 * public prompt in the library — defaulting to model `gpt-image-2` and the tags
 * text-to-image + img-to-img. Section/category/title are taken from the form so
 * the prompt lands in the right place in the tree.
 */
export async function savePromptFromImageAction(
  _prev: PromptFromImageState,
  formData: FormData
): Promise<PromptFromImageState> {
  if (!(await getAdminUser())) return { error: 'Não autorizado.' };

  const file = formData.get('image');
  if (!(file instanceof File) || file.size === 0) return { error: 'Selecione uma imagem.' };
  if (!file.type.startsWith('image/')) return { error: 'O arquivo precisa ser uma imagem.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'Imagem muito grande (máx. 20MB).' };

  const activeRaw = String(formData.get('active') ?? '');
  const active = activeRaw === 'on' || activeRaw === 'true' || activeRaw === '';

  try {
    // Downscale + re-encode once; the same JPEG is sent to Vision and stored.
    const input = Buffer.from(await file.arrayBuffer());
    const resized = await sharp(input)
      .rotate()
      .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    const dataUri = `data:image/jpeg;base64,${resized.toString('base64')}`;
    const raw = await imageToPrompt(dataUri);

    // Pretty-print valid JSON; keep raw text otherwise.
    let promptText = raw;
    try {
      promptText = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      /* keep raw text */
    }

    const imageUrl = await uploadBufferToSupabase(
      new Uint8Array(resized),
      `prompts/${FLAT_SECTION.slug}`,
      'image/jpeg'
    );

    const service = createServiceClient();
    const row = {
      section_id: FLAT_SECTION.id,
      section_slug: FLAT_SECTION.slug,
      section_title: FLAT_SECTION.title,
      section_icon: null,
      category_id: FLAT_SECTION.categoryId,
      category_title: FLAT_SECTION.categoryTitle,
      title: '',
      type: DEFAULT_TYPE,
      prompt: promptText,
      image_url: imageUrl,
      thumbnail_url: imageUrl,
      ai_model: DEFAULT_AI_MODEL,
      sort_order: 0,
      active,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await service.from('prompts').insert(row).select('id').single();
    if (error) return { error: error.message };

    revalidatePath('/admin/prompts');
    revalidatePath('/dashboard/prompts');

    return {
      info: 'Prompt salvo na biblioteca.',
      promptId: data?.id,
      prompt: promptText,
      imageUrl,
    };
  } catch (err) {
    if (err instanceof ImageToPromptError) {
      const msg: Record<ImageToPromptError['code'], string> = {
        auth_missing: 'OPENAI_API_KEY não configurada no servidor.',
        timeout: 'A análise demorou demais. Tente novamente.',
        rate_limited: 'Limite da OpenAI atingido. Tente em instantes.',
        content_rejected: 'A imagem foi rejeitada pela moderação do provedor.',
        upstream: 'A OpenAI está indisponível agora. Tente novamente.',
        unexpected: 'Resposta inesperada do modelo.',
        unknown: 'Falha ao analisar a imagem.',
      };
      return { error: msg[err.code] ?? 'Falha ao analisar a imagem.' };
    }
    return { error: err instanceof Error ? err.message : 'Falha ao salvar o prompt.' };
  }
}
