import { NextResponse, type NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { createServiceClient } from '@/lib/supabase/server';

/**
 * Webhook DEDICADO da compra do CURSO na PerfectPay.
 *
 * Configure esta URL no webhook DO PRODUTO DO CURSO na PerfectPay. Como é uma
 * rota exclusiva do curso, toda venda APROVADA que chega aqui = comprador do
 * curso → liberamos a cota grátis diária por e-mail (não credita nada).
 *
 * O crédito (pacotes) continua no webhook separado /api/webhooks/perfectpay.
 *
 * Token: usa PERFECTPAY_COURSE_WEBHOOK_TOKEN se definido; senão cai no mesmo
 * PERFECTPAY_WEBHOOK_TOKEN do webhook de créditos (mesma conta PerfectPay).
 */

type PerfectPayPayload = {
  token?: string;
  code?: string;
  sale_amount?: number;
  sale_status_enum?: number;
  product?: { code?: string; name?: string };
  plan?: { code?: string; name?: string };
  customer?: { email?: string; full_name?: string };
};

const APPROVED = 2;

function safeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export async function POST(req: NextRequest) {
  const raw = await req.text();
  let payload: PerfectPayPayload;
  try {
    payload = JSON.parse(raw) as PerfectPayPayload;
  } catch {
    return NextResponse.json({ error: 'invalid json' }, { status: 400 });
  }

  const expected =
    process.env.PERFECTPAY_COURSE_WEBHOOK_TOKEN || process.env.PERFECTPAY_WEBHOOK_TOKEN;
  if (!expected) {
    console.error('[perfectpay-course] webhook token não configurado — rejeitando');
    return NextResponse.json({ error: 'misconfigured' }, { status: 500 });
  }
  if (typeof payload.token !== 'string' || !safeEqualStr(payload.token, expected)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const orderId = payload.code;
  if (!orderId) return NextResponse.json({ ok: false, body: 'no order id' });
  if (payload.sale_status_enum !== APPROVED) {
    return NextResponse.json({ ok: false, body: 'not approved' });
  }

  const email = payload.customer?.email ?? null;
  const service = createServiceClient();

  // Idempotência: o mesmo order_id não libera duas vezes.
  const { data: existing } = await service
    .from('processed_orders')
    .select('order_id')
    .eq('order_id', orderId)
    .maybeSingle();
  if (existing) return NextResponse.json({ ok: true, body: 'duplicate' });

  const { error: insErr } = await service.from('processed_orders').insert({
    order_id: orderId,
    user_id: null,
    pkg_id: 'course',
    credits: 0,
    amount: payload.sale_amount ?? 0,
    raw_payload: payload,
  });
  if (insErr) {
    console.error('[perfectpay-course] insert order falhou:', insErr);
    return NextResponse.json({ error: 'db error' }, { status: 500 });
  }

  if (!email) {
    console.warn(`[perfectpay-course] venda sem e-mail order=${orderId}`);
    return NextResponse.json({ ok: true, body: 'no email' });
  }

  const { error: grantErr } = await service.rpc('grant_course_entitlement', {
    p_email: email,
    p_source: 'perfectpay-course',
    p_order_id: orderId,
    p_payload: payload,
  });
  if (grantErr) {
    console.error('[perfectpay-course] grant_course_entitlement falhou:', grantErr);
    return NextResponse.json({ error: 'grant error' }, { status: 500 });
  }

  console.log(`[perfectpay-course] CURSO liberado email=${email} order=${orderId}`);
  return NextResponse.json({ ok: true });
}
