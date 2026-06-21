import { NextResponse, type NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';

/**
 * Confirmação de link de e-mail via token_hash (verifyOtp). Funciona entre
 * dispositivos (não depende do cookie de PKCE do navegador que pediu).
 *
 * Para usar no reset de senha, aponte o template de e-mail "Reset Password" do
 * Supabase para:
 *   {{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/reset-password
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const nextParam = url.searchParams.get('next');
  const next = nextParam && nextParam.startsWith('/') ? nextParam : '/dashboard';

  if (tokenHash && type) {
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }

  // Falhou -> manda pro fluxo de pedir novo link.
  return NextResponse.redirect(new URL('/reset-password', url.origin));
}
