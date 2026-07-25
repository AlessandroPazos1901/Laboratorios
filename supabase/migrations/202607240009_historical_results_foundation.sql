-- Importación histórica segura: conserva resultados legados sin convertirlos
-- en reglas clínicas aprobadas para órdenes nuevas.
begin;

alter table public.analysis_versions
  add column if not exists clinical_status text not null default 'approved',
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

alter table public.analysis_versions
  drop constraint if exists analysis_versions_clinical_status_check;

alter table public.analysis_versions
  add constraint analysis_versions_clinical_status_check
  check (clinical_status in ('approved', 'historical_unreviewed'));

alter table public.orders
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create unique index if not exists orders_historical_source_row_uidx
  on public.orders (
    (source_metadata->>'workbook'),
    (source_metadata->>'sheet'),
    (source_metadata->>'row')
  )
  where source_metadata->>'import_kind' = 'historical_results';

do $seed$
declare
  actor uuid;
  target record;
  next_version integer;
begin
  select p.id
  into actor
  from public.profiles p
  where p.role = 'owner' and p.active
  order by p.created_at
  limit 1;

  if actor is null then
    raise exception 'historical_seed_owner_profile_not_found';
  end if;

  insert into public.analyses(
    code, group_id, name, result_type, active, created_by, source_metadata
  )
  select
    'BIO-HB-DOS',
    ag.id,
    'Dosaje de hemoglobina',
    'text'::public.result_type,
    false,
    actor,
    jsonb_build_object(
      'workbook', 'REGISTRO DIARIO 2026 (version 1).xlsb.xlsm',
      'sheet', 'RESULTADOS',
      'column', 'AK',
      'clinical_review', 'pending'
    )
  from public.analysis_groups ag
  where ag.code = 'BIO'
  on conflict (code) do update set
    source_metadata = public.analyses.source_metadata || excluded.source_metadata;

  for target in
    select a.id, a.code, a.name, a.source_metadata
    from public.analyses a
    where a.code in (
      'HEM-RBC', 'HEM-HB', 'HEM-HCT', 'BIO-GLU', 'BIO-TG', 'BIO-HB-DOS',
      'URO-FIS-COLOR', 'URO-FIS-ASPECTO', 'URO-BIO-GLU', 'URO-BIO-CET',
      'URO-BIO-PRO', 'URO-BIO-BIL', 'URO-BIO-NIT', 'URO-BIO-URO',
      'URO-MIC-CEL', 'URO-MIC-RBC', 'URO-MIC-WBC', 'URO-MIC-PIO',
      'URO-MIC-GER', 'URO-MIC-CRIS', 'URO-MIC-CIL'
    )
      and not exists (
        select 1
        from public.analysis_versions av
        where av.analysis_id = a.id
          and av.clinical_status = 'historical_unreviewed'
      )
  loop
    select coalesce(max(av.version), 0) + 1
    into next_version
    from public.analysis_versions av
    where av.analysis_id = target.id;

    insert into public.analysis_versions(
      analysis_id, version, sample_type, method, unit, decimals,
      qualitative_options, reference_ranges, critical_limits,
      effective_from, effective_to, approved_by, clinical_status,
      source_metadata
    ) values (
      target.id,
      next_version,
      'Histórico importado',
      null,
      null,
      null,
      null,
      '[]'::jsonb,
      '{}'::jsonb,
      '2026-01-01 00:00:00-05'::timestamptz,
      '2026-01-04 00:00:00-05'::timestamptz,
      actor,
      'historical_unreviewed',
      jsonb_build_object(
        'workbook', 'REGISTRO DIARIO 2026 (version 1).xlsb.xlsm',
        'sheet', 'RESULTADOS',
        'column', target.source_metadata->>'column',
        'clinical_review', 'pending',
        'approval_semantics', 'migration_actor_only'
      )
    );
  end loop;
end;
$seed$;

create or replace function public.create_simple_order(
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
    and av.clinical_status = 'approved'
    and av.effective_from <= occurred_at
    and (av.effective_to is null or av.effective_to > occurred_at);

  get diagnostics inserted_count = row_count;
  if inserted_count <> selected_count
  then raise exception 'invalid_or_inactive_analysis_version'; end if;

  return new_order;
end;
$$;

revoke all on function public.create_simple_order(uuid, uuid[], timestamptz)
  from public, anon;
grant execute on function public.create_simple_order(uuid, uuid[], timestamptz)
  to authenticated;

commit;
