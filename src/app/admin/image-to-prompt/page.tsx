import ImageToPrompt from '@/components/admin/ImageToPrompt';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export default function ImageToPromptPage() {
  return (
    <div className="space-y-8">
      <header className="pb-6 border-b border-white/10">
        <p className="text-xs font-bold tracking-widest text-bone-mute uppercase mb-3">Admin</p>
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Imagem → Prompt</h1>
        <p className="text-sm text-bone-dim mt-3 max-w-[640px]">
          Envie uma imagem e a IA devolve o prompt estruturado (JSON) que reproduz aquela imagem,
          no padrão UGC realista de influenciador.
        </p>
      </header>

      <ImageToPrompt />
    </div>
  );
}
