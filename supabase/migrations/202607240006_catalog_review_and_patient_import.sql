-- Catálogo inicial extraído del libro y carga segura de pacientes.
-- Ningún análisis queda operativo hasta que exista una versión clínica aprobada.
begin;

alter table public.analyses
  add column if not exists source_metadata jsonb not null default '{}'::jsonb;

create or replace function public.upsert_import_patient(
  patient_dni text,
  patient_name text,
  patient_birth_date date default null,
  patient_sex text default null,
  source_metadata jsonb default '{}'::jsonb
)
returns public.patients
language plpgsql
security definer
set search_path = public
as $$
declare
  saved public.patients;
  normalized_sex text;
begin
  if not public.current_profile_is_active() then
    raise exception 'not_authorized';
  end if;
  if coalesce(trim(patient_dni), '') !~ '^[0-9]{8}$' then
    raise exception 'invalid_dni';
  end if;
  if char_length(trim(coalesce(patient_name, ''))) not between 2 and 180 then
    raise exception 'patient_name_required';
  end if;

  normalized_sex := case upper(trim(coalesce(patient_sex, '')))
    when 'F' then 'F'
    when 'FEMENINO' then 'F'
    when 'M' then 'M'
    when 'MASCULINO' then 'M'
    when 'X' then 'X'
    when 'U' then 'U'
    else null
  end;

  insert into public.patients(
    document_type, document_number, full_name, first_names, paternal_surname,
    birth_date, sex, metadata, created_by, updated_by
  ) values (
    'DNI', trim(patient_dni), trim(patient_name), trim(patient_name), 'N/A',
    patient_birth_date, normalized_sex, coalesce(source_metadata, '{}'::jsonb),
    auth.uid(), auth.uid()
  )
  on conflict (document_type, document_number) do update set
    full_name = excluded.full_name,
    first_names = excluded.first_names,
    birth_date = coalesce(excluded.birth_date, public.patients.birth_date),
    sex = coalesce(excluded.sex, public.patients.sex),
    metadata = public.patients.metadata || excluded.metadata,
    updated_by = auth.uid(),
    updated_at = now()
  returning * into saved;

  return saved;
end;
$$;

revoke all on function public.upsert_import_patient(text,text,date,text,jsonb)
  from public, anon;
grant execute on function public.upsert_import_patient(text,text,date,text,jsonb)
  to authenticated;

do $seed$
declare
  actor uuid;
begin
  select p.id
  into actor
  from public.profiles p
  where p.role = 'owner'
    and p.active
  order by p.created_at
  limit 1;

  if actor is null then
    raise exception 'seed_owner_profile_not_found';
  end if;

  update public.profiles set role = 'owner', updated_at = now() where id = actor;

  insert into public.analysis_groups(code, name, display_order, active)
  values
    ('HEM', 'Hematología', 10, true),
    ('BIO', 'Bioquímica', 20, true),
    ('INM', 'Inmunología', 30, true),
    ('URO', 'Uroanálisis', 40, true),
    ('PAR', 'Parasitología', 50, true),
    ('OTR', 'Otros', 60, true)
  on conflict (code) do update set
    name = excluded.name,
    display_order = excluded.display_order;

  create temporary table seed_catalog(
    code text primary key,
    group_code text not null,
    name text not null,
    source_column text not null,
    observed_count integer not null
  ) on commit drop;

  insert into seed_catalog(code, group_code, name, source_column, observed_count)
  values
    ('HEM-HCT', 'HEM', 'Hematocrito', 'J', 2541),
    ('HEM-HB', 'HEM', 'Hemoglobina', 'I', 2534),
    ('HEM-RBC', 'HEM', 'Glóbulos rojos (hematíes)', 'H', 2533),
    ('BIO-GLU', 'BIO', 'Glucosa', 'W', 2295),
    ('URO-FIS-COLOR', 'URO', 'Color', 'BB', 1666),
    ('URO-FIS-ASPECTO', 'URO', 'Aspecto', 'BC', 1663),
    ('URO-MIC-WBC', 'URO', 'Leucocitos', 'BP', 1662),
    ('URO-MIC-CEL', 'URO', 'Células', 'BN', 1662),
    ('URO-MIC-RBC', 'URO', 'Hematíes', 'BO', 1662),
    ('URO-MIC-GER', 'URO', 'Gérmenes', 'BR', 1661),
    ('URO-MIC-PIO', 'URO', 'Piocitos', 'BQ', 1661),
    ('URO-MIC-CRIS', 'URO', 'Cristales', 'BS', 1621),
    ('URO-MIC-CIL', 'URO', 'Cilindros', 'BT', 1586),
    ('BIO-TG', 'BIO', 'Triglicéridos', 'AC', 1559),
    ('URO-BIO-CET', 'URO', 'Cetonas', 'BG', 1491),
    ('URO-BIO-PRO', 'URO', 'Proteínas', 'BH', 1491),
    ('URO-BIO-URO', 'URO', 'Urobilinógeno', 'BL', 1491),
    ('URO-BIO-BIL', 'URO', 'Bilirrubina', 'BI', 1491),
    ('URO-BIO-NIT', 'URO', 'Nitritos', 'BK', 1491),
    ('URO-BIO-GLU', 'URO', 'Glucosa', 'BF', 1491);

  insert into public.analyses(
    code, group_id, name, result_type, active, created_by, source_metadata
  )
  select
    seed.code,
    groups.id,
    seed.name,
    'text'::public.result_type,
    false,
    actor,
    jsonb_build_object(
      'workbook', 'REGISTRO DIARIO 2026 (version 1).xlsb.xlsm',
      'sheet', 'RESULTADOS',
      'column', seed.source_column,
      'observed_nonempty_cells', seed.observed_count,
      'clinical_review', 'pending'
    )
  from seed_catalog seed
  join public.analysis_groups groups on groups.code = seed.group_code
  on conflict (code) do update set
    name = excluded.name,
    group_id = excluded.group_id,
    source_metadata = public.analyses.source_metadata || excluded.source_metadata;

  insert into public.panels(code, name, active, created_by)
  values
    ('HEMA-LEGACY', 'Hematología frecuente (revisión pendiente)', false, actor),
    ('URO-LEGACY', 'Uroanálisis del libro (revisión pendiente)', false, actor)
  on conflict (code) do update set name = excluded.name;

  insert into public.panel_analyses(panel_id, analysis_id, display_order)
  select panel.id, analysis.id, ordering.display_order
  from (
    values
      ('HEMA-LEGACY', 'HEM-RBC', 10),
      ('HEMA-LEGACY', 'HEM-HB', 20),
      ('HEMA-LEGACY', 'HEM-HCT', 30),
      ('URO-LEGACY', 'URO-FIS-COLOR', 10),
      ('URO-LEGACY', 'URO-FIS-ASPECTO', 20),
      ('URO-LEGACY', 'URO-BIO-GLU', 30),
      ('URO-LEGACY', 'URO-BIO-CET', 40),
      ('URO-LEGACY', 'URO-BIO-PRO', 50),
      ('URO-LEGACY', 'URO-BIO-BIL', 60),
      ('URO-LEGACY', 'URO-BIO-NIT', 70),
      ('URO-LEGACY', 'URO-BIO-URO', 80),
      ('URO-LEGACY', 'URO-MIC-CEL', 90),
      ('URO-LEGACY', 'URO-MIC-RBC', 100),
      ('URO-LEGACY', 'URO-MIC-WBC', 110),
      ('URO-LEGACY', 'URO-MIC-PIO', 120),
      ('URO-LEGACY', 'URO-MIC-GER', 130),
      ('URO-LEGACY', 'URO-MIC-CRIS', 140),
      ('URO-LEGACY', 'URO-MIC-CIL', 150)
  ) as ordering(panel_code, analysis_code, display_order)
  join public.panels panel on panel.code = ordering.panel_code
  join public.analyses analysis on analysis.code = ordering.analysis_code
  on conflict (panel_id, analysis_id) do update
    set display_order = excluded.display_order;
end;
$seed$;

commit;
