import 'server-only';
import { getRun } from '@/lib/comfydeploy';
import { getKlingVideo } from '@/lib/kie-video';
import { getSpicyVideo } from '@/lib/wavespeed-video';

/**
 * Uma geração de vídeo guarda em `input_urls` um marcador do backend que a
 * processa: `kie:<taskId>` (Kling V3 Turbo via kie.ai), `ws:<getUrl>` (LTX 2.3
 * Spicy via WaveSpeed) ou `run:<runId>` (ComfyDeploy, legado/fallback). Este
 * módulo centraliza a resolução do estado pra que /api/video-status, o reconcile
 * e o cron compartilhem a mesma lógica.
 */

export function findVideoMarker(inputUrls?: string[] | null): string | null {
  return (
    (inputUrls ?? []).find(
      (u) => u.startsWith('kie:') || u.startsWith('ws:') || u.startsWith('run:')
    ) ?? null
  );
}

export type VideoResolve =
  | { status: 'pending'; progress?: number; liveStatus?: string | null }
  | { status: 'success'; url: string }
  | { status: 'success_no_output' }
  | { status: 'failed'; reason: string };

export async function resolveVideoMarker(marker: string): Promise<VideoResolve> {
  // Kling (kie.ai)
  if (marker.startsWith('kie:')) {
    const r = await getKlingVideo(marker.slice(4));
    if (r.state === 'success') {
      return r.url ? { status: 'success', url: r.url } : { status: 'success_no_output' };
    }
    if (r.state === 'fail') return { status: 'failed', reason: r.failMsg };
    return { status: 'pending' };
  }

  // LTX 2.3 Spicy (WaveSpeed) — marcador `ws:<getUrl>`.
  if (marker.startsWith('ws:')) {
    const r = await getSpicyVideo(marker.slice(3));
    if (r.state === 'success') {
      return r.url ? { status: 'success', url: r.url } : { status: 'success_no_output' };
    }
    if (r.state === 'fail') return { status: 'failed', reason: r.failMsg };
    return { status: 'pending' };
  }

  // ComfyDeploy (run:<id> ou id cru, por compatibilidade)
  const runId = marker.startsWith('run:') ? marker.slice(4) : marker;
  const run = await getRun(runId);
  if (run.status === 'success') {
    const url = run.outputs?.[0]?.data?.files?.[0]?.url;
    return url ? { status: 'success', url } : { status: 'success_no_output' };
  }
  if (run.status === 'failed' || run.status === 'cancelled' || run.status === 'timeout') {
    return { status: 'failed', reason: `Run ${run.status}` };
  }
  return { status: 'pending', progress: run.progress, liveStatus: run.live_status ?? null };
}
