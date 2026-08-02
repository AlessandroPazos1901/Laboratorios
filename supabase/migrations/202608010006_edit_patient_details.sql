-- Edición controlada de los datos maestros de un paciente.
begin;

create or replace function public.update_patient_details(
  target_patient uuid,
  patient_name text,
  patient_birth_at timestamptz,
  patient_sex text,
  patient_phone text default null
)
returns public.patients
language plpgsql
security definer
set search_path = public
as $$
declare saved public.patients;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if char_length(trim(coalesce(patient_name, ''))) not between 2 and 180
  then raise exception 'patient_name_required'; end if;
  if patient_birth_at is null or patient_birth_at > now()
  then raise exception 'invalid_birth_date'; end if;
  if patient_sex is null or patient_sex not in ('F','M','X')
  then raise exception 'invalid_patient_sex'; end if;
  if char_length(trim(coalesce(patient_phone, ''))) > 30
  then raise exception 'invalid_patient_phone'; end if;

  update public.patients
  set
    full_name = trim(patient_name),
    birth_date = (patient_birth_at at time zone 'America/Lima')::date,
    birth_at = patient_birth_at,
    sex = patient_sex,
    phone = nullif(trim(coalesce(patient_phone, '')), ''),
    updated_by = auth.uid()
  where id = target_patient and archived_at is null
  returning * into saved;

  if saved.id is null then raise exception 'patient_not_found'; end if;
  return saved;
end;
$$;

revoke all on function public.update_patient_details(uuid,text,timestamptz,text,text) from public, anon;
grant execute on function public.update_patient_details(uuid,text,timestamptz,text,text) to authenticated;

notify pgrst, 'reload schema';
commit;
