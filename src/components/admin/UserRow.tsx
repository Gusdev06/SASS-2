'use client';

import { useActionState, useEffect, useState } from 'react';
import {
  adjustCreditsAction,
  setBannedAction,
  setAdminAction,
  type AdminState,
} from '@/lib/actions/admin';

// Atalhos de crédito (espelham os tamanhos de pacote mais comuns).
const QUICK_CREDITS = [30, 75, 150, 350];

export type AdminUser = {
  user_id: string;
  email: string | null;
  credits: number;
  banned: boolean;
  is_admin: boolean;
  created_at: string;
};

export default function UserRow({ user, isSelf = false }: { user: AdminUser; isSelf?: boolean }) {
  const [creditState, adjustCredits, creditsPending] = useActionState<AdminState, FormData>(
    adjustCreditsAction,
    {}
  );
  const [banState, setBanned, banPending] = useActionState<AdminState, FormData>(setBannedAction, {});
  const [adminState, setAdmin, adminPending] = useActionState<AdminState, FormData>(setAdminAction, {});
  const [delta, setDelta] = useState('');

  // Limpa o campo depois de creditar com sucesso.
  useEffect(() => {
    if (creditState.info) setDelta('');
  }, [creditState]);

  const created = new Date(user.created_at).toLocaleDateString('pt-BR');
  const status =
    creditState.error ??
    creditState.info ??
    adminState.error ??
    adminState.info ??
    banState.error ??
    banState.info;
  const statusIsError = Boolean(
    creditState.error ?? adminState.error ?? banState.error
  );

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold truncate">{user.email ?? '—'}</p>
          <p className="text-xs text-bone-mute mt-0.5">desde {created}</p>
          <p className="text-[10px] text-bone-mute mt-0.5 font-mono">{user.user_id}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="pill">{user.credits} cr</span>
          {user.is_admin && (
            <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-lime/15 text-lime">ADMIN</span>
          )}
          {user.banned && (
            <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-ember/15 text-ember">BANIDO</span>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
        <form action={adjustCredits} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="user_id" value={user.user_id} />
          <span className="text-[10px] font-bold tracking-widest text-bone-mute uppercase mr-1">
            Dar créditos
          </span>
          {QUICK_CREDITS.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setDelta(String(amount))}
              className="!py-1.5 !px-2.5 text-xs rounded-lg font-semibold bg-lime/10 text-lime hover:bg-lime/20 transition-colors"
            >
              +{amount}
            </button>
          ))}
          <input
            name="delta"
            type="number"
            step="1"
            value={delta}
            onChange={(e) => setDelta(e.target.value)}
            placeholder="+ ou −"
            required
            className="input !py-2 !px-3 w-24 text-sm"
          />
          <button
            type="submit"
            disabled={creditsPending}
            className="btn-primary !py-2 !px-3 text-sm disabled:opacity-50"
          >
            {creditsPending ? '...' : 'Dar créditos'}
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2">
          <form action={setAdmin}>
            <input type="hidden" name="user_id" value={user.user_id} />
            <input type="hidden" name="is_admin" value={user.is_admin ? 'false' : 'true'} />
            <button
              type="submit"
              disabled={adminPending || (user.is_admin && isSelf)}
              title={user.is_admin && isSelf ? 'Você não pode remover o seu próprio acesso' : undefined}
              className={`!py-2 !px-3 text-sm rounded-lg font-semibold transition-colors disabled:opacity-40 ${
                user.is_admin
                  ? 'bg-white/10 text-bone-dim hover:bg-white/20'
                  : 'bg-lime/10 text-lime hover:bg-lime/20'
              }`}
            >
              {adminPending ? '...' : user.is_admin ? 'Remover admin' : 'Tornar admin'}
            </button>
          </form>

          <form action={setBanned}>
            <input type="hidden" name="user_id" value={user.user_id} />
            <input type="hidden" name="banned" value={user.banned ? 'false' : 'true'} />
            <button
              type="submit"
              disabled={banPending}
              className={`!py-2 !px-3 text-sm rounded-lg font-semibold transition-colors disabled:opacity-50 ${
                user.banned
                  ? 'bg-lime/10 text-lime hover:bg-lime/20'
                  : 'bg-ember/10 text-ember hover:bg-ember/20'
              }`}
            >
              {banPending ? '...' : user.banned ? 'Reativar' : 'Banir'}
            </button>
          </form>
        </div>
      </div>

      {status && (
        <p className={`text-xs ${statusIsError ? 'text-ember' : 'text-lime'}`}>{status}</p>
      )}
    </div>
  );
}
