-- Restore the detailed qualitative option panels sourced from COD.xlsx (Heces, Secreción vaginal,
-- Orinas subsections, Widal/aglutinaciones dilutions, RPR/PCR/FR severity tiers) that migration
-- 202608040003 had deliberately simplified away. Heces absorbs Parasitología's physical/chemical/
-- microscopic/parasitológico items (group PAR is deactivated); Microbiología stays merged into
-- Otros (Hongos KOH added there); Secreción vaginal becomes a new active group.
begin;

do $catalog$
declare
  actor uuid;
  hec_id uuid;
  otr_id uuid;
begin
  select authorized_user_id into actor from public.lab_settings where id;
  if actor is null then raise exception 'authorized_user_required'; end if;

  update public.analysis_groups set active = true, name = 'HECES' where code = 'HEC';
  update public.analysis_groups set active = false where code = 'PAR';
  update public.analysis_groups set active = true, name = 'SECRECIÓN VAGINAL' where code = 'VAG';

  select id into hec_id from public.analysis_groups where code = 'HEC';
  select id into otr_id from public.analysis_groups where code = 'OTR';

  -- Heces: move physical-exam items out of Parasitología and reactivate the rest of the panel
  update public.analyses set group_id = hec_id,
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":10,"picker_subsection":"Examen físico"}'::jsonb
    where code = 'PAR-COLOR';
  update public.analyses set group_id = hec_id,
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":20,"picker_subsection":"Examen físico"}'::jsonb
    where code = 'PAR-CONS';
  update public.analyses set group_id = hec_id,
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":30,"picker_subsection":"Examen físico"}'::jsonb
    where code = 'PAR-ASP';
  update public.analyses set group_id = hec_id,
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":40,"picker_subsection":"Examen físico"}'::jsonb
    where code = 'PAR-MOCO';
  update public.analyses set active = true, name = 'PH',
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":50,"picker_subsection":"Examen químico"}'::jsonb
    where code = 'HEC-PH';
  update public.analyses set group_id = hec_id,
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":60,"picker_subsection":"Examen químico"}'::jsonb
    where code = 'PAR-THE';
  update public.analyses set active = true, name = 'SUDAN',
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":70,"picker_subsection":"Examen químico"}'::jsonb
    where code = 'HEC-SUD';
  update public.analyses set active = true, name = 'BENEDIC',
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":80,"picker_subsection":"Examen químico"}'::jsonb
    where code = 'HEC-BEN';
  update public.analyses set active = true, name = 'GLOBULOS DE GRASA',
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":90,"picker_subsection":"Examen microscópico"}'::jsonb
    where code = 'HEC-GRA';
  update public.analyses set active = true, name = 'RESTOS ALIMENTICIOS',
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":100,"picker_subsection":"Examen microscópico"}'::jsonb
    where code = 'HEC-REST';
  update public.analyses set active = true, name = 'PARASITOS',
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":110,"picker_subsection":"Examen parasitológico"}'::jsonb
    where code = 'HEC-PAR';
  update public.analyses set active = true, name = 'REPORTE',
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":120,"picker_subsection":"Examen parasitológico"}'::jsonb
    where code = 'HEC-REP';
  update public.analyses set group_id = hec_id,
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":130,"picker_subsection":"Examen parasitológico"}'::jsonb
    where code = 'PAR-GRA';
  update public.analyses set group_id = hec_id, source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":140}'::jsonb where code = 'PAR-RXI';
  update public.analyses set group_id = hec_id, source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":150}'::jsonb where code = 'PAR-M1';
  update public.analyses set group_id = hec_id, source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":160}'::jsonb where code = 'PAR-M2';
  update public.analyses set group_id = hec_id, source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":170}'::jsonb where code = 'PAR-M3';
  update public.analyses set group_id = hec_id, source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":180}'::jsonb where code = 'PAR-DIR';
  update public.analyses set group_id = hec_id, source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":190}'::jsonb where code = 'PAR-TSR';

  -- superseded by PARASITOS (species) + REPORTE (stage/finding)
  update public.analyses set active = false where code in ('PAR-HUE','PAR-LAR','PAR-QUI','PAR-TRO');

  -- Orinas: physical-exam subsection + reactivate Reacción in place of the numeric PH
  update public.analyses set
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":10,"picker_subsection":"Examen físico"}'::jsonb
    where code = 'URO-COLOR';
  update public.analyses set
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":20,"picker_subsection":"Examen físico"}'::jsonb
    where code = 'URO-ASP';
  update public.analyses set active = true, name = 'REACCION',
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":30,"picker_subsection":"Examen físico"}'::jsonb
    where code = 'URO-REAC';
  update public.analyses set active = false where code = 'URO-PH';
  update public.analyses set
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":40,"picker_subsection":"Examen físico"}'::jsonb
    where code = 'URO-DEN';
  update public.analyses set source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_subsection":"Examen microscópico"}'::jsonb where code = 'URO-PRU';
  update public.analyses set source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_subsection":"Examen microscópico"}'::jsonb where code = 'URO-CEL';
  update public.analyses set source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_subsection":"Examen microscópico"}'::jsonb where code = 'URO-GER';

  -- Microbiología stays merged into Otros: add Hongos (KOH) there
  update public.analyses set group_id = otr_id, active = true, name = 'HONGOS (KOH)',
    source_metadata = coalesce(source_metadata,'{}'::jsonb) || '{"picker_order":50}'::jsonb
    where code = 'MIC-KOH';

  -- Secreción vaginal: reactivate the whole panel as-is (options already match)
  update public.analyses set active = true, name = 'TEST DE AMINAS' where code = 'VAG-AMIN';
  update public.analyses set active = true, name = 'PH' where code = 'VAG-PH';
  update public.analyses set active = true, name = 'TRICHOMONAS' where code = 'VAG-TRI';
  update public.analyses set active = true, name = 'HONGOS (KOH)' where code = 'VAG-KOH';
  update public.analyses set active = true, name = 'H. DUCREY' where code = 'VAG-HDU';
  update public.analyses set active = true, name = 'DIPLOCOCOS INTRACELULARES (GN)' where code = 'VAG-GN';

end;
$catalog$;

do $versions$
declare
  actor uuid;
  rec record;
  spec record;
  specs jsonb := '[
    {"code":"HEM-GRF","result_type":"qualitative","unit":null,"decimals":null,"options":["\"O\" POSITIVO","\"A\" POSITIVO","\"B\" POSITIVO","\"AB\" POSITIVO","\"O\" NEGATIVO","\"A\" NEGATIVO","\"B\" NEGATIVO","\"AB\" NEGATIVO"],"label":"Según método y muestra"},
    {"code":"INM-RPR","options":["NO REACTIVO","REACTIVO 2 DILS","REACTIVO 4 DILS","REACTIVO 8 DILS","REACTIVO 16 DILS","REACTIVO 32 DILS","REACTIVO 64 DILS"],"label":"No Reactivo"},
    {"code":"INM-SIF","options":["NO REACTIVO","REACTIVO"],"label":"No Reactivo"},
    {"code":"INM-HIV","options":["NO REACTIVO","REACTIVO"],"label":"No Reactivo"},
    {"code":"INM-HBSAG","options":["NO REACTIVO","REACTIVO"],"label":"No Reactivo"},
    {"code":"INM-PCR","options":["NEGATIVO","POSITIVO 1+","POSITIVO 2+","POSITIVO 3+"],"label":"Negativo"},
    {"code":"INM-FR","options":["NEGATIVO","POSITIVO 1+","POSITIVO 2+","POSITIVO 3+"],"label":"Negativo"},
    {"code":"INM-PSA","result_type":"qualitative","unit":null,"decimals":null,"options":["NEGATIVO","POSITIVO"],"label":"Negativo"},
    {"code":"INM-TIF-O","result_type":"qualitative","options":["NEGATIVO","POSITIVO 1/20","POSITIVO 1/40","POSITIVO 1/80","POSITIVO 1/160","POSITIVO 1/320"],"label":"Negativo (< 1:80)"},
    {"code":"INM-TIF-H","result_type":"qualitative","options":["NEGATIVO","POSITIVO 1/20","POSITIVO 1/40","POSITIVO 1/80","POSITIVO 1/160","POSITIVO 1/320"],"label":"Negativo (< 1:80)"},
    {"code":"INM-PAR-A","result_type":"qualitative","options":["NEGATIVO","POSITIVO 1/20","POSITIVO 1/40","POSITIVO 1/80","POSITIVO 1/160","POSITIVO 1/320"],"label":"Negativo (< 1:80)"},
    {"code":"INM-PAR-B","result_type":"qualitative","options":["NEGATIVO","POSITIVO 1/20","POSITIVO 1/40","POSITIVO 1/80","POSITIVO 1/160","POSITIVO 1/320"],"label":"Negativo (< 1:80)"},
    {"code":"INM-BRU","result_type":"qualitative","options":["NEGATIVO","POSITIVO 1/20","POSITIVO 1/40","POSITIVO 1/80","POSITIVO 1/160","POSITIVO 1/320"],"label":"Negativo (< 1:80)"},
    {"code":"URO-COLOR","result_type":"qualitative","options":["INCOLORO","PAJIZO","AMARILLO","AMARILLO OSCURO","AMBAR","CAFÉ","ROSACEO","ROJISO","NARANJA","VERDOSO","ESPUMOSA","MARRON","NEGRO"],"label":"Según método y muestra"},
    {"code":"URO-ASP","result_type":"qualitative","options":["TRANSPARENTE","LIGERO TURBIO","TURBIO","MUY TURBIO"],"label":"Según método y muestra"},
    {"code":"URO-DEN","result_type":"qualitative","unit":null,"decimals":null,"options":["1000","1005","1010","1015","1020","1025","1030"],"label":"Según método y muestra"},
    {"code":"URO-GLU","options":["NEGATIVO","POSITIVO 1(+)","POSITIVO 2(+)","POSITIVO 3(+)"],"label":"Negativo"},
    {"code":"URO-CET","options":["NEGATIVO","POSITIVO 1(+)","POSITIVO 2(+)","POSITIVO 3(+)"],"label":"Negativo"},
    {"code":"URO-BLD","options":["NEGATIVO","POSITIVO 1(+)","POSITIVO 2(+)","POSITIVO 3(+)"],"label":"Negativo"},
    {"code":"URO-PRO","options":["NEGATIVO","POSITIVO 1(+)","POSITIVO 2(+)","POSITIVO 3(+)"],"label":"Negativo"},
    {"code":"URO-BIL","options":["NEGATIVO","POSITIVO 1(+)","POSITIVO 2(+)","POSITIVO 3(+)"],"label":"Negativo"},
    {"code":"URO-NIT","options":["NEGATIVO","POSITIVO 1(+)","POSITIVO 2(+)","POSITIVO 3(+)"],"label":"Negativo"},
    {"code":"URO-URO","result_type":"qualitative","unit":null,"decimals":null,"options":["NEGATIVO","POSITIVO 1(+)","POSITIVO 2(+)","POSITIVO 3(+)"],"label":"Negativo"},
    {"code":"URO-ASC","result_type":"qualitative","options":["NEGATIVO","POSITIVO 1(+)","POSITIVO 2(+)","POSITIVO 3(+)"],"label":"Negativo"},
    {"code":"URO-CEL","result_type":"qualitative","options":["ESCASOS","REGULAR CANTIDAD","ABUNDANTES"],"label":"Según método y muestra"},
    {"code":"URO-GER","result_type":"qualitative","options":["ESCASOS","1 (+)","2 (+)","3 (+)"],"label":"Según método y muestra"},
    {"code":"URO-PRU","options":["NEGATIVO","POSITIVO 1(+)","POSITIVO 2(+)","POSITIVO 3(+)"],"label":"Negativo"},
    {"code":"PAR-COLOR","result_type":"qualitative","options":["BLANQUESINO","MARRON","PARDO","AMARILLO","VERDOSO","NEGRUSCO","ROJIZO"],"label":"Según método y muestra"},
    {"code":"PAR-CONS","result_type":"qualitative","options":["PASTOSO","BLANDO","LIQUIDO","SEMI LIQUIDO","DURO"],"label":"Según método y muestra"},
    {"code":"PAR-ASP","result_type":"qualitative","options":["HOMOGENEO","HETEROGENEO"],"label":"Según método y muestra"},
    {"code":"PAR-MOCO","options":["AUSENTE","PRESENTE"],"label":"Según método y muestra"},
    {"code":"PAR-THE","options":["NEGATIVO","POSITIVO"],"label":"Negativo"},
    {"code":"PAR-GRA","options":["NEGATIVO","1(+)","2(+)","3(+)"],"label":"Negativo"},
    {"code":"HEC-REP","options":["NO SE OBSERVA PARASITOS","QUISTES (Q)","TROFOZOITO (T)","LARVA (L)","HUEVO (H)"],"label":"Según método y muestra"},
    {"code":"OTR-GOT","options":["NEGATIVO","POSITIVO 1(+)","POSITIVO 2(+)","POSITIVO 3(+)"],"label":"Negativo"},
    {"code":"MIC-KOH","options":["NEGATIVO","POSITIVO","HIFAS","SEUDOHIFAS","LEVADURAS","CONIDIOS"],"label":"Según método y muestra"}
  ]'::jsonb;
begin
  select authorized_user_id into actor from public.lab_settings where id;
  if actor is null then raise exception 'authorized_user_required'; end if;

  for spec in select * from jsonb_to_recordset(specs) as x(code text, result_type public.result_type, unit text, decimals smallint, options jsonb, label text)
  loop
    if spec.result_type is not null then
      update public.analyses set result_type = spec.result_type where code = spec.code;
    end if;

    select av.* into rec
      from public.analysis_versions av
      join public.analyses a on a.id = av.analysis_id
      where a.code = spec.code and av.effective_to is null;

    update public.analysis_versions set effective_to = now() where id = rec.id;

    insert into public.analysis_versions(
      analysis_id, version, sample_type, method,
      unit, decimals, qualitative_options, reference_ranges, critical_limits,
      effective_from, approved_by, clinical_status, source_metadata
    ) values (
      rec.analysis_id, rec.version + 1, rec.sample_type, rec.method,
      case when spec.result_type is not null then null else rec.unit end,
      case when spec.result_type is not null then null else rec.decimals end,
      spec.options, jsonb_build_array(jsonb_build_object('label', spec.label)), '{}'::jsonb,
      '2000-01-01 00:00:00+00', actor, 'approved', jsonb_build_object('catalog_version', 3)
    );
  end loop;
end;
$versions$;

notify pgrst, 'reload schema';
commit;
