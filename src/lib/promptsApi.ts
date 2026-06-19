import { createServiceClient } from '@/lib/supabase/server';

export type PromptType =
  | 'text_to_image'
  | 'image_to_image'
  | 'text_to_video'
  | 'image_to_video'
  | 'motion_control';

export interface PromptTemplate {
  id: string;
  title: string;
  type: PromptType | string;
  prompt: string;
  imageUrl?: string;
  thumbnailUrl?: string;
  aiModel?: string;
}

export interface PromptCategory {
  id: string;
  title: string;
  prompts: PromptTemplate[];
}

export interface PromptSection {
  id: string;
  slug: string;
  title: string;
  description?: string;
  icon?: string;
  categories: PromptCategory[];
}

export interface PromptSectionsResponse {
  sections: PromptSection[];
}

// Flat DB row shape (public.prompts). The sections → categories → prompts tree
// is reconstructed from these rows, ordered by sort_order.
export interface PromptRow {
  id: string;
  section_id: string;
  section_slug: string;
  section_title: string;
  section_icon: string | null;
  category_id: string;
  category_title: string;
  title: string;
  type: string | null;
  prompt: string;
  image_url: string | null;
  thumbnail_url: string | null;
  ai_model: string | null;
  sort_order: number;
  active: boolean;
  created_at?: string;
  updated_at?: string;
}

const COLUMNS =
  'id, section_id, section_slug, section_title, section_icon, category_id, category_title, title, type, prompt, image_url, thumbnail_url, ai_model, sort_order, active';

// The public library is a single flat list now (no sections/categories/titles).
// These fixed values fill the table's NOT NULL columns on insert so the schema
// stays untouched while the UI shows one gallery.
export const FLAT_SECTION = {
  id: 'prompts',
  slug: 'prompts',
  title: 'Prompts',
  categoryId: 'prompts:all',
  categoryTitle: 'Prompts',
} as const;

/**
 * All active prompts as a single flat list, newest first. This is the source of
 * truth for the public library now that sections/categories are gone.
 */
export async function fetchAllPrompts(): Promise<PromptTemplate[]> {
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('prompts')
    .select(COLUMNS)
    .eq('active', true)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as PromptRow[]).map(toTemplate);
}

function toTemplate(r: PromptRow): PromptTemplate {
  return {
    id: r.id,
    title: r.title,
    type: r.type ?? 'text',
    prompt: r.prompt,
    imageUrl: r.image_url ?? undefined,
    thumbnailUrl: r.thumbnail_url ?? undefined,
    aiModel: r.ai_model ?? undefined,
  };
}

export async function searchPrompts(q: string): Promise<PromptTemplate[]> {
  // Strip characters that would break PostgREST's or() filter grammar.
  const term = q.trim().replace(/[,()]/g, ' ').trim();
  if (!term) return [];
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from('prompts')
    .select(COLUMNS)
    .eq('active', true)
    .or(`title.ilike.%${term}%,prompt.ilike.%${term}%`)
    .order('sort_order', { ascending: true })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as PromptRow[]).map(toTemplate);
}
