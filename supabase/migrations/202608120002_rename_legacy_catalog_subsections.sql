begin;

create or replace function public.rename_catalog_subsection_by_name(
  target_group uuid,
  current_name text,
  subsection_name text
)
returns public.analysis_subsections
language plpgsql security definer set search_path = public as $$
declare
  current_row public.analysis_subsections;
  updated_row public.analysis_subsections;
  first_order integer;
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  if char_length(trim(coalesce(current_name, ''))) not between 2 and 80 then raise exception 'invalid_subsection_name'; end if;
  if char_length(trim(coalesce(subsection_name, ''))) not between 2 and 80 then raise exception 'invalid_subsection_name'; end if;
  if not exists(select 1 from public.analysis_groups where id = target_group and active) then raise exception 'group_not_found'; end if;

  select * into current_row
  from public.analysis_subsections
  where group_id = target_group and lower(trim(name)) = lower(trim(current_name))
  for update;

  if current_row.id is null then
    select coalesce(min((source_metadata->>'picker_order')::integer), 999)
    into first_order
    from public.analyses
    where group_id = target_group
      and lower(trim(source_metadata->>'picker_subsection')) = lower(trim(current_name));

    if not exists(
      select 1 from public.analyses
      where group_id = target_group
        and lower(trim(source_metadata->>'picker_subsection')) = lower(trim(current_name))
    ) then raise exception 'subsection_not_found'; end if;

    insert into public.analysis_subsections(group_id, name, display_order)
    values (target_group, trim(subsection_name), first_order)
    returning * into updated_row;
  else
    update public.analysis_subsections
    set name = trim(subsection_name), updated_at = now()
    where id = current_row.id
    returning * into updated_row;
  end if;

  update public.analyses
  set source_metadata = jsonb_set(
    coalesce(source_metadata, '{}'::jsonb),
    '{picker_subsection}',
    to_jsonb(trim(subsection_name)),
    true
  )
  where group_id = target_group
    and lower(trim(source_metadata->>'picker_subsection')) = lower(trim(current_name));

  return updated_row;
end;
$$;

revoke all on function public.rename_catalog_subsection_by_name(uuid,text,text) from public, anon;
grant execute on function public.rename_catalog_subsection_by_name(uuid,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
