-- Catálogo editable sin internet.
--
-- Hasta ahora la cola offline solo aceptaba pacientes, registros y resultados;
-- el catálogo exigía conexión. El obstáculo real no era el permiso sino los
-- identificadores: `create_catalog_group`, `create_catalog_subsection` y
-- `save_catalog_analysis` generaban el id en el servidor, así que un equipo sin
-- conexión no podía crear un grupo y meterle análisis en la misma sesión —
-- no tenía a qué apuntar.
--
-- Esta migración hace dos cosas:
--   1. Las tres RPC que crean filas aceptan un id opcional. El equipo lo genera
--      (crypto.randomUUID) y ese id es el definitivo: al sincronizar no hay
--      remapeo, y las operaciones encoladas después ya apuntan al sitio correcto.
--   2. `apply_offline_operation` acepta la operación `catalog.apply`, cuyo payload
--      es el mismo cuerpo que ya recibe /api/catalog. Reparte a las mismas RPC,
--      así que el catálogo tiene una sola implementación con o sin conexión.
--
-- Reconciliación: los cambios de catálogo son metadatos, no datos clínicos de un
-- paciente, y se resuelven con «gana el último en llegar». Borrar o archivar algo
-- que otro equipo ya borró se considera aplicado: la intención ya se cumplió.
-- Lo que NO se toca es la instantánea clínica — los informes ya emitidos guardan
-- su propia copia y ninguna edición de catálogo los altera.

-- 1. Ids opcionales -----------------------------------------------------------
-- Postgres identifica funciones por sus tipos de argumento: sin este drop
-- quedarían dos sobrecargas y las llamadas de un solo argumento serían ambiguas.

drop function if exists public.create_catalog_group(text);
drop function if exists public.create_catalog_subsection(uuid, text);
drop function if exists public.save_catalog_analysis(uuid, uuid, text, text, text, text, text, text, integer, jsonb, jsonb, jsonb);

create or replace function public.create_catalog_group(group_name text, target_id uuid default null)
returns analysis_groups
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  created public.analysis_groups;
  generated_code text;
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  if char_length(trim(coalesce(group_name, ''))) not between 2 and 80 then raise exception 'invalid_group_name'; end if;
  -- Un id ya existente significa que el equipo lo creó sin conexión y esta es la
  -- sincronización: devolver la fila sin duplicarla.
  if target_id is not null then
    select * into created from public.analysis_groups where id = target_id;
    if created.id is not null then return created; end if;
  end if;
  generated_code := 'CUS-GRP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.analysis_groups(id, code, name, display_order, active)
  values (
    coalesce(target_id, gen_random_uuid()),
    generated_code,
    trim(group_name),
    coalesce((select max(display_order) + 10 from public.analysis_groups), 10),
    true
  ) returning * into created;
  return created;
end;
$function$;

create or replace function public.create_catalog_subsection(target_group uuid, subsection_name text, target_id uuid default null)
returns analysis_subsections
language plpgsql
security definer
set search_path to 'public'
as $function$
declare created public.analysis_subsections;
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  if char_length(trim(coalesce(subsection_name, ''))) not between 2 and 80 then raise exception 'invalid_subsection_name'; end if;
  if target_id is not null then
    select * into created from public.analysis_subsections where id = target_id;
    if created.id is not null then return created; end if;
  end if;
  if not exists(select 1 from public.analysis_groups where id = target_group and active) then raise exception 'group_not_found'; end if;
  insert into public.analysis_subsections(id, group_id, name, display_order)
  values (
    coalesce(target_id, gen_random_uuid()),
    target_group,
    trim(subsection_name),
    coalesce((select max(display_order) + 10 from public.analysis_subsections where group_id = target_group), 10)
  ) returning * into created;
  return created;
end;
$function$;

create or replace function public.save_catalog_analysis(
  target_analysis uuid, target_group uuid, target_subsection text, analysis_name text,
  approved_result_type text, approved_sample_type text, approved_method text, approved_unit text,
  approved_decimals integer, approved_qualitative_options jsonb, approved_reference_ranges jsonb,
  approved_critical_limits jsonb, target_new_analysis uuid default null, target_new_version uuid default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare saved_analysis uuid; previous_group uuid; next_version integer; next_order integer; generated_code text; new_analysis_id uuid;
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  if char_length(trim(coalesce(analysis_name, ''))) not between 2 and 120 then raise exception 'invalid_analysis_name'; end if;
  if approved_result_type not in ('numeric', 'qualitative', 'text') then raise exception 'invalid_result_type'; end if;
  if char_length(trim(coalesce(approved_sample_type, ''))) < 2 then raise exception 'sample_type_required'; end if;
  if not exists(select 1 from public.analysis_groups where id = target_group and active) then raise exception 'group_not_found'; end if;
  if nullif(trim(coalesce(target_subsection, '')), '') is not null and not exists(
    select 1 from public.analysis_subsections where group_id = target_group and lower(name) = lower(trim(target_subsection))
  ) then raise exception 'subsection_not_found'; end if;
  if approved_result_type = 'numeric' and jsonb_array_length(coalesce(approved_reference_ranges, '[]'::jsonb)) = 0 then raise exception 'reference_range_required'; end if;
  if approved_result_type = 'qualitative' and jsonb_array_length(coalesce(approved_qualitative_options, '[]'::jsonb)) = 0 then raise exception 'qualitative_options_required'; end if;

  -- Reenvío de algo ya aplicado: la versión que traía el equipo ya está en la
  -- base. Hay que salir aquí, antes de cerrar la versión vigente — si se sigue
  -- adelante se cierra una versión para no abrir ninguna.
  if target_new_version is not null and exists(select 1 from public.analysis_versions where id = target_new_version) then
    return coalesce(
      target_analysis, target_new_analysis,
      (select analysis_id from public.analysis_versions where id = target_new_version)
    );
  end if;

  if target_analysis is null then
    new_analysis_id := coalesce(target_new_analysis, gen_random_uuid());
    -- El código se deriva del id, no de un uuid nuevo: así el equipo que creó el
    -- análisis sin conexión calcula exactamente el mismo y no cambia al sincronizar.
    generated_code := 'CUS-' || upper(substr(replace(new_analysis_id::text, '-', ''), 1, 12));
    select coalesce(max((source_metadata->>'picker_order')::integer), 0) + 10 into next_order
    from public.analyses where group_id = target_group;
    insert into public.analyses(id, code, group_id, name, result_type, active, created_by, source_metadata)
    values (
      new_analysis_id,
      generated_code, target_group, trim(analysis_name), approved_result_type::public.result_type, true, auth.uid(),
      jsonb_strip_nulls(jsonb_build_object('picker_order', next_order, 'picker_subsection', nullif(trim(coalesce(target_subsection, '')), ''), 'picker_common', true))
    ) returning id into saved_analysis;
    next_version := 1;
  else
    select id, group_id into saved_analysis, previous_group from public.analyses where id = target_analysis for update;
    if saved_analysis is null then raise exception 'analysis_not_found'; end if;
    select coalesce(max(version), 0) + 1 into next_version from public.analysis_versions where analysis_id = target_analysis;
    update public.analysis_versions set effective_to = now() where analysis_id = target_analysis and effective_to is null;
    update public.analyses
    set group_id = target_group, name = trim(analysis_name), result_type = approved_result_type::public.result_type,
      active = true, archived_at = null,
      source_metadata = case
        when nullif(trim(coalesce(target_subsection, '')), '') is null
          then coalesce(source_metadata, '{}'::jsonb) - 'picker_subsection'
        else jsonb_set(
          coalesce(source_metadata, '{}'::jsonb),
          '{picker_subsection}',
          to_jsonb(trim(target_subsection)),
          true
        )
      end
    where id = target_analysis;
    if previous_group is distinct from target_group then
      select coalesce(max((source_metadata->>'picker_order')::integer), 0) + 10 into next_order
      from public.analyses where group_id = target_group and id <> target_analysis;
      update public.analyses
      set source_metadata = jsonb_set(coalesce(source_metadata, '{}'::jsonb), '{picker_order}', to_jsonb(next_order), true)
      where id = target_analysis;
    end if;
  end if;

  -- La versión también acepta id del equipo: los resultados registrados sin
  -- conexión guardan analysis_version_id y deben apuntar a esta misma fila,
  -- tanto en un alta como en una edición.
  insert into public.analysis_versions(
    id, analysis_id, version, sample_type, method, unit, decimals, qualitative_options,
    reference_ranges, critical_limits, approved_by, clinical_status
  ) values (
    coalesce(target_new_version, gen_random_uuid()),
    saved_analysis, next_version, trim(approved_sample_type), nullif(trim(coalesce(approved_method, '')), ''),
    nullif(trim(coalesce(approved_unit, '')), ''), case when approved_result_type = 'numeric' then approved_decimals else null end,
    case when approved_result_type = 'qualitative' then approved_qualitative_options else null end,
    coalesce(approved_reference_ranges, '[]'::jsonb), coalesce(approved_critical_limits, '{}'::jsonb), auth.uid(), 'approved'
  );
  return saved_analysis;
end;
$function$;

-- 2. Reparto del catálogo, compartido por la API y por la cola offline ---------

create or replace function public.apply_catalog_operation(operation_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  action text := operation_payload->>'action';
  saved_group public.analysis_groups;
  saved_subsection public.analysis_subsections;
  saved_analysis uuid;
begin
  if action = 'group.create' then
    saved_group := public.create_catalog_group(
      operation_payload->>'name',
      nullif(operation_payload->>'groupId', '')::uuid
    );
    return jsonb_build_object('groupId', saved_group.id);

  elsif action = 'group.rename' then
    perform public.rename_catalog_group((operation_payload->>'groupId')::uuid, operation_payload->>'name');
    return jsonb_build_object('groupId', operation_payload->>'groupId');

  elsif action = 'group.archive' then
    -- Archivar algo que ya no está es la intención cumplida, no un error.
    if not exists(select 1 from public.analysis_groups where id = (operation_payload->>'groupId')::uuid and active) then
      return jsonb_build_object('groupId', operation_payload->>'groupId', 'noop', true);
    end if;
    perform public.archive_catalog_group((operation_payload->>'groupId')::uuid);
    return jsonb_build_object('groupId', operation_payload->>'groupId');

  elsif action = 'subsection.create' then
    saved_subsection := public.create_catalog_subsection(
      (operation_payload->>'groupId')::uuid,
      operation_payload->>'name',
      nullif(operation_payload->>'subsectionId', '')::uuid
    );
    return jsonb_build_object('subsectionId', saved_subsection.id);

  elsif action = 'subsection.rename' then
    perform public.rename_catalog_subsection((operation_payload->>'subsectionId')::uuid, operation_payload->>'name');
    return jsonb_build_object('subsectionId', operation_payload->>'subsectionId');

  elsif action = 'subsection.renameLegacy' then
    perform public.rename_catalog_subsection_by_name(
      (operation_payload->>'groupId')::uuid, operation_payload->>'currentName', operation_payload->>'name');
    return jsonb_build_object('groupId', operation_payload->>'groupId');

  elsif action = 'subsection.delete' then
    if not exists(select 1 from public.analysis_subsections where id = (operation_payload->>'subsectionId')::uuid) then
      return jsonb_build_object('subsectionId', operation_payload->>'subsectionId', 'noop', true);
    end if;
    perform public.delete_catalog_subsection((operation_payload->>'subsectionId')::uuid);
    return jsonb_build_object('subsectionId', operation_payload->>'subsectionId');

  elsif action = 'subsection.deleteLegacy' then
    perform public.delete_catalog_subsection_by_name(
      (operation_payload->>'groupId')::uuid, operation_payload->>'currentName');
    return jsonb_build_object('groupId', operation_payload->>'groupId');

  elsif action = 'subsection.reorder' then
    perform public.reorder_catalog_subsections(
      (operation_payload->>'groupId')::uuid,
      -- jsonb_array_elements_text, no ::text: este último deja las comillas del jsonb.
      (select coalesce(array_agg(value::uuid), '{}'::uuid[])
         from jsonb_array_elements_text(operation_payload->'subsectionIds')));
    return jsonb_build_object('groupId', operation_payload->>'groupId');

  elsif action = 'layout.save' then
    perform public.save_catalog_layout(
      (operation_payload->>'groupId')::uuid,
      (select coalesce(jsonb_agg(jsonb_build_object(
                'analysis_id', item->>'analysisId',
                'subsection', item->>'subsection',
                'display_order', (item->>'displayOrder')::integer)), '[]'::jsonb)
         from jsonb_array_elements(operation_payload->'items') item));
    return jsonb_build_object('groupId', operation_payload->>'groupId');

  elsif action = 'analysis.save' then
    saved_analysis := public.save_catalog_analysis(
      nullif(operation_payload->>'analysisId', '')::uuid,
      (operation_payload->>'groupId')::uuid,
      operation_payload->>'subsection',
      operation_payload->>'name',
      operation_payload->>'resultType',
      operation_payload->>'sampleType',
      operation_payload->>'method',
      operation_payload->>'unit',
      nullif(operation_payload->>'decimals', '')::integer,
      operation_payload->'qualitativeOptions',
      operation_payload->'referenceRanges',
      operation_payload->'criticalLimits',
      nullif(operation_payload->>'newAnalysisId', '')::uuid,
      nullif(operation_payload->>'newVersionId', '')::uuid
    );
    return jsonb_build_object('analysisId', saved_analysis);

  elsif action = 'analysis.archive' then
    if not exists(select 1 from public.analyses where id = (operation_payload->>'analysisId')::uuid and active) then
      return jsonb_build_object('analysisId', operation_payload->>'analysisId', 'noop', true);
    end if;
    perform public.archive_catalog_analysis((operation_payload->>'analysisId')::uuid);
    return jsonb_build_object('analysisId', operation_payload->>'analysisId');
  end if;

  raise exception 'unsupported_catalog_action';
end;
$function$;

-- 3. La cola offline acepta catalog.apply -------------------------------------

create or replace function public.apply_offline_operation(target_device uuid, target_mutation uuid, operation_kind text, operation_payload jsonb, base_version integer DEFAULT NULL::integer)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
