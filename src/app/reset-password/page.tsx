import Link from 'next/link';
import { getUser } from '@/lib/auth';
import { getLang } from '@/lib/lang';
import Logo from '@/components/Logo';
import ResetForm from './form';

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage() {
  const lang = await getLang();
  const user = await getUser();

  return (
    <main className="min-h-screen flex flex-col bg-ink-900">
      <header className="fixed top-4 left-2 right-2 md:top-5 md:left-6 md:right-6 z-50">
        <nav className="max-w-[980px] mx-auto flex items-center justify-between px-4 md:px-6 py-3 bg-ink-800/60 backdrop-blur-md border border-white/10 rounded-2xl">
          <Link href="/" className="flex items-center gap-2 font-bold text-base md:text-lg text-bone">
            <Logo />
            goz.ai
          </Link>
        </nav>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 pt-32 pb-12">
        <div className="w-full max-w-[420px]">
          <div className="card p-8 md:p-10">
            <h1 className="text-3xl font-bold tracking-tight mb-2">
              {lang === 'pt' ? 'Nova senha' : lang === 'es' ? 'Nueva contraseña' : 'New password'}
            </h1>
            {user ? (
              <>
                <p className="text-bone-dim text-sm mb-8">
                  {lang === 'pt'
                    ? 'Escolha uma nova senha para sua conta.'
                    : lang === 'es'
                    ? 'Elige una nueva contraseña para tu cuenta.'
                    : 'Choose a new password for your account.'}
                </p>
                <ResetForm lang={lang} />
              </>
            ) : (
              <>
                <p className="text-bone-dim text-sm mb-6">
                  {lang === 'pt'
                    ? 'Link inválido ou expirado. Peça um novo link de redefinição.'
                    : lang === 'es'
                    ? 'Enlace inválido o expirado. Solicita un nuevo enlace.'
                    : 'Invalid or expired link. Request a new reset link.'}
                </p>
                <Link href="/forgot-password" className="btn-primary w-full inline-flex justify-center">
                  {lang === 'pt' ? 'Pedir novo link' : lang === 'es' ? 'Pedir nuevo enlace' : 'Request new link'}
                </Link>
              </>
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
