-- Editar un análisis desde el Catálogo fallaba siempre con
-- «column reference "analysis_id" is ambiguous».
--
-- La variable PL/pgSQL `analysis_id` se llamaba igual que la columna
-- `analysis_versions.analysis_id`, y la rama de edición es la única que las usa
-- juntas en la misma sentencia:
--
--   select coalesce(max(version), 0) + 1 into next_version
--     from public.analysis_versions where analysis_id = target_analysis;
--   update public.analysis_versions set effective_to = now()
--    where analysis_id = target_analysis and effective_to is null;
--
-- Con `plpgsql.variable_conflict = error` (el valor por defecto) Postgres aborta.
-- Por eso crear análisis funcionaba y editarlos no.
--
-- La variable pasa a llamarse `saved_analysis`. El cuerpo es idéntico al
-- anterior en todo lo demás.

create or replace function public.save_catalog_analysis(
  target_analysis uuid, target_group uuid, target_subsection text, analysis_name text,
  approved_result_type text, approved_sample_type text, approved_method text, approved_unit text,
  approved_decimals integer, approved_qualitative_options jsonb, approved_reference_ranges jsonb,
  approved_critical_limits jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare saved_analysis uuid; previous_group uuid; next_version integer; next_order integer; generated_code text;
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

  insert into public.analysis_versions(
    analysis_id, version, sample_type, method, unit, decimals, qualitative_options,
    reference_ranges, critical_limits, approved_by, clinical_status
  ) values (
    saved_analysis, next_version, trim(approved_sample_type), nullif(trim(coalesce(approved_method, '')), ''),
    nullif(trim(coalesce(approved_unit, '')), ''), case when approved_result_type = 'numeric' then approved_decimals else null end,
    case when approved_result_type = 'qualitative' then approved_qualitative_options else null end,
    coalesce(approved_reference_ranges, '[]'::jsonb), coalesce(approved_critical_limits, '{}'::jsonb), auth.uid(), 'approved'
  );
  return saved_analysis;
end;
$function$;
