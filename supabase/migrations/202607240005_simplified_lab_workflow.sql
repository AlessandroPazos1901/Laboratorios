-- Flujo confirmado: registrar -> guardar -> imprimir.
-- Todos los perfiles activos tienen las mismas facultades operativas.
begin;

alter table public.patients add column if not exists full_name text;

update public.patients
set full_name = trim(concat_ws(' ', first_names, paternal_surname, maternal_surname))
where full_name is null or trim(full_name) = '';

alter table public.patients alter column full_name set not null;
alter table public.patients
  add constraint patients_full_name_length
  check (char_length(trim(full_name)) between 2 and 180) not valid;
alter table public.patients validate constraint patients_full_name_length;

create index if not exists patients_full_name_idx on public.patients (full_name);

-- La interfaz no expone roles. Se conservan las políticas owner existentes.
-- Cada una de las tres cuentas autorizadas se eleva explícitamente después de
-- crearla; nunca se concede administración automática a usuarios futuros.

create or replace function public.search_patients(search_text text, result_limit integer default 20)
returns table(id uuid, document_type text, document_number text, full_name text, birth_date date, sex text)
language sql stable security definer set search_path = public, extensions as $$
  select p.id, p.document_type, p.document_number, p.full_name, p.birth_date, p.sex
  from public.patients p
  where public.current_profile_is_active()
    and p.archived_at is null
    and (
      p.document_number ilike '%' || trim(search_text) || '%'
      or unaccent(p.full_name)
         ilike '%' || unaccent(trim(search_text)) || '%'
    )
  order by (p.document_number = trim(search_text)) desc, p.full_name
  limit least(greatest(result_limit, 1), 50);
$$;

create function public.upsert_simple_patient(patient_dni text, patient_name text)
returns public.patients
language plpgsql security definer set search_path = public as $$
declare saved public.patients;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if coalesce(trim(patient_dni), '') !~ '^[0-9]{8}$' then raise exception 'invalid_dni'; end if;
  if char_length(trim(coalesce(patient_name, ''))) not between 2 and 180
  then raise exception 'patient_name_required'; end if;

  insert into public.patients(
    document_type, document_number, full_name, first_names, paternal_surname,
    created_by, updated_by
  ) values (
    'DNI', trim(patient_dni), trim(patient_name), trim(patient_name), 'N/A',
    auth.uid(), auth.uid()
  )
  on conflict (document_type, document_number) do update set
    full_name = excluded.full_name,
    first_names = excluded.first_names,
    updated_by = auth.uid()
  returning * into saved;
  return saved;
end;
$$;

create function public.create_simple_order(
  target_patient uuid,
  selected_analysis_versions uuid[],
  occurred_at timestamptz default now()
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  new_order uuid;
  selected_count integer;
  inserted_count integer;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if occurred_at > now() + interval '1 day' then raise exception 'invalid_order_date'; end if;
  if coalesce(array_length(selected_analysis_versions, 1), 0) = 0
  then raise exception 'analyses_required'; end if;
  if not exists (
    select 1 from public.patients where id = target_patient and archived_at is null
  ) then raise exception 'patient_not_found'; end if;

  select count(distinct version_id) into selected_count
  from unnest(selected_analysis_versions) selected(version_id);
  if selected_count <> array_length(selected_analysis_versions, 1)
  then raise exception 'duplicate_analysis_version'; end if;

  insert into public.orders(
    patient_id, status, priority, ordered_at, collected_at, received_at,
    created_by, updated_by
  ) values (
    target_patient, 'draft', 'routine', occurred_at, occurred_at, occurred_at,
    auth.uid(), auth.uid()
  ) returning id into new_order;

  insert into public.result_revisions(order_id, revision, status, created_by)
  values(new_order, 1, 'draft', auth.uid());

  insert into public.order_analyses(
    order_id, analysis_id, analysis_version_id, display_order
  )
  select
    new_order, av.analysis_id, av.id,
    row_number() over(order by ag.display_order, a.name)
  from public.analysis_versions av
  join public.analyses a on a.id = av.analysis_id and a.active
  join public.analysis_groups ag on ag.id = a.group_id and ag.active
  where av.id = any(selected_analysis_versions)
    and av.effective_from <= occurred_at
    and (av.effective_to is null or av.effective_to > occurred_at);

  get diagnostics inserted_count = row_count;
  if inserted_count <> selected_count
  then raise exception 'invalid_or_inactive_analysis_version'; end if;

  return new_order;
end;
$$;

create function public.record_order_print(
  target_order uuid,
  expected_lock_version integer
)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare
  current_order public.orders;
  latest_revision public.result_revisions;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;

  select * into current_order
  from public.orders
  where id = target_order
  for update;

  if not found then raise exception 'order_not_found'; end if;
  if current_order.status = 'cancelled' then raise exception 'cancelled_order'; end if;
  if current_order.lock_version <> expected_lock_version
  then raise exception 'concurrent_change'; end if;

  select * into latest_revision
  from public.result_revisions
  where order_id = target_order
  order by revision desc
  limit 1;

  if exists (
    select 1
    from public.order_analyses oa
    where oa.order_id = target_order
      and not exists (
        select 1
        from public.result_values rv
        where rv.revision_id = latest_revision.id
          and rv.order_analysis_id = oa.id
          and num_nonnulls(rv.numeric_value, rv.text_value, rv.qualitative_value) = 1
      )
  ) then raise exception 'all_results_required'; end if;

  if current_order.status in ('draft', 'pending_validation') then
    update public.orders
    set
      status = 'validated',
      validated_at = now(),
      validated_by = auth.uid(),
      lock_version = lock_version + 1
    where id = target_order
    returning * into current_order;

    update public.result_revisions
    set status = 'validated', validated_by = auth.uid(), validated_at = now()
    where id = latest_revision.id;
  end if;

  return current_order;
end;
$$;

create function public.cancel_simple_order(target_order uuid, cancellation text)
returns public.orders
language plpgsql security definer set search_path = public as $$
declare changed public.orders;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if char_length(trim(coalesce(cancellation, ''))) < 5
  then raise exception 'reason_required'; end if;

  update public.orders
  set
    status = 'cancelled',
    cancelled_at = now(),
    cancellation_reason = trim(cancellation),
    lock_version = lock_version + 1
  where id = target_order and status <> 'cancelled'
  returning * into changed;

  if changed.id is null then raise exception 'invalid_state'; end if;

  return changed;
end;
$$;

revoke all on function public.upsert_simple_patient(text, text) from public, anon;
revoke all on function public.create_simple_order(uuid, uuid[], timestamptz) from public, anon;
revoke all on function public.record_order_print(uuid, integer) from public, anon;
revoke all on function public.cancel_simple_order(uuid, text) from public, anon;

grant execute on function public.upsert_simple_patient(text, text) to authenticated;
grant execute on function public.create_simple_order(uuid, uuid[], timestamptz) to authenticated;
grant execute on function public.record_order_print(uuid, integer) to authenticated;
grant execute on function public.cancel_simple_order(uuid, text) to authenticated;

commit;
