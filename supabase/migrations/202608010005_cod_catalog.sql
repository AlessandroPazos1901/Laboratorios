-- Catálogo cualitativo del laboratorio extraído de COD.xlsx, hoja COD.
begin;

create temporary table cod_catalog (
  code text primary key,
  group_code text not null,
  name text not null,
  sample_type text not null,
  method text not null,
  subsection text,
  display_order integer not null,
  source_range text not null,
  options jsonb not null
) on commit drop;

insert into cod_catalog values
  ('HEM-GRF','HEM','Grupo y factor','Sangre','Hemaglutinación',null,110,'COD!B3:B11',to_jsonb(array['"O" POSITIVO','"A" POSITIVO','"B" POSITIVO','"AB" POSITIVO','"O" NEGATIVO','"A" NEGATIVO','"B" NEGATIVO','"AB" NEGATIVO']::text[])),

  ('INM-AGL','INM','Aglutinaciones','Suero','Aglutinación',null,10,'COD!B14:B20',to_jsonb(array['NEGATIVO','POSITIVO 1/20','POSITIVO 1/40','POSITIVO 1/80','POSITIVO 1/160','POSITIVO 1/320']::text[])),
  ('INM-RPR','INM','RPR','Suero','Floculación',null,20,'COD!C14:C21',to_jsonb(array['NO REACTIVO','REACTIVO 2 DILS','REACTIVO 4 DILS','REACTIVO 8 DILS','REACTIVO 16 DILS','REACTIVO 32 DILS','REACTIVO 64 DILS']::text[])),
  ('INM-SIF','INM','Sífilis (PR)','Sangre','Inmunocromatografía',null,30,'COD!D14:D16',to_jsonb(array['NO REACTIVO','REACTIVO']::text[])),
  ('INM-HIV','INM','HIV (PR)','Sangre','Inmunocromatografía',null,40,'COD!E14:E16',to_jsonb(array['NO REACTIVO','REACTIVO']::text[])),
  ('INM-HBSAG','INM','Hepatitis B (PR)','Sangre','Inmunocromatografía',null,50,'COD!F14:F16',to_jsonb(array['NO REACTIVO','REACTIVO']::text[])),
  ('INM-PCR','INM','PCR','Suero','Aglutinación',null,60,'COD!G14:G18',to_jsonb(array['NEGATIVO','POSITIVO 1+','POSITIVO 2+','POSITIVO 3+']::text[])),
  ('INM-FR','INM','Factor reumatoideo','Suero','Aglutinación',null,70,'COD!H14:H18',to_jsonb(array['NEGATIVO','POSITIVO 1+','POSITIVO 2+','POSITIVO 3+']::text[])),
  ('INM-HPI','INM','Helicobacter pilory (PR)','Sangre','Inmunocromatografía',null,80,'COD!I14:I16',to_jsonb(array['NEGATIVO','POSITIVO']::text[])),
  ('INM-PSA','INM','PSA (PR)','Sangre','Inmunocromatografía',null,90,'COD!J14:J16',to_jsonb(array['NEGATIVO','POSITIVO']::text[])),
  ('INM-THE','INM','Thevenon (PR)','Heces','Inmunocromatografía',null,100,'COD!K14:K16',to_jsonb(array['NEGATIVO','POSITIVO']::text[])),
  ('INM-HCG-U','INM','HCG','Orina','Inmunocromatografía',null,110,'COD!L14:L16',to_jsonb(array['NEGATIVO','POSITIVO']::text[])),

  ('URO-COLOR','URO','Color','Orina','Observación directa','Examen físico',10,'COD!B25:B38',to_jsonb(array['INCOLORO','PAJIZO','AMARILLO','AMARILLO OSCURO','AMBAR','CAFÉ','ROSACEO','ROJISO','NARANJA','VERDOSO','ESPUMOSA','MARRON','NEGRO']::text[])),
  ('URO-ASP','URO','Aspecto','Orina','Observación directa','Examen físico',20,'COD!C25:C29',to_jsonb(array['TRANSPARENTE','LIGERO TURBIO','TURBIO','MUY TURBIO']::text[])),
  ('URO-REAC','URO','Reacción','Orina','Tira reactiva','Examen físico',30,'COD!D25:D28',to_jsonb(array['ACIDO','NEUTRO','ALCALINO']::text[])),
  ('URO-DEN','URO','Densidad','Orina','Tira reactiva','Examen físico',40,'COD!E25:E32',to_jsonb(array['1000','1005','1010','1015','1020','1025','1030']::text[])),
  ('URO-GLU','URO','Glucosa','Orina','Tira reactiva','Examen bioquímico',50,'COD!F25:F33; COD!G26:G29',to_jsonb(array['NEGATIVO','POSITIVO 1(+)','POSITIVO 2(+)','POSITIVO 3(+)']::text[])),
  ('URO-CET','URO','Cetonas','Orina','Tira reactiva','Examen bioquímico',60,'COD!G25:G29',to_jsonb(array['NEGATIVO','POSITIVO 1(+)','POSITIVO 2(+)','POSITIVO 3(+)']::text[])),
  ('URO-BLD','URO','Sangre','Orina','Tira reactiva','Examen bioquímico',70,'COD!H25:H29',to_jsonb(array['NEGATIVO','POSITIVO 1(+)','POSITIVO 2(+)','POSITIVO 3(+)']::text[])),
  ('URO-PRO','URO','Proteínas','Orina','Tira reactiva','Examen bioquímico',80,'COD!I25:I29',to_jsonb(array['NEGATIVO','POSITIVO 1(+)','POSITIVO 2(+)','POSITIVO 3(+)']::text[])),
  ('URO-BIL','URO','Bilirrubina','Orina','Tira reactiva','Examen bioquímico',90,'COD!J25:J29',to_jsonb(array['NEGATIVO','POSITIVO 1(+)','POSITIVO 2(+)','POSITIVO 3(+)']::text[])),
  ('URO-URO','URO','Urobilinógeno','Orina','Tira reactiva','Examen bioquímico',100,'COD!K25:K29',to_jsonb(array['NEGATIVO','POSITIVO 1(+)','POSITIVO 2(+)','POSITIVO 3(+)']::text[])),
  ('URO-NIT','URO','Nitritos','Orina','Tira reactiva','Examen bioquímico',110,'COD!L25:L29',to_jsonb(array['NEGATIVO','POSITIVO 1(+)','POSITIVO 2(+)','POSITIVO 3(+)']::text[])),
  ('URO-ASC','URO','Ácido ascórbico','Orina','Tira reactiva','Examen bioquímico',120,'COD!M25:M29',to_jsonb(array['NEGATIVO','POSITIVO 1(+)','POSITIVO 2(+)','POSITIVO 3(+)']::text[])),
  ('URO-CEL','URO','Células epiteliales','Orina','Microscopía','Examen microscópico',130,'COD!N25:N28',to_jsonb(array['ESCASOS','REGULAR CANTIDAD','ABUNDANTES']::text[])),
  ('URO-GER','URO','Gérmenes','Orina','Microscopía','Examen microscópico',140,'COD!O25:O29',to_jsonb(array['ESCASOS','1 (+)','2 (+)','3 (+)']::text[])),
  ('URO-PRU','URO','Proteinuria','Orina','Tira reactiva','Otros exámenes',150,'COD!P25:P29',to_jsonb(array['NEGATIVO','POSITIVO 1(+)','POSITIVO 2(+)','POSITIVO 3(+)']::text[])),

  ('PAR-COLOR','HEC','Color','Heces','Observación directa','Examen físico',10,'COD!B42:B49',to_jsonb(array['BLANQUESINO','MARRON','PARDO','AMARILLO','VERDOSO','NEGRUSCO','ROJIZO']::text[])),
  ('PAR-CONS','HEC','Consistencia','Heces','Observación directa','Examen físico',20,'COD!C42:C47',to_jsonb(array['PASTOSO','BLANDO','LIQUIDO','SEMI LIQUIDO','DURO']::text[])),
  ('PAR-ASP','HEC','Aspecto','Heces','Observación directa','Examen físico',30,'COD!D42:D44',to_jsonb(array['HOMOGENEO','HETEROGENEO']::text[])),
  ('PAR-MOCO','HEC','Moco','Heces','Observación directa','Examen físico',40,'COD!E42:E44',to_jsonb(array['AUSENTE','PRESENTE']::text[])),
  ('HEC-PH','HEC','pH','Heces','Tira reactiva','Examen químico',50,'COD!F42:F44',to_jsonb(array['ACIDO','ALCALINO']::text[])),
  ('HEC-THE','HEC','Thevenon','Heces','Método directo','Examen químico',60,'COD!G42:G44',to_jsonb(array['NEGATIVO','POSITIVO']::text[])),
  ('HEC-SUD','HEC','Sudan','Heces','Coloración de Sudan','Examen químico',70,'COD!H42:H44',to_jsonb(array['NEGATIVO','POSITIVO']::text[])),
  ('HEC-BEN','HEC','Benedic','Heces','Reacción química','Examen químico',80,'COD!I42:I44',to_jsonb(array['NEGATIVO','POSITIVO']::text[])),
  ('HEC-GRA','HEC','Glóbulos de grasa','Heces','Microscopía','Examen microscópico',90,'COD!J42:J45',to_jsonb(array['ESCASOS','REGULAR CANTIDAD','ABUNDANTES']::text[])),
  ('HEC-REST','HEC','Restos alimenticios','Heces','Microscopía','Examen microscópico',100,'COD!K42:K45',to_jsonb(array['ESCASOS','REGULAR CANTIDAD','ABUNDANTES']::text[])),
  ('HEC-PAR','HEC','Parásitos','Heces','Microscopía','Examen parasitológico',110,'COD!L42:L66',to_jsonb(array['Ancylosotma duodenale','Ascaris lumbriocoides','Balamtidium coli','Blastocystis hominis','Chilomastix mesnili','Endolimax nana','Entamoeba coli','Entamoeba histolytica','Enterobius vermicularis','Enteromonas hominis','Fasciola hepatica','Giardia lambilia','Hymenolepis diminuta','Hymenolepis nana','Iodamoeba bütschlii','Isospora belli','Microsporidium spp.','Necator americanus','Paragonimus spp.','Strongyloides stercoralis','Taenia saginata','Taenia solium','Trichomonas hominis','Trichuris trichiura']::text[])),
  ('HEC-REP','HEC','Reporte parasitológico','Heces','Microscopía','Examen parasitológico',120,'COD!M42:N47',to_jsonb(array['NO SE OBSERVA PARASITOS','QUISTES (Q) 1(+)','QUISTES (Q) 2(+)','QUISTES (Q) 3(+)','TROFOZOITO (T) 1(+)','TROFOZOITO (T) 2(+)','TROFOZOITO (T) 3(+)','LARVA (L) 1(+)','LARVA (L) 2(+)','LARVA (L) 3(+)','HUEVO (H) 1(+)','HUEVO (H) 2(+)','HUEVO (H) 3(+)']::text[])),
  ('HEC-GRAHAM','HEC','Test Graham','Heces','Método de Graham','Examen parasitológico',130,'COD!O42:O44',to_jsonb(array['NEGATIVO','POSITIVO']::text[])),

  ('MIC-LEI','MIC','Leishmania','Muestra clínica','Método directo',null,10,'COD!B58:B61',to_jsonb(array['NEGATIVO','POSITIVO']::text[])),
  ('MIC-GOT','MIC','Gota gruesa','Sangre','Gota gruesa',null,20,'COD!C58:C63',to_jsonb(array['NEGATIVO','POSITIVO 1(+)','POSITIVO 2(+)','POSITIVO 3(+)']::text[])),
  ('MIC-HEL','MIC','Test helecho','Secreción','Cristalización',null,30,'COD!D58:D61',to_jsonb(array['NEGATIVO','POSITIVO']::text[])),
  ('MIC-KOH','MIC','Hongos (KOH)','Muestra clínica','Examen directo con KOH',null,40,'COD!E58:E64',to_jsonb(array['NEGATIVO','HIFAS','SEUDOHIFAS','LEVADURAS','CONIDIOS']::text[])),

  ('VAG-AMIN','VAG','Test de aminas','Secreción vaginal','Reacción de aminas',null,10,'COD!B68:B70',to_jsonb(array['NEGATIVO','POSITIVO']::text[])),
  ('VAG-PH','VAG','pH','Secreción vaginal','Tira reactiva',null,20,'COD!C68:C70',to_jsonb(array['ACIDO','ALCALINO']::text[])),
  ('VAG-TRI','VAG','Trichomonas','Secreción vaginal','Microscopía',null,30,'COD!D68:D72',to_jsonb(array['NO SE OBSERVA','POSITIVO 1 (+)','POSITIVO 2 (+)','POSITIVO 3 (+)']::text[])),
  ('VAG-KOH','VAG','Hongos (KOH)','Secreción vaginal','Examen directo con KOH',null,40,'COD!E68:E72',to_jsonb(array['NO SE OBSERVA','POSITIVO 1 (+)','POSITIVO 2 (+)','POSITIVO 3 (+)']::text[])),
  ('VAG-HDU','VAG','H. Ducrey','Secreción vaginal','Microscopía',null,50,'COD!F68:F72',to_jsonb(array['NO SE OBSERVA','POSITIVO 1 (+)','POSITIVO 2 (+)','POSITIVO 3 (+)']::text[])),
  ('VAG-GN','VAG','Diplococos intracelulares (GN)','Secreción vaginal','Microscopía',null,60,'COD!G68:G72',to_jsonb(array['NO SE OBSERVA','POSITIVO 1 (+)','POSITIVO 2 (+)','POSITIVO 3 (+)']::text[]));

do $seed$
declare
  actor uuid;
  item record;
  target_analysis_id uuid;
  target_result_type public.result_type;
  next_version integer;
begin
  select id into actor
  from public.profiles
  where active
  order by (role = 'owner') desc, created_at
  limit 1;
  if actor is null then raise exception 'seed_active_profile_not_found'; end if;

  insert into public.analysis_groups(code,name,display_order,active)
  values
    ('HEM','Hematología',10,true),
    ('INM','Inmunología',30,true),
    ('URO','Uroanálisis',40,true),
    ('HEC','Heces',50,true),
    ('MIC','Microbiología',60,true),
    ('VAG','Secreción vaginal',70,true)
  on conflict (code) do update set
    name = excluded.name,
    display_order = excluded.display_order,
    active = true;

  for item in select * from cod_catalog order by group_code, display_order loop
    insert into public.analyses(code,group_id,name,result_type,active,created_by,source_metadata)
    values (
      item.code,
      (select id from public.analysis_groups where code = item.group_code),
      item.name,
      'qualitative',
      true,
      actor,
      jsonb_build_object(
        'workbook','COD.xlsx','sheet','COD','range',item.source_range,
        'picker_subsection',item.subsection,'picker_order',item.display_order,
        'picker_common',item.display_order <= 60,'clinical_review','approved'
      )
    )
    on conflict (code) do update set
      group_id = excluded.group_id,
      name = excluded.name,
      active = true,
      archived_at = null,
      source_metadata = public.analyses.source_metadata || excluded.source_metadata
    returning id,result_type into target_analysis_id,target_result_type;

    if not exists (
      select 1 from public.analysis_versions
      where analysis_versions.analysis_id = target_analysis_id
        and source_metadata->>'source_workbook' = 'COD.xlsx'
        and source_metadata->>'catalog_version' = '1'
    ) then
      update public.analysis_versions
      set effective_to = now()
      where analysis_versions.analysis_id = target_analysis_id and effective_to is null;

      select coalesce(max(version),0) + 1 into next_version
      from public.analysis_versions where analysis_versions.analysis_id = target_analysis_id;

      insert into public.analysis_versions(
        analysis_id,version,sample_type,method,unit,decimals,qualitative_options,
        reference_ranges,critical_limits,approved_by,clinical_status,source_metadata
      ) values (
        target_analysis_id,next_version,item.sample_type,item.method,null,
        case when target_result_type = 'numeric' then 2 else null end,item.options,
        jsonb_build_array(jsonb_build_object('label','Según método y muestra')),
        '{}'::jsonb,actor,'approved',
        jsonb_build_object('source_workbook','COD.xlsx','source_sheet','COD','source_range',item.source_range,'catalog_version',1)
      );
    end if;
  end loop;
end;
$seed$;

notify pgrst, 'reload schema';
commit;
