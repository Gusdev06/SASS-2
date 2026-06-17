import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

/**
 * Request-deduplicated current user.
 * React.cache() memoizes per request, so layout + page (which both need the
 * user) collapse into a single Supabase Auth round-trip instead of N.
 */
export const getUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user;
});

/**
 * Request-deduplicated profile (credits + language). Shared by the dashboard
 * layout and every dashboard page so the `profiles` query runs once.
 */
export const getProfile = cache(async () => {
  const user = await getUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data } = await supabase
    .from('profiles')
    .select('credits, language_code')
    .eq('user_id', user.id)
    .single();
  return data;
});
