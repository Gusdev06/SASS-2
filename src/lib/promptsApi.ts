import data from '@/data/prompts.json';

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

// Prompts are now bundled with the app (migrated from the old external API into
// src/data/prompts.json, images hosted on our own Supabase Storage). These stay
// async to keep the existing call sites unchanged.
const SECTIONS = (data as PromptSectionsResponse).sections;

export async function fetchAllPromptSections(): Promise<PromptSection[]> {
  return SECTIONS;
}

export async function fetchPromptSection(slug: string): Promise<PromptSection | null> {
  return SECTIONS.find((s) => s.slug === slug) ?? null;
}

export async function searchPrompts(q: string): Promise<PromptTemplate[]> {
  const term = q.trim().toLowerCase();
  if (!term) return [];
  const out: PromptTemplate[] = [];
  for (const section of SECTIONS) {
    for (const category of section.categories) {
      for (const p of category.prompts) {
        if (
          p.title.toLowerCase().includes(term) ||
          p.prompt.toLowerCase().includes(term)
        ) {
          out.push(p);
        }
      }
    }
  }
  return out;
}
