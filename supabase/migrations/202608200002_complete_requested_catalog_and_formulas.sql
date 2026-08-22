-- Completa el catálogo solicitado sin duplicar análisis ya existentes.
-- Las fórmulas y el bloqueo de resultados calculados viven en la aplicación;
-- esta migración agrega sus entradas de catálogo y organiza los subgrupos.

do $migration$
declare
  actor uuid;
  entry record;
  saved_analysis uuid;
  next_version integer;
begin
  select a.created_by into actor
  from public.analyses a
  order by a.created_at
  limit 1;
  if actor is null then
    raise exception 'No existe un usuario para atribuir los análisis nuevos';
  end if;

  -- Subgrupos clínicos de la lista fuente.
  for entry in
    select * from (values
      ('HEM', 'Hemograma', 10),
      ('HEM', 'Grupo sanguíneo', 120),
      ('HEM', 'Pruebas adicionales', 130),
      ('BIO', 'Glucosa', 10),
      ('BIO', 'Perfil lipídico', 20),
      ('BIO', 'Función renal', 30),
      ('BIO', 'Enzimas pancreáticas', 40),
      ('BIO', 'Perfil hepático', 50),
      ('BIO', 'Control glucémico', 60),
      ('INM', 'Pruebas cualitativas y cuantitativas', 20),
      ('INM', 'Inmunocromatografía', 40),
      ('URO', 'Pruebas adicionales', 230),
      ('HEC', 'Información de muestras', 5)
    ) as requested(group_code, subsection_name, subsection_order)
  loop
    insert into public.analysis_subsections(group_id, name, display_order)
    select g.id, entry.subsection_name, entry.subsection_order
    from public.analysis_groups g
    where g.code = entry.group_code
      and not exists (
        select 1 from public.analysis_subsections s
        where s.group_id = g.id and lower(s.name) = lower(entry.subsection_name)
      );
  end loop;

  -- Los 22 análisis ausentes. Los rangos sin límites numéricos quedan
  -- explícitamente sujetos al método, evitando inventar intervalos clínicos.
  for entry in
    select *
    from jsonb_to_recordset($catalog$[
      {"code":"HEM-BLAST","group_code":"HEM","name":"BLASTOS","result_type":"numeric","picker_order":105,"subsection":"Hemograma","sample_type":"Sangre","method":"Frotis","unit":"%","decimals":1,"qualitative_options":null,"reference_ranges":[{"label":"Según evaluación microscópica"}]},

      {"code":"BIO-VLDL","group_code":"BIO","name":"COLESTEROL VLDL","result_type":"numeric","picker_order":65,"subsection":"Perfil lipídico","sample_type":"Suero","method":"Calculado","unit":"mg/dL","decimals":2,"qualitative_options":null,"reference_ranges":[{"label":"Según método"}]},
      {"code":"BIO-LIP","group_code":"BIO","name":"LIPASA SÉRICA","result_type":"numeric","picker_order":145,"subsection":"Enzimas pancreáticas","sample_type":"Suero","method":"Enzimático","unit":"U/L","decimals":1,"qualitative_options":null,"reference_ranges":[{"label":"Según método"}]},
      {"code":"BIO-PROT","group_code":"BIO","name":"PROTEÍNAS","result_type":"numeric","picker_order":121,"subsection":"Perfil hepático","sample_type":"Suero","method":"Colorimétrico","unit":"g/dL","decimals":2,"qualitative_options":null,"reference_ranges":[{"label":"Según método"}]},
      {"code":"BIO-ALB","group_code":"BIO","name":"ALBÚMINAS","result_type":"numeric","picker_order":122,"subsection":"Perfil hepático","sample_type":"Suero","method":"Colorimétrico","unit":"g/dL","decimals":2,"qualitative_options":null,"reference_ranges":[{"label":"Según método"}]},
      {"code":"BIO-ALP","group_code":"BIO","name":"FOSFATASA ALCALINA","result_type":"numeric","picker_order":123,"subsection":"Perfil hepático","sample_type":"Suero","method":"Cinético","unit":"U/L","decimals":1,"qualitative_options":null,"reference_ranges":[{"label":"Según método"}]},
      {"code":"BIO-GGT","group_code":"BIO","name":"GAMMA GLUTAMIL TRANSPEPTIDASA","result_type":"numeric","picker_order":124,"subsection":"Perfil hepático","sample_type":"Suero","method":"Cinético","unit":"U/L","decimals":1,"qualitative_options":null,"reference_ranges":[{"label":"Según método"}]},
      {"code":"BIO-LDH","group_code":"BIO","name":"DESHIDROGENASA LÁCTICA","result_type":"numeric","picker_order":125,"subsection":"Perfil hepático","sample_type":"Suero","method":"Cinético","unit":"U/L","decimals":1,"qualitative_options":null,"reference_ranges":[{"label":"Según método"}]},

      {"code":"INM-ASO","group_code":"INM","name":"ASO","result_type":"qualitative","picker_order":5,"subsection":"Pruebas cualitativas y cuantitativas","sample_type":"Suero","method":"Aglutinación","unit":null,"decimals":null,"qualitative_options":["NEGATIVO","POSITIVO"],"reference_ranges":[{"label":"Negativo"}]},
      {"code":"INM-RPR-Q","group_code":"INM","name":"RPR CUANTITATIVO","result_type":"numeric","picker_order":35,"subsection":"Pruebas cualitativas y cuantitativas","sample_type":"Suero","method":"Titulación","unit":"dils","decimals":0,"qualitative_options":null,"reference_ranges":[{"label":"No reactivo"}]},
      {"code":"INM-HAV","group_code":"INM","name":"HAV — HEPATITIS A","result_type":"qualitative","picker_order":36,"subsection":"Inmunocromatografía","sample_type":"Suero","method":"Inmunocromatografía","unit":null,"decimals":null,"qualitative_options":["NO REACTIVO","REACTIVO"],"reference_ranges":[{"label":"No reactivo"}]},
      {"code":"INM-PSA-Q","group_code":"INM","name":"PSA CUANTITATIVO","result_type":"numeric","picker_order":75,"subsection":"Inmunocromatografía","sample_type":"Suero","method":"Inmunoensayo","unit":"ng/mL","decimals":2,"qualitative_options":null,"reference_ranges":[{"label":"Según método"}]},

      {"code":"URO-MALB","group_code":"URO","name":"MICROALBUMINURIA","result_type":"numeric","picker_order":230,"subsection":"Pruebas adicionales","sample_type":"Orina","method":"Inmunoturbidimetría","unit":"mg/L","decimals":2,"qualitative_options":null,"reference_ranges":[{"label":"Según método"}]},

      {"code":"HEC-NSAMP","group_code":"HEC","name":"NÚMERO DE MUESTRAS","result_type":"numeric","picker_order":5,"subsection":"Información de muestras","sample_type":"Heces","method":"Registro","unit":null,"decimals":0,"qualitative_options":null,"reference_ranges":[{"label":"Cantidad registrada"}]},
      {"code":"HEC-LEU","group_code":"HEC","name":"LEUCOCITOS","result_type":"text","picker_order":81,"subsection":"Examen microscópico","sample_type":"Heces","method":"Microscopía","unit":null,"decimals":null,"qualitative_options":null,"reference_ranges":[{"label":"Según muestra"}]},
      {"code":"HEC-PMN","group_code":"HEC","name":"PMN/POLIMORFONUCLEARES","result_type":"numeric","picker_order":82,"subsection":"Examen microscópico","sample_type":"Heces","method":"Microscopía","unit":"%","decimals":0,"qualitative_options":null,"reference_ranges":[{"label":"Según muestra"}]},
      {"code":"HEC-MN","group_code":"HEC","name":"MN/MONONUCLEARES","result_type":"numeric","picker_order":83,"subsection":"Examen microscópico","sample_type":"Heces","method":"Microscopía","unit":"%","decimals":0,"qualitative_options":null,"reference_ranges":[{"label":"Según muestra"}]},
      {"code":"HEC-HEMA","group_code":"HEC","name":"HEMATÍES","result_type":"text","picker_order":84,"subsection":"Examen microscópico","sample_type":"Heces","method":"Microscopía","unit":null,"decimals":null,"qualitative_options":null,"reference_ranges":[{"label":"Según muestra"}]},
      {"code":"PAR-M4","group_code":"HEC","name":"N° MUESTRA 4°","result_type":"text","picker_order":175,"subsection":"Examen parasitológico","sample_type":"Heces","method":"Registro","unit":null,"decimals":null,"qualitative_options":null,"reference_ranges":[{"label":"Registrada"}]},

      {"code":"VAG-NUG","group_code":"VAG","name":"TEST DE NUGENT","result_type":"numeric","picker_order":42,"subsection":"Secrecion Vaginal","sample_type":"Secreción vaginal","method":"Tinción de Gram","unit":"puntos","decimals":0,"qualitative_options":null,"reference_ranges":[{"label":"Según escala de Nugent"}]},
      {"code":"VAG-PMN","group_code":"VAG","name":"PMN/POLIMORFONUCLEARES","result_type":"qualitative","picker_order":45,"subsection":"Secrecion Vaginal","sample_type":"Secreción vaginal","method":"Microscopía","unit":null,"decimals":null,"qualitative_options":["NO SE OBSERVA","POSITIVO 1 (+)","POSITIVO 2 (+)","POSITIVO 3 (+)"],"reference_ranges":[{"label":"Según método y muestra"}]},
      {"code":"VAG-OTR","group_code":"VAG","name":"OTROS","result_type":"text","picker_order":65,"subsection":"Secrecion Vaginal","sample_type":"Secreción vaginal","method":"Microscopía","unit":null,"decimals":null,"qualitative_options":null,"reference_ranges":[{"label":"Según método y muestra"}]}
    ]$catalog$::jsonb) as requested(
      code text, group_code text, name text, result_type text, picker_order integer,
      subsection text, sample_type text, method text, unit text, decimals integer,
      qualitative_options jsonb, reference_ranges jsonb
    )
  loop
    insert into public.analyses(code, group_id, name, result_type, active, created_by, source_metadata)
    select
      entry.code, g.id, entry.name, entry.result_type::public.result_type, true, actor,
      jsonb_build_object(
        'picker_order', entry.picker_order,
        'picker_common', false,
        'picker_subsection', entry.subsection,
        'catalog_version', 3,
        'clinical_review', 'approved',
        'source', 'requested catalog completion 2026-08-20'
      )
    from public.analysis_groups g
    where g.code = entry.group_code
    on conflict (code) do update
    set group_id = excluded.group_id,
        name = excluded.name,
        result_type = excluded.result_type,
        active = true,
        archived_at = null,
        source_metadata = coalesce(public.analyses.source_metadata, '{}'::jsonb) || excluded.source_metadata
    returning id into saved_analysis;

    if saved_analysis is null then
      raise exception 'No se encontró el grupo % para %', entry.group_code, entry.code;
    end if;

    if not exists (
      select 1 from public.analysis_versions v
      where v.analysis_id = saved_analysis and v.effective_to is null
    ) then
      select coalesce(max(v.version), 0) + 1 into next_version
      from public.analysis_versions v where v.analysis_id = saved_analysis;

      insert into public.analysis_versions(
        analysis_id, version, sample_type, method, unit, decimals,
        qualitative_options, reference_ranges, critical_limits,
        approved_by, clinical_status, source_metadata
      ) values (
        saved_analysis, next_version, entry.sample_type, entry.method, entry.unit,
        entry.decimals, entry.qualitative_options, entry.reference_ranges, '{}'::jsonb,
        actor, 'approved', jsonb_build_object('migration', '202608200002')
      );
    end if;
  end loop;

  -- HCG en orina ya existía, pero estaba inactivo: se recupera sin duplicarlo.
  update public.analyses
  set active = true,
      archived_at = null,
      source_metadata = jsonb_set(
        coalesce(source_metadata, '{}'::jsonb),
        '{picker_subsection}', to_jsonb('Inmunocromatografía'::text), true
      )
  where code = 'INM-HCG-U';

  -- Completa los subgrupos de los análisis relacionados para que cada panel
  -- aparezca unido, no solamente las filas nuevas.
  for entry in
    select * from (values
      ('HEM-RBC','Hemograma'),('HEM-HB','Hemograma'),('HEM-HCT','Hemograma'),
      ('HEM-WBC','Hemograma'),('HEM-ABA','Hemograma'),('HEM-NEU','Hemograma'),
      ('HEM-LIN','Hemograma'),('HEM-EOS','Hemograma'),('HEM-MON','Hemograma'),
      ('HEM-BAS','Hemograma'),('HEM-BLAST','Hemograma'),('HEM-PLT','Hemograma'),
      ('HEM-GRF','Grupo sanguíneo'),('HEM-VSG','Pruebas adicionales'),
      ('HEM-TC','Pruebas adicionales'),('HEM-TS','Pruebas adicionales'),

      ('BIO-GLU','Glucosa'),('BIO-CHOL','Perfil lipídico'),('BIO-HDL','Perfil lipídico'),
      ('BIO-LDL','Perfil lipídico'),('BIO-VLDL','Perfil lipídico'),('BIO-TG','Perfil lipídico'),
      ('BIO-URE','Función renal'),('BIO-CRE','Función renal'),('BIO-URIC','Función renal'),
      ('BIO-AMY','Enzimas pancreáticas'),('BIO-LIP','Enzimas pancreáticas'),
      ('BIO-BT','Perfil hepático'),('BIO-BD','Perfil hepático'),('BIO-BI','Perfil hepático'),
      ('BIO-TGO','Perfil hepático'),('BIO-TGP','Perfil hepático'),('BIO-PROT','Perfil hepático'),
      ('BIO-ALB','Perfil hepático'),('BIO-ALP','Perfil hepático'),('BIO-GGT','Perfil hepático'),
      ('BIO-LDH','Perfil hepático'),('BIO-HBA1C','Control glucémico'),

      ('INM-ASO','Pruebas cualitativas y cuantitativas'),
      ('INM-FR','Pruebas cualitativas y cuantitativas'),
      ('INM-PCR','Pruebas cualitativas y cuantitativas'),
      ('INM-RPR','Pruebas cualitativas y cuantitativas'),
      ('INM-RPR-Q','Pruebas cualitativas y cuantitativas'),
      ('INM-HAV','Inmunocromatografía'),('INM-HBSAG','Inmunocromatografía'),
      ('INM-HVC','Inmunocromatografía'),('INM-HIV','Inmunocromatografía'),
      ('INM-SIF','Inmunocromatografía'),('INM-PSA','Inmunocromatografía'),
      ('INM-PSA-Q','Inmunocromatografía'),('INM-HPI','Inmunocromatografía'),
      ('INM-HCG-U','Inmunocromatografía'),('INM-HCG-S','Inmunocromatografía'),

      ('URO-PRU','Pruebas adicionales'),('URO-MALB','Pruebas adicionales')
    ) as placement(analysis_code, subsection_name)
  loop
    update public.analyses
    set source_metadata = jsonb_set(
      coalesce(source_metadata, '{}'::jsonb),
      '{picker_subsection}', to_jsonb(entry.subsection_name::text), true
    )
    where code = entry.analysis_code;
  end loop;
end;
$migration$;
