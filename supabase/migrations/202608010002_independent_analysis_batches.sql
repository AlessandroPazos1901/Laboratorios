-- Conserva cada registro como una tanda independiente dentro de la orden diaria.
begin;

create table if not exists public.order_analysis_batches (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  group_id uuid not null references public.analysis_groups(id) on delete restrict,
  registered_at timestamptz not null default now(),
  created_by uuid not null references public.profiles(id),
  source_key text,
  created_at timestamptz not null default now(),
  unique(order_id, source_key)
);

alter table public.order_analyses
  add column if not exists batch_id uuid references public.order_analysis_batches(id) on delete restrict;

insert into public.order_analysis_batches(
  order_id, group_id, registered_at, created_by, source_key
)
select
  oa.order_id,
  a.group_id,
  min(oa.created_at),
  o.created_by,
  'legacy:' || a.group_id::text
from public.order_analyses oa
join public.analyses a on a.id = oa.analysis_id
join public.orders o on o.id = oa.order_id
where oa.batch_id is null
group by oa.order_id, a.group_id, o.created_by
on conflict (order_id, source_key) do nothing;

update public.order_analyses oa
set batch_id = batch.id
from public.analyses a, public.order_analysis_batches batch
where oa.batch_id is null
  and a.id = oa.analysis_id
  and batch.order_id = oa.order_id
  and batch.group_id = a.group_id
  and batch.source_key = 'legacy:' || a.group_id::text;

alter table public.order_analyses
  drop constraint if exists order_analyses_order_id_analysis_id_key;

create unique index if not exists order_analyses_batch_analysis_uidx
  on public.order_analyses(batch_id, analysis_id)
  where batch_id is not null;
create index if not exists order_analysis_batches_order_date_idx
  on public.order_analysis_batches(order_id, registered_at desc);

alter table public.order_analysis_batches enable row level security;
drop policy if exists order_analysis_batches_staff_read on public.order_analysis_batches;
create policy order_analysis_batches_staff_read on public.order_analysis_batches
for select using (public.current_profile_is_active());
revoke all on public.order_analysis_batches from public, anon;
grant select on public.order_analysis_batches to authenticated;

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
  if not exists (
    select 1 from public.patients where id = target_patient and archived_at is null
  ) then raise exception 'patient_not_found'; end if;

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

  select count(*) into valid_count
  from public.analysis_versions av
  join public.analyses a on a.id = av.analysis_id and a.active
  join public.analysis_groups ag on ag.id = a.group_id and ag.active
  where av.id = any(analysis_versions)
    and av.clinical_status = 'approved'
    and av.effective_from <= occurred_at
    and (av.effective_to is null or av.effective_to > occurred_at);
  if valid_count <> entry_count then raise exception 'invalid_or_inactive_analysis_version'; end if;

  select coalesce(nullif(settings.timezone, ''), 'America/Lima')
  into lab_timezone
  from public.lab_settings settings
  where settings.id = true;
  lab_timezone := coalesce(lab_timezone, 'America/Lima');
  clinical_date := (occurred_at at time zone lab_timezone)::date;

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
    values(target_order, 1, 'draft', auth.uid())
    returning id into target_revision;
  elsif target_status in ('validated', 'delivered') then
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
      'Nueva tanda agregada a la orden diaria', previous_revision.id, auth.uid()
    ) returning id into target_revision;

    insert into public.result_values(
      revision_id, order_analysis_id, numeric_value, text_value,
      qualitative_value, flag, clinical_snapshot, created_by, updated_by
    )
    select
      target_revision, order_analysis_id, numeric_value, text_value,
      qualitative_value, flag, clinical_snapshot, auth.uid(), auth.uid()
    from public.result_values
    where revision_id = previous_revision.id;

    update public.orders
    set status = 'draft', updated_by = auth.uid(), lock_version = lock_version + 1
    where id = target_order;
  else
    select id into target_revision
    from public.result_revisions
    where order_id = target_order
    order by revision desc
    limit 1
    for update;

    if target_status = 'pending_validation' then
      update public.result_revisions set status = 'draft' where id = target_revision;
      update public.orders set status = 'draft', updated_by = auth.uid() where id = target_order;
    end if;
  end if;

  select coalesce(max(display_order), 0) into first_display_order
  from public.order_analyses
  where order_id = target_order;

  for selected_group in
    select distinct a.group_id
    from public.analysis_versions av
    join public.analyses a on a.id = av.analysis_id
    where av.id = any(analysis_versions)
  loop
    insert into public.order_analysis_batches(
      order_id, group_id, registered_at, created_by
    ) values (
      target_order, selected_group.group_id, occurred_at, auth.uid()
    ) returning id into new_batch;
    created_batches := array_append(created_batches, new_batch);

    insert into public.order_analyses(
      order_id, analysis_id, analysis_version_id, batch_id, display_order
    )
    select
      target_order, av.analysis_id, av.id, new_batch,
      first_display_order + row_number() over(order by ag.display_order, a.name)
    from public.analysis_versions av
    join public.analyses a on a.id = av.analysis_id
    join public.analysis_groups ag on ag.id = a.group_id
    where av.id = any(analysis_versions)
      and a.group_id = selected_group.group_id;

    get diagnostics inserted_group_count = row_count;
    first_display_order := first_display_order + inserted_group_count;
  end loop;

  update public.orders
  set updated_by = auth.uid(), lock_version = lock_version + 1
  where id = target_order
  returning lock_version into current_lock;

  for entry in select value from jsonb_array_elements(result_entries)
  loop
    select oa.id into target_order_analysis
    from public.order_analyses oa
    where oa.order_id = target_order
      and oa.batch_id = any(created_batches)
      and oa.analysis_version_id = (entry->>'analysis_version_id')::uuid;

    if target_order_analysis is null then raise exception 'analysis_not_in_order'; end if;
    perform public.save_result_draft(
      target_revision, target_order_analysis, entry->'payload', current_lock
    );
    current_lock := current_lock + 1;
  end loop;

  return jsonb_build_object(
    'order_id', target_order,
    'revision_id', target_revision,
    'batch_ids', created_batches,
    'lock_version', current_lock,
    'saved_results', entry_count
  );
end;
$$;

create or replace function public.record_order_batch_print(
  target_order uuid,
  target_batch uuid,
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
  batch_group text;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;

  select * into current_order
  from public.orders
  where id = target_order
  for update;
  if not found then raise exception 'order_not_found'; end if;
  if current_order.status = 'cancelled' then raise exception 'cancelled_order'; end if;
  if current_order.lock_version <> expected_lock_version then raise exception 'concurrent_change'; end if;

  select ag.name into batch_group
  from public.order_analysis_batches batch
  join public.analysis_groups ag on ag.id = batch.group_id
  where batch.id = target_batch and batch.order_id = target_order;
  if batch_group is null then raise exception 'batch_not_in_order'; end if;

  select * into latest_revision
  from public.result_revisions
  where order_id = target_order
  order by revision desc
  limit 1;

  if exists (
    select 1 from public.order_analyses oa
    where oa.order_id = target_order and oa.batch_id = target_batch
      and not exists (
        select 1 from public.result_values rv
        where rv.revision_id = latest_revision.id
          and rv.order_analysis_id = oa.id
          and num_nonnulls(rv.numeric_value, rv.text_value, rv.qualitative_value) = 1
      )
  ) then raise exception 'all_batch_results_required'; end if;

  if current_order.status in ('draft', 'pending_validation') and not exists (
    select 1 from public.order_analyses oa
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

revoke all on function public.record_order_batch_print(uuid, uuid, integer)
  from public, anon;
grant execute on function public.record_order_batch_print(uuid, uuid, integer)
  to authenticated;

commit;
