-- Identifica al usuario que registró cada análisis de una orden.
begin;

alter table public.order_analyses
  add column if not exists performed_by uuid references public.profiles(id) on delete restrict;

update public.order_analyses oa
set performed_by = coalesce(
  (
    select batch.created_by
    from public.order_analysis_batches batch
    where batch.id = oa.batch_id
  ),
  orders.created_by
)
from public.orders orders
where orders.id = oa.order_id
  and oa.performed_by is null;

alter table public.order_analyses
  alter column performed_by set not null;

create index if not exists order_analyses_performed_by_idx
  on public.order_analyses(performed_by);

create or replace function public.assign_order_analysis_performer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.performed_by := coalesce(
    auth.uid(),
    new.performed_by,
    (select orders.created_by from public.orders orders where orders.id = new.order_id)
  );
  if new.performed_by is null then raise exception 'analysis_performer_required'; end if;
  return new;
end;
$$;

drop trigger if exists order_analyses_assign_performer on public.order_analyses;
create trigger order_analyses_assign_performer
before insert on public.order_analyses
for each row execute function public.assign_order_analysis_performer();

commit;
