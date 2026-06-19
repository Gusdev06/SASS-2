'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import {
  deletePromptAction,
  togglePromptActiveAction,
  type PromptFormState,
} from '@/lib/actions/admin-prompts';

export default function PromptRowActions({ id, active }: { id: string; active: boolean }) {
  const [, toggle, togglePending] = useActionState<PromptFormState, FormData>(togglePromptActiveAction, {});
  const [delState, del, delPending] = useActionState<PromptFormState, FormData>(deletePromptAction, {});

  return (
    <div className="flex items-center gap-1.5">
      <Link href={`/admin/prompts/${id}`} className="btn-ghost !py-1.5 !px-2.5 text-xs">
        Editar
      </Link>

      <form action={toggle}>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="active" value={active ? 'false' : 'true'} />
        <button
          type="submit"
          disabled={togglePending}
          className="!py-1.5 !px-2.5 text-xs rounded-lg font-semibold bg-white/5 text-bone-dim hover:bg-white/10 disabled:opacity-50"
        >
          {active ? 'Ocultar' : 'Ativar'}
        </button>
      </form>

      <form
        action={del}
        onSubmit={(e) => {
          if (!confirm('Excluir este prompt? Esta ação não pode ser desfeita.')) e.preventDefault();
        }}
      >
        <input type="hidden" name="id" value={id} />
        <button
          type="submit"
          disabled={delPending}
          className="!py-1.5 !px-2.5 text-xs rounded-lg font-semibold bg-ember/10 text-ember hover:bg-ember/20 disabled:opacity-50"
          title={delState.error ?? 'Excluir'}
        >
          Excluir
        </button>
      </form>
    </div>
  );
}
