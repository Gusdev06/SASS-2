import { createServiceClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

const PAGE_SIZE = 100;

export default async function AdminOrdersPage() {
  const service = createServiceClient();

  const { data: orders, error } = await service
    .from('processed_orders')
    .select('order_id, user_id, pkg_id, credits, amount, created_at')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);

  const total = (orders ?? []).reduce((sum, o) => sum + Number(o.amount ?? 0), 0);

  return (
    <div className="space-y-8">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-4 pb-6 border-b border-white/10">
        <div>
          <p className="text-xs font-bold tracking-widest text-bone-mute uppercase mb-3">Admin</p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight">Pedidos</h1>
          <p className="text-sm text-bone-dim mt-3">
            {(orders?.length ?? 0)} pedidos •{' '}
            <span className="text-bone">
              {total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
            </span>
          </p>
        </div>
      </header>

      {error && <p className="text-sm text-ember">Erro ao carregar pedidos: {error.message}</p>}

      {!error && (orders?.length ?? 0) === 0 && (
        <p className="text-sm text-bone-dim">Nenhum pedido registrado ainda.</p>
      )}

      {(orders?.length ?? 0) > 0 && (
        <div className="card !p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] font-bold tracking-widest text-bone-mute uppercase border-b border-white/10">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Pacote</th>
                <th className="px-4 py-3 text-right">Créditos</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3">Usuário</th>
                <th className="px-4 py-3">Pedido</th>
              </tr>
            </thead>
            <tbody>
              {(orders ?? []).map((o) => (
                <tr key={o.order_id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 whitespace-nowrap text-bone-dim">
                    {new Date(o.created_at).toLocaleString('pt-BR')}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">{o.pkg_id ?? '—'}</td>
                  <td className="px-4 py-3 text-right">{o.credits}</td>
                  <td className="px-4 py-3 text-right text-lime font-semibold">
                    {Number(o.amount ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                  </td>
                  <td className="px-4 py-3 font-mono text-[11px] text-bone-mute">{o.user_id ?? '—'}</td>
                  <td className="px-4 py-3 font-mono text-[11px] text-bone-mute">{o.order_id}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(orders?.length ?? 0) === PAGE_SIZE && (
        <p className="text-xs text-bone-mute">Mostrando os últimos {PAGE_SIZE} pedidos.</p>
      )}
    </div>
  );
}
