-- Cierra altas automáticas y obliga a usar RPCs transaccionales para escrituras.
begin;

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles(id, full_name, role, active)
  values(
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data->>'full_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Usuario del laboratorio'
    ),
    'staff'::public.app_role,
    false
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

-- Las cuentas ya autorizadas conservan su estado. Las futuras cuentas quedan
-- inactivas hasta que una cuenta propietaria las apruebe explícitamente.

revoke insert, update, delete on table
  public.lab_settings,
  public.patients,
  public.analysis_groups,
  public.analyses,
  public.analysis_versions,
  public.panels,
  public.panel_analyses,
  public.orders,
  public.order_analyses,
  public.result_revisions,
  public.result_values,
  public.report_versions,
  public.import_batches,
  public.import_rows
from anon, authenticated;

drop policy if exists patients_staff_all on public.patients;
create policy patients_staff_read on public.patients
for select using (public.current_profile_is_active());

drop policy if exists orders_staff_insert on public.orders;
drop policy if exists order_analyses_staff_insert on public.order_analyses;
drop policy if exists revisions_staff_insert on public.result_revisions;
drop policy if exists values_staff_insert on public.result_values;
drop policy if exists values_staff_update_draft on public.result_values;
drop policy if exists imports_staff_insert on public.import_batches;
drop policy if exists import_rows_staff_insert on public.import_rows;

-- El bucket aún no forma parte del flujo V1; no se deja una lectura global.
drop policy if exists reports_storage_read on storage.objects;

commit;
