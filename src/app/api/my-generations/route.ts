import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const isVideoUrl = (url: string) => /\.(mp4|webm|mov)(\?|$)/i.test(url);

/**
 * Lists the signed-in user's previously generated images so they can be picked
 * as an input ("attach from my gallery") in the generation panel. Videos are
 * excluded — only images can be used as an input. RLS already scopes the
 * `generations` table to the owner, so the user-session client is enough.
 */
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: 'auth' }, { status: 401 });

  const limit = Math.min(Number(req.nextUrl.searchParams.get('limit') ?? 60) || 60, 100);

  const { data, error } = await supabase
    .from('generations')
    .select('id, output_url, kind, prompt, created_at')
    .eq('user_id', user.id)
    .not('output_url', 'is', null)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const items = (data ?? [])
    .filter((g) => g.output_url && !isVideoUrl(g.output_url))
    .map((g) => ({
      id: g.id,
      url: g.output_url as string,
      kind: g.kind,
      prompt: g.prompt,
      created_at: g.created_at,
    }));

  return NextResponse.json({ items });
}
