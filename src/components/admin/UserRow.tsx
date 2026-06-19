'use client';

import { useActionState } from 'react';
import { adjustCreditsAction, setBannedAction, type AdminState } from '@/lib/actions/admin';

export type AdminUser = {
  user_id: string;
  email: string | null;
  username: string | null;
  credits: number;
  banned: boolean;
  created_at: string;
};

export default function UserRow({ user }: { user: AdminUser }) {
  const [creditState, adjustCredits, creditsPending] = useActionState<AdminState, FormData>(
    adjustCreditsAction,
    {}
  );
  const [banState, setBanned, banPending] = useActionState<AdminState, FormData>(setBannedAction, {});

  const created = new Date(user.created_at).toLocaleDateString('pt-BR');
  const status = creditState.error ?? creditState.info ?? banState.error ?? banState.info;
  const statusIsError = Boolean(creditState.error ?? banState.error);

  return (
    <div className="card flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold truncate">{user.email ?? '—'}</p>
          <p className="text-xs text-bone-mute mt-0.5">
            {user.username ? `@${user.username} • ` : ''}desde {created}
          </p>
          <p className="text-[10px] text-bone-mute mt-0.5 font-mono">{user.user_id}</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="pill">{user.credits} cr</span>
          {user.banned && (
            <span className="px-2 py-1 rounded-full text-[11px] font-bold bg-ember/15 text-ember">BANIDO</span>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-white/5">
        <form action={adjustCredits} className="flex items-center gap-2">
          <input type="hidden" name="user_id" value={user.user_id} />
          <input
            name="delta"
            type="number"
            step="1"
            placeholder="±créditos"
            required
            className="input !py-2 !px-3 w-32 text-sm"
          />
          <button type="submit" disabled={creditsPending} className="btn-ghost !py-2 !px-3 text-sm disabled:opacity-50">
            {creditsPending ? '...' : 'Ajustar'}
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

      {status && (
        <p className={`text-xs ${statusIsError ? 'text-ember' : 'text-lime'}`}>{status}</p>
      )}
    </div>
  );
}
