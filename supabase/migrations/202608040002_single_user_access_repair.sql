-- Garantiza la fila de configuración y asigna la única cuenta Auth existente.
begin;

do $$
begin
  if (select count(*) from auth.users) <> 1 then
    raise exception 'Se esperaba exactamente una cuenta Auth para reparar el acceso';
  end if;
end;
$$;

insert into public.lab_settings(
  id,
  legal_name,
  trade_name,
  timezone,
  authorized_user_id
)
select
  true,
  'PENDIENTE DE CONFIGURAR',
  'Laboratorio José',
  'America/Lima',
  id
from auth.users
on conflict (id) do update
set authorized_user_id = excluded.authorized_user_id,
    updated_at = now();

commit;
