import { getUser, getProfile } from '@/lib/auth';
import { getLang } from '@/lib/lang';
import AppShell from '@/components/AppShell';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const user = await getUser();
  const profile = user ? await getProfile() : null;
  const credits = profile?.credits ?? 0;

  const lang = await getLang(profile?.language_code ?? null);
  return (
    <AppShell lang={lang} credits={credits} email={user?.email ?? null}>
      {children}
    </AppShell>
  );
}
