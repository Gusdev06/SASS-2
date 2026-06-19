import 'server-only';
import { cache } from 'react';
import { getUser } from '@/lib/auth';

/**
 * Admin access is gated by the ADMIN_EMAIL env var. Supports a comma-separated
 * list so you can grant access to more than one operator without a DB migration.
 */
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAIL ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const list = adminEmails();
  return list.length > 0 && list.includes(email.toLowerCase());
}

/**
 * Request-deduplicated admin user. Returns the auth user when the signed-in
 * account is an admin, otherwise null. Mirrors getUser()'s caching so the
 * layout + page collapse into a single Auth round-trip.
 */
export const getAdminUser = cache(async () => {
  const user = await getUser();
  if (!user || !isAdminEmail(user.email)) return null;
  return user;
});
