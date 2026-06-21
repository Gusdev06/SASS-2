import { NextRequest, NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { createClient, createServiceClient } from '@/lib/supabase/server';
import { resolveVideoMarker } from '@/lib/video';
import { persistGeneration } from '@/lib/storage';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ runId: string }> }
) {
  const { runId } = await params;

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: 'auth' }, { status: 401 });

  const service = createServiceClient();
  // O cliente faz polling com o id "cru"; o marcador salvo é `kie:<id>` (Kling)
  // ou `run:<id>` (ComfyDeploy). Procuramos por qualquer um dos dois.
  let gen: { id: string; output_url: string | null; status: string } | null = null;
  let marker = '';
  for (const candidate of [`kie:${runId}`, `run:${runId}`]) {
    const { data } = await service
      .from('generations')
      .select('id, output_url, status')
      .eq('user_id', user.id)
      .in('kind', ['video', 'video_kling'])
      .contains('input_urls', [candidate])
      .maybeSingle();
    if (data) {
      gen = data;
      marker = candidate;
      break;
    }
  }

  if (!gen) return NextResponse.json({ error: 'not found' }, { status: 404 });

  if (gen.output_url) {
    return NextResponse.json({ status: 'success', progress: 1, outputUrl: gen.output_url });
  }

  if (gen.status === 'refunded' || gen.status === 'failed') {
    return NextResponse.json({
      status: 'failed',
      error: 'Run failed',
      refunded: gen.status === 'refunded',
    });
  }

  let res;
  try {
    res = await resolveVideoMarker(marker);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'video provider error' },
      { status: 502 }
    );
  }

  if (res.status === 'success') {
    const storedUrl = await persistGeneration(res.url, `${user.id}/video`);
    await service
      .from('generations')
      .update({ output_url: storedUrl, status: 'succeeded' })
      .eq('id', gen.id);
    revalidatePath('/dashboard');
    return NextResponse.json({ status: 'success', progress: 1, outputUrl: storedUrl });
  }

  if (res.status === 'success_no_output') {
    return NextResponse.json({ status: 'success', progress: 1, outputUrl: null });
  }

  if (res.status === 'failed') {
    const { data: refunded } = await service.rpc('refund_generation', {
      p_gen_id: gen.id,
      p_reason: res.reason,
    });
    revalidatePath('/dashboard');
    return NextResponse.json({ status: 'failed', error: res.reason, refunded: Boolean(refunded) });
  }

  // pending
  return NextResponse.json({
    status: 'pending',
    progress: res.progress ?? 0,
    liveStatus: res.liveStatus ?? null,
  });
}
