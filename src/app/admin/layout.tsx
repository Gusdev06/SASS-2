import { redirect } from 'next/navigation';
import { getAdminUser } from '@/lib/admin';
import AdminShell from '@/components/AdminShell';

export const metadata = { title: 'Admin — goz.ai', robots: { index: false, follow: false } };

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await getAdminUser();
  // The middleware already redirects logged-out users to /login. Here we also
  // block authenticated non-admins so /admin is never reachable by accident.
  if (!admin) redirect('/dashboard');

  return <AdminShell email={admin.email ?? null}>{children}</AdminShell>;
}
