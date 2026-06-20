-- ============================================================================
-- Cota grátis diária para COMPRADORES DO CURSO + liberação por e-mail
-- ----------------------------------------------------------------------------
-- Modelo de negócio:
--   * Quem compra o curso (webhook PerfectPay) ganha uma cota grátis DIÁRIA:
--       - 5 imagens Nano Banana Pro   (bucket 'nano_pro')
--       - 5 imagens Nano Banana 2     (bucket 'nano_v2')
--       - 2 imagens Replicate/NSFW    (bucket 'replicate')
--   * Janela ÚNICA por usuário: a 1ª geração grátis do dia abre a janela;
--     24h depois TUDO recarrega junto. O timer mostrado é window_start + 24h.
--   * Esgotou a cota -> a geração passa a custar créditos (não bloqueia).
--   * Cadastro normal (sem comprar o curso) NÃO tem cota grátis.
--
-- A liberação é por E-MAIL (course_entitlements). Funciona mesmo se o comprador
-- ainda não criou a conta: quando ele se cadastrar com o mesmo e-mail, a cota
-- passa a valer automaticamente (is_course_entitled cruza profiles.email).
--
-- Rode este arquivo no SQL Editor do Supabase (ou via `supabase db push`).
-- É reexecutável (idempotente).
-- ============================================================================

-- 1) Tabelas -----------------------------------------------------------------

-- E-mails liberados (vindos do webhook do curso). Chave = e-mail normalizado.
create table if not exists public.course_entitlements (
  email       text primary key,
  source      text,
  order_id    text,
  raw_payload jsonb,
  granted_at  timestamptz not null default now()
);

-- Estado da cota grátis por usuário (1 janela diária; contadores por bucket).
create table if not exists public.free_quota (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  window_start timestamptz,
  nano_pro     integer not null default 0,
  nano_v2      integer not null default 0,
  replicate    integer not null default 0,
  undress      integer not null default 0,
  edit         integer not null default 0,
  faceswap     integer not null default 0,
  updated_at   timestamptz not null default now()
);

-- Colunas adicionadas depois (installs que já rodaram a 1ª versão).
alter table public.free_quota add column if not exists undress  integer not null default 0;
alter table public.free_quota add column if not exists edit     integer not null default 0;
alter table public.free_quota add column if not exists faceswap integer not null default 0;

-- RLS: somente service-role (server actions / webhooks) mutam e leem.
-- Os clientes acessam a cota apenas via RPC SECURITY DEFINER abaixo.
alter table public.course_entitlements enable row level security;
alter table public.free_quota enable row level security;

-- 2) Entitlement -------------------------------------------------------------

-- True se o e-mail do usuário consta na lista de compradores do curso.
create or replace function public.is_course_entitled(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
      from public.profiles p
      join public.course_entitlements c on c.email = lower(p.email)
     where p.user_id = p_user_id
  );
$$;

-- Libera (ou re-libera) um e-mail. Chamado pelo webhook do curso.
create or replace function public.grant_course_entitlement(
  p_email   text,
  p_source  text default null,
  p_order_id text default null,
  p_payload jsonb default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_email is null or btrim(p_email) = '' then
    return;
  end if;
  insert into public.course_entitlements (email, source, order_id, raw_payload)
  values (lower(btrim(p_email)), p_source, p_order_id, p_payload)
  on conflict (email) do update
     set source      = excluded.source,
         order_id    = excluded.order_id,
         raw_payload = excluded.raw_payload,
         granted_at  = now();
end;
$$;

-- 3) Limites (fonte da verdade) ---------------------------------------------

create or replace function public.free_quota_limit(p_bucket text)
returns integer
language sql
immutable
as $$
  select case p_bucket
    when 'nano_pro'  then 5
    when 'nano_v2'   then 5
    when 'replicate' then 2
    when 'undress'   then 2
    when 'edit'      then 2
    when 'faceswap'  then 2
    else -1
  end;
$$;

-- 4) Consumir cota (atômico) -------------------------------------------------
-- Retorna jsonb: { allowed, reason?, bucket, used, limit, remaining, reset_at }
-- - Gate de entitlement embutido (só comprador do curso consome).
-- - Reseta a janela se expirou (>=24h) ou nunca abriu.
create or replace function public.consume_free_quota(p_user_id uuid, p_bucket text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limit int;
  v_used  int;
  v_now   timestamptz := now();
  q       public.free_quota%rowtype;
  v_reset timestamptz;
begin
  if not public.is_course_entitled(p_user_id) then
    return jsonb_build_object('allowed', false, 'reason', 'not_entitled');
  end if;

  v_limit := public.free_quota_limit(p_bucket);
  if v_limit < 0 then
    return jsonb_build_object('allowed', false, 'reason', 'invalid_bucket');
  end if;

  insert into public.free_quota (user_id) values (p_user_id)
    on conflict (user_id) do nothing;

  select * into q from public.free_quota where user_id = p_user_id for update;

  -- Janela expirada ou inexistente -> reseta contadores e reabre.
  if q.window_start is null or v_now - q.window_start >= interval '24 hours' then
    q.window_start := v_now;
    q.nano_pro := 0;
    q.nano_v2 := 0;
    q.replicate := 0;
    q.undress := 0;
    q.edit := 0;
    q.faceswap := 0;
  end if;

  v_reset := q.window_start + interval '24 hours';
  v_used := case p_bucket
    when 'nano_pro'  then q.nano_pro
    when 'nano_v2'   then q.nano_v2
    when 'replicate' then q.replicate
    when 'undress'   then q.undress
    when 'edit'      then q.edit
    when 'faceswap'  then q.faceswap
  end;

  if v_used >= v_limit then
    -- Persiste eventual reset (caso a janela tivesse acabado de virar).
    update public.free_quota
       set window_start = q.window_start,
           nano_pro = q.nano_pro, nano_v2 = q.nano_v2, replicate = q.replicate,
           undress = q.undress, edit = q.edit, faceswap = q.faceswap,
           updated_at = v_now
     where user_id = p_user_id;
    return jsonb_build_object(
      'allowed', false, 'reason', 'exhausted', 'bucket', p_bucket,
      'used', v_used, 'limit', v_limit, 'remaining', 0, 'reset_at', v_reset
    );
  end if;

  if p_bucket = 'nano_pro' then
    q.nano_pro := q.nano_pro + 1;
  elsif p_bucket = 'nano_v2' then
    q.nano_v2 := q.nano_v2 + 1;
  elsif p_bucket = 'replicate' then
    q.replicate := q.replicate + 1;
  elsif p_bucket = 'undress' then
    q.undress := q.undress + 1;
  elsif p_bucket = 'edit' then
    q.edit := q.edit + 1;
  else
    q.faceswap := q.faceswap + 1;
  end if;

  update public.free_quota
     set window_start = q.window_start,
         nano_pro = q.nano_pro, nano_v2 = q.nano_v2, replicate = q.replicate,
         undress = q.undress, edit = q.edit, faceswap = q.faceswap,
         updated_at = v_now
   where user_id = p_user_id;

  v_used := v_used + 1;
  return jsonb_build_object(
    'allowed', true, 'bucket', p_bucket,
    'used', v_used, 'limit', v_limit, 'remaining', v_limit - v_used,
    'reset_at', v_reset
  );
end;
$$;

-- 5) Devolver cota (em caso de falha na geração) -----------------------------
create or replace function public.refund_free_quota(p_user_id uuid, p_bucket text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  q     public.free_quota%rowtype;
begin
  select * into q from public.free_quota where user_id = p_user_id for update;
  if not found then return; end if;
  -- Só devolve dentro da janela ativa (senão já resetou de qualquer forma).
  if q.window_start is null or v_now - q.window_start >= interval '24 hours' then
    return;
  end if;
  if p_bucket = 'nano_pro' then
    update public.free_quota set nano_pro = greatest(0, nano_pro - 1), updated_at = v_now
     where user_id = p_user_id;
  elsif p_bucket = 'nano_v2' then
    update public.free_quota set nano_v2 = greatest(0, nano_v2 - 1), updated_at = v_now
     where user_id = p_user_id;
  elsif p_bucket = 'replicate' then
    update public.free_quota set replicate = greatest(0, replicate - 1), updated_at = v_now
     where user_id = p_user_id;
  elsif p_bucket = 'undress' then
    update public.free_quota set undress = greatest(0, undress - 1), updated_at = v_now
     where user_id = p_user_id;
  elsif p_bucket = 'edit' then
    update public.free_quota set edit = greatest(0, edit - 1), updated_at = v_now
     where user_id = p_user_id;
  elsif p_bucket = 'faceswap' then
    update public.free_quota set faceswap = greatest(0, faceswap - 1), updated_at = v_now
     where user_id = p_user_id;
  end if;
end;
$$;

-- 6) Ler cota (somente leitura, p/ UI) --------------------------------------
-- Retorna { entitled:false } OU
--         { entitled:true, reset_at, buckets:{ nano_pro:{used,limit,remaining}, ... } }
create or replace function public.get_free_quota(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  q       public.free_quota%rowtype;
  v_now   timestamptz := now();
  pro int := 0; v2 int := 0; rep int := 0;
  und int := 0; edt int := 0; fsw int := 0;
  v_reset timestamptz := null;
begin
  if not public.is_course_entitled(p_user_id) then
    return jsonb_build_object('entitled', false);
  end if;

  select * into q from public.free_quota where user_id = p_user_id;
  if found and q.window_start is not null and v_now - q.window_start < interval '24 hours' then
    pro := q.nano_pro; v2 := q.nano_v2; rep := q.replicate;
    und := q.undress; edt := q.edit; fsw := q.faceswap;
    v_reset := q.window_start + interval '24 hours';
  end if;

  return jsonb_build_object(
    'entitled', true,
    'reset_at', v_reset,
    'buckets', jsonb_build_object(
      'nano_pro',  jsonb_build_object('used', pro, 'limit', 5, 'remaining', greatest(0, 5 - pro)),
      'nano_v2',   jsonb_build_object('used', v2,  'limit', 5, 'remaining', greatest(0, 5 - v2)),
      'replicate', jsonb_build_object('used', rep, 'limit', 2, 'remaining', greatest(0, 2 - rep)),
      'undress',   jsonb_build_object('used', und, 'limit', 2, 'remaining', greatest(0, 2 - und)),
      'edit',      jsonb_build_object('used', edt, 'limit', 2, 'remaining', greatest(0, 2 - edt)),
      'faceswap',  jsonb_build_object('used', fsw, 'limit', 2, 'remaining', greatest(0, 2 - fsw))
    )
  );
end;
$$;

-- 7) Admin: liberar a cota grátis COMPLETA para um usuário (manual) ----------
-- Equivale a "dar todas as gerações grátis de uma vez": marca o e-mail do
-- usuário como comprador (entitlement, idempotente) e reabre a janela de 24h
-- com TODOS os contadores zerados -> cota cheia disponível na hora
-- (5 nano_pro, 5 nano_v2, 2 replicate, 2 undress, 2 edit, 2 faceswap).
create or replace function public.admin_grant_full_free_quota(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
  v_now   timestamptz := now();
begin
  select lower(btrim(email)) into v_email
    from public.profiles where user_id = p_user_id;
  if v_email is null or v_email = '' then
    return jsonb_build_object('ok', false, 'reason', 'no_email');
  end if;

  -- Libera o e-mail (idempotente) para destravar a cota diária.
  insert into public.course_entitlements (email, source)
  values (v_email, 'admin-manual')
  on conflict (email) do update
     set source = 'admin-manual', granted_at = now();

  -- Reabre a janela zerando os contadores (cota cheia agora).
  insert into public.free_quota (user_id, window_start)
  values (p_user_id, v_now)
  on conflict (user_id) do update
     set window_start = v_now,
         nano_pro = 0, nano_v2 = 0, replicate = 0,
         undress = 0, edit = 0, faceswap = 0,
         updated_at = v_now;

  return jsonb_build_object('ok', true, 'email', v_email);
end;
$$;
