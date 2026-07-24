-- Supabase instala extensiones administradas en el esquema `extensions`.
-- Esta migración corrige proyectos donde 001 ya fue aplicado.
begin;

create or replace function public.search_patients(search_text text, result_limit integer default 20)
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
      or extensions.unaccent(concat_ws(' ', p.first_names, p.paternal_surname, p.maternal_surname))
         ilike '%' || extensions.unaccent(trim(search_text)) || '%'
    )
  order by (p.document_number = trim(search_text)) desc, p.paternal_surname
  limit least(greatest(result_limit, 1), 50);
$$;

grant execute on function public.search_patients(text, integer) to authenticated;

commit;
