-- Simplifica pacientes: el DNI numerico es la clave primaria y la cuenta Auth es unica.
begin;

-- Detener escrituras si existen documentos que no pueden convertirse sin perdida.
do $$
begin
  if exists (
    select 1 from public.patients
    where document_type <> 'DNI' or document_number !~ '^[0-9]{8}$'
  ) then
    raise exception 'patients_require_eight_digit_dni';
  end if;
  if exists (
    select document_number::integer
    from public.patients
    group by document_number::integer
    having count(*) > 1
  ) then
    raise exception 'duplicate_numeric_patient_dni';
  end if;
end;
$$;

-- Las firmas UUID y las funciones que leen columnas eliminadas se reemplazan abajo.
drop function if exists public.search_patients(text, integer);
drop function if exists public.upsert_patient(jsonb);
drop function if exists public.upsert_simple_patient(text, text);
drop function if exists public.upsert_import_patient(text, text, date, text, jsonb);
drop function if exists public.upsert_patient_with_demographics(text, text, timestamptz, text);
drop function if exists public.update_patient_details(uuid, text, timestamptz, text, text);
drop function if exists public.create_order(uuid, uuid[], text);
drop function if exists public.create_simple_order(uuid, uuid[], timestamptz);
drop function if exists public.get_patient_trend(uuid, uuid);
drop function if exists public.register_daily_analyses(uuid, jsonb, timestamptz);
drop function if exists public.register_daily_analyses_core(uuid, jsonb, timestamptz);
drop function if exists public.commit_patient_import(uuid);

drop trigger if exists patients_touch on public.patients;
drop trigger if exists patients_bump_sync_version on public.patients;
drop trigger if exists patients_capture_sync_change on public.patients;

create temporary table patient_id_migration_map(
  old_id uuid primary key,
  new_id integer not null unique
) on commit drop;

insert into patient_id_migration_map(old_id, new_id)
select id, document_number::integer from public.patients;

alter table public.patients add column dni_id integer;
update public.patients p
set dni_id = map.new_id
from patient_id_migration_map map
where map.old_id = p.id;
alter table public.patients alter column dni_id set not null;

alter table public.orders add column patient_dni integer;
update public.orders o
set patient_dni = map.new_id
from patient_id_migration_map map
where map.old_id = o.patient_id;
alter table public.orders alter column patient_dni set not null;

alter table public.orders drop constraint if exists orders_patient_id_fkey;
alter table public.patients drop constraint if exists patients_pkey;
alter table public.orders drop column patient_id;
alter table public.orders rename column patient_dni to patient_id;
alter table public.patients drop column id;
alter table public.patients rename column dni_id to id;

alter table public.patients
  add constraint patients_pkey primary key (id),
  add constraint patients_dni_range check (id between 0 and 99999999);
alter table public.orders
  add constraint orders_patient_id_fkey foreign key (patient_id)
  references public.patients(id) on delete restrict;
create index if not exists orders_patient_date_idx
  on public.orders(patient_id, ordered_at desc);

-- IDs mixtos (UUID para ordenes y enteros para pacientes) se guardan como texto.
alter table public.sync_change_log
  alter column entity_id type text using entity_id::text;
alter table public.import_rows
  alter column target_entity_id type text using target_entity_id::text;

drop index if exists public.patients_document_idx;
drop index if exists public.patients_name_search_idx;
drop index if exists public.patients_full_name_idx;
alter table public.patients
  drop constraint if exists patients_document_type_document_number_key,
  drop column if exists birth_at,
  drop column if exists first_names,
  drop column if exists first_name,
  drop column if exists paternal_surname,
  drop column if exists maternal_surname,
  drop column if exists document_type,
  drop column if exists document_number,
  drop column if exists phone,
  drop column if exists email,
  drop column if exists address,
  drop column if exists metadata,
  drop column if exists created_by,
  drop column if exists updated_by,
  drop column if exists archived_at;
create index patients_full_name_idx on public.patients(full_name);
create index patients_full_name_search_idx on public.patients
  using gin (to_tsvector('simple', coalesce(full_name, '')));

-- La identidad clinica vive en analysts; no depende de la cuenta tecnica.
alter table public.analysts
  drop column if exists legacy_profile_id,
  drop column if exists created_by,
  drop column if exists updated_by;

-- Conserva una única cuenta técnica autorizada sin mantener public.profiles.
alter table public.lab_settings add column authorized_user_id uuid;

insert into public.lab_settings(id, legal_name, trade_name, timezone)
select true, 'PENDIENTE DE CONFIGURAR', 'Laboratorio José', 'America/Lima'
where exists (select 1 from public.profiles where active)
on conflict (id) do nothing;

update public.lab_settings settings
set authorized_user_id = (
  select profile.id
  from public.profiles profile
  join auth.users auth_user on auth_user.id = profile.id
  where profile.active
  order by (profile.role = 'owner') desc, auth_user.created_at, profile.created_at
  limit 1
)
where settings.id;

do $$
begin
  if exists (select 1 from public.lab_settings where authorized_user_id is null) then
    raise exception 'No existe una cuenta técnica activa para autorizar la aplicación';
  end if;
end;
$$;

alter table public.lab_settings
  alter column authorized_user_id set not null,
  add constraint lab_settings_authorized_user_id_fkey
    foreign key (authorized_user_id) references auth.users(id) on delete restrict;

-- Conserva auditoria tecnica apuntando directamente a Auth antes de borrar profiles.
do $replace_profile_fks$
declare fk record;
begin
  for fk in
    select c.conname, c.conrelid::regclass as source_table, a.attname as source_column
    from pg_constraint c
    join unnest(c.conkey) with ordinality keys(attnum, ord) on true
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = keys.attnum
    where c.contype = 'f'
      and c.confrelid = 'public.profiles'::regclass
      and c.conrelid <> 'public.analysts'::regclass
  loop
    execute format('alter table %s drop constraint %I', fk.source_table, fk.conname);
    execute format(
      'alter table %s add constraint %I foreign key (%I) references auth.users(id) on delete restrict',
      fk.source_table, fk.conname, fk.source_column
    );
  end loop;
end;
$replace_profile_fks$;

drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_auth_user();
drop trigger if exists profiles_touch on public.profiles;
drop policy if exists profiles_self_read on public.profiles;
drop policy if exists profiles_owner_all on public.profiles;

-- Quita la dependencia funcional de profiles antes de eliminar la tabla.
create or replace function public.current_profile_is_active()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.lab_settings
    where authorized_user_id = auth.uid()
  );
$$;

create or replace function public.current_profile_is_owner()
returns boolean language sql stable security definer set search_path = public
as $$ select public.current_profile_is_active(); $$;

drop table public.profiles;
drop type if exists public.app_role;

-- Se mantienen estos nombres para no reescribir todas las politicas historicas.
create or replace function public.current_profile_is_active()
returns boolean language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.lab_settings
    where authorized_user_id = auth.uid()
  );
$$;

create or replace function public.current_profile_is_owner()
returns boolean language sql stable security definer set search_path = public
as $$ select public.current_profile_is_active(); $$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_table_name in ('orders', 'result_values') then
    new.updated_by := coalesce(auth.uid(), new.updated_by, old.updated_by, new.created_by, old.created_by);
  end if;
  return new;
end;
$$;

create trigger patients_touch before update on public.patients
for each row execute function public.touch_updated_at();

create or replace function public.capture_sync_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.sync_change_log(entity_type, entity_id)
  values (tg_table_name, new.id::text);
  return new;
end;
$$;

create trigger patients_bump_sync_version before update on public.patients
for each row execute function public.bump_patient_sync_version();
create trigger patients_capture_sync_change after insert or update on public.patients
for each row execute function public.capture_sync_change();

create or replace function public.search_patients(search_text text, result_limit integer default 20)
returns table(id integer, full_name text, birth_date date, sex text)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.full_name, p.birth_date, p.sex
  from public.patients p
  where public.current_profile_is_active()
    and (
      lpad(p.id::text, 8, '0') like '%' || trim(search_text) || '%'
      or unaccent(p.full_name) ilike '%' || unaccent(trim(search_text)) || '%'
    )
  order by (lpad(p.id::text, 8, '0') = trim(search_text)) desc, p.full_name
  limit least(greatest(result_limit, 1), 50);
$$;

create function public.upsert_simple_patient(patient_dni text, patient_name text)
returns public.patients language plpgsql security definer set search_path = public as $$
declare saved public.patients;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if coalesce(trim(patient_dni), '') !~ '^[0-9]{8}$' then raise exception 'invalid_dni'; end if;
  if char_length(trim(coalesce(patient_name, ''))) not between 2 and 180 then
    raise exception 'patient_name_required';
  end if;
  insert into public.patients(id, full_name)
  values (trim(patient_dni)::integer, trim(patient_name))
  on conflict (id) do update set full_name = excluded.full_name
  returning * into saved;
  return saved;
end;
$$;

create function public.upsert_patient_with_demographics(
  patient_dni text,
  patient_name text,
  patient_birth_date date,
  patient_sex text
)
returns public.patients language plpgsql security definer set search_path = public as $$
declare saved public.patients;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if coalesce(trim(patient_dni), '') !~ '^[0-9]{8}$' then raise exception 'invalid_dni'; end if;
  if char_length(trim(coalesce(patient_name, ''))) not between 2 and 180 then raise exception 'patient_name_required'; end if;
  if patient_birth_date is null or patient_birth_date > current_date then raise exception 'invalid_birth_date'; end if;
  if patient_sex is null or patient_sex not in ('F', 'M', 'X') then raise exception 'invalid_patient_sex'; end if;
  insert into public.patients(id, full_name, birth_date, sex)
  values (trim(patient_dni)::integer, trim(patient_name), patient_birth_date, patient_sex)
  on conflict (id) do update set
    full_name = excluded.full_name,
    birth_date = excluded.birth_date,
    sex = excluded.sex
  returning * into saved;
  return saved;
end;
$$;

create function public.update_patient_details(
  target_patient integer,
  patient_name text,
  patient_birth_date date,
  patient_sex text
)
returns public.patients language plpgsql security definer set search_path = public as $$
declare saved public.patients;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if char_length(trim(coalesce(patient_name, ''))) not between 2 and 180 then raise exception 'patient_name_required'; end if;
  if patient_birth_date is null or patient_birth_date > current_date then raise exception 'invalid_birth_date'; end if;
  if patient_sex is null or patient_sex not in ('F','M','X') then raise exception 'invalid_patient_sex'; end if;
  update public.patients set
    full_name = trim(patient_name), birth_date = patient_birth_date, sex = patient_sex
  where id = target_patient
  returning * into saved;
  if saved.id is null then raise exception 'patient_not_found'; end if;
  return saved;
end;
$$;

create function public.upsert_import_patient(
  patient_dni text,
  patient_name text,
  patient_birth_date date default null,
  patient_sex text default null,
  source_metadata jsonb default '{}'::jsonb
)
returns public.patients language plpgsql security definer set search_path = public as $$
declare saved public.patients; normalized_sex text;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if coalesce(trim(patient_dni), '') !~ '^[0-9]{8}$' then raise exception 'invalid_dni'; end if;
  if char_length(trim(coalesce(patient_name, ''))) not between 2 and 180 then raise exception 'patient_name_required'; end if;
  normalized_sex := case upper(trim(coalesce(patient_sex, '')))
    when 'F' then 'F' when 'FEMENINO' then 'F'
    when 'M' then 'M' when 'MASCULINO' then 'M'
    when 'X' then 'X' when 'U' then 'U' else null end;
  insert into public.patients(id, full_name, birth_date, sex)
  values (trim(patient_dni)::integer, trim(patient_name), patient_birth_date, normalized_sex)
  on conflict (id) do update set
    full_name = excluded.full_name,
    birth_date = coalesce(excluded.birth_date, public.patients.birth_date),
    sex = coalesce(excluded.sex, public.patients.sex)
  returning * into saved;
  return saved;
end;
$$;

create function public.register_daily_analyses_core(
  target_patient integer,
  result_entries jsonb,
  occurred_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  target_order uuid;
  target_status public.order_status;
  target_revision uuid;
  previous_revision public.result_revisions;
  analysis_versions uuid[];
  current_lock integer;
  entry jsonb;
  entry_count integer;
  distinct_count integer;
  valid_count integer;
  target_order_analysis uuid;
  selected_group record;
  new_batch uuid;
  created_batches uuid[] := '{}';
  first_display_order integer;
  inserted_group_count integer;
  lab_timezone text;
  clinical_date date;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if occurred_at > now() + interval '1 day' then raise exception 'invalid_order_date'; end if;
  if jsonb_typeof(result_entries) <> 'array' then raise exception 'invalid_result_entries'; end if;
  if not exists (select 1 from public.patients where id = target_patient) then raise exception 'patient_not_found'; end if;

  select count(*), count(distinct value->>'analysis_version_id'),
         array_agg((value->>'analysis_version_id')::uuid)
  into entry_count, distinct_count, analysis_versions
  from jsonb_array_elements(result_entries);
  if entry_count = 0 then raise exception 'analyses_required'; end if;
  if entry_count <> distinct_count then raise exception 'duplicate_analysis_version'; end if;
  if exists (
    select 1 from jsonb_array_elements(result_entries) item(value)
    where jsonb_typeof(item.value->'payload') <> 'object'
  ) then raise exception 'invalid_result_entries'; end if;

  select count(*) into valid_count
  from public.analysis_versions av
  join public.analyses a on a.id = av.analysis_id and a.active
  join public.analysis_groups ag on ag.id = a.group_id and ag.active
  where av.id = any(analysis_versions)
    and av.clinical_status = 'approved'
    and av.effective_from <= occurred_at
    and (av.effective_to is null or av.effective_to > occurred_at);
  if valid_count <> entry_count then raise exception 'invalid_or_inactive_analysis_version'; end if;

  select coalesce(nullif(settings.timezone, ''), 'America/Lima') into lab_timezone
  from public.lab_settings settings where settings.id = true;
  lab_timezone := coalesce(lab_timezone, 'America/Lima');
  clinical_date := (occurred_at at time zone lab_timezone)::date;
  perform pg_advisory_xact_lock(hashtextextended(target_patient::text || ':' || clinical_date::text, 0));

  select o.id, o.status into target_order, target_status
  from public.orders o
  where o.patient_id = target_patient
    and (o.ordered_at at time zone lab_timezone)::date = clinical_date
    and o.status <> 'cancelled'
    and (o.source_metadata->>'import_kind') is distinct from 'historical_results'
  order by o.ordered_at, o.order_number limit 1 for update;

  if target_order is null then
    insert into public.orders(
      patient_id, status, priority, ordered_at, collected_at, received_at, created_by, updated_by
    ) values (
      target_patient, 'draft', 'routine', occurred_at, occurred_at, occurred_at, auth.uid(), auth.uid()
    ) returning id into target_order;
    insert into public.result_revisions(order_id, revision, status, created_by)
    values(target_order, 1, 'draft', auth.uid()) returning id into target_revision;
  elsif target_status in ('validated', 'delivered') then
    select * into previous_revision from public.result_revisions
    where order_id = target_order order by revision desc limit 1 for update;
    insert into public.result_revisions(
      order_id, revision, status, amendment_reason, based_on_revision_id, created_by
    ) values (
      target_order, previous_revision.revision + 1, 'draft',
      'Nueva tanda agregada a la orden diaria', previous_revision.id, auth.uid()
    ) returning id into target_revision;
    insert into public.result_values(
      revision_id, order_analysis_id, numeric_value, text_value,
      qualitative_value, flag, clinical_snapshot, created_by, updated_by
    )
    select target_revision, order_analysis_id, numeric_value, text_value,
           qualitative_value, flag, clinical_snapshot, auth.uid(), auth.uid()
    from public.result_values where revision_id = previous_revision.id;
    update public.orders set status = 'draft', updated_by = auth.uid(), lock_version = lock_version + 1
    where id = target_order;
  else
    select id into target_revision from public.result_revisions
    where order_id = target_order order by revision desc limit 1 for update;
    if target_status = 'pending_validation' then
      update public.result_revisions set status = 'draft' where id = target_revision;
      update public.orders set status = 'draft', updated_by = auth.uid() where id = target_order;
    end if;
  end if;

  select coalesce(max(display_order), 0) into first_display_order
  from public.order_analyses where order_id = target_order;
  for selected_group in
    select distinct a.group_id
    from public.analysis_versions av join public.analyses a on a.id = av.analysis_id
    where av.id = any(analysis_versions)
  loop
    insert into public.order_analysis_batches(order_id, group_id, registered_at, created_by)
    values (target_order, selected_group.group_id, occurred_at, auth.uid()) returning id into new_batch;
    created_batches := array_append(created_batches, new_batch);
    insert into public.order_analyses(order_id, analysis_id, analysis_version_id, batch_id, display_order)
    select target_order, av.analysis_id, av.id, new_batch,
           first_display_order + row_number() over(order by ag.display_order, a.name)
    from public.analysis_versions av
    join public.analyses a on a.id = av.analysis_id
    join public.analysis_groups ag on ag.id = a.group_id
    where av.id = any(analysis_versions) and a.group_id = selected_group.group_id;
    get diagnostics inserted_group_count = row_count;
    first_display_order := first_display_order + inserted_group_count;
  end loop;

  update public.orders set updated_by = auth.uid(), lock_version = lock_version + 1
  where id = target_order returning lock_version into current_lock;
  for entry in select value from jsonb_array_elements(result_entries)
  loop
    select oa.id into target_order_analysis
    from public.order_analyses oa
    where oa.order_id = target_order
      and oa.batch_id = any(created_batches)
      and oa.analysis_version_id = (entry->>'analysis_version_id')::uuid;
    if target_order_analysis is null then raise exception 'analysis_not_in_order'; end if;
    perform public.save_result_draft(target_revision, target_order_analysis, entry->'payload', current_lock);
    current_lock := current_lock + 1;
  end loop;
  return jsonb_build_object(
    'order_id', target_order, 'revision_id', target_revision,
    'batch_ids', created_batches, 'lock_version', current_lock, 'saved_results', entry_count
  );
end;
$$;

create function public.register_daily_analyses(
  target_patient integer,
  result_entries jsonb,
  occurred_at timestamptz default now()
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare selected_analyst uuid; analyst_count integer;
begin
  if jsonb_typeof(result_entries) <> 'array' or jsonb_array_length(result_entries) = 0 then
    raise exception 'analyses_required';
  end if;
  select count(distinct nullif(value->>'analyst_id', '')),
         max(nullif(value->>'analyst_id', ''))::uuid
  into analyst_count, selected_analyst from jsonb_array_elements(result_entries);
  if analyst_count = 0 and (select count(*) from public.analysts where active) = 1 then
    select id into selected_analyst from public.analysts where active limit 1;
  end if;
  if analyst_count > 1 or selected_analyst is null then raise exception 'analyst_required'; end if;
  if not exists (select 1 from public.analysts where id = selected_analyst and active) then
    raise exception 'analyst_inactive_or_missing';
  end if;
  perform set_config('app.selected_analyst_id', selected_analyst::text, true);
  return public.register_daily_analyses_core(target_patient, result_entries, occurred_at);
end;
$$;

create or replace function public.get_patient_trend(target_patient integer, target_analysis uuid)
returns table(
  ordered_at timestamptz, value numeric, unit text, method text, flag public.result_flag,
  report_version integer, compatible_series_key text
) language sql stable security definer set search_path = public as $$
  select o.ordered_at, rv.numeric_value, rv.clinical_snapshot->>'unit', rv.clinical_snapshot->>'method',
         rv.flag, rp.version,
         encode(extensions.digest(
           coalesce(rv.clinical_snapshot->>'unit','') || '|' || coalesce(rv.clinical_snapshot->>'method',''),
           'sha256'
         ), 'hex')
  from public.orders o
  join public.result_revisions rr on rr.order_id = o.id and rr.status in ('validated','delivered')
  join public.result_values rv on rv.revision_id = rr.id
  join public.order_analyses oa on oa.id = rv.order_analysis_id and oa.analysis_id = target_analysis
  left join public.report_versions rp on rp.result_revision_id = rr.id
  where public.current_profile_is_active() and o.patient_id = target_patient and rv.numeric_value is not null
  order by o.ordered_at;
$$;

create or replace function public.apply_offline_operation(
  target_device uuid,
  target_mutation uuid,
  operation_kind text,
  operation_payload jsonb,
  base_version integer default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  prior_response jsonb;
  response jsonb;
  saved_patient public.patients;
  current_patient public.patients;
  target_patient_id integer;
  save_response jsonb;
  current_order public.orders;
  target_revision uuid;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if not exists (
    select 1 from public.offline_devices d
    where d.id = target_device and d.user_id = auth.uid()
      and d.revoked_at is null and d.lease_expires_at > now()
  ) then raise exception 'offline_device_not_authorized'; end if;
  select receipt.response into prior_response
  from public.offline_mutation_receipts receipt where receipt.mutation_id = target_mutation;
  if prior_response is not null then return prior_response; end if;

  if operation_kind = 'patient.upsert' then
    target_patient_id := (operation_payload->>'patientId')::integer;
    select * into current_patient from public.patients where id = target_patient_id for update;
    if current_patient.id is not null then
      if (
        nullif(trim(operation_payload->>'fullName'), '') is not null
        and current_patient.full_name is distinct from trim(operation_payload->>'fullName')
      ) or (
        nullif(operation_payload->>'birthDate', '') is not null
        and current_patient.birth_date is distinct from (operation_payload->>'birthDate')::date
      ) or (
        nullif(operation_payload->>'sex', '') is not null
        and current_patient.sex is distinct from operation_payload->>'sex'
      ) then
        response := jsonb_build_object(
          'clientMutationId', target_mutation, 'status', 'conflict',
          'conflict', jsonb_build_object(
            'clientMutationId', target_mutation, 'kind', operation_kind,
            'reason', 'patient_demographics_changed', 'local', operation_payload,
            'remote', jsonb_build_object(
              'id', current_patient.id, 'fullName', current_patient.full_name,
              'birthDate', current_patient.birth_date, 'sex', current_patient.sex
            ),
            'remoteVersion', current_patient.sync_version
          )
        );
      else
        response := jsonb_build_object(
          'clientMutationId', target_mutation, 'status', 'applied',
          'serverRefs', jsonb_build_object('patientId', current_patient.id, 'syncVersion', current_patient.sync_version)
        );
      end if;
    elsif nullif(operation_payload->>'birthDate', '') is not null then
      saved_patient := public.upsert_patient_with_demographics(
        lpad(target_patient_id::text, 8, '0'), operation_payload->>'fullName',
        (operation_payload->>'birthDate')::date, operation_payload->>'sex'
      );
      response := jsonb_build_object(
        'clientMutationId', target_mutation, 'status', 'applied',
        'serverRefs', jsonb_build_object('patientId', saved_patient.id, 'syncVersion', saved_patient.sync_version)
      );
    else
      saved_patient := public.upsert_simple_patient(
        lpad(target_patient_id::text, 8, '0'), operation_payload->>'fullName'
      );
      response := jsonb_build_object(
        'clientMutationId', target_mutation, 'status', 'applied',
        'serverRefs', jsonb_build_object('patientId', saved_patient.id, 'syncVersion', saved_patient.sync_version)
      );
    end if;
  elsif operation_kind = 'patient.update' then
    select * into current_patient from public.patients
    where id = (operation_payload->>'patientId')::integer for update;
    if current_patient.id is null then raise exception 'patient_not_found'; end if;
    if base_version is null or current_patient.sync_version <> base_version then
      response := jsonb_build_object(
        'clientMutationId', target_mutation, 'status', 'conflict',
        'conflict', jsonb_build_object(
          'clientMutationId', target_mutation, 'kind', operation_kind,
          'reason', 'patient_concurrent_change', 'local', operation_payload,
          'remote', jsonb_build_object(
            'id', current_patient.id, 'fullName', current_patient.full_name,
            'birthDate', current_patient.birth_date, 'sex', current_patient.sex
          ),
          'remoteVersion', current_patient.sync_version
        )
      );
    else
      saved_patient := public.update_patient_details(
        current_patient.id, operation_payload->>'fullName',
        (operation_payload->>'birthDate')::date, operation_payload->>'sex'
      );
      response := jsonb_build_object(
        'clientMutationId', target_mutation, 'status', 'applied',
        'serverRefs', jsonb_build_object('patientId', saved_patient.id, 'syncVersion', saved_patient.sync_version)
      );
    end if;
  elsif operation_kind = 'results.save' then
    target_revision := (operation_payload->>'targetRevision')::uuid;
    begin
      save_response := public.save_result_batch(
        target_revision, operation_payload->'resultEntries',
        coalesce(base_version, (operation_payload->>'expectedLockVersion')::integer)
      );
      response := jsonb_build_object(
        'clientMutationId', target_mutation, 'status', 'applied', 'serverRefs', save_response
      );
    exception when others then
      if sqlerrm = 'concurrent_change' then
        select o.* into current_order from public.orders o
        join public.result_revisions rr on rr.order_id = o.id where rr.id = target_revision;
        response := jsonb_build_object(
          'clientMutationId', target_mutation, 'status', 'conflict',
          'conflict', jsonb_build_object(
            'clientMutationId', target_mutation, 'kind', operation_kind,
            'reason', 'result_concurrent_change', 'local', operation_payload,
            'remote', jsonb_build_object('orderId', current_order.id, 'lockVersion', current_order.lock_version),
            'remoteVersion', current_order.lock_version
          )
        );
      else raise;
      end if;
    end;
  else
    raise exception 'unsupported_offline_operation';
  end if;

  insert into public.offline_mutation_receipts(mutation_id, device_id, user_id, operation_kind, response)
  values (target_mutation, target_device, auth.uid(), operation_kind, response);
  update public.offline_devices set last_seen_at = now() where id = target_device;
  return response;
end;
$$;

create or replace function public.apply_offline_analysis_registration(
  target_device uuid,
  target_mutation uuid,
  operation_payload jsonb
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare prior_response jsonb; response jsonb; target_patient_id integer; register_response jsonb;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if not exists (
    select 1 from public.offline_devices d
    where d.id = target_device and d.user_id = auth.uid()
      and d.revoked_at is null and d.lease_expires_at > now()
  ) then raise exception 'offline_device_not_authorized'; end if;
  select receipt.response into prior_response
  from public.offline_mutation_receipts receipt where receipt.mutation_id = target_mutation;
  if prior_response is not null then return prior_response; end if;
  target_patient_id := (operation_payload->>'patientId')::integer;
  if not exists (select 1 from public.patients where id = target_patient_id) then
    raise exception 'patient_dependency_pending';
  end if;
  register_response := public.register_daily_analyses(
    target_patient_id, operation_payload->'resultEntries',
    (operation_payload->>'occurredAt')::timestamptz
  );
  response := jsonb_build_object(
    'clientMutationId', target_mutation, 'status', 'applied', 'serverRefs', register_response
  );
  insert into public.offline_mutation_receipts(mutation_id, device_id, user_id, operation_kind, response)
  values (target_mutation, target_device, auth.uid(), 'analysis.register', response);
  update public.offline_devices set last_seen_at = now() where id = target_device;
  return response;
end;
$$;

create or replace function public.create_analyst(analyst_name text)
returns public.analysts language plpgsql security definer set search_path = public as $$
declare saved public.analysts;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if char_length(trim(coalesce(analyst_name, ''))) < 2 then raise exception 'analyst_name_required'; end if;
  insert into public.analysts(full_name) values(trim(analyst_name)) returning * into saved;
  return saved;
end;
$$;

create or replace function public.set_analyst_active(target_analyst uuid, analyst_active boolean)
returns public.analysts language plpgsql security definer set search_path = public as $$
declare saved public.analysts;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  lock table public.analysts in share row exclusive mode;
  if not exists (select 1 from public.analysts where id = target_analyst) then raise exception 'analyst_not_found'; end if;
  if not analyst_active and (select count(*) from public.analysts where active and id <> target_analyst) = 0 then
    raise exception 'at_least_one_active_analyst_required';
  end if;
  update public.analysts set active = analyst_active where id = target_analyst returning * into saved;
  return saved;
end;
$$;

revoke all on function public.register_daily_analyses_core(integer, jsonb, timestamptz) from public, anon, authenticated;
revoke all on function public.search_patients(text, integer) from public, anon;
revoke all on function public.upsert_simple_patient(text, text) from public, anon;
revoke all on function public.upsert_patient_with_demographics(text, text, date, text) from public, anon;
revoke all on function public.update_patient_details(integer, text, date, text) from public, anon;
revoke all on function public.upsert_import_patient(text, text, date, text, jsonb) from public, anon;
revoke all on function public.register_daily_analyses(integer, jsonb, timestamptz) from public, anon;
revoke all on function public.get_patient_trend(integer, uuid) from public, anon;
grant execute on function public.search_patients(text, integer) to authenticated;
grant execute on function public.upsert_simple_patient(text, text) to authenticated;
grant execute on function public.upsert_patient_with_demographics(text, text, date, text) to authenticated;
grant execute on function public.update_patient_details(integer, text, date, text) to authenticated;
grant execute on function public.upsert_import_patient(text, text, date, text, jsonb) to authenticated;
grant execute on function public.register_daily_analyses(integer, jsonb, timestamptz) to authenticated;
grant execute on function public.get_patient_trend(integer, uuid) to authenticated;

comment on table public.patients is 'Pacientes identificados exclusivamente por DNI numerico.';
comment on column public.patients.id is 'DNI del paciente; mostrar siempre con ocho digitos.';
comment on table public.analysts is 'Identidades clinicas seleccionables para la unica cuenta tecnica.';

notify pgrst, 'reload schema';
commit;
