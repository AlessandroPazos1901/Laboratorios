-- LIMS José · esquema inicial
-- Revisar y aprobar clínicamente antes de ejecutar en el proyecto Supabase definitivo.
begin;

create extension if not exists pgcrypto;
create extension if not exists unaccent;

create type public.app_role as enum ('owner', 'staff');
create type public.order_status as enum ('draft', 'pending_validation', 'validated', 'delivered', 'cancelled');
create type public.result_type as enum ('numeric', 'qualitative', 'text');
create type public.result_flag as enum ('normal', 'low', 'high', 'critical');
create type public.import_status as enum ('previewed', 'processing', 'completed', 'failed', 'cancelled');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null check (char_length(trim(full_name)) between 2 and 120),
  role public.app_role not null default 'staff',
  professional_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.lab_settings (
  id boolean primary key default true check (id),
  legal_name text not null,
  trade_name text not null,
  tax_id text,
  address text,
  phone text,
  timezone text not null default 'America/Lima',
  report_footer text,
  updated_by uuid references public.profiles(id),
  updated_at timestamptz not null default now()
);

create table public.patients (
  id uuid primary key default gen_random_uuid(),
  document_type text not null default 'DNI',
  document_number text not null check (document_number ~ '^[0-9A-Za-z-]{4,20}$'),
  first_names text not null,
  paternal_surname text not null,
  maternal_surname text,
  birth_date date,
  sex text check (sex in ('F', 'M', 'X', 'U')),
  phone text,
  email text,
  address text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (document_type, document_number)
);

create table public.analysis_groups (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null unique,
  display_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.analyses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  group_id uuid not null references public.analysis_groups(id),
  name text not null,
  result_type public.result_type not null,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  archived_at timestamptz
);

create table public.analysis_versions (
  id uuid primary key default gen_random_uuid(),
  analysis_id uuid not null references public.analyses(id) on delete restrict,
  version integer not null check (version > 0),
  sample_type text not null,
  method text,
  unit text,
  decimals smallint check (decimals between 0 and 8),
  qualitative_options jsonb,
  reference_ranges jsonb not null default '[]'::jsonb,
  critical_limits jsonb not null default '{}'::jsonb,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  approved_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  unique (analysis_id, version),
  check (effective_to is null or effective_to > effective_from)
);

create table public.panels (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  active boolean not null default true,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now()
);

create table public.panel_analyses (
  panel_id uuid not null references public.panels(id) on delete cascade,
  analysis_id uuid not null references public.analyses(id) on delete restrict,
  display_order integer not null default 0,
  primary key (panel_id, analysis_id)
);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  patient_id uuid not null references public.patients(id) on delete restrict,
  status public.order_status not null default 'draft',
  priority text not null default 'routine' check (priority in ('routine', 'urgent')),
  ordered_at timestamptz not null default now(),
  collected_at timestamptz,
  received_at timestamptz,
  submitted_at timestamptz,
  validated_at timestamptz,
  delivered_at timestamptz,
  validated_by uuid references public.profiles(id),
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  lock_version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  cancelled_at timestamptz,
  cancellation_reason text,
  check ((status <> 'cancelled') or (cancellation_reason is not null and char_length(trim(cancellation_reason)) >= 5))
);

create table public.order_analyses (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  analysis_id uuid not null references public.analyses(id) on delete restrict,
  analysis_version_id uuid not null references public.analysis_versions(id) on delete restrict,
  sample_identifier text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (order_id, analysis_id)
);

create table public.result_revisions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  revision integer not null check (revision > 0),
  status public.order_status not null check (status in ('draft', 'pending_validation', 'validated', 'delivered')),
  amendment_reason text,
  based_on_revision_id uuid references public.result_revisions(id) on delete restrict,
  created_by uuid not null references public.profiles(id),
  submitted_by uuid references public.profiles(id),
  validated_by uuid references public.profiles(id),
  created_at timestamptz not null default now(),
  submitted_at timestamptz,
  validated_at timestamptz,
  unique (order_id, revision),
  check ((based_on_revision_id is null and amendment_reason is null) or char_length(trim(amendment_reason)) >= 5)
);

create table public.result_values (
  id uuid primary key default gen_random_uuid(),
  revision_id uuid not null references public.result_revisions(id) on delete restrict,
  order_analysis_id uuid not null references public.order_analyses(id) on delete restrict,
  numeric_value numeric,
  text_value text,
  qualitative_value text,
  flag public.result_flag not null default 'normal',
  clinical_snapshot jsonb not null,
  critical_acknowledged_at timestamptz,
  critical_acknowledged_by uuid references public.profiles(id),
  critical_communication text,
  created_by uuid not null references public.profiles(id),
  updated_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (revision_id, order_analysis_id),
  check (num_nonnulls(numeric_value, text_value, qualitative_value) <= 1),
  check (
    flag <> 'critical' or
    (critical_acknowledged_at is not null and critical_acknowledged_by is not null and char_length(trim(critical_communication)) >= 5)
  )
);

create table public.report_versions (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete restrict,
  result_revision_id uuid not null unique references public.result_revisions(id) on delete restrict,
  version integer not null check (version > 0),
  storage_path text not null unique,
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  issued_by uuid not null references public.profiles(id),
  issued_at timestamptz not null default now(),
  superseded_at timestamptz,
  unique (order_id, version)
);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  status public.import_status not null default 'previewed',
  source_filename text not null,
  source_sha256 text not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_kind text not null check (source_kind in ('patients', 'historical_results')),
  total_rows integer not null default 0,
  accepted_rows integer not null default 0,
  rejected_rows integer not null default 0,
  mapping jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  committed_at timestamptz,
  unique (source_sha256, source_kind)
);

create table public.import_rows (
  id bigint generated always as identity primary key,
  batch_id uuid not null references public.import_batches(id) on delete restrict,
  sheet_name text,
  source_row integer not null,
  source_values jsonb not null,
  normalized_values jsonb,
  status text not null check (status in ('pending', 'valid', 'invalid', 'committed')),
  errors jsonb not null default '[]'::jsonb,
  target_entity_id uuid,
  unique (batch_id, sheet_name, source_row)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  actor_id uuid references public.profiles(id),
  action text not null,
  entity_table text not null,
  entity_id text not null,
  before_values jsonb,
  after_values jsonb,
  reason text,
  import_batch_id uuid references public.import_batches(id)
);

create index patients_document_idx on public.patients (document_number);
create index patients_name_search_idx on public.patients using gin (to_tsvector('simple', coalesce(first_names,'') || ' ' || coalesce(paternal_surname,'') || ' ' || coalesce(maternal_surname,'')));
create index orders_patient_date_idx on public.orders (patient_id, ordered_at desc);
create index orders_status_date_idx on public.orders (status, ordered_at desc);
create index order_analyses_order_idx on public.order_analyses (order_id);
create index result_values_revision_idx on public.result_values (revision_id);
create index audit_entity_idx on public.audit_events (entity_table, entity_id, occurred_at desc);
create index audit_actor_idx on public.audit_events (actor_id, occurred_at desc);

create function public.current_profile_is_active()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles p where p.id = auth.uid() and p.active); $$;

create function public.current_profile_is_owner()
returns boolean language sql stable security definer set search_path = public
as $$ select exists(select 1 from public.profiles p where p.id = auth.uid() and p.active and p.role = 'owner'); $$;

create function public.touch_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if tg_table_name in ('patients', 'orders', 'result_values') then new.updated_by := auth.uid(); end if;
  return new;
end; $$;

create trigger patients_touch before update on public.patients for each row execute function public.touch_updated_at();
create trigger orders_touch before update on public.orders for each row execute function public.touch_updated_at();
create trigger result_values_touch before update on public.result_values for each row execute function public.touch_updated_at();
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();

create function public.capture_audit_event()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  row_id text;
begin
  row_id := coalesce((case when tg_op = 'DELETE' then to_jsonb(old) else to_jsonb(new) end)->>'id', 'unknown');
  insert into public.audit_events(actor_id, action, entity_table, entity_id, before_values, after_values)
  values (auth.uid(), lower(tg_op), tg_table_name, row_id,
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end; $$;

create trigger patients_audit after insert or update or delete on public.patients for each row execute function public.capture_audit_event();
create trigger orders_audit after insert or update or delete on public.orders for each row execute function public.capture_audit_event();
create trigger result_revisions_audit after insert or update or delete on public.result_revisions for each row execute function public.capture_audit_event();
create trigger result_values_audit after insert or update or delete on public.result_values for each row execute function public.capture_audit_event();
create trigger analyses_audit after insert or update or delete on public.analyses for each row execute function public.capture_audit_event();
create trigger analysis_versions_audit after insert or update or delete on public.analysis_versions for each row execute function public.capture_audit_event();
create trigger report_versions_audit after insert or update or delete on public.report_versions for each row execute function public.capture_audit_event();

create function public.search_patients(search_text text, result_limit integer default 20)
returns table(id uuid, document_type text, document_number text, full_name text, birth_date date, sex text)
language sql stable security definer set search_path = public as $$
  select p.id, p.document_type, p.document_number,
         concat_ws(' ', p.first_names, p.paternal_surname, p.maternal_surname),
         p.birth_date, p.sex
  from public.patients p
  where public.current_profile_is_active()
    and p.archived_at is null
    and (
      p.document_number ilike '%' || trim(search_text) || '%'
      or unaccent(concat_ws(' ', p.first_names, p.paternal_surname, p.maternal_surname))
         ilike '%' || unaccent(trim(search_text)) || '%'
    )
  order by (p.document_number = trim(search_text)) desc, p.paternal_surname
  limit least(greatest(result_limit, 1), 50);
$$;

create function public.submit_for_validation(target_order uuid, expected_lock_version integer)
returns public.orders language plpgsql security definer set search_path = public as $$
declare changed public.orders;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if not exists (
    select 1 from public.order_analyses oa
    join public.result_revisions rr on rr.order_id = oa.order_id
    join public.result_values rv on rv.revision_id = rr.id and rv.order_analysis_id = oa.id
    where oa.order_id = target_order and rr.revision = (select max(revision) from public.result_revisions where order_id = target_order)
  ) then raise exception 'results_required'; end if;
  update public.orders set status='pending_validation', submitted_at=now(), lock_version=lock_version+1
  where id=target_order and status='draft' and lock_version=expected_lock_version returning * into changed;
  if changed.id is null then raise exception 'invalid_state_or_concurrent_change'; end if;
  update public.result_revisions set status='pending_validation', submitted_by=auth.uid(), submitted_at=now()
  where order_id=target_order and revision=(select max(revision) from public.result_revisions where order_id=target_order);
  return changed;
end; $$;

create function public.validate_results(target_order uuid, expected_lock_version integer)
returns public.orders language plpgsql security definer set search_path = public as $$
declare changed public.orders;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if exists (
    select 1 from public.result_values rv join public.result_revisions rr on rr.id=rv.revision_id
    where rr.order_id=target_order and rr.revision=(select max(revision) from public.result_revisions where order_id=target_order)
      and rv.flag='critical' and (rv.critical_acknowledged_at is null or char_length(trim(rv.critical_communication)) < 5)
  ) then raise exception 'critical_communication_required'; end if;
  update public.orders set status='validated', validated_at=now(), validated_by=auth.uid(), lock_version=lock_version+1
  where id=target_order and status='pending_validation' and lock_version=expected_lock_version returning * into changed;
  if changed.id is null then raise exception 'invalid_state_or_concurrent_change'; end if;
  update public.result_revisions set status='validated', validated_by=auth.uid(), validated_at=now()
  where order_id=target_order and revision=(select max(revision) from public.result_revisions where order_id=target_order);
  return changed;
end; $$;

create function public.amend_report(target_order uuid, amendment_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare previous_revision public.result_revisions; new_revision_id uuid; next_revision integer;
begin
  if not public.current_profile_is_active() then raise exception 'not_authorized'; end if;
  if char_length(trim(amendment_reason)) < 5 then raise exception 'reason_required'; end if;
  select * into previous_revision from public.result_revisions where order_id=target_order order by revision desc limit 1 for update;
  if previous_revision.status not in ('validated','delivered') then raise exception 'validated_revision_required'; end if;
  next_revision := previous_revision.revision + 1;
  insert into public.result_revisions(order_id,revision,status,amendment_reason,based_on_revision_id,created_by)
  values(target_order,next_revision,'draft',trim(amendment_reason),previous_revision.id,auth.uid()) returning id into new_revision_id;
  insert into public.result_values(revision_id,order_analysis_id,numeric_value,text_value,qualitative_value,flag,clinical_snapshot,created_by,updated_by)
  select new_revision_id,order_analysis_id,numeric_value,text_value,qualitative_value,flag,clinical_snapshot,auth.uid(),auth.uid()
  from public.result_values where revision_id=previous_revision.id;
  update public.orders set status='draft', lock_version=lock_version+1 where id=target_order;
  insert into public.audit_events(actor_id,action,entity_table,entity_id,reason)
  values(auth.uid(),'amend','orders',target_order::text,trim(amendment_reason));
  return new_revision_id;
end; $$;

alter table public.profiles enable row level security;
alter table public.lab_settings enable row level security;
alter table public.patients enable row level security;
alter table public.analysis_groups enable row level security;
alter table public.analyses enable row level security;
alter table public.analysis_versions enable row level security;
alter table public.panels enable row level security;
alter table public.panel_analyses enable row level security;
alter table public.orders enable row level security;
alter table public.order_analyses enable row level security;
alter table public.result_revisions enable row level security;
alter table public.result_values enable row level security;
alter table public.report_versions enable row level security;
alter table public.import_batches enable row level security;
alter table public.import_rows enable row level security;
alter table public.audit_events enable row level security;

create policy profiles_self_read on public.profiles for select using (id=auth.uid() or public.current_profile_is_owner());
create policy profiles_owner_all on public.profiles for all using (public.current_profile_is_owner()) with check (public.current_profile_is_owner());
create policy settings_read on public.lab_settings for select using (public.current_profile_is_active());
create policy settings_owner_write on public.lab_settings for all using (public.current_profile_is_owner()) with check (public.current_profile_is_owner());

-- V1: una sola sede. El personal activo comparte facultades operativas.
create policy patients_staff_all on public.patients for all using (public.current_profile_is_active()) with check (public.current_profile_is_active());
create policy groups_staff_read on public.analysis_groups for select using (public.current_profile_is_active());
create policy analyses_staff_read on public.analyses for select using (public.current_profile_is_active());
create policy versions_staff_read on public.analysis_versions for select using (public.current_profile_is_active());
create policy panels_staff_read on public.panels for select using (public.current_profile_is_active());
create policy panel_analyses_staff_read on public.panel_analyses for select using (public.current_profile_is_active());
create policy groups_owner_write on public.analysis_groups for all using (public.current_profile_is_owner()) with check (public.current_profile_is_owner());
create policy analyses_owner_write on public.analyses for all using (public.current_profile_is_owner()) with check (public.current_profile_is_owner());
create policy versions_owner_write on public.analysis_versions for all using (public.current_profile_is_owner()) with check (public.current_profile_is_owner());
create policy panels_owner_write on public.panels for all using (public.current_profile_is_owner()) with check (public.current_profile_is_owner());
create policy panel_analyses_owner_write on public.panel_analyses for all using (public.current_profile_is_owner()) with check (public.current_profile_is_owner());
create policy orders_staff_read on public.orders for select using (public.current_profile_is_active());
create policy order_analyses_staff_read on public.order_analyses for select using (public.current_profile_is_active());
create policy revisions_staff_read on public.result_revisions for select using (public.current_profile_is_active());
create policy values_staff_read on public.result_values for select using (public.current_profile_is_active());
create policy reports_staff_read on public.report_versions for select using (public.current_profile_is_active());
create policy imports_staff_read on public.import_batches for select using (public.current_profile_is_active());
create policy import_rows_staff_read on public.import_rows for select using (public.current_profile_is_active());
create policy audit_staff_read on public.audit_events for select using (public.current_profile_is_active());

-- Escritura clínica directa mínima; transiciones y correcciones deben usar RPC.
create policy orders_staff_insert on public.orders for insert with check (public.current_profile_is_active() and created_by=auth.uid() and updated_by=auth.uid() and status='draft');
create policy order_analyses_staff_insert on public.order_analyses for insert with check (public.current_profile_is_active());
create policy revisions_staff_insert on public.result_revisions for insert with check (public.current_profile_is_active() and created_by=auth.uid() and status='draft');
create policy values_staff_insert on public.result_values for insert with check (public.current_profile_is_active() and created_by=auth.uid() and updated_by=auth.uid());
create policy values_staff_update_draft on public.result_values for update
  using (public.current_profile_is_active() and exists(select 1 from public.result_revisions rr where rr.id=revision_id and rr.status='draft'))
  with check (public.current_profile_is_active() and exists(select 1 from public.result_revisions rr where rr.id=revision_id and rr.status='draft'));
create policy imports_staff_insert on public.import_batches for insert with check (public.current_profile_is_active() and created_by=auth.uid());
create policy import_rows_staff_insert on public.import_rows for insert with check (public.current_profile_is_active());

revoke insert, update, delete on public.audit_events from anon, authenticated;
revoke update, delete on public.report_versions from anon, authenticated;
grant execute on function public.search_patients(text, integer) to authenticated;
grant execute on function public.submit_for_validation(uuid, integer) to authenticated;
grant execute on function public.validate_results(uuid, integer) to authenticated;
grant execute on function public.amend_report(uuid, text) to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('clinical-reports', 'clinical-reports', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

create policy reports_storage_read on storage.objects for select to authenticated
using (bucket_id='clinical-reports' and public.current_profile_is_active());

commit;
