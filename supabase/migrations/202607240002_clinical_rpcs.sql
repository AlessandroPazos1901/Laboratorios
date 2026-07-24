-- Operaciones transaccionales del LIMS.
-- Ejecutar después de 202607240001_initial_lims.sql.
begin;

create function public.upsert_patient(patient_data jsonb)
returns public.patients
language plpgsql security definer set search_path = public as $$
declare saved public.patients;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if coalesce(patient_data->>'document_type','DNI') = 'DNI'
     and coalesce(patient_data->>'document_number','') !~ '^[0-9]{8}$'
  then raise exception 'invalid_dni'; end if;
  if nullif(patient_data->>'birth_date','')::date > current_date then raise exception 'invalid_birth_date'; end if;
  if coalesce(char_length(trim(patient_data->>'first_names')),0) < 2
     or coalesce(char_length(trim(patient_data->>'paternal_surname')),0) < 2
  then raise exception 'patient_name_required'; end if;

  insert into public.patients(
    document_type, document_number, first_names, paternal_surname, maternal_surname,
    birth_date, sex, phone, email, address, created_by, updated_by
  ) values (
    coalesce(patient_data->>'document_type','DNI'), trim(patient_data->>'document_number'),
    trim(patient_data->>'first_names'), trim(patient_data->>'paternal_surname'),
    nullif(trim(patient_data->>'maternal_surname'),''),
    nullif(patient_data->>'birth_date','')::date, nullif(patient_data->>'sex',''),
    nullif(trim(patient_data->>'phone'),''), nullif(lower(trim(patient_data->>'email')),''),
    nullif(trim(patient_data->>'address'),''), auth.uid(), auth.uid()
  )
  on conflict (document_type, document_number) do update set
    first_names=excluded.first_names, paternal_surname=excluded.paternal_surname,
    maternal_surname=excluded.maternal_surname, birth_date=excluded.birth_date,
    sex=excluded.sex, phone=excluded.phone, email=excluded.email, address=excluded.address,
    updated_by=auth.uid()
  returning * into saved;
  return saved;
end; $$;

create function public.create_order(
  target_patient uuid,
  selected_analysis_versions uuid[],
  order_priority text default 'routine'
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare new_order uuid; new_revision uuid; selected_count integer; inserted_count integer;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if order_priority not in ('routine','urgent') then raise exception 'invalid_priority'; end if;
  if coalesce(array_length(selected_analysis_versions,1),0)=0 then raise exception 'analyses_required'; end if;
  if not exists(select 1 from public.patients where id=target_patient and archived_at is null) then raise exception 'patient_not_found'; end if;

  select count(distinct version_id) into selected_count from unnest(selected_analysis_versions) selected(version_id);
  if selected_count <> array_length(selected_analysis_versions,1) then raise exception 'duplicate_analysis_version'; end if;

  insert into public.orders(patient_id,priority,created_by,updated_by)
  values(target_patient,order_priority,auth.uid(),auth.uid()) returning id into new_order;
  insert into public.result_revisions(order_id,revision,status,created_by)
  values(new_order,1,'draft',auth.uid()) returning id into new_revision;

  insert into public.order_analyses(order_id,analysis_id,analysis_version_id,display_order)
  select new_order,av.analysis_id,av.id,row_number() over(order by ag.display_order,a.name)
  from public.analysis_versions av
  join public.analyses a on a.id=av.analysis_id and a.active
  join public.analysis_groups ag on ag.id=a.group_id and ag.active
  where av.id=any(selected_analysis_versions)
    and av.effective_from<=now() and (av.effective_to is null or av.effective_to>now());
  get diagnostics inserted_count = row_count;
  if inserted_count <> selected_count then raise exception 'invalid_or_inactive_analysis_version'; end if;
  return new_order;
end; $$;

create function public.save_result_draft(
  target_revision uuid,
  target_order_analysis uuid,
  result_payload jsonb,
  expected_lock_version integer
)
returns public.result_values
language plpgsql security definer set search_path = public as $$
declare
  ctx record; saved public.result_values; selected_range jsonb; snapshot jsonb;
  numeric_result numeric; result_flag public.result_flag := 'normal'; age_days integer;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  select rr.status revision_status,rr.order_id,o.lock_version,o.ordered_at,p.birth_date,p.sex,
         oa.id order_analysis_id,a.id analysis_id,a.code,a.name,a.result_type,
         av.id analysis_version_id,av.version,av.sample_type,av.method,av.unit,av.decimals,
         av.qualitative_options,av.reference_ranges,av.critical_limits
  into ctx
  from public.result_revisions rr
  join public.orders o on o.id=rr.order_id
  join public.patients p on p.id=o.patient_id
  join public.order_analyses oa on oa.order_id=o.id and oa.id=target_order_analysis
  join public.analyses a on a.id=oa.analysis_id
  join public.analysis_versions av on av.id=oa.analysis_version_id and av.analysis_id=a.id
  where rr.id=target_revision
  for update of o;
  if not found then raise exception 'result_context_not_found'; end if;
  if ctx.revision_status<>'draft' then raise exception 'revision_locked'; end if;
  if ctx.lock_version<>expected_lock_version then raise exception 'concurrent_change'; end if;

  age_days := case when ctx.birth_date is null then null else (ctx.ordered_at::date-ctx.birth_date) end;
  select value into selected_range
  from jsonb_array_elements(ctx.reference_ranges) value
  where (not (value ? 'sex') or value->>'sex' in (ctx.sex,'ALL'))
    and (
      (age_days is null and not (value ? 'min_age_days') and not (value ? 'max_age_days'))
      or
      (age_days is not null
        and (not (value ? 'min_age_days') or age_days >= (value->>'min_age_days')::integer)
        and (not (value ? 'max_age_days') or age_days <= (value->>'max_age_days')::integer))
    )
  order by coalesce((value->>'min_age_days')::integer,0) desc
  limit 1;

  if ctx.result_type='numeric' then
    if not (result_payload ? 'numeric_value')
       or num_nonnulls(nullif(result_payload->>'text_value',''),nullif(result_payload->>'qualitative_value',''))>0
    then raise exception 'numeric_value_required'; end if;
    numeric_result := (result_payload->>'numeric_value')::numeric;
    if ctx.decimals is not null and scale(numeric_result)>ctx.decimals then raise exception 'numeric_precision_exceeded'; end if;
    if ctx.critical_limits ? 'low' and numeric_result <= (ctx.critical_limits->>'low')::numeric then result_flag:='critical';
    elsif ctx.critical_limits ? 'high' and numeric_result >= (ctx.critical_limits->>'high')::numeric then result_flag:='critical';
    elsif selected_range ? 'low' and numeric_result < (selected_range->>'low')::numeric then result_flag:='low';
    elsif selected_range ? 'high' and numeric_result > (selected_range->>'high')::numeric then result_flag:='high';
    end if;
  elsif ctx.result_type='qualitative' then
    if coalesce(result_payload->>'qualitative_value','')='' then raise exception 'qualitative_value_required'; end if;
    if not exists(select 1 from jsonb_array_elements_text(ctx.qualitative_options) option_value where option_value=result_payload->>'qualitative_value')
    then raise exception 'qualitative_option_not_allowed'; end if;
  elsif ctx.result_type='text' then
    if coalesce(char_length(trim(result_payload->>'text_value')),0)=0 then raise exception 'text_value_required'; end if;
  end if;

  snapshot := jsonb_build_object(
    'analysis_id',ctx.analysis_id,'analysis_code',ctx.code,'analysis_name',ctx.name,
    'analysis_version_id',ctx.analysis_version_id,'version',ctx.version,
    'result_type',ctx.result_type,'sample_type',ctx.sample_type,'method',ctx.method,
    'unit',ctx.unit,'decimals',ctx.decimals,'reference_range',selected_range,
    'critical_limits',ctx.critical_limits,'patient_sex',ctx.sex,'age_days_at_order',age_days
  );

  insert into public.result_values(
    revision_id,order_analysis_id,numeric_value,text_value,qualitative_value,flag,
    clinical_snapshot,critical_acknowledged_at,critical_acknowledged_by,
    critical_communication,created_by,updated_by
  ) values (
    target_revision,target_order_analysis,numeric_result,
    nullif(trim(result_payload->>'text_value'),''),nullif(result_payload->>'qualitative_value',''),
    result_flag,snapshot,
    case when result_flag='critical' and (result_payload->>'critical_acknowledged')::boolean then now() end,
    case when result_flag='critical' and (result_payload->>'critical_acknowledged')::boolean then auth.uid() end,
    nullif(trim(result_payload->>'critical_communication'),''),auth.uid(),auth.uid()
  )
  on conflict (revision_id,order_analysis_id) do update set
    numeric_value=excluded.numeric_value,text_value=excluded.text_value,
    qualitative_value=excluded.qualitative_value,flag=excluded.flag,
    clinical_snapshot=excluded.clinical_snapshot,
    critical_acknowledged_at=excluded.critical_acknowledged_at,
    critical_acknowledged_by=excluded.critical_acknowledged_by,
    critical_communication=excluded.critical_communication,updated_by=auth.uid()
  returning * into saved;
  update public.orders set lock_version=lock_version+1 where id=ctx.order_id;
  return saved;
end; $$;

create function public.release_report(
  target_order uuid,
  report_storage_path text,
  report_sha256 text,
  expected_lock_version integer
)
returns public.report_versions
language plpgsql security definer set search_path = public as $$
declare latest_revision public.result_revisions; released public.report_versions; next_version integer;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if report_storage_path !~ '^reports/[0-9a-f-]+/v[0-9]+\.pdf$' then raise exception 'invalid_storage_path'; end if;
  if report_sha256 !~ '^[0-9a-f]{64}$' then raise exception 'invalid_sha256'; end if;
  perform 1 from public.orders where id=target_order and status='validated' and lock_version=expected_lock_version for update;
  if not found then raise exception 'invalid_state_or_concurrent_change'; end if;
  select * into latest_revision from public.result_revisions where order_id=target_order order by revision desc limit 1;
  if latest_revision.status<>'validated' then raise exception 'validated_revision_required'; end if;
  select coalesce(max(version),0)+1 into next_version from public.report_versions where order_id=target_order;
  insert into public.report_versions(order_id,result_revision_id,version,storage_path,sha256,issued_by)
  values(target_order,latest_revision.id,next_version,report_storage_path,report_sha256,auth.uid())
  returning * into released;
  update public.orders set status='delivered',delivered_at=now(),lock_version=lock_version+1 where id=target_order;
  update public.result_revisions set status='delivered' where id=latest_revision.id;
  return released;
end; $$;

create function public.preview_patient_import(target_batch uuid)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.current_profile_is_active() then jsonb_build_object(
    'batch_id',b.id,'status',b.status,'total_rows',count(r.id),
    'valid_rows',count(r.id) filter(where r.status='valid'),
    'invalid_rows',count(r.id) filter(where r.status='invalid'),
    'sample_errors',coalesce(jsonb_agg(r.errors) filter(where r.status='invalid'),'[]'::jsonb)
  ) else null end
  from public.import_batches b left join public.import_rows r on r.batch_id=b.id
  where public.current_profile_is_active() and b.id=target_batch group by b.id;
$$;

create function public.commit_patient_import(target_batch uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare batch public.import_batches; row_item public.import_rows; accepted integer:=0; rejected integer:=0; saved public.patients;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  select * into batch from public.import_batches where id=target_batch for update;
  if not found or batch.source_kind<>'patients' then raise exception 'patient_batch_not_found'; end if;
  if batch.status='completed' then
    return jsonb_build_object('batch_id',batch.id,'accepted_rows',batch.accepted_rows,'rejected_rows',batch.rejected_rows,'idempotent',true);
  end if;
  if batch.status not in ('previewed','failed') then raise exception 'batch_not_committable'; end if;
  update public.import_batches set status='processing' where id=target_batch;
  for row_item in select * from public.import_rows where batch_id=target_batch order by source_row loop
    if row_item.status<>'valid' then rejected:=rejected+1; continue; end if;
    begin
      saved:=public.upsert_patient(row_item.normalized_values);
      update public.import_rows set status='committed',target_entity_id=saved.id where id=row_item.id;
      accepted:=accepted+1;
    exception when others then
      update public.import_rows set status='invalid',errors=jsonb_build_array(jsonb_build_object('code','commit_error')) where id=row_item.id;
      rejected:=rejected+1;
    end;
  end loop;
  update public.import_batches set status='completed',accepted_rows=accepted,rejected_rows=rejected,committed_at=now() where id=target_batch;
  return jsonb_build_object('batch_id',target_batch,'accepted_rows',accepted,'rejected_rows',rejected,'idempotent',false);
end; $$;

create function public.get_analytics_summary(date_from date, date_to date, group_filter uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with scoped_orders as (
    select distinct o.* from public.orders o
    left join public.order_analyses oa on oa.order_id=o.id
    left join public.analyses a on a.id=oa.analysis_id
    where public.current_profile_is_active()
      and o.ordered_at >= date_from::timestamptz
      and o.ordered_at < (date_to+1)::timestamptz
      and (group_filter is null or a.group_id=group_filter)
  ), scoped_analyses as (
    select oa.id from public.order_analyses oa join scoped_orders o on o.id=oa.order_id
    join public.analyses a on a.id=oa.analysis_id where group_filter is null or a.group_id=group_filter
  )
  select jsonb_build_object(
    'orders',count(distinct o.id),
    'patients',count(distinct o.patient_id),
    'analyses',(select count(*) from scoped_analyses),
    'delivered',count(*) filter(where o.status='delivered'),
    'pending_validation',count(*) filter(where o.status='pending_validation'),
    'critical_values',(select count(*) from public.result_values rv join public.result_revisions rr on rr.id=rv.revision_id join scoped_orders so on so.id=rr.order_id where rv.flag='critical'),
    'median_turnaround_minutes',percentile_cont(.5) within group(order by extract(epoch from (o.validated_at-o.ordered_at))/60) filter(where o.validated_at is not null)
  ) from scoped_orders o;
$$;

create function public.get_patient_trend(target_patient uuid, target_analysis uuid)
returns table(
  ordered_at timestamptz, value numeric, unit text, method text, flag public.result_flag,
  report_version integer, compatible_series_key text
) language sql stable security definer set search_path = public as $$
  select o.ordered_at,rv.numeric_value,rv.clinical_snapshot->>'unit',rv.clinical_snapshot->>'method',
         rv.flag,rp.version,
         encode(extensions.digest(
           coalesce(rv.clinical_snapshot->>'unit','') || '|' || coalesce(rv.clinical_snapshot->>'method',''),
           'sha256'
         ),'hex')
  from public.orders o
  join public.result_revisions rr on rr.order_id=o.id and rr.status in ('validated','delivered')
  join public.result_values rv on rv.revision_id=rr.id
  join public.order_analyses oa on oa.id=rv.order_analysis_id and oa.analysis_id=target_analysis
  left join public.report_versions rp on rp.result_revision_id=rr.id
  where public.current_profile_is_active() and o.patient_id=target_patient and rv.numeric_value is not null
  order by o.ordered_at;
$$;

create trigger import_batches_audit after insert or update or delete on public.import_batches
for each row execute function public.capture_audit_event();

grant execute on function public.upsert_patient(jsonb) to authenticated;
grant execute on function public.create_order(uuid,uuid[],text) to authenticated;
grant execute on function public.save_result_draft(uuid,uuid,jsonb,integer) to authenticated;
grant execute on function public.release_report(uuid,text,text,integer) to authenticated;
grant execute on function public.preview_patient_import(uuid) to authenticated;
grant execute on function public.commit_patient_import(uuid) to authenticated;
grant execute on function public.get_analytics_summary(date,date,uuid) to authenticated;
grant execute on function public.get_patient_trend(uuid,uuid) to authenticated;

commit;
