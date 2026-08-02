-- Flujo vigente: registrar, editar e imprimir bajo demanda.
-- `status` se conserva únicamente como columna heredada para no destruir datos ni
-- romper políticas antiguas; deja de representar un estado funcional y permanece
-- siempre en `draft` para todos los registros activos.
begin;

update public.orders
set
  status = 'draft',
  validated_at = null,
  validated_by = null,
  delivered_at = null
where status in ('pending_validation', 'validated', 'delivered');

update public.result_revisions
set
  status = 'draft',
  submitted_at = null,
  submitted_by = null,
  validated_at = null,
  validated_by = null
where status in ('pending_validation', 'validated', 'delivered');

-- Imprimir genera el PDF directamente y no escribe auditoría, métricas ni estados.
-- IF EXISTS permite aplicar la migración en instalaciones que nunca tuvieron
-- estos RPC o donde ya se retiraron manualmente.
drop function if exists public.record_order_print(uuid, integer);
drop function if exists public.record_order_group_print(uuid, text, integer);
drop function if exists public.record_order_batch_print(uuid, uuid, integer);

-- Se retiran las transiciones del flujo anterior. Guardar resultados continúa
-- usando lock_version exclusivamente para controlar ediciones concurrentes.
drop function if exists public.submit_for_validation(uuid, integer);
drop function if exists public.validate_results(uuid, integer);
drop function if exists public.release_report(uuid, text, text, integer);
drop function if exists public.amend_report(uuid, text);
drop function if exists public.cancel_simple_order(uuid, text);

-- Elimina cualquier trigger que todavía invoque la función de auditoría sin
-- asumir qué tablas o migraciones existen en esta instalación.
do $$
declare
  audit_trigger record;
begin
  for audit_trigger in
    select namespace.nspname as schema_name,
           target.relname as table_name,
           trigger_row.tgname as trigger_name
    from pg_trigger trigger_row
    join pg_class target on target.oid = trigger_row.tgrelid
    join pg_namespace namespace on namespace.oid = target.relnamespace
    join pg_proc trigger_function on trigger_function.oid = trigger_row.tgfoid
    join pg_namespace function_namespace on function_namespace.oid = trigger_function.pronamespace
    where not trigger_row.tgisinternal
      and function_namespace.nspname = 'public'
      and trigger_function.proname = 'capture_audit_event'
  loop
    execute format(
      'drop trigger if exists %I on %I.%I',
      audit_trigger.trigger_name,
      audit_trigger.schema_name,
      audit_trigger.table_name
    );
  end loop;
end;
$$;

drop function if exists public.capture_audit_event();
drop table if exists public.audit_events;

commit;
