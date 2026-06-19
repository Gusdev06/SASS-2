import Link from 'next/link';
import PromptFromImage from '@/components/admin/PromptFromImage';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export default function PromptFromImagePage() {
  return (
    <div className="space-y-8">
      <header className="pb-6 border-b border-white/10">
        <Link
          href="/admin/prompts"
          className="text-xs font-bold tracking-widest text-bone-mute uppercase hover:text-lime transition-colors"
        >
          ← Voltar para prompts
        </Link>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mt-4">Imagem → Prompt público</h1>
        <p className="text-sm text-bone-dim mt-3 max-w-[640px]">
          Envie uma imagem: a IA extrai o prompt estruturado e ele é salvo direto na biblioteca pública
          junto com a imagem — modelo <span className="text-bone">gpt-image-2</span> e tags{' '}
          <span className="text-bone">text-to-image</span> + <span className="text-bone">img-to-img</span>.
        </p>
      </header>

      <PromptFromImage />
    </div>
  );
}
