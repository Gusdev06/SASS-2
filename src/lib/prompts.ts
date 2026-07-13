export const CREDITS_PER_IMAGE = 10;

/**
 * Preço por modelo na aba `create`. Modelos não listados (NSFW/Seedream) e os
 * demais fluxos (undress, faceswap, edit, enhance) usam CREDITS_PER_IMAGE (10).
 */
export const CREATE_MODEL_CREDITS: Record<string, number> = {
  'gemini-3-pro-image-preview': 3, // Nano Banana Pro
  'gemini-3.1-flash-image-preview': 2, // Nano Banana 2
  'gpt-image-2': 3, // GPT Image
};

/** Créditos de uma geração de imagem conforme o fluxo/modelo escolhido. */
export function imageCost(kind: string, model?: string | null): number {
  if (kind === 'create' && model && model in CREATE_MODEL_CREDITS) {
    return CREATE_MODEL_CREDITS[model];
  }
  return CREDITS_PER_IMAGE;
}
// Custo-base do vídeo (2s). Durações maiores escalam linearmente — ver videoCost().
export const CREDITS_PER_VIDEO = 25;

// Vídeo: a duração escolhida (em segundos) vira o `length` (nº de frames) do nó
// WanImageToVideo. O deployment usa segundos × 16 + 1 (o WAN exige contagens
// 4n+1), então 2s = 33 frames, 5s = 81. (Confirmado pelo body do
// deployment: { duration: 33 } == vídeo de 2s.)
export const VIDEO_FRAME_RATE = 16;
export const VIDEO_DURATIONS = [2, 5] as const;
export type VideoDuration = (typeof VIDEO_DURATIONS)[number];
export const DEFAULT_VIDEO_DURATION: VideoDuration = 2;

/** Nº de frames (`length` do WanImageToVideo) para uma duração em segundos. */
export const videoFrames = (seconds: number) => Math.round(seconds * VIDEO_FRAME_RATE) + 1;

/** Créditos de um vídeo — escalam linearmente com a duração (2s = base). */
export const videoCost = (seconds: number) => Math.round((CREDITS_PER_VIDEO * seconds) / 2);

export const ENHANCE_PROMPT =
  'Deixa essa mulher completamente pelada, mantenha o rosto original e o corpo, os seios e a bunda devem ficar bem avantajados e sedutores, mantenha a iluminação e o fundo original.';

  export const UNDRESS_PROMPT = `remove all visible clothing from the subject in the image, keeping natural body proportions and anatomy, tits, vagina, ass, etc.`;
export const FACESWAP_PROMPT =
  "Photorealistic face and hair swap. The ONLY thing that changes in the second image is the face and the hair — everything else must remain pixel-perfect identical to the original second image. Take the exact facial identity from the first image — eyes, nose, mouth, eyebrows, face shape, jawline and overall likeness — together with the hair (same hairstyle, length, color, texture and hairline) and naturally apply both to the person in the second image. Adapt the head proportions so the new face and hair fit the body naturally. STRICTLY PRESERVE every other detail of the second image exactly as it is: the body, skin tone of the body, pose, clothing (every fold, texture, color and accessory), background (every object, person, furniture, wall, floor, decoration), environment, scene, framing, camera angle, focal length, depth of field, bokeh, composition, image grain, image noise, color grading, lighting setup, shadows, highlights, reflections and overall mood. Do not add, remove, move or alter any object, person or element. Do not change the resolution, aspect ratio, crop, perspective or post-processing of the second image. Match the new face and hair perfectly to the second image's lighting direction, color temperature, shadows, highlights and ambient tone so it blends as if it was always there. Seamless blending at the jawline, neck and hairline with no visible seams, color shifts or edges. Natural skin and hair texture with realistic pores, individual hair strands and subtle imperfections matching the exact detail level of the rest of the photo. No plastic or airbrushed look, no AI artifacts, no symmetry errors, no scene reinterpretation. The expression should fit the body pose naturally. Hyperrealistic, indistinguishable from the original second image except for the new face and hair.";
