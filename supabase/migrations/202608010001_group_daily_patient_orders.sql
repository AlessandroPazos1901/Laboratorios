-- Reutiliza la orden activa de un paciente durante el mismo dia clinico.
begin;

create or replace function public.create_simple_order(
  target_patient uuid,
  selected_analysis_versions uuid[],
  occurred_at timestamptz default now()
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  target_order uuid;
  target_status public.order_status;
  selected_count integer;
  new_analysis_count integer;
  inserted_count integer;
  first_display_order integer;
  lab_timezone text;
  clinical_date date;
  previous_revision public.result_revisions;
  new_revision_id uuid;
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

  -- Valida toda la seleccion antes de crear o modificar una orden.
  if (
    select count(*)
    from public.analysis_versions av
    join public.analyses a on a.id = av.analysis_id and a.active
    join public.analysis_groups ag on ag.id = a.group_id and ag.active
    where av.id = any(selected_analysis_versions)
      and av.clinical_status = 'approved'
      and av.effective_from <= occurred_at
      and (av.effective_to is null or av.effective_to > occurred_at)
  ) <> selected_count then
    raise exception 'invalid_or_inactive_analysis_version';
  end if;

  select coalesce(nullif(settings.timezone, ''), 'America/Lima')
  into lab_timezone
  from public.lab_settings settings
  where settings.id = true;
  lab_timezone := coalesce(lab_timezone, 'America/Lima');
  clinical_date := (occurred_at at time zone lab_timezone)::date;

  -- Serializa los registros del mismo paciente y dia para evitar dos ordenes
  -- cuando dos usuarios guardan casi al mismo tiempo.
  perform pg_advisory_xact_lock(
    hashtextextended(target_patient::text || ':' || clinical_date::text, 0)
  );

  select o.id, o.status
  into target_order, target_status
  from public.orders o
  where o.patient_id = target_patient
    and (o.ordered_at at time zone lab_timezone)::date = clinical_date
    and o.status <> 'cancelled'
    and (o.source_metadata->>'import_kind') is distinct from 'historical_results'
  order by o.ordered_at, o.order_number
  limit 1
  for update;

  if target_order is null then
    insert into public.orders(
      patient_id, status, priority, ordered_at, collected_at, received_at,
      created_by, updated_by
    ) values (
      target_patient, 'draft', 'routine', occurred_at, occurred_at, occurred_at,
      auth.uid(), auth.uid()
    ) returning id into target_order;

    insert into public.result_revisions(order_id, revision, status, created_by)
    values(target_order, 1, 'draft', auth.uid());
    new_analysis_count := selected_count;
  else
    select count(*) into new_analysis_count
    from public.analysis_versions av
    where av.id = any(selected_analysis_versions)
      and not exists (
        select 1
        from public.order_analyses oa
        where oa.order_id = target_order and oa.analysis_id = av.analysis_id
      );
  end if;

  if new_analysis_count > 0 and target_status in ('validated', 'delivered') then
    select * into previous_revision
    from public.result_revisions
    where order_id = target_order
    order by revision desc
    limit 1
    for update;

    insert into public.result_revisions(
      order_id, revision, status, amendment_reason, based_on_revision_id, created_by
    ) values (
      target_order, previous_revision.revision + 1, 'draft',
      'Analisis agregado a la orden diaria', previous_revision.id, auth.uid()
    ) returning id into new_revision_id;

    insert into public.result_values(
      revision_id, order_analysis_id, numeric_value, text_value,
      qualitative_value, flag, clinical_snapshot, created_by, updated_by
    )
    select
      new_revision_id, order_analysis_id, numeric_value, text_value,
      qualitative_value, flag, clinical_snapshot, auth.uid(), auth.uid()
    from public.result_values
    where revision_id = previous_revision.id;

    update public.orders
    set status = 'draft', updated_by = auth.uid(), lock_version = lock_version + 1
    where id = target_order;

  elsif new_analysis_count > 0 and target_status = 'pending_validation' then
    update public.result_revisions
    set status = 'draft'
    where id = (
      select id from public.result_revisions
      where order_id = target_order
      order by revision desc
      limit 1
    );

    update public.orders
    set status = 'draft', updated_by = auth.uid(), lock_version = lock_version + 1
    where id = target_order;
  end if;

  select coalesce(max(display_order), 0) into first_display_order
  from public.order_analyses
  where order_id = target_order;

  insert into public.order_analyses(
    order_id, analysis_id, analysis_version_id, display_order
  )
  select
    target_order, av.analysis_id, av.id,
    first_display_order + row_number() over(order by ag.display_order, a.name)
  from public.analysis_versions av
  join public.analyses a on a.id = av.analysis_id and a.active
  join public.analysis_groups ag on ag.id = a.group_id and ag.active
  where av.id = any(selected_analysis_versions)
    and not exists (
      select 1
      from public.order_analyses oa
      where oa.order_id = target_order and oa.analysis_id = av.analysis_id
    )
  on conflict (order_id, analysis_id) do nothing;

  get diagnostics inserted_count = row_count;
  if inserted_count > 0 and target_status = 'draft' then
    update public.orders
    set status = 'draft', updated_by = auth.uid(), lock_version = lock_version + 1
    where id = target_order;
  end if;

  return target_order;
end;
$$;

revoke all on function public.create_simple_order(uuid, uuid[], timestamptz)
  from public, anon;
grant execute on function public.create_simple_order(uuid, uuid[], timestamptz)
  to authenticated;

create or replace function public.register_daily_analyses(
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
  target_order uuid;
  target_revision uuid;
  analysis_versions uuid[];
  current_lock integer;
  entry jsonb;
  target_order_analysis uuid;
  entry_count integer;
  distinct_count integer;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if jsonb_typeof(result_entries) <> 'array' then raise exception 'invalid_result_entries'; end if;

  select
    count(*),
    count(distinct value->>'analysis_version_id'),
    array_agg((value->>'analysis_version_id')::uuid)
  into entry_count, distinct_count, analysis_versions
  from jsonb_array_elements(result_entries);

  if entry_count = 0 then raise exception 'analyses_required'; end if;
  if entry_count <> distinct_count then raise exception 'duplicate_analysis_version'; end if;
  if exists (
    select 1 from jsonb_array_elements(result_entries) item(value)
    where jsonb_typeof(item.value->'payload') <> 'object'
  ) then raise exception 'invalid_result_entries'; end if;

  target_order := public.create_simple_order(
    target_patient,
    analysis_versions,
    occurred_at
  );

  select rr.id, o.lock_version
  into target_revision, current_lock
  from public.orders o
  join public.result_revisions rr on rr.order_id = o.id
  where o.id = target_order and rr.status = 'draft'
  order by rr.revision desc
  limit 1;

  if target_revision is null then raise exception 'revision_not_editable'; end if;

  for entry in select value from jsonb_array_elements(result_entries)
  loop
    select oa.id into target_order_analysis
    from public.analysis_versions selected_version
    join public.order_analyses oa
      on oa.order_id = target_order
     and oa.analysis_id = selected_version.analysis_id
    where selected_version.id = (entry->>'analysis_version_id')::uuid;

    if target_order_analysis is null then raise exception 'analysis_not_in_order'; end if;

    perform public.save_result_draft(
      target_revision,
      target_order_analysis,
      entry->'payload',
      current_lock
    );
    current_lock := current_lock + 1;
  end loop;

  return jsonb_build_object(
    'order_id', target_order,
    'revision_id', target_revision,
    'lock_version', current_lock,
    'saved_results', entry_count
  );
end;
$$;

create or replace function public.record_order_group_print(
  target_order uuid,
  target_group text,
  expected_lock_version integer
)
returns public.orders
language plpgsql
security definer
set search_path = public
as $$
declare
  current_order public.orders;
  latest_revision public.result_revisions;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if char_length(trim(coalesce(target_group, ''))) = 0 then raise exception 'group_required'; end if;

  select * into current_order
  from public.orders
  where id = target_order
  for update;

  if not found then raise exception 'order_not_found'; end if;
  if current_order.status = 'cancelled' then raise exception 'cancelled_order'; end if;
  if current_order.lock_version <> expected_lock_version then raise exception 'concurrent_change'; end if;

  select * into latest_revision
  from public.result_revisions
  where order_id = target_order
  order by revision desc
  limit 1;

  if not exists (
    select 1
    from public.order_analyses oa
    join public.analyses a on a.id = oa.analysis_id
    join public.analysis_groups ag on ag.id = a.group_id
    where oa.order_id = target_order and ag.name = trim(target_group)
  ) then raise exception 'group_not_in_order'; end if;

  if exists (
    select 1
    from public.order_analyses oa
    join public.analyses a on a.id = oa.analysis_id
    join public.analysis_groups ag on ag.id = a.group_id
    where oa.order_id = target_order
      and ag.name = trim(target_group)
      and not exists (
        select 1 from public.result_values rv
        where rv.revision_id = latest_revision.id
          and rv.order_analysis_id = oa.id
          and num_nonnulls(rv.numeric_value, rv.text_value, rv.qualitative_value) = 1
      )
  ) then raise exception 'all_group_results_required'; end if;

  if current_order.status in ('draft', 'pending_validation') and not exists (
    select 1
    from public.order_analyses oa
    where oa.order_id = target_order
      and not exists (
        select 1 from public.result_values rv
        where rv.revision_id = latest_revision.id
          and rv.order_analysis_id = oa.id
          and num_nonnulls(rv.numeric_value, rv.text_value, rv.qualitative_value) = 1
      )
  ) then
    update public.orders
    set status = 'validated', validated_at = now(), validated_by = auth.uid(),
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

revoke all on function public.register_daily_analyses(uuid, jsonb, timestamptz)
  from public, anon;
revoke all on function public.record_order_group_print(uuid, text, integer)
  from public, anon;
grant execute on function public.register_daily_analyses(uuid, jsonb, timestamptz)
  to authenticated;
grant execute on function public.record_order_group_print(uuid, text, integer)
  to authenticated;

commit;
