begin;

create table if not exists public.analysis_subsections (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references public.analysis_groups(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 2 and 80),
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists analysis_subsections_group_name_key
  on public.analysis_subsections(group_id, lower(name));

alter table public.analysis_subsections enable row level security;
drop policy if exists analysis_subsections_staff_read on public.analysis_subsections;
drop policy if exists analysis_subsections_owner_write on public.analysis_subsections;
create policy analysis_subsections_staff_read on public.analysis_subsections
  for select using (public.current_profile_is_active());
create policy analysis_subsections_owner_write on public.analysis_subsections
  for all using (public.current_profile_is_owner()) with check (public.current_profile_is_owner());

insert into public.analysis_subsections(group_id, name, display_order)
select
  a.group_id,
  trim(a.source_metadata->>'picker_subsection'),
  min(coalesce((a.source_metadata->>'picker_order')::integer, 999))
from public.analyses a
where nullif(trim(a.source_metadata->>'picker_subsection'), '') is not null
group by a.group_id, lower(trim(a.source_metadata->>'picker_subsection')), trim(a.source_metadata->>'picker_subsection')
on conflict do nothing;

create or replace function public.create_catalog_subsection(target_group uuid, subsection_name text)
returns public.analysis_subsections
language plpgsql security definer set search_path = public as $$
declare created public.analysis_subsections;
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  if char_length(trim(coalesce(subsection_name, ''))) not between 2 and 80 then raise exception 'invalid_subsection_name'; end if;
  if not exists(select 1 from public.analysis_groups where id = target_group and active) then raise exception 'group_not_found'; end if;
  insert into public.analysis_subsections(group_id, name, display_order)
  values (
    target_group,
    trim(subsection_name),
    coalesce((select max(display_order) + 10 from public.analysis_subsections where group_id = target_group), 10)
  ) returning * into created;
  return created;
end;
$$;

create or replace function public.rename_catalog_subsection(target_subsection uuid, subsection_name text)
returns public.analysis_subsections
language plpgsql security definer set search_path = public as $$
declare current_row public.analysis_subsections; updated_row public.analysis_subsections;
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  if char_length(trim(coalesce(subsection_name, ''))) not between 2 and 80 then raise exception 'invalid_subsection_name'; end if;
  select * into current_row from public.analysis_subsections where id = target_subsection for update;
  if current_row.id is null then raise exception 'subsection_not_found'; end if;
  update public.analyses
  set source_metadata = jsonb_set(coalesce(source_metadata, '{}'::jsonb), '{picker_subsection}', to_jsonb(trim(subsection_name)), true)
  where group_id = current_row.group_id
    and lower(trim(source_metadata->>'picker_subsection')) = lower(trim(current_row.name));
  update public.analysis_subsections
  set name = trim(subsection_name), updated_at = now()
  where id = target_subsection returning * into updated_row;
  return updated_row;
end;
$$;

create or replace function public.delete_catalog_subsection(target_subsection uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
declare current_row public.analysis_subsections;
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  select * into current_row from public.analysis_subsections where id = target_subsection for update;
  if current_row.id is null then raise exception 'subsection_not_found'; end if;
  update public.analyses
  set source_metadata = coalesce(source_metadata, '{}'::jsonb) - 'picker_subsection'
  where group_id = current_row.group_id
    and lower(trim(source_metadata->>'picker_subsection')) = lower(trim(current_row.name));
  delete from public.analysis_subsections where id = target_subsection;
  return true;
end;
$$;

create or replace function public.reorder_catalog_subsections(target_group uuid, subsection_ids uuid[])
returns boolean
language plpgsql security definer set search_path = public as $$
declare invalid_count integer;
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  select count(*) into invalid_count
  from unnest(coalesce(subsection_ids, '{}'::uuid[])) with ordinality item(id, position)
  left join public.analysis_subsections section on section.id = item.id and section.group_id = target_group
  where section.id is null;
  if invalid_count > 0 then raise exception 'invalid_subsection_order'; end if;
  update public.analysis_subsections section
  set display_order = item.position * 10, updated_at = now()
  from unnest(coalesce(subsection_ids, '{}'::uuid[])) with ordinality item(id, position)
  where section.id = item.id and section.group_id = target_group;
  return true;
end;
$$;

create or replace function public.save_catalog_layout(target_group uuid, layout jsonb)
returns boolean
language plpgsql security definer set search_path = public as $$
declare item record; subsection_exists boolean;
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  if jsonb_typeof(coalesce(layout, '[]'::jsonb)) <> 'array' then raise exception 'invalid_catalog_layout'; end if;
  for item in
    select * from jsonb_to_recordset(layout) as entry(analysis_id uuid, subsection text, display_order integer)
  loop
    if not exists(select 1 from public.analyses where id = item.analysis_id and group_id = target_group) then
      raise exception 'analysis_not_in_group';
    end if;
    if nullif(trim(coalesce(item.subsection, '')), '') is not null then
      select exists(
        select 1 from public.analysis_subsections
        where group_id = target_group and lower(name) = lower(trim(item.subsection))
      ) into subsection_exists;
      if not subsection_exists then raise exception 'subsection_not_found'; end if;
    end if;
    update public.analyses
    set source_metadata = case
      when nullif(trim(coalesce(item.subsection, '')), '') is null
        then jsonb_set(coalesce(source_metadata, '{}'::jsonb) - 'picker_subsection', '{picker_order}', to_jsonb(item.display_order), true)
      else jsonb_set(
        jsonb_set(coalesce(source_metadata, '{}'::jsonb), '{picker_order}', to_jsonb(item.display_order), true),
        '{picker_subsection}', to_jsonb(trim(item.subsection)), true
      )
    end
    where id = item.analysis_id;
  end loop;
  return true;
end;
$$;

create or replace function public.save_catalog_analysis(
  target_analysis uuid,
  target_group uuid,
  target_subsection text,
  analysis_name text,
  approved_result_type text,
  approved_sample_type text,
  approved_method text,
  approved_unit text,
  approved_decimals integer,
  approved_qualitative_options jsonb,
  approved_reference_ranges jsonb,
  approved_critical_limits jsonb
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare analysis_id uuid; previous_group uuid; next_version integer; next_order integer; generated_code text;
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

  if target_analysis is null then
    generated_code := 'CUS-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    select coalesce(max((source_metadata->>'picker_order')::integer), 0) + 10 into next_order
    from public.analyses where group_id = target_group;
    insert into public.analyses(code, group_id, name, result_type, active, created_by, source_metadata)
    values (
      generated_code, target_group, trim(analysis_name), approved_result_type::public.result_type, true, auth.uid(),
      jsonb_strip_nulls(jsonb_build_object('picker_order', next_order, 'picker_subsection', nullif(trim(coalesce(target_subsection, '')), ''), 'picker_common', true))
    ) returning id into analysis_id;
    next_version := 1;
  else
    select id, group_id into analysis_id, previous_group from public.analyses where id = target_analysis for update;
    if analysis_id is null then raise exception 'analysis_not_found'; end if;
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

  insert into public.analysis_versions(
    analysis_id, version, sample_type, method, unit, decimals, qualitative_options,
    reference_ranges, critical_limits, approved_by, clinical_status
  ) values (
    analysis_id, next_version, trim(approved_sample_type), nullif(trim(coalesce(approved_method, '')), ''),
    nullif(trim(coalesce(approved_unit, '')), ''), case when approved_result_type = 'numeric' then approved_decimals else null end,
    case when approved_result_type = 'qualitative' then approved_qualitative_options else null end,
    coalesce(approved_reference_ranges, '[]'::jsonb), coalesce(approved_critical_limits, '{}'::jsonb), auth.uid(), 'approved'
  );
  return analysis_id;
end;
$$;

create or replace function public.archive_catalog_analysis(target_analysis uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  update public.analyses set active = false, archived_at = now() where id = target_analysis;
  if not found then raise exception 'analysis_not_found'; end if;
  return true;
end;
$$;

revoke all on function public.create_catalog_subsection(uuid,text) from public, anon;
revoke all on function public.rename_catalog_subsection(uuid,text) from public, anon;
revoke all on function public.delete_catalog_subsection(uuid) from public, anon;
revoke all on function public.reorder_catalog_subsections(uuid,uuid[]) from public, anon;
revoke all on function public.save_catalog_layout(uuid,jsonb) from public, anon;
revoke all on function public.save_catalog_analysis(uuid,uuid,text,text,text,text,text,text,integer,jsonb,jsonb,jsonb) from public, anon;
revoke all on function public.archive_catalog_analysis(uuid) from public, anon;
grant execute on function public.create_catalog_subsection(uuid,text) to authenticated;
grant execute on function public.rename_catalog_subsection(uuid,text) to authenticated;
grant execute on function public.delete_catalog_subsection(uuid) to authenticated;
grant execute on function public.reorder_catalog_subsections(uuid,uuid[]) to authenticated;
grant execute on function public.save_catalog_layout(uuid,jsonb) to authenticated;
grant execute on function public.save_catalog_analysis(uuid,uuid,text,text,text,text,text,text,integer,jsonb,jsonb,jsonb) to authenticated;
grant execute on function public.archive_catalog_analysis(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
