-- Cron: reconciliação de vídeos travados (substitui o cron da Vercel)
-- Roda a cada 5 min e faz GET no endpoint Next, autenticado via CRON_SECRET.
-- Rode este arquivo no SQL Editor do Supabase.
--
-- PRÉ-REQUISITOS (uma vez):
--   1. Database → Extensions: habilitar `pg_cron` e `pg_net` (ou os CREATE EXTENSION abaixo).
--   2. O mesmo CRON_SECRET do .env.local precisa estar nas envs de PRODUÇÃO da Vercel.

-- 1) Extensões -------------------------------------------------------------
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2) Guarda o segredo no Vault (não fica legível na tabela de cron) ---------
-- Cole o valor do CRON_SECRET (o mesmo do .env.local, 64 chars) no lugar do placeholder.
-- Reexecutável: atualiza se já existir.
do $$
declare
  v_secret text := '09ac855f0f311b742b9ea198ba1b28c89c3c61d7fc6b0dd16d4b7a70c4f846c9s';
begin
  if exists (select 1 from vault.secrets where name = 'cron_secret') then
    perform vault.update_secret(
      (select id from vault.secrets where name = 'cron_secret'),
      v_secret
    );
  else
    perform vault.create_secret(v_secret, 'cron_secret');
  end if;
end $$;

-- 3) Agenda o job ----------------------------------------------------------
-- Remove agendamento anterior (se existir) pra evitar duplicata.
select cron.unschedule('sweep-stale-videos')
where exists (select 1 from cron.job where jobname = 'sweep-stale-videos');

select cron.schedule(
  'sweep-stale-videos',
  '*/5 * * * *',
  $$
  select net.http_get(
    url     := 'https://gozainfluencer.vercel.app/api/cron/sweep-stale-videos',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    )
  );
  $$
);

-- 4) Conferir (opcional) ---------------------------------------------------
-- select * from cron.job where jobname = 'sweep-stale-videos';
-- select * from cron.job_run_details order by start_time desc limit 10;
