-- Catálogo canónico y orden único para captura, almacenamiento e impresión.
begin;

create temporary table desired_catalog (
  code text primary key,
  group_code text not null,
  name text not null,
  result_type public.result_type not null,
  picker_order integer not null,
  unit text,
  reference_label text not null,
  low_value numeric,
  high_value numeric,
  qualitative_options jsonb,
  sample_type text not null,
  method text,
  decimals smallint
) on commit drop;

insert into desired_catalog values
-- Hematología
('HEM-RBC','HEM','HEMATIES','numeric',10,'millones/µL','4.0 - 5.9 millones/µL',4.0,5.9,null,'Sangre','Automatizado',2),
('HEM-HB','HEM','HEMOGLOBINA','numeric',20,'g/dL','12.0 - 17.5 g/dL',12.0,17.5,null,'Sangre','Automatizado',2),
('HEM-HCT','HEM','HEMATOCRITO','numeric',30,'%','36% - 53%',36,53,null,'Sangre','Automatizado',2),
('HEM-WBC','HEM','LEUCOCITOS','numeric',40,'/µL','4,500 - 11,000 /µL',4500,11000,null,'Sangre','Automatizado',0),
('HEM-ABA','HEM','ABASTONADOS','numeric',50,'%','3% - 5%',3,5,null,'Sangre','Frotis',1),
('HEM-NEU','HEM','SEGMENTADOS','numeric',60,'%','54% - 62%',54,62,null,'Sangre','Frotis',1),
('HEM-EOS','HEM','EOSINOFILOS','numeric',70,'%','1% - 3%',1,3,null,'Sangre','Frotis',1),
('HEM-BAS','HEM','BASOFILOS','numeric',80,'%','0% - 0.75%',0,0.75,null,'Sangre','Frotis',2),
('HEM-MON','HEM','MONOCITOS','numeric',90,'%','3% - 7%',3,7,null,'Sangre','Frotis',1),
('HEM-LIN','HEM','LINFOCITOS','numeric',100,'%','25% - 33%',25,33,null,'Sangre','Frotis',1),
('HEM-PLT','HEM','PLAQUETAS','numeric',110,'/µL','150,000 - 400,000 /µL',150000,400000,null,'Sangre','Automatizado',0),
('HEM-GRF','HEM','GRUPO Y FACTOR','text',120,null,'No aplicable',null,null,null,'Sangre','Aglutinación',null),
('HEM-TC','HEM','T.C.','numeric',130,'minutos','5 - 10 minutos',5,10,null,'Sangre','Manual',1),
('HEM-TS','HEM','T.S.','numeric',140,'minutos','1 - 5 minutos',1,5,null,'Sangre','Manual',1),
('HEM-VSG','HEM','V.S.G.','numeric',150,'mm/1ra hora','0 - 20 mm/1ra hora',0,20,null,'Sangre','Westergren',1),
-- Bioquímica
('BIO-GLU','BIO','GLUCOSA','numeric',10,'mg/dL','70 - 110 mg/dL',70,110,null,'Suero','Enzimático',1),
('BIO-URE','BIO','UREA','numeric',20,'mg/dL','10 - 50 mg/dL',10,50,null,'Suero','Enzimático',1),
('BIO-CRE','BIO','CREATININA','numeric',30,'mg/dL','0.5 - 1.3 mg/dL',0.5,1.3,null,'Suero','Jaffé',2),
('BIO-CHOL','BIO','COLESTEROL TOTAL','numeric',40,'mg/dL','Menos de 200 mg/dL',null,200,null,'Suero','Enzimático',1),
('BIO-HDL','BIO','HDL COLESTEROL','numeric',50,'mg/dL','Mayor a 40 mg/dL',40,null,null,'Suero','Enzimático',1),
('BIO-LDL','BIO','LDL COLESTEROL','numeric',60,'mg/dL','Menos de 100 mg/dL',null,100,null,'Suero','Calculado',1),
('BIO-TG','BIO','TRIGLICERIDOS','numeric',70,'mg/dL','Menos de 150 mg/dL',null,150,null,'Suero','Enzimático',1),
('BIO-TGO','BIO','TGO','numeric',80,'U/L','10 - 40 U/L',10,40,null,'Suero','Cinético',1),
('BIO-TGP','BIO','TGP','numeric',90,'U/L','7 - 56 U/L',7,56,null,'Suero','Cinético',1),
('BIO-BT','BIO','B.TOTAL','numeric',100,'mg/dL','0.2 - 1.0 mg/dL',0.2,1.0,null,'Suero','Colorimétrico',2),
('BIO-BD','BIO','B.DIRECTA','numeric',110,'mg/dL','0.0 - 0.3 mg/dL',0.0,0.3,null,'Suero','Colorimétrico',2),
('BIO-BI','BIO','B.INDIRECTA','numeric',120,'mg/dL','0.2 - 0.8 mg/dL',0.2,0.8,null,'Suero','Calculado',2),
('BIO-URIC','BIO','ÁCIDO ÚRICO','numeric',130,'mg/dL','2.4 - 7.0 mg/dL',2.4,7.0,null,'Suero','Enzimático',1),
('BIO-AMY','BIO','AMILASA','numeric',140,'U/L','28 - 100 U/L',28,100,null,'Suero','Enzimático',1),
('BIO-HB-DOS','BIO','DOSAJE HB','numeric',150,'g/dL','12.0 - 17.5 g/dL',12.0,17.5,null,'Sangre','Automatizado',1),
-- Inmunología
('INM-FR','INM','F.REUMATOIDEO','qualitative',10,null,'Negativo (< 8 UI/mL)',null,null,'["Negativo","Positivo"]','Suero','Aglutinación',null),
('INM-PCR','INM','PCR','qualitative',20,null,'Negativo (< 5 mg/L)',null,null,'["Negativo","Positivo"]','Suero','Aglutinación',null),
('INM-RPR','INM','RPR O VDRL','qualitative',30,null,'No Reactivo / Negativo',null,null,'["No Reactivo","Negativo","Reactivo","Positivo"]','Suero','Floculación',null),
('INM-HBSAG','INM','PR HVB','qualitative',40,null,'No Reactivo / Negativo',null,null,'["No Reactivo","Negativo","Reactivo","Positivo"]','Suero','Inmunocromatografía',null),
('INM-HIV','INM','PR HIV','qualitative',50,null,'No Reactivo / Negativo',null,null,'["No Reactivo","Negativo","Reactivo","Positivo"]','Suero','Inmunocromatografía',null),
('INM-SIF','INM','PR SIFILIS','qualitative',60,null,'No Reactivo / Negativo',null,null,'["No Reactivo","Negativo","Reactivo","Positivo"]','Suero','Inmunocromatografía',null),
('INM-PSA','INM','PSA','numeric',70,'ng/mL','Menos de 4.0 ng/mL',null,4.0,null,'Suero','Inmunocromatografía',2),
('INM-THE','INM','PR THEVENON','qualitative',80,null,'Negativo',null,null,'["Negativo","Positivo"]','Heces','Inmunocromatografía',null),
('INM-HPI','INM','HELICOBACTER P.','qualitative',90,null,'Negativo',null,null,'["Negativo","Positivo"]','Suero','Inmunocromatografía',null),
('INM-HVC','INM','PR HVC','qualitative',100,null,'No Reactivo / Negativo',null,null,'["No Reactivo","Negativo","Reactivo","Positivo"]','Suero','Inmunocromatografía',null),
('INM-HCG-S','INM','HCG (SANGRE)','qualitative',110,null,'Negativo (< 5 mUI/mL)',null,null,'["Negativo","Positivo"]','Suero','Inmunocromatografía',null),
('INM-TIF-O','INM','AGLUTINACIONES TIFICO "O"','text',120,null,'Negativo (< 1:80)',null,null,null,'Suero','Aglutinación',null),
('INM-TIF-H','INM','AGLUTINACIONES TIFICO "H"','text',130,null,'Negativo (< 1:80)',null,null,null,'Suero','Aglutinación',null),
('INM-PAR-A','INM','AGLUTINACIONES PARATIFICO "A"','text',140,null,'Negativo (< 1:80)',null,null,null,'Suero','Aglutinación',null),
('INM-PAR-B','INM','AGLUTINACIONES PARATIFICO "B"','text',150,null,'Negativo (< 1:80)',null,null,null,'Suero','Aglutinación',null),
('INM-BRU','INM','AGLUTINACIONES BRUCELLAS "Br"','text',160,null,'Negativo (< 1:80)',null,null,null,'Suero','Aglutinación',null),
-- Uroanálisis
('URO-COLOR','URO','COLOR','text',10,null,'Amarillo claro / Ámbar',null,null,null,'Orina','Observación directa',null),
('URO-ASP','URO','ASPECTO','text',20,null,'Límpido / Transparente',null,null,null,'Orina','Observación directa',null),
('URO-PH','URO','PH','numeric',30,null,'4.5 - 8.0',4.5,8.0,null,'Orina','Tira reactiva',2),
('URO-DEN','URO','DENSIDAD','numeric',40,null,'1.010 - 1.030',1.010,1.030,null,'Orina','Tira reactiva',3),
('URO-GLU','URO','GLUCOSA','qualitative',50,null,'Negativo',null,null,'["Negativo","Trazas","Positivo"]','Orina','Tira reactiva',null),
('URO-CET','URO','CETONAS','qualitative',60,null,'Negativo',null,null,'["Negativo","Trazas","Positivo"]','Orina','Tira reactiva',null),
('URO-PRO','URO','PROTEÍNAS','qualitative',70,null,'Negativo',null,null,'["Negativo","Trazas","Positivo"]','Orina','Tira reactiva',null),
('URO-BIL','URO','BILIRRUBINA','qualitative',80,null,'Negativo',null,null,'["Negativo","Positivo"]','Orina','Tira reactiva',null),
('URO-BLD','URO','SANGRE','qualitative',90,null,'Negativo',null,null,'["Negativo","Trazas","Positivo"]','Orina','Tira reactiva',null),
('URO-NIT','URO','NITRITOS','qualitative',100,null,'Negativo',null,null,'["Negativo","Positivo"]','Orina','Tira reactiva',null),
('URO-URO','URO','UROBILINOGENO','numeric',110,'mg/dL','0.2 - 1.0 mg/dL',0.2,1.0,null,'Orina','Tira reactiva',2),
('URO-ASC','URO','A.ASCORBICO','text',120,null,'Negativo o variable',null,null,null,'Orina','Tira reactiva',null),
('URO-CEL','URO','C.EPITELIALES','text',130,null,'0 - 5 por campo',null,null,null,'Orina','Microscopía',null),
('URO-HEMA','URO','HEMATIES','text',140,null,'0 - 2 por campo',null,null,null,'Orina','Microscopía',null),
('URO-LEU','URO','LEUCOCITOS','text',150,null,'0 - 5 por campo',null,null,null,'Orina','Microscopía',null),
('URO-PIO','URO','PIOCITOS','text',160,null,'0 - 5 por campo',null,null,null,'Orina','Microscopía',null),
('URO-GER','URO','GÉRMENES','text',170,null,'Ausentes / Escasos',null,null,null,'Orina','Microscopía',null),
('URO-PRU','URO','PROTEINURA','qualitative',180,null,'Negativo (< 150 mg/24 horas)',null,null,'["Negativo","Positivo"]','Orina','Cuantificación',null),
('URO-CRIS','URO','CRISTALES','text',190,null,'Ausentes',null,null,null,'Orina','Microscopía',null),
('URO-CIL','URO','CILINDROS','text',200,null,'Ausentes',null,null,null,'Orina','Microscopía',null),
('URO-OTR-1','URO','OTROS','text',210,null,'Negativo',null,null,null,'Orina','Microscopía',null),
('URO-OTR-2','URO','OTROS','text',220,null,'Negativo',null,null,null,'Orina','Microscopía',null),
-- Parasitología
('PAR-COLOR','PAR','COLOR','text',10,null,'Marrón',null,null,null,'Heces','Observación directa',null),
('PAR-CONS','PAR','CONSISTENCIA','text',20,null,'Formada / Pastosa',null,null,null,'Heces','Observación directa',null),
('PAR-ASP','PAR','ASPECTO','text',30,null,'Homogéneo',null,null,null,'Heces','Observación directa',null),
('PAR-MOCO','PAR','MOCO','qualitative',40,null,'Negativo / Ausente',null,null,'["Negativo","Ausente","Presente"]','Heces','Observación directa',null),
('PAR-HUE','PAR','HUEVO','qualitative',50,null,'Negativo',null,null,'["Negativo","Positivo"]','Heces','Microscopía',null),
('PAR-LAR','PAR','LARVA','qualitative',60,null,'Negativo',null,null,'["Negativo","Positivo"]','Heces','Microscopía',null),
('PAR-QUI','PAR','QUISTE','qualitative',70,null,'Negativo',null,null,'["Negativo","Positivo"]','Heces','Microscopía',null),
('PAR-TRO','PAR','TROFOZOITO','qualitative',80,null,'Negativo',null,null,'["Negativo","Positivo"]','Heces','Microscopía',null),
('PAR-RXI','PAR','RX INFLAMATORIA','qualitative',90,null,'Negativa',null,null,'["Negativa","Positiva"]','Heces','Microscopía',null),
('PAR-GRA','PAR','TEST GRAHAM','qualitative',100,null,'Negativo',null,null,'["Negativo","Positivo"]','Cinta adhesiva','Microscopía',null),
('PAR-THE','PAR','THEVENON','qualitative',110,null,'Negativo',null,null,'["Negativo","Positivo"]','Heces','Método químico',null),
('PAR-M1','PAR','N° MUESTRA 1°','text',120,null,'Registrada',null,null,null,'Heces','Registro',null),
('PAR-M2','PAR','N° MUESTRA 2°','text',130,null,'Registrada',null,null,null,'Heces','Registro',null),
('PAR-M3','PAR','N° MUESTRA 3°','text',140,null,'Registrada',null,null,null,'Heces','Registro',null),
('PAR-DIR','PAR','METODO DIRECTO','qualitative',150,null,'Aplicado',null,null,'["Aplicado","No aplicado"]','Heces','Método directo',null),
('PAR-TSR','PAR','METODO TSR','qualitative',160,null,'Aplicado',null,null,'["Aplicado","No aplicado"]','Heces','TSR',null),
-- Otros
('OTR-LEI','OTR','LEISHMANIASIS','qualitative',10,null,'Negativo',null,null,'["Negativo","Positivo"]','Muestra clínica','Microscopía',null),
('OTR-GOT','OTR','GOTA GRUESA','qualitative',20,null,'Negativo',null,null,'["Negativo","Positivo"]','Sangre','Microscopía',null),
('OTR-HEL','OTR','TEST HELECHO','qualitative',30,null,'Negativo',null,null,'["Negativo","Positivo"]','Muestra clínica','Microscopía',null),
('OTR-GRAM','OTR','COLORACIÓN GRAM','qualitative',40,null,'Negativo',null,null,'["Negativo","Positivo"]','Muestra clínica','Microscopía',null);

insert into public.analysis_groups(code, name, display_order, active)
values
  ('HEM','HEMATOLOGÍA',10,true), ('BIO','BIOQUÍMICA',20,true),
  ('INM','INMUNOLOGÍA',30,true), ('URO','UROANÁLISIS',40,true),
  ('PAR','PARASITOLOGÍA',50,true), ('OTR','OTROS',60,true)
on conflict (code) do update set
  name = excluded.name,
  display_order = excluded.display_order,
  active = true;

update public.analysis_groups set active = false
where code not in ('HEM','BIO','INM','URO','PAR','OTR');

do $catalog$
declare
  item desired_catalog%rowtype;
  actor uuid;
  target_group uuid;
  target_analysis uuid;
  next_version integer;
begin
  select authorized_user_id into actor from public.lab_settings where id;
  if actor is null then raise exception 'authorized_user_required'; end if;

  update public.analyses set active = false
  where code not in (select code from desired_catalog);

  for item in select * from desired_catalog order by group_code, picker_order loop
    select id into target_group from public.analysis_groups where code = item.group_code;
    insert into public.analyses(code, group_id, name, result_type, active, created_by, source_metadata)
    values (
      item.code, target_group, item.name, item.result_type, true, actor,
      jsonb_build_object('picker_order', item.picker_order, 'picker_common', true, 'catalog_version', 2)
    )
    on conflict (code) do update set
      group_id = excluded.group_id,
      name = excluded.name,
      result_type = excluded.result_type,
      active = true,
      archived_at = null,
      source_metadata = coalesce(public.analyses.source_metadata, '{}'::jsonb) || excluded.source_metadata
    returning id into target_analysis;

    update public.analysis_versions
    set effective_to = now()
    where analysis_id = target_analysis and effective_to is null and effective_from < now();

    select coalesce(max(version), 0) + 1 into next_version
    from public.analysis_versions where analysis_id = target_analysis;

    insert into public.analysis_versions(
      analysis_id, version, sample_type, method, unit, decimals,
      qualitative_options, reference_ranges, critical_limits, effective_from,
      approved_by, clinical_status, source_metadata
    ) values (
      target_analysis, next_version, item.sample_type, item.method, item.unit, item.decimals,
      item.qualitative_options,
      jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'label', item.reference_label, 'low', item.low_value, 'high', item.high_value
      ))),
      '{}'::jsonb, '2000-01-01 00:00:00+00', actor, 'approved',
      jsonb_build_object('catalog_version', 2, 'canonical_order', item.picker_order)
    );
  end loop;
end;
$catalog$;

create or replace function public.assign_canonical_analysis_order()
returns trigger language plpgsql set search_path = public as $$
begin
  select ag.display_order * 1000
       + coalesce((a.source_metadata->>'picker_order')::integer, 999)
  into new.display_order
  from public.analyses a
  join public.analysis_groups ag on ag.id = a.group_id
  where a.id = new.analysis_id;
  return new;
end;
$$;

drop trigger if exists order_analyses_canonical_order on public.order_analyses;
create trigger order_analyses_canonical_order
before insert or update of analysis_id on public.order_analyses
for each row execute function public.assign_canonical_analysis_order();

update public.order_analyses oa
set display_order = ag.display_order * 1000
  + coalesce((a.source_metadata->>'picker_order')::integer, 999)
from public.analyses a
join public.analysis_groups ag on ag.id = a.group_id
where oa.analysis_id = a.id;

notify pgrst, 'reload schema';
commit;
