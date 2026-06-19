'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const items = [
  { href: '/admin', label: 'Visão geral' },
  { href: '/admin/users', label: 'Usuários' },
  { href: '/admin/prompts', label: 'Prompts' },
  { href: '/admin/prompts-from-image', label: 'Img→Prompt+' },
  { href: '/admin/image-to-prompt', label: 'Img→Prompt' },
  { href: '/admin/orders', label: 'Pedidos' },
  { href: '/admin/generations', label: 'Gerações' },
];

export default function AdminNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href);

  if (mobile) {
    return (
      <nav className="bg-ink-800/80 backdrop-blur-md border border-white/10 rounded-2xl px-2 py-2 flex gap-1 overflow-x-auto">
        {items.map((it) => (
          <Link
            key={it.href}
            href={it.href}
            className={`flex-1 shrink-0 text-center py-2 px-2 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
              isActive(it.href) ? 'bg-lime/10 text-lime' : 'text-bone-dim hover:text-bone'
            }`}
          >
            {it.label}
          </Link>
        ))}
      </nav>
    );
  }

  return (
    <nav className="hidden md:flex items-center gap-1">
      {items.map((it) => (
        <Link
          key={it.href}
          href={it.href}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            isActive(it.href) ? 'bg-lime/10 text-lime' : 'text-bone-dim hover:text-bone hover:bg-white/5'
          }`}
        >
          {it.label}
        </Link>
      ))}
    </nav>
  );
}
