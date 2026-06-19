import Link from 'next/link';
import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card">
      <p className="text-[10px] font-bold tracking-widest text-bone-mute uppercase mb-2">{label}</p>
      <p className="text-3xl font-bold tracking-tight">{value}</p>
      {hint && <p className="text-xs text-bone-dim mt-1">{hint}</p>}
    </div>
  );
}

export default async function AdminOverviewPage() {
  const service = createServiceClient();

  const [
    { count: totalUsers },
    { count: bannedUsers },
    { count: totalRenders },
    { count: pendingRenders },
    { data: creditRows },
    { data: orderRows },
  ] = await Promise.all([
    service.from('profiles').select('user_id', { count: 'exact', head: true }),
    service.from('profiles').select('user_id', { count: 'exact', head: true }).eq('banned', true),
    service.from('generations').select('id', { count: 'exact', head: true }).not('output_url', 'is', null),
    service.from('generations').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    service.from('profiles').select('credits'),
    service.from('processed_orders').select('amount, credits'),
  ]);

  const creditsInCirculation = (creditRows ?? []).reduce((sum, r) => sum + (r.credits ?? 0), 0);
  const revenue = (orderRows ?? []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0);
  const creditsSold = (orderRows ?? []).reduce((sum, r) => sum + (r.credits ?? 0), 0);
  const orderCount = (orderRows ?? []).length;

  return (
    <div className="space-y-10">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <p className="text-xs font-bold tracking-widest text-bone-mute uppercase mb-3">Admin</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Visão geral</h1>
          <p className="text-sm text-bone-dim mt-3">Métricas da plataforma em tempo real.</p>
        </div>
        <Link href="/admin/users" className="btn-primary text-sm">
          Gerenciar usuários →
        </Link>
      </header>

      <section className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Usuários" value={(totalUsers ?? 0).toString()} hint={`${bannedUsers ?? 0} banidos`} />
        <StatCard label="Renders" value={(totalRenders ?? 0).toString()} hint={`${pendingRenders ?? 0} pendentes`} />
        <StatCard label="Créditos em circulação" value={creditsInCirculation.toString()} />
        <StatCard label="Créditos vendidos" value={creditsSold.toString()} hint={`${orderCount} pedidos`} />
      </section>

      <section className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <StatCard
          label="Receita total"
          value={revenue.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
          hint={`em ${orderCount} pedidos`}
        />
        <StatCard
          label="Ticket médio"
          value={(orderCount > 0 ? revenue / orderCount : 0).toLocaleString('pt-BR', {
            style: 'currency',
            currency: 'BRL',
          })}
        />
      </section>

      <section className="flex flex-wrap gap-3">
        <Link href="/admin/users" className="btn-ghost text-sm">Usuários</Link>
        <Link href="/admin/prompts" className="btn-ghost text-sm">Prompts</Link>
        <Link href="/admin/image-to-prompt" className="btn-ghost text-sm">Imagem → Prompt</Link>
        <Link href="/admin/orders" className="btn-ghost text-sm">Pedidos</Link>
        <Link href="/admin/generations" className="btn-ghost text-sm">Gerações</Link>
      </section>
    </div>
  );
}
