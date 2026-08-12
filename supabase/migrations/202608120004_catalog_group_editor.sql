begin;

create or replace function public.create_catalog_group(group_name text)
returns public.analysis_groups
language plpgsql security definer set search_path = public as $$
declare
  created public.analysis_groups;
  generated_code text;
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  if char_length(trim(coalesce(group_name, ''))) not between 2 and 80 then raise exception 'invalid_group_name'; end if;
  generated_code := 'CUS-GRP-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.analysis_groups(code, name, display_order, active)
  values (
    generated_code,
    trim(group_name),
    coalesce((select max(display_order) + 10 from public.analysis_groups), 10),
    true
  ) returning * into created;
  return created;
end;
$$;

create or replace function public.rename_catalog_group(target_group uuid, group_name text)
returns public.analysis_groups
language plpgsql security definer set search_path = public as $$
declare updated_row public.analysis_groups;
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  if char_length(trim(coalesce(group_name, ''))) not between 2 and 80 then raise exception 'invalid_group_name'; end if;
  update public.analysis_groups
  set name = trim(group_name)
  where id = target_group and active
  returning * into updated_row;
  if updated_row.id is null then raise exception 'group_not_found'; end if;
  return updated_row;
end;
$$;

create or replace function public.archive_catalog_group(target_group uuid)
returns boolean
language plpgsql security definer set search_path = public as $$
begin
  if not public.current_profile_is_owner() then raise exception 'owner_required'; end if;
  update public.analysis_groups set active = false where id = target_group and active;
  if not found then raise exception 'group_not_found'; end if;
  update public.analyses
  set active = false, archived_at = coalesce(archived_at, now())
  where group_id = target_group and active;
  return true;
end;
$$;

revoke all on function public.create_catalog_group(text) from public, anon;
revoke all on function public.rename_catalog_group(uuid,text) from public, anon;
revoke all on function public.archive_catalog_group(uuid) from public, anon;
grant execute on function public.create_catalog_group(text) to authenticated;
grant execute on function public.rename_catalog_group(uuid,text) to authenticated;
grant execute on function public.archive_catalog_group(uuid) to authenticated;

notify pgrst, 'reload schema';
commit;
