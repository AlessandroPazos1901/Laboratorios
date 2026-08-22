-- Agrega Globulinas como resultado calculado y documenta las dependencias
-- exactas indicadas por el laboratorio. Los UUID pueden corresponder al
-- análisis o a su versión vigente, por eso se resuelven ambos casos.

do $migration$
declare
  indirect_analysis uuid;
  proteins_analysis uuid;
  albumin_analysis uuid;
  proteins_group uuid;
  albumin_group uuid;
  actor uuid;
  globulins_analysis uuid;
  next_version integer;
  proteins_unit text;
  proteins_decimals integer;
begin
  select resolved.analysis_id into indirect_analysis
  from (
    select a.id as analysis_id, 1 as priority
    from public.analyses a
    where a.id = '1acf7da9-7726-4869-9b0c-b4306e998eae'::uuid
    union all
    select v.analysis_id, 2
    from public.analysis_versions v
    where v.id = '1acf7da9-7726-4869-9b0c-b4306e998eae'::uuid
  ) resolved
  order by resolved.priority
  limit 1;

  select resolved.analysis_id into proteins_analysis
  from (
    select a.id as analysis_id, 1 as priority
    from public.analyses a
    where a.id = '43cdd789-4b21-401b-bd71-e0e12615c82b'::uuid
    union all
    select v.analysis_id, 2
    from public.analysis_versions v
    where v.id = '43cdd789-4b21-401b-bd71-e0e12615c82b'::uuid
  ) resolved
  order by resolved.priority
  limit 1;

  select resolved.analysis_id into albumin_analysis
  from (
    select a.id as analysis_id, 1 as priority
    from public.analyses a
    where a.id = 'cd8a5b70-6ff6-4118-b3f5-ea3eb2bad2fd'::uuid
    union all
    select v.analysis_id, 2
    from public.analysis_versions v
    where v.id = 'cd8a5b70-6ff6-4118-b3f5-ea3eb2bad2fd'::uuid
  ) resolved
  order by resolved.priority
  limit 1;

  if indirect_analysis is null then
    raise exception 'No se encontró B. Indirecta (1acf7da9-7726-4869-9b0c-b4306e998eae)';
  end if;
  if proteins_analysis is null then
    raise exception 'No se encontró Proteínas (43cdd789-4b21-401b-bd71-e0e12615c82b)';
  end if;
  if albumin_analysis is null then
    raise exception 'No se encontró Albúminas (cd8a5b70-6ff6-4118-b3f5-ea3eb2bad2fd)';
  end if;

  select a.group_id, a.created_by into proteins_group, actor
  from public.analyses a where a.id = proteins_analysis;
  select a.group_id into albumin_group
  from public.analyses a where a.id = albumin_analysis;

  if proteins_group is distinct from albumin_group then
    raise exception 'Proteínas y Albúminas pertenecen a secciones diferentes';
  end if;

  if actor is null then
    select a.created_by into actor
    from public.analyses a
    where a.created_by is not null
    order by a.created_at
    limit 1;
  end if;
  if actor is null then
    raise exception 'No existe un usuario para atribuir Globulinas';
  end if;

  -- Estas claves dejan auditada la dependencia en el catálogo. La interfaz usa
  -- las mismas claves para recalcular y bloquear los resultados derivados.
  update public.analyses
  set source_metadata = coalesce(source_metadata, '{}'::jsonb)
    || jsonb_build_object(
      'formula_key', 'BIO-BI',
      'calculated', true,
      'formula', 'Bilirrubina total - Bilirrubina directa'
    )
  where id = indirect_analysis;

  update public.analyses
  set source_metadata = coalesce(source_metadata, '{}'::jsonb)
    || jsonb_build_object('formula_key', 'BIO-PROT')
  where id = proteins_analysis;

  update public.analyses
  set source_metadata = coalesce(source_metadata, '{}'::jsonb)
    || jsonb_build_object('formula_key', 'BIO-ALB')
  where id = albumin_analysis;

  select v.unit, v.decimals into proteins_unit, proteins_decimals
  from public.analysis_versions v
  where v.analysis_id = proteins_analysis and v.effective_to is null
  order by v.version desc
  limit 1;

  insert into public.analyses(
    code, group_id, name, result_type, active, created_by, source_metadata
  )
  select
    'BIO-GLOB', proteins_group, 'GLOBULINAS', 'numeric'::public.result_type,
    true, actor,
    jsonb_build_object(
      'picker_order', coalesce((p.source_metadata->>'picker_order')::integer, 120) + 2,
      'picker_common', false,
      'picker_subsection', coalesce(p.source_metadata->>'picker_subsection', 'Perfil hepático'),
      'formula_key', 'BIO-GLOB',
      'calculated', true,
      'formula', 'Proteínas - Albúminas',
      'formula_source_analysis_ids', jsonb_build_array(proteins_analysis, albumin_analysis),
      'source', 'requested calculated analysis 2026-08-20'
    )
  from public.analyses p
  where p.id = proteins_analysis
  on conflict (code) do update
  set group_id = excluded.group_id,
      name = excluded.name,
      result_type = excluded.result_type,
      active = true,
      archived_at = null,
      source_metadata = coalesce(public.analyses.source_metadata, '{}'::jsonb)
        || excluded.source_metadata
  returning id into globulins_analysis;

  if not exists (
    select 1 from public.analysis_versions v
    where v.analysis_id = globulins_analysis and v.effective_to is null
  ) then
    select coalesce(max(v.version), 0) + 1 into next_version
    from public.analysis_versions v
    where v.analysis_id = globulins_analysis;

    insert into public.analysis_versions(
      analysis_id, version, sample_type, method, unit, decimals,
      qualitative_options, reference_ranges, critical_limits,
      approved_by, clinical_status, source_metadata
    ) values (
      globulins_analysis, next_version, 'Suero', 'Calculado',
      coalesce(proteins_unit, 'g/dL'), coalesce(proteins_decimals, 2),
      null, jsonb_build_array(jsonb_build_object('label', 'Según método')),
      '{}'::jsonb, actor, 'approved',
      jsonb_build_object(
        'migration', '202608200003',
        'formula', 'Proteínas - Albúminas',
        'source_analysis_ids', jsonb_build_array(proteins_analysis, albumin_analysis)
      )
    );
  end if;
end;
$migration$;
