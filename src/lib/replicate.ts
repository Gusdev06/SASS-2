import Replicate from 'replicate';

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

const GENERATION_TIMEOUT_MS = 120_000;

/** Seedream 4.5 accepted values (from the Replicate model schema). */
export const SEEDREAM_SIZES = ['2K', '4K'] as const;
export const SEEDREAM_ASPECT_RATIOS = [
  'match_input_image',
  '1:1',
  '4:3',
  '3:4',
  '4:5',
  '5:4',
  '16:9',
  '9:16',
  '3:2',
  '2:3',
  '21:9',
  '9:21',
] as const;

export type SeedreamOptions = {
  size?: string;
  aspectRatio?: string;
};

export async function generateImage(
  prompt: string,
  imageInput?: string[],
  opts: SeedreamOptions = {}
): Promise<string> {
  const hasImages = !!imageInput && imageInput.length > 0;
  const size = opts.size && (SEEDREAM_SIZES as readonly string[]).includes(opts.size) ? opts.size : '2K';
  // `match_input_image` only makes sense with a reference; without one fall back
  // to a square (or the explicit ratio the caller chose).
  let aspect = opts.aspectRatio && (SEEDREAM_ASPECT_RATIOS as readonly string[]).includes(opts.aspectRatio)
    ? opts.aspectRatio
    : hasImages ? 'match_input_image' : '1:1';
  if (aspect === 'match_input_image' && !hasImages) aspect = '1:1';
  const input: Record<string, unknown> = {
    prompt,
    size,
    max_images: 1,
    aspect_ratio: aspect,
    disable_safety_checker: true,
    sequential_image_generation: 'disabled',
  };
  if (hasImages) input.image_input = imageInput;

  const output = await Promise.race([
    replicate.run('bytedance/seedream-4.5', { input }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('generation timeout')), GENERATION_TIMEOUT_MS)
    ),
  ]);

  const first = Array.isArray(output) ? output[0] : output;
  if (typeof first === 'string') return first;
  if (first && typeof (first as { url?: unknown }).url === 'function') {
    const u = (first as { url: () => URL | string }).url();
    return u instanceof URL ? u.href : String(u);
  }
  throw new Error(`Resposta inesperada da Replicate: ${JSON.stringify(output)}`);
}
