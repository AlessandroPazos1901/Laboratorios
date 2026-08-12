begin;

create or replace function public.delete_catalog_subsection_by_name(
  target_group uuid,
  current_name text
)
returns boolean
language plpgsql security definer set search_path = public as $$
declare
  removed_sections integer;
  updated_analyses integer;
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  if char_length(trim(coalesce(current_name, ''))) not between 2 and 80 then raise exception 'invalid_subsection_name'; end if;

  delete from public.analysis_subsections
  where group_id = target_group
    and lower(trim(name)) = lower(trim(current_name));
  get diagnostics removed_sections = row_count;

  update public.analyses
  set source_metadata = coalesce(source_metadata, '{}'::jsonb) - 'picker_subsection'
  where group_id = target_group
    and lower(trim(source_metadata->>'picker_subsection')) = lower(trim(current_name));
  get diagnostics updated_analyses = row_count;

  if removed_sections = 0 and updated_analyses = 0 then raise exception 'subsection_not_found'; end if;
  return true;
end;
$$;

revoke all on function public.delete_catalog_subsection_by_name(uuid,text) from public, anon;
grant execute on function public.delete_catalog_subsection_by_name(uuid,text) to authenticated;

notify pgrst, 'reload schema';
commit;
