-- Ingreso por nombre de usuario en lugar de correo.
--
-- Sigue habiendo una sola cuenta de Supabase (`lab_settings.authorized_user_id`).
-- Lo único que cambia es cómo la nombra el personal al entrar: un usuario corto
-- en vez de una dirección de correo, que nadie recuerda y se escribe mal.

alter table public.lab_settings
  add column if not exists login_username text;

comment on column public.lab_settings.login_username is
  'Nombre de usuario con el que el personal ingresa. Resuelve al correo de la cuenta compartida.';

-- Sembrado: la parte local del correo de la cuenta autorizada. Para cambiarlo:
--   update public.lab_settings set login_username = 'laboratorio';
update public.lab_settings s
   set login_username = split_part(u.email, '@', 1)
  from auth.users u
 where u.id = s.authorized_user_id
   and nullif(trim(coalesce(s.login_username, '')), '') is null;

alter table public.lab_settings
  add constraint lab_settings_login_username_format
  check (login_username is null or login_username ~ '^[a-zA-Z0-9._-]{3,40}$');

create unique index if not exists lab_settings_login_username_uidx
  on public.lab_settings (lower(login_username))
  where login_username is not null;

-- El navegador necesita el correo para `signInWithPassword`, y en la pantalla de
-- ingreso todavía no hay sesión: por eso es `security definer` y accesible a
-- `anon`. Solo responde ante una coincidencia exacta del usuario configurado; no
-- permite enumerar cuentas porque únicamente existe una.
create or replace function public.email_for_login(candidate text)
returns text
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.email
    from public.lab_settings s
    join auth.users u on u.id = s.authorized_user_id
   where lower(s.login_username) = lower(trim(candidate))
   limit 1;
$$;

revoke all on function public.email_for_login(text) from public;
grant execute on function public.email_for_login(text) to anon, authenticated;
