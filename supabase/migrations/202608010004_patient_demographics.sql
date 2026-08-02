-- Conserva fecha y hora de nacimiento para edades pediátricas y neonatales exactas.
begin;

-- El editor SQL no establece auth.uid(). El trigger anterior reemplazaba
-- updated_by por NULL en cualquier mantenimiento ejecutado desde el editor.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  if tg_table_name in ('patients', 'orders', 'result_values') then
    new.updated_by := coalesce(
      auth.uid(),
      new.updated_by,
      old.updated_by,
      new.created_by,
      old.created_by
    );
  end if;
  return new;
end;
$$;

alter table public.patients
  add column if not exists birth_at timestamptz;

-- Algunas filas históricas se importaron antes de exigir updated_by. Al tocar
-- esas filas PostgreSQL vuelve a validar el NOT NULL, así que se reparan primero.
update public.patients
set updated_by = created_by
where updated_by is null
  and created_by is not null;

update public.patients
set birth_at = birth_date::timestamp at time zone 'America/Lima'
where birth_at is null and birth_date is not null;

create or replace function public.upsert_patient_with_demographics(
  patient_dni text,
  patient_name text,
  patient_birth_at timestamptz,
  patient_sex text
)
returns public.patients
language plpgsql
security definer
set search_path = public
as $$
declare saved public.patients;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if coalesce(trim(patient_dni), '') !~ '^[0-9]{8}$' then raise exception 'invalid_dni'; end if;
  if char_length(trim(coalesce(patient_name, ''))) not between 2 and 180
  then raise exception 'patient_name_required'; end if;
  if patient_birth_at is null or patient_birth_at > now() then raise exception 'invalid_birth_date'; end if;
  if patient_sex is null or patient_sex not in ('F', 'M', 'X') then raise exception 'invalid_patient_sex'; end if;

  insert into public.patients(
    document_type, document_number, full_name, first_names, paternal_surname,
    birth_date, birth_at, sex, created_by, updated_by
  ) values (
    'DNI', trim(patient_dni), trim(patient_name), trim(patient_name), 'N/A',
    (patient_birth_at at time zone 'America/Lima')::date, patient_birth_at, patient_sex,
    auth.uid(), auth.uid()
  )
  on conflict (document_type, document_number) do update set
    full_name = excluded.full_name,
    first_names = excluded.first_names,
    birth_date = excluded.birth_date,
    birth_at = excluded.birth_at,
    sex = excluded.sex,
    updated_by = auth.uid()
  returning * into saved;
  return saved;
end;
$$;

grant execute on function public.upsert_patient_with_demographics(text,text,timestamptz,text) to authenticated;

commit;
