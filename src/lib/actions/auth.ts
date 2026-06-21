'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export type AuthState = { error?: string; info?: string };

type Lang = 'pt' | 'en';
const isLang = (v: unknown): v is Lang => v === 'pt' || v === 'en';

const M = {
  empty: { pt: 'Preencha e-mail e senha.', en: 'Enter email and password.' },
  shortPw: { pt: 'A senha precisa ter ao menos 6 caracteres.', en: 'Password must be at least 6 characters.' },
  emptyUser: { pt: 'Escolha um nome de usuário.', en: 'Pick a username.' },
  exists: {
    pt: 'Este e-mail já está cadastrado. Faça login.',
    en: 'This email is already registered. Please sign in.',
  },
  confirm: {
    pt: 'Confira seu e-mail para confirmar a conta.',
    en: 'Check your email to confirm your account.',
  },
  invalidLogin: { pt: 'E-mail ou senha inválidos.', en: 'Invalid email or password.' },
};

function pickLang(formData: FormData): Lang {
  const raw = formData.get('lang');
  return isLang(raw) ? raw : 'pt';
}

export async function loginAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const lang = pickLang(formData);
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  if (!email || !password) return { error: M.empty[lang] };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (/invalid login credentials/i.test(error.message)) return { error: M.invalidLogin[lang] };
    return { error: error.message };
  }

  revalidatePath('/', 'layout');
  redirect('/dashboard');
}

export async function signupAction(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const lang = pickLang(formData);
  const email = String(formData.get('email') ?? '').trim().toLowerCase();
  const password = String(formData.get('password') ?? '');
  const username = String(formData.get('username') ?? '').trim().slice(0, 60);
  if (!email || !password) return { error: M.empty[lang] };
  if (!username) return { error: M.emptyUser[lang] };
  if (password.length < 6) return { error: M.shortPw[lang] };

  const supabase = await createClient();

  // Conta pré-criada pela ÁREA DE MEMBROS (compra do curso, mesma Supabase): o
  // e-mail já existe em auth.users. Em vez de barrar com "já cadastrado", deixa
  // a pessoa ASSUMIR a conta definindo a própria senha — e já loga. Só vale para
  // contas criadas pelo webhook do curso (têm `perfectpay_*` no metadata) e que
  // ainda não foram reivindicadas, pra não permitir trocar a senha de uma conta
  // normal do SaaS já existente.
  const claimed = await tryClaimMembersAccount(email, password, username, lang);
  if (claimed === 'claimed') {
    revalidatePath('/', 'layout');
    redirect('/dashboard');
  }
  if (claimed && claimed !== 'not_eligible') {
    return { error: claimed };
  }

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/callback`,
      data: { username, language_code: lang },
    },
  });
  if (error) {
    if (/already (registered|exists)|user.*exists/i.test(error.message)) {
      return { error: M.exists[lang] };
    }
    return { error: error.message };
  }

  // Supabase obscures duplicate emails when email-confirmation is on:
  // it returns a user with an empty `identities` array instead of an error.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    return { error: M.exists[lang] };
  }

  if (data.session) {
    revalidatePath('/', 'layout');
    redirect('/dashboard');
  }
  return { info: M.confirm[lang] };
}

/**
 * Tenta ASSUMIR uma conta pré-criada pela área de membros (compra do curso).
 * Retorna:
 *   'claimed'      -> senha definida e sessão iniciada (o chamador redireciona)
 *   'not_eligible' -> não há conta pré-criada elegível (segue o signup normal)
 *   <mensagem>     -> erro a exibir (ex.: conta normal/ já reivindicada)
 *
 * Só assume contas com `perfectpay_*` no metadata (criadas pelo webhook do curso)
 * e ainda não reivindicadas — assim ninguém troca a senha de uma conta normal do
 * SaaS já existente.
 */
async function tryClaimMembersAccount(
  email: string,
  password: string,
  username: string,
  lang: Lang
): Promise<'claimed' | 'not_eligible' | string> {
  const service = createServiceClient();

  const { data: prof } = await service
    .from('profiles')
    .select('user_id')
    .eq('email', email)
    .maybeSingle();
  if (!prof?.user_id) return 'not_eligible';

  const userId = prof.user_id as string;
  const { data: got, error: getErr } = await service.auth.admin.getUserById(userId);
  if (getErr || !got?.user) return 'not_eligible';

  const meta = (got.user.user_metadata ?? {}) as Record<string, unknown>;
  const fromMembers = Boolean(meta.perfectpay_sale_code || meta.perfectpay_product_code);
  const alreadyClaimed = Boolean(meta.saas_claimed_at);

  // Conta normal do SaaS (sem metadata do curso) ou já reivindicada -> não assume.
  if (!fromMembers || alreadyClaimed) return M.exists[lang];

  const { error: updErr } = await service.auth.admin.updateUserById(userId, {
    password,
    email_confirm: true,
    user_metadata: {
      ...meta,
      username,
      language_code: lang,
      saas_claimed_at: new Date().toISOString(),
    },
  });
  if (updErr) return updErr.message;

  await service
    .from('profiles')
    .update({ username, language_code: lang, updated_at: new Date().toISOString() })
    .eq('user_id', userId);

  const supabase = await createClient();
  const { error: signErr } = await supabase.auth.signInWithPassword({ email, password });
  if (signErr) return signErr.message;

  return 'claimed';
}

export async function logoutAction() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect('/login');
}
