import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createServiceClient } from '@/lib/supabase/server';
import type { PromptRow } from '@/lib/promptsApi';
import PromptForm from '@/components/admin/PromptForm';

export const dynamic = 'force-dynamic';

export default async function EditPromptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const service = createServiceClient();
  const { data } = await service
    .from('prompts')
    .select(
      'id, section_slug, section_title, section_icon, category_title, title, type, prompt, image_url, thumbnail_url, ai_model, sort_order, active'
    )
    .eq('id', id)
    .maybeSingle();

  if (!data) notFound();
  const p = data as PromptRow;

  return (
    <div className="space-y-8">
      <header className="pb-6 border-b border-white/10">
        <Link
          href="/admin/prompts"
          className="text-xs font-bold tracking-widest text-bone-mute uppercase hover:text-lime transition-colors"
        >
          ← Voltar para prompts
        </Link>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mt-4">Editar prompt</h1>
        <p className="text-xs text-bone-mute font-mono mt-2">{p.id}</p>
      </header>

      <PromptForm
        values={{
          id: p.id,
          section_slug: p.section_slug,
          section_title: p.section_title,
          section_icon: p.section_icon,
          category_title: p.category_title,
          title: p.title,
          type: p.type ?? 'text',
          prompt: p.prompt,
          image_url: p.image_url,
          thumbnail_url: p.thumbnail_url,
          ai_model: p.ai_model,
          sort_order: p.sort_order,
          active: p.active,
        }}
      />
    </div>
  );
}
