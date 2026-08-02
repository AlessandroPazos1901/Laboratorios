-- Soporte local-first: equipos autorizados, idempotencia y control de conflictos.
begin;

alter table public.patients
  add column if not exists sync_version integer not null default 1;

create table if not exists public.offline_devices (
  id uuid primary key,
  user_id uuid not null references public.profiles(id) on delete restrict,
  name text not null check (char_length(trim(name)) between 2 and 80),
  authorized_at timestamptz not null default now(),
  lease_expires_at timestamptz not null,
  last_seen_at timestamptz not null default now(),
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists offline_devices_user_idx
  on public.offline_devices(user_id, revoked_at, lease_expires_at desc);

create table if not exists public.offline_mutation_receipts (
  mutation_id uuid primary key,
  device_id uuid not null references public.offline_devices(id) on delete restrict,
  user_id uuid not null references public.profiles(id) on delete restrict,
  operation_kind text not null,
  response jsonb not null,
  applied_at timestamptz not null default now()
);

create table if not exists public.sync_change_log (
  sequence bigint generated always as identity primary key,
  entity_type text not null,
  entity_id uuid not null,
  changed_at timestamptz not null default now()
);

create index if not exists sync_change_log_changed_idx
  on public.sync_change_log(changed_at, sequence);

create or replace function public.bump_patient_sync_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.sync_version := old.sync_version + 1;
  return new;
end;
$$;

drop trigger if exists patients_bump_sync_version on public.patients;
create trigger patients_bump_sync_version
before update on public.patients
for each row execute function public.bump_patient_sync_version();

create or replace function public.capture_sync_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.sync_change_log(entity_type, entity_id)
  values (tg_table_name, new.id);
  return new;
end;
$$;

drop trigger if exists patients_capture_sync_change on public.patients;
create trigger patients_capture_sync_change after insert or update on public.patients
for each row execute function public.capture_sync_change();
drop trigger if exists orders_capture_sync_change on public.orders;
create trigger orders_capture_sync_change after insert or update on public.orders
for each row execute function public.capture_sync_change();
drop trigger if exists order_analyses_capture_sync_change on public.order_analyses;
create trigger order_analyses_capture_sync_change after insert or update on public.order_analyses
for each row execute function public.capture_sync_change();
drop trigger if exists result_revisions_capture_sync_change on public.result_revisions;
create trigger result_revisions_capture_sync_change after insert or update on public.result_revisions
for each row execute function public.capture_sync_change();
drop trigger if exists result_values_capture_sync_change on public.result_values;
create trigger result_values_capture_sync_change after insert or update on public.result_values
for each row execute function public.capture_sync_change();

alter table public.offline_devices enable row level security;
alter table public.offline_mutation_receipts enable row level security;
alter table public.sync_change_log enable row level security;

drop policy if exists offline_devices_own_read on public.offline_devices;
create policy offline_devices_own_read on public.offline_devices
for select using (user_id = auth.uid() and public.current_profile_is_active());
drop policy if exists offline_devices_own_insert on public.offline_devices;
create policy offline_devices_own_insert on public.offline_devices
for insert with check (user_id = auth.uid() and public.current_profile_is_active());
drop policy if exists offline_devices_own_update on public.offline_devices;
create policy offline_devices_own_update on public.offline_devices
for update using (user_id = auth.uid() and public.current_profile_is_active())
with check (user_id = auth.uid() and public.current_profile_is_active());
drop policy if exists sync_change_log_staff_read on public.sync_change_log;
create policy sync_change_log_staff_read on public.sync_change_log
for select using (public.current_profile_is_active());

revoke all on public.offline_devices, public.offline_mutation_receipts, public.sync_change_log
  from public, anon;
grant select, insert, update on public.offline_devices to authenticated;
grant select on public.sync_change_log to authenticated;

create or replace function public.apply_offline_operation(
  target_device uuid,
  target_mutation uuid,
  operation_kind text,
  operation_payload jsonb,
  base_version integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  prior_response jsonb;
  response jsonb;
  saved_patient public.patients;
  current_patient public.patients;
  target_patient_id uuid;
  register_response jsonb;
  save_response jsonb;
  current_order public.orders;
  target_revision uuid;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if not exists (
    select 1 from public.offline_devices d
    where d.id = target_device
      and d.user_id = auth.uid()
      and d.revoked_at is null
      and d.lease_expires_at > now()
  ) then raise exception 'offline_device_not_authorized'; end if;

  select receipt.response into prior_response
  from public.offline_mutation_receipts receipt
  where receipt.mutation_id = target_mutation;
  if prior_response is not null then return prior_response; end if;

  if operation_kind = 'patient.upsert' then
    select * into current_patient
    from public.patients
    where document_type = 'DNI'
      and document_number = trim(operation_payload->>'documentNumber')
      and archived_at is null
    for update;

    if current_patient.id is not null then
      if (
        nullif(trim(operation_payload->>'fullName'), '') is not null
        and current_patient.full_name is distinct from trim(operation_payload->>'fullName')
      ) or (
        nullif(operation_payload->>'birthAt', '') is not null
        and current_patient.birth_at is distinct from (operation_payload->>'birthAt')::timestamptz
      ) or (
        nullif(operation_payload->>'sex', '') is not null
        and current_patient.sex is distinct from operation_payload->>'sex'
      ) then
        response := jsonb_build_object(
          'clientMutationId', target_mutation,
          'status', 'conflict',
          'conflict', jsonb_build_object(
            'clientMutationId', target_mutation,
            'kind', operation_kind,
            'reason', 'patient_demographics_changed',
            'local', operation_payload,
            'remote', jsonb_build_object(
              'id', current_patient.id,
              'documentNumber', current_patient.document_number,
              'fullName', current_patient.full_name,
              'birthAt', current_patient.birth_at,
              'sex', current_patient.sex,
              'phone', current_patient.phone
            ),
            'remoteVersion', current_patient.sync_version
          )
        );
      else
        response := jsonb_build_object(
          'clientMutationId', target_mutation,
          'status', 'applied',
          'serverRefs', jsonb_build_object('patientId', current_patient.id, 'syncVersion', current_patient.sync_version)
        );
      end if;
    elsif nullif(operation_payload->>'birthAt', '') is not null then
      saved_patient := public.upsert_patient_with_demographics(
        operation_payload->>'documentNumber',
        operation_payload->>'fullName',
        (operation_payload->>'birthAt')::timestamptz,
        operation_payload->>'sex'
      );
      if nullif(trim(operation_payload->>'phone'), '') is not null then
        saved_patient := public.update_patient_details(
          saved_patient.id, saved_patient.full_name, saved_patient.birth_at,
          saved_patient.sex, operation_payload->>'phone'
        );
      end if;
      response := jsonb_build_object(
        'clientMutationId', target_mutation,
        'status', 'applied',
        'serverRefs', jsonb_build_object('patientId', saved_patient.id, 'syncVersion', saved_patient.sync_version)
      );
    else
      saved_patient := public.upsert_simple_patient(
        operation_payload->>'documentNumber', operation_payload->>'fullName'
      );
      response := jsonb_build_object(
        'clientMutationId', target_mutation,
        'status', 'applied',
        'serverRefs', jsonb_build_object('patientId', saved_patient.id, 'syncVersion', saved_patient.sync_version)
      );
    end if;

  elsif operation_kind = 'patient.update' then
    select * into current_patient
    from public.patients
    where id = (operation_payload->>'patientId')::uuid and archived_at is null
    for update;
    if current_patient.id is null then raise exception 'patient_not_found'; end if;
    if base_version is null or current_patient.sync_version <> base_version then
      response := jsonb_build_object(
        'clientMutationId', target_mutation,
        'status', 'conflict',
        'conflict', jsonb_build_object(
          'clientMutationId', target_mutation,
          'kind', operation_kind,
          'reason', 'patient_concurrent_change',
          'local', operation_payload,
          'remote', jsonb_build_object(
            'id', current_patient.id,
            'documentNumber', current_patient.document_number,
            'fullName', current_patient.full_name,
            'birthAt', current_patient.birth_at,
            'sex', current_patient.sex,
            'phone', current_patient.phone
          ),
          'remoteVersion', current_patient.sync_version
        )
      );
    else
      saved_patient := public.update_patient_details(
        current_patient.id,
        operation_payload->>'fullName',
        (operation_payload->>'birthAt')::timestamptz,
        operation_payload->>'sex',
        operation_payload->>'phone'
      );
      response := jsonb_build_object(
        'clientMutationId', target_mutation,
        'status', 'applied',
        'serverRefs', jsonb_build_object('patientId', saved_patient.id, 'syncVersion', saved_patient.sync_version)
      );
    end if;

  elsif operation_kind = 'analysis.register' then
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

  elsif operation_kind = 'results.save' then
    target_revision := (operation_payload->>'targetRevision')::uuid;
    begin
      save_response := public.save_result_batch(
        target_revision,
        operation_payload->'resultEntries',
        coalesce(base_version, (operation_payload->>'expectedLockVersion')::integer)
      );
      response := jsonb_build_object(
        'clientMutationId', target_mutation,
        'status', 'applied',
        'serverRefs', save_response
      );
    exception when others then
      if sqlerrm = 'concurrent_change' then
        select o.* into current_order
        from public.orders o
        join public.result_revisions rr on rr.order_id = o.id
        where rr.id = target_revision;
        response := jsonb_build_object(
          'clientMutationId', target_mutation,
          'status', 'conflict',
          'conflict', jsonb_build_object(
            'clientMutationId', target_mutation,
            'kind', operation_kind,
            'reason', 'result_concurrent_change',
            'local', operation_payload,
            'remote', jsonb_build_object('orderId', current_order.id, 'lockVersion', current_order.lock_version),
            'remoteVersion', current_order.lock_version
          )
        );
      else
        raise;
      end if;
    end;
  else
    raise exception 'unsupported_offline_operation';
  end if;

  insert into public.offline_mutation_receipts(
    mutation_id, device_id, user_id, operation_kind, response
  ) values (
    target_mutation, target_device, auth.uid(), operation_kind, response
  );
  update public.offline_devices set last_seen_at = now() where id = target_device;
  return response;
end;
$$;

revoke all on function public.apply_offline_operation(uuid,uuid,text,jsonb,integer)
  from public, anon;
grant execute on function public.apply_offline_operation(uuid,uuid,text,jsonb,integer)
  to authenticated;

notify pgrst, 'reload schema';
commit;
