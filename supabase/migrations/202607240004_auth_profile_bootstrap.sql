-- Sincroniza Auth con public.profiles y crea la configuración inicial.
-- El primer usuario existente queda como owner; los siguientes, como staff.
begin;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare assigned_role public.app_role;
begin
  assigned_role := case
    when exists (select 1 from public.profiles where role='owner') then 'staff'::public.app_role
    else 'owner'::public.app_role
  end;

  insert into public.profiles(id,full_name,role,active)
  values(
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'),''),
      nullif(split_part(coalesce(new.email,''),'@',1),''),
      'Usuario del laboratorio'
    ),
    assigned_role,
    true
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

-- Sincroniza usuarios que se crearon antes de instalar el trigger.
insert into public.profiles(id,full_name,role,active)
select
  u.id,
  coalesce(
    nullif(trim(u.raw_user_meta_data->>'full_name'),''),
    nullif(split_part(coalesce(u.email,''),'@',1),''),
    'Usuario del laboratorio'
  ),
  'staff'::public.app_role,
  true
from auth.users u
where not exists(select 1 from public.profiles p where p.id=u.id)
on conflict (id) do nothing;

-- Garantiza al menos una cuenta propietaria inicial.
do $$
declare first_user uuid;
begin
  if not exists(select 1 from public.profiles where role='owner') then
    select p.id into first_user
    from public.profiles p
    join auth.users u on u.id=p.id
    where p.active
    order by u.created_at, p.created_at
    limit 1;

    if first_user is not null then
      update public.profiles set role='owner',updated_at=now() where id=first_user;
    end if;
  end if;
end;
$$;

insert into public.lab_settings(id,legal_name,trade_name,timezone)
values(true,'PENDIENTE DE CONFIGURAR','Laboratorio José','America/Lima')
on conflict (id) do nothing;

commit;
