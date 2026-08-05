-- Separa la cuenta técnica compartida de la identidad clínica del analista.
begin;

create table public.analysts (
  id uuid primary key default gen_random_uuid(),
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  active boolean not null default true,
  legacy_profile_id uuid unique references public.profiles(id) on delete set null,
  created_by uuid not null references public.profiles(id) on delete restrict,
  updated_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into public.analysts(full_name, legacy_profile_id, created_by, updated_by)
select trim(p.full_name), p.id, p.id, p.id
from public.profiles p
where p.active
  and not exists (select 1 from public.analysts a where a.legacy_profile_id = p.id);

alter table public.order_analyses
  add column analyst_id uuid references public.analysts(id) on delete restrict;

update public.order_analyses oa
set analyst_id = a.id
from public.analysts a
where a.legacy_profile_id = oa.performed_by
  and oa.analyst_id is null;

-- Cubre instalaciones históricas donde el ejecutor ya no tiene perfil activo.
insert into public.analysts(full_name, legacy_profile_id, created_by, updated_by, active)
select trim(p.full_name), p.id, p.id, p.id, false
from public.profiles p
where exists (
  select 1 from public.order_analyses oa
  where oa.performed_by = p.id and oa.analyst_id is null
)
and not exists (select 1 from public.analysts a where a.legacy_profile_id = p.id);

update public.order_analyses oa
set analyst_id = a.id
from public.analysts a
where a.legacy_profile_id = oa.performed_by
  and oa.analyst_id is null;

alter table public.order_analyses alter column analyst_id set not null;
create index order_analyses_analyst_idx on public.order_analyses(analyst_id);
create unique index analysts_full_name_active_uidx
  on public.analysts(lower(trim(full_name))) where active;

create trigger analysts_touch before update on public.analysts
for each row execute function public.touch_updated_at();

create or replace function public.assign_order_analysis_analyst()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_analyst uuid;
begin
  selected_analyst := nullif(current_setting('app.selected_analyst_id', true), '')::uuid;
  new.analyst_id := coalesce(new.analyst_id, selected_analyst);
  if new.analyst_id is null then raise exception 'analyst_required'; end if;
  if not exists (select 1 from public.analysts where id = new.analyst_id and active) then
    raise exception 'analyst_inactive_or_missing';
  end if;
  return new;
end;
$$;

drop trigger if exists order_analyses_assign_analyst on public.order_analyses;
create trigger order_analyses_assign_analyst
before insert on public.order_analyses
for each row execute function public.assign_order_analysis_analyst();

-- Conserva intacta la implementación clínica existente y coloca delante una
-- validación obligatoria del analista. Los campos extra del JSON son ignorados
-- por el núcleo anterior y permiten que la cola offline use el mismo contrato.
alter function public.register_daily_analyses(uuid, jsonb, timestamptz)
  rename to register_daily_analyses_core;

create function public.register_daily_analyses(
  target_patient uuid,
  result_entries jsonb,
  occurred_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  selected_analyst uuid;
  analyst_count integer;
begin
  if jsonb_typeof(result_entries) <> 'array' or jsonb_array_length(result_entries) = 0 then
    raise exception 'analyses_required';
  end if;

  select count(distinct nullif(value->>'analyst_id', '')),
         max(nullif(value->>'analyst_id', ''))::uuid
  into analyst_count, selected_analyst
  from jsonb_array_elements(result_entries);

  if analyst_count = 0 then
    select id into selected_analyst
    from public.analysts
    where active and legacy_profile_id = auth.uid();
    if selected_analyst is null and (select count(*) from public.analysts where active) = 1 then
      select id into selected_analyst from public.analysts where active limit 1;
    end if;
  end if;
  if analyst_count > 1 or selected_analyst is null then raise exception 'analyst_required'; end if;
  if analyst_count > 0 and exists (
    select 1 from jsonb_array_elements(result_entries)
    where nullif(value->>'analyst_id', '')::uuid is distinct from selected_analyst
  ) then raise exception 'mixed_analysts_not_allowed'; end if;
  if not exists (select 1 from public.analysts where id = selected_analyst and active) then
    raise exception 'analyst_inactive_or_missing';
  end if;

  perform set_config('app.selected_analyst_id', selected_analyst::text, true);
  return public.register_daily_analyses_core(target_patient, result_entries, occurred_at);
end;
$$;

revoke all on function public.register_daily_analyses_core(uuid, jsonb, timestamptz)
  from public, anon, authenticated;
revoke all on function public.register_daily_analyses(uuid, jsonb, timestamptz)
  from public, anon;
grant execute on function public.register_daily_analyses(uuid, jsonb, timestamptz)
  to authenticated;

create function public.apply_offline_analysis_registration(
  target_device uuid,
  target_mutation uuid,
  operation_payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prior_response jsonb;
  response jsonb;
  target_patient_id uuid;
  register_response jsonb;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if not exists (
    select 1 from public.offline_devices d
    where d.id = target_device and d.user_id = auth.uid()
      and d.revoked_at is null and d.lease_expires_at > now()
  ) then raise exception 'offline_device_not_authorized'; end if;

  select receipt.response into prior_response
  from public.offline_mutation_receipts receipt
  where receipt.mutation_id = target_mutation;
  if prior_response is not null then return prior_response; end if;

  select id into target_patient_id
  from public.patients
  where document_type = 'DNI'
    and document_number = operation_payload->>'patientDocumentNumber'
    and archived_at is null;
  if target_patient_id is null then raise exception 'patient_dependency_pending'; end if;

  register_response := public.register_daily_analyses(
    target_patient_id,
    operation_payload->'resultEntries',
    (operation_payload->>'occurredAt')::timestamptz
  );
  response := jsonb_build_object(
    'clientMutationId', target_mutation,
    'status', 'applied',
    'serverRefs', register_response
  );
  insert into public.offline_mutation_receipts(
    mutation_id, device_id, user_id, operation_kind, response
  ) values (target_mutation, target_device, auth.uid(), 'analysis.register', response);
  update public.offline_devices set last_seen_at = now() where id = target_device;
  return response;
end;
$$;

revoke all on function public.apply_offline_analysis_registration(uuid, uuid, jsonb)
  from public, anon;
grant execute on function public.apply_offline_analysis_registration(uuid, uuid, jsonb)
  to authenticated;

create or replace function public.create_analyst(analyst_name text)
returns public.analysts
language plpgsql
security definer
set search_path = public
as $$
declare saved public.analysts;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if char_length(trim(coalesce(analyst_name, ''))) < 2 then raise exception 'analyst_name_required'; end if;
  insert into public.analysts(full_name, created_by, updated_by)
  values(trim(analyst_name), auth.uid(), auth.uid())
  returning * into saved;
  return saved;
end;
$$;

create or replace function public.set_analyst_active(target_analyst uuid, analyst_active boolean)
returns public.analysts
language plpgsql
security definer
set search_path = public
as $$
declare saved public.analysts;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  lock table public.analysts in share row exclusive mode;
  if not exists (select 1 from public.analysts where id = target_analyst) then
    raise exception 'analyst_not_found';
  end if;
  if not analyst_active and (
    select count(*) from public.analysts where active and id <> target_analyst
  ) = 0 then raise exception 'at_least_one_active_analyst_required'; end if;
  update public.analysts
  set active = analyst_active, updated_by = auth.uid()
  where id = target_analyst
  returning * into saved;
  return saved;
end;
$$;

alter table public.analysts enable row level security;
create policy analysts_staff_read on public.analysts
for select using (public.current_profile_is_active());
revoke all on public.analysts from public, anon;
grant select on public.analysts to authenticated;
revoke all on function public.create_analyst(text) from public, anon;
revoke all on function public.set_analyst_active(uuid, boolean) from public, anon;
grant execute on function public.create_analyst(text) to authenticated;
grant execute on function public.set_analyst_active(uuid, boolean) to authenticated;

drop trigger if exists analysts_capture_sync_change on public.analysts;
create trigger analysts_capture_sync_change after insert or update on public.analysts
for each row execute function public.capture_sync_change();

comment on table public.analysts is
  'Identidades clínicas seleccionables; no son cuentas de acceso a Supabase Auth.';
comment on column public.order_analyses.performed_by is
  'Cuenta técnica autenticada que ejecutó la operación.';
comment on column public.order_analyses.analyst_id is
  'Analista clínico seleccionado como ejecutor del análisis.';

commit;
