import Link from 'next/link';
import PromptForm from '@/components/admin/PromptForm';

export default function NewPromptPage() {
  return (
    <div className="space-y-8">
      <header className="pb-6 border-b border-white/10">
        <Link
          href="/admin/prompts"
          className="text-xs font-bold tracking-widest text-bone-mute uppercase hover:text-lime transition-colors"
        >
          ← Voltar para prompts
        </Link>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mt-4">Novo prompt</h1>
      </header>

      <PromptForm />
    </div>
  );
}
