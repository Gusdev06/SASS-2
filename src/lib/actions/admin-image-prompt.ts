'use server';

import sharp from 'sharp';
import { getAdminUser } from '@/lib/admin';
import { imageToPrompt, ImageToPromptError } from '@/lib/image-to-prompt';

export type ImagePromptState = {
  error?: string;
  json?: string;
  model?: string;
};

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024; // 20MB raw upload cap

/**
 * Receive an uploaded image, downscale it (keeps token cost + latency sane),
 * and return the structured prompt JSON reverse-engineered from it.
 */
export async function analyzeImageAction(_prev: ImagePromptState, formData: FormData): Promise<ImagePromptState> {
  if (!(await getAdminUser())) return { error: 'Não autorizado.' };

  const file = formData.get('image');
  if (!(file instanceof File) || file.size === 0) return { error: 'Selecione uma imagem.' };
  if (!file.type.startsWith('image/')) return { error: 'O arquivo precisa ser uma imagem.' };
  if (file.size > MAX_UPLOAD_BYTES) return { error: 'Imagem muito grande (máx. 20MB).' };

  try {
    const input = Buffer.from(await file.arrayBuffer());
    // Resize to max 1536px on the long edge and re-encode as JPEG to cut payload.
    const resized = await sharp(input)
      .rotate()
      .resize({ width: 1536, height: 1536, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const dataUri = `data:image/jpeg;base64,${resized.toString('base64')}`;

    const raw = await imageToPrompt(dataUri);

    // Pretty-print when the model returns valid JSON; otherwise return as-is.
    let pretty = raw;
    try {
      pretty = JSON.stringify(JSON.parse(raw), null, 2);
    } catch {
      /* keep raw */
    }

    return { json: pretty, model: process.env.OPENAI_VISION_MODEL || 'gpt-4o' };
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
    return { error: err instanceof Error ? err.message : 'Falha ao analisar a imagem.' };
  }
}
