-- Hora de nacimiento para recién nacidos.
--
-- `patients.birth_date` es DATE, así que un bebé de horas figuraba con la misma
-- edad que uno de un día. Se añade la hora aparte en vez de convertir la columna
-- a timestamp: así ninguna lectura ni ningún campo de fecha existente cambia de
-- forma, y la hora es opcional para los 99% de pacientes que no la necesitan.

alter table public.patients add column if not exists birth_time time;

comment on column public.patients.birth_time is
  'Hora de nacimiento. Solo se registra en recién nacidos, donde la edad se informa en horas.';

-- Las tres funciones cambian de firma, así que hay que soltarlas antes: un
-- `create or replace` con otra firma dejaría dos sobrecargas y las llamadas
-- quedarían ambiguas. Soltar también borra los permisos, que se vuelven a dar
-- al final.
drop function if exists public.upsert_patient_with_demographics(text, text, date, text);
drop function if exists public.update_patient_details(integer, text, date, text);

create or replace function public.upsert_patient_with_demographics(
  patient_dni text,
  patient_name text,
  patient_birth_date date,
  patient_sex text,
  patient_birth_time time default null
)
returns patients
language plpgsql
security definer
set search_path to 'public'
as $function$
declare saved public.patients;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if coalesce(trim(patient_dni), '') !~ '^[0-9]{8}$' then raise exception 'invalid_dni'; end if;
  if char_length(trim(coalesce(patient_name, ''))) not between 2 and 180 then raise exception 'patient_name_required'; end if;
  if patient_birth_date is null or patient_birth_date > current_date then raise exception 'invalid_birth_date'; end if;
  if patient_sex is null or patient_sex not in ('F', 'M', 'X') then raise exception 'invalid_patient_sex'; end if;
  -- Nacer dentro de un rato no es posible: se compara en hora de Lima, que es la
  -- que teclea el laboratorio.
  if patient_birth_time is not null
     and (patient_birth_date + patient_birth_time) > (now() at time zone 'America/Lima') then
    raise exception 'invalid_birth_date';
  end if;
  insert into public.patients(id, full_name, birth_date, sex, birth_time)
  values (trim(patient_dni)::integer, trim(patient_name), patient_birth_date, patient_sex, patient_birth_time)
  on conflict (id) do update set
    full_name = excluded.full_name,
    birth_date = excluded.birth_date,
    sex = excluded.sex,
    -- Una hora ya registrada no se borra por guardar sin ella.
    birth_time = coalesce(excluded.birth_time, public.patients.birth_time)
  returning * into saved;
  return saved;
end;
$function$;

create or replace function public.update_patient_details(
  target_patient integer,
  patient_name text,
  patient_birth_date date,
  patient_sex text,
  patient_birth_time time default null
)
returns patients
language plpgsql
security definer
set search_path to 'public'
as $function$
declare saved public.patients;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if char_length(trim(coalesce(patient_name, ''))) not between 2 and 180 then raise exception 'patient_name_required'; end if;
  if patient_birth_date is null or patient_birth_date > current_date then raise exception 'invalid_birth_date'; end if;
  if patient_sex is null or patient_sex not in ('F','M','X') then raise exception 'invalid_patient_sex'; end if;
  if patient_birth_time is not null
     and (patient_birth_date + patient_birth_time) > (now() at time zone 'America/Lima') then
    raise exception 'invalid_birth_date';
  end if;
  update public.patients set
    full_name = trim(patient_name),
    birth_date = patient_birth_date,
    sex = patient_sex,
    birth_time = coalesce(patient_birth_time, birth_time)
  where id = target_patient
  returning * into saved;
  if saved.id is null then raise exception 'patient_not_found'; end if;
  return saved;
end;
$function$;

-- Misma función de siempre; lo único nuevo es que la hora viaja en el payload
-- offline y llega a las dos RPC de arriba, y que una hora distinta en el
-- servidor también cuenta como conflicto de demografía.
CREATE OR REPLACE FUNCTION public.apply_offline_operation(target_device uuid, target_mutation uuid, operation_kind text, operation_payload jsonb, base_version integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
        nullif(operation_payload->>'birthTime', '') is not null
        and current_patient.birth_time is distinct from (operation_payload->>'birthTime')::time
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
              'birthDate', current_patient.birth_date, 'birthTime', current_patient.birth_time, 'sex', current_patient.sex
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
        (operation_payload->>'birthDate')::date, operation_payload->>'sex',
        nullif(operation_payload->>'birthTime', '')::time
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
            'birthDate', current_patient.birth_date, 'birthTime', current_patient.birth_time, 'sex', current_patient.sex
          ),
          'remoteVersion', current_patient.sync_version
        )
      );
    else
      saved_patient := public.update_patient_details(
        current_patient.id, operation_payload->>'fullName',
        (operation_payload->>'birthDate')::date, operation_payload->>'sex',
        nullif(operation_payload->>'birthTime', '')::time
      );
      response := jsonb_build_object(
        'clientMutationId', target_mutation, 'status', 'applied',
        'serverRefs', jsonb_build_object('patientId', saved_patient.id, 'syncVersion', saved_patient.sync_version)
      );
    end if;
  elsif operation_kind = 'catalog.apply' then
    response := jsonb_build_object(
      'clientMutationId', target_mutation, 'status', 'applied',
      'serverRefs', public.apply_catalog_operation(operation_payload)
    );
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
$function$;

-- Una función recién creada nace con EXECUTE para PUBLIC, y los permisos por
-- defecto de Supabase añaden `anon`. Las originales no los tenían, así que se
-- retiran antes de devolver los que sí corresponden.
revoke all on function public.upsert_patient_with_demographics(text, text, date, text, time) from public, anon;
revoke all on function public.update_patient_details(integer, text, date, text, time) from public, anon;

grant execute on function public.upsert_patient_with_demographics(text, text, date, text, time) to authenticated, service_role;
grant execute on function public.update_patient_details(integer, text, date, text, time) to authenticated, service_role;
