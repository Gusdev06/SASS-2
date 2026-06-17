import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';

export const runtime = 'nodejs';

/**
 * Poll endpoint for background image generations (the SFW `create` tab).
 * The generation runs in `generateAction` via `after()`; this just reads the
 * row state so the client can poll instead of blocking on a long request.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: 'auth' }, { status: 401 });

  const service = createServiceClient();
  const { data: gen } = await service
    .from('generations')
    .select('id, output_url, status')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle();

  if (!gen) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (gen.output_url) {
    revalidatePath('/dashboard');
    return NextResponse.json({ status: 'success', outputUrl: gen.output_url });
  }

  if (gen.status === 'refunded' || gen.status === 'failed') {
    return NextResponse.json({
      status: 'failed',
      error: 'Generation failed',
      refunded: gen.status === 'refunded',
    });
  }

  return NextResponse.json({ status: 'pending' });
}
