'use client';
import { useActionState } from 'react';
import { updatePasswordAction, type AuthState } from '@/lib/actions/auth';
import { t, type Lang } from '@/lib/i18n';

const initial: AuthState = {};

export default function ResetForm({ lang }: { lang: Lang }) {
  const [state, action, pending] = useActionState(updatePasswordAction, initial);
  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="lang" value={lang} />
      <div>
        <label className="field-label">{t('password', lang)}</label>
        <input
          className="input"
          name="password"
          type="password"
          required
          minLength={6}
          autoComplete="new-password"
          placeholder="••••••••"
        />
      </div>
      {state.error && (
        <div className="text-sm text-red-400 bg-red-500/10 border border-red-500/25 rounded-lg px-3 py-2.5">
          {state.error}
        </div>
      )}
      <button type="submit" className="btn-primary w-full" disabled={pending}>
        {pending ? (
          <span className="inline-block w-4 h-4 border-2 border-ink-900/30 border-t-ink-900 rounded-full animate-spin" />
        ) : lang === 'pt' ? (
          'Salvar senha →'
        ) : lang === 'es' ? (
          'Guardar contraseña →'
        ) : (
          'Save password →'
        )}
      </button>
    </form>
  );
}
