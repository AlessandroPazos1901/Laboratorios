-- Guardado atómico de resultados y aprobación explícita del catálogo.
begin;

create or replace function public.save_result_batch(
  target_revision uuid,
  result_entries jsonb,
  expected_lock_version integer
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  revision_order uuid;
  current_lock integer := expected_lock_version;
  entry jsonb;
  target_order_analysis uuid;
  entry_count integer;
  distinct_count integer;
  result_rows jsonb;
begin
  if not public.current_profile_is_active() then
    raise exception 'not_authorized';
  end if;
  if jsonb_typeof(result_entries) <> 'array' then
    raise exception 'invalid_result_entries';
  end if;

  select rr.order_id into revision_order
  from public.result_revisions rr
  join public.orders o on o.id = rr.order_id
  where rr.id = target_revision
    and rr.status = 'draft'
    and o.status in ('draft', 'pending_validation');

  if revision_order is null then
    raise exception 'revision_not_editable';
  end if;

  select count(*), count(distinct value->>'order_analysis_id')
  into entry_count, distinct_count
  from jsonb_array_elements(result_entries);
  if entry_count <> distinct_count then
    raise exception 'duplicate_result_entry';
  end if;

  for entry in select value from jsonb_array_elements(result_entries)
  loop
    target_order_analysis := (entry->>'order_analysis_id')::uuid;
    if not exists (
      select 1 from public.order_analyses
      where id = target_order_analysis and order_id = revision_order
    ) then
      raise exception 'analysis_not_in_order';
    end if;

    if coalesce((entry->>'clear')::boolean, false) then
      delete from public.result_values
      where revision_id = target_revision
        and order_analysis_id = target_order_analysis;

      update public.orders
      set lock_version = lock_version + 1
      where id = revision_order and lock_version = current_lock
      returning lock_version into current_lock;
      if not found then raise exception 'concurrent_change'; end if;
    else
      perform public.save_result_draft(
        target_revision,
        target_order_analysis,
        entry->'payload',
        current_lock
      );
      current_lock := current_lock + 1;
    end if;
  end loop;

  select coalesce(
    jsonb_agg(jsonb_build_object(
      'order_analysis_id', oa.id,
      'id', rv.id,
      'flag', rv.flag
    ) order by oa.display_order),
    '[]'::jsonb
  )
  into result_rows
  from public.order_analyses oa
  left join public.result_values rv
    on rv.order_analysis_id = oa.id
   and rv.revision_id = target_revision
  where oa.order_id = revision_order;

  return jsonb_build_object(
    'lock_version', current_lock,
    'results', result_rows
  );
end;
$$;

create or replace function public.approve_analysis_version(
  target_analysis uuid,
  approved_result_type text,
  approved_sample_type text,
  approved_method text default null,
  approved_unit text default null,
  approved_decimals integer default null,
  approved_qualitative_options jsonb default null,
  approved_reference_ranges jsonb default '[]'::jsonb,
  approved_critical_limits jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  new_version integer;
  new_version_id uuid;
begin
  if not public.current_profile_is_owner() then
    raise exception 'owner_required';
  end if;
  if approved_result_type not in ('numeric', 'qualitative', 'text') then
    raise exception 'invalid_result_type';
  end if;
  if char_length(trim(coalesce(approved_sample_type, ''))) < 2 then
    raise exception 'sample_type_required';
  end if;
  if approved_decimals is not null and approved_decimals not between 0 and 8 then
    raise exception 'invalid_decimals';
  end if;
  if approved_result_type = 'numeric'
    and (
      jsonb_typeof(coalesce(approved_reference_ranges, '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(approved_reference_ranges, '[]'::jsonb)) = 0
    )
  then
    raise exception 'reference_range_required';
  end if;
  if approved_result_type = 'qualitative'
    and (
      jsonb_typeof(coalesce(approved_qualitative_options, '[]'::jsonb)) <> 'array'
      or jsonb_array_length(coalesce(approved_qualitative_options, '[]'::jsonb)) = 0
    )
  then
    raise exception 'qualitative_options_required';
  end if;

  perform 1 from public.analyses where id = target_analysis for update;
  if not found then raise exception 'analysis_not_found'; end if;

  update public.analysis_versions
  set effective_to = now()
  where analysis_id = target_analysis and effective_to is null;

  select coalesce(max(version), 0) + 1
  into new_version
  from public.analysis_versions
  where analysis_id = target_analysis;

  insert into public.analysis_versions(
    analysis_id, version, sample_type, method, unit, decimals,
    qualitative_options, reference_ranges, critical_limits, approved_by
  ) values (
    target_analysis,
    new_version,
    trim(approved_sample_type),
    nullif(trim(coalesce(approved_method, '')), ''),
    nullif(trim(coalesce(approved_unit, '')), ''),
    approved_decimals,
    case when approved_result_type = 'qualitative'
      then approved_qualitative_options else null end,
    coalesce(approved_reference_ranges, '[]'::jsonb),
    coalesce(approved_critical_limits, '{}'::jsonb),
    auth.uid()
  )
  returning id into new_version_id;

  update public.analyses
  set
    result_type = approved_result_type::public.result_type,
    active = true,
    archived_at = null,
    source_metadata = source_metadata || jsonb_build_object(
      'clinical_review', 'approved',
      'clinical_reviewed_at', now(),
      'clinical_reviewed_by', auth.uid()
    )
  where id = target_analysis;

  return new_version_id;
end;
$$;

revoke all on function public.save_result_batch(uuid,jsonb,integer)
  from public, anon;
revoke all on function public.approve_analysis_version(uuid,text,text,text,text,integer,jsonb,jsonb,jsonb)
  from public, anon;
grant execute on function public.save_result_batch(uuid,jsonb,integer)
  to authenticated;
grant execute on function public.approve_analysis_version(uuid,text,text,text,text,integer,jsonb,jsonb,jsonb)
  to authenticated;

commit;
