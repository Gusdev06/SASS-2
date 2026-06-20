-- ============================================================================
-- Admin por banco de dados (substitui o gate só-por-env ADMIN_EMAIL)
-- ----------------------------------------------------------------------------
-- A flag `profiles.is_admin` é a fonte de verdade. Vários usuários podem ser
-- admin ao mesmo tempo. O ADMIN_EMAIL no .env continua valendo apenas como
-- "break-glass" (bootstrap), pra você nunca se trancar pra fora.
--
-- Rode no SQL Editor do Supabase (ou `supabase db push`). É idempotente.
-- ============================================================================

alter table public.profiles add column if not exists is_admin boolean not null default false;
create index if not exists profiles_admin_idx on public.profiles(is_admin) where is_admin = true;

-- Bootstrap: promove o(s) e-mail(s) abaixo a admin. Edite a lista conforme
-- necessário (ou faça tudo pela tela /admin/users depois do primeiro admin).
update public.profiles
   set is_admin = true, updated_at = now()
 where lower(email) in (
   'gustavoapple109@gmail.com'
 );
