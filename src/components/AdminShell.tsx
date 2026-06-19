import Link from 'next/link';
import { logoutAction } from '@/lib/actions/auth';
import Logo from './Logo';
import AdminNav from './AdminNav';

export default function AdminShell({
  children,
  email,
}: {
  children: React.ReactNode;
  email: string | null;
}) {
  return (
    <div className="min-h-screen flex flex-col bg-ink-900">
      <header className="fixed top-4 left-2 right-2 md:top-5 md:left-6 md:right-6 z-50">
        <nav className="max-w-[1280px] mx-auto flex items-center justify-between gap-4 px-4 md:px-6 py-3 bg-ink-800/60 backdrop-blur-md border border-white/10 rounded-2xl">
          <div className="flex items-center gap-6 md:gap-8 min-w-0">
            <Link href="/admin" className="flex items-center gap-2 font-bold text-base md:text-lg shrink-0">
              <Logo />
              goz.ai
              <span className="pill ml-1">admin</span>
            </Link>
            <AdminNav />
          </div>

          <div className="flex items-center gap-2 md:gap-3 shrink-0">
            <Link href="/dashboard" className="text-sm text-bone-dim hover:text-bone transition-colors hidden sm:inline">
              ← Studio
            </Link>
            <form action={logoutAction}>
              <button type="submit" className="text-sm text-bone-dim hover:text-bone transition-colors">
                Sair
              </button>
            </form>
          </div>
        </nav>
      </header>

      <div className="md:hidden fixed bottom-3 left-2 right-2 z-40">
        <AdminNav mobile />
      </div>

      <main className="flex-1 max-w-[1280px] w-full mx-auto px-5 lg:px-8 pt-28 pb-20 md:pb-12">
        {children}
      </main>

      <footer className="border-t border-white/10 py-5 text-center text-xs text-bone-mute">
        <span>{email ?? 'admin'}</span>
        <span className="mx-3">•</span>
        <span>goz.ai admin © {new Date().getFullYear()}</span>
      </footer>
    </div>
  );
}
