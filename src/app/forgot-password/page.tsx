import Link from 'next/link';
import { t } from '@/lib/i18n';
import { getLang } from '@/lib/lang';
import Logo from '@/components/Logo';
import ForgotForm from './form';

export default async function ForgotPasswordPage() {
  const lang = await getLang();
  return (
    <main className="min-h-screen flex flex-col bg-ink-900">
      <header className="fixed top-4 left-2 right-2 md:top-5 md:left-6 md:right-6 z-50">
        <nav className="max-w-[980px] mx-auto flex items-center justify-between px-4 md:px-6 py-3 bg-ink-800/60 backdrop-blur-md border border-white/10 rounded-2xl">
          <Link href="/" className="flex items-center gap-2 font-bold text-base md:text-lg text-bone">
            <Logo />
            goz.ai
          </Link>
          <Link href="/login" className="text-sm text-bone-dim hover:text-bone transition-colors">
            {t('login', lang)}
          </Link>
        </nav>
      </header>

      <div className="flex-1 flex items-center justify-center px-6 pt-32 pb-12">
        <div className="w-full max-w-[420px]">
          <div className="card p-8 md:p-10">
            <h1 className="text-3xl font-bold tracking-tight mb-2">
              {lang === 'pt' ? 'Esqueci minha senha' : lang === 'es' ? 'Olvidé mi contraseña' : 'Forgot password'}
            </h1>
            <p className="text-bone-dim text-sm mb-8">
              {lang === 'pt'
                ? 'Informe seu e-mail e enviaremos um link para criar uma nova senha.'
                : lang === 'es'
                ? 'Escribe tu e-mail y te enviaremos un enlace para crear una nueva contraseña.'
                : "Enter your email and we'll send you a link to set a new password."}
            </p>
            <ForgotForm lang={lang} />
          </div>
          <p className="text-center text-sm text-bone-dim mt-6">
            <Link href="/login" className="text-lime font-semibold hover:underline">
              {lang === 'pt' ? 'Voltar ao login' : lang === 'es' ? 'Volver al login' : 'Back to login'}
            </Link>
          </p>
        </div>
      </div>
    </main>
  );
}
