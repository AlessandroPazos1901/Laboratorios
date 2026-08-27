# Configuración de Supabase

El entorno local está conectado al proyecto indicado por el propietario. No se
creó otro proyecto ni se guardó la clave `service_role`; las migraciones se
ejecutan manualmente y permanecen versionadas en este repositorio.

La clave `service_role` fue compartida durante la configuración. Debe rotarse
antes de producción y solo volver a crearse como secreto de servidor si un
proceso administrativo demuestra que la necesita.

## Decisiones de infraestructura

- Un proyecto Supabase Pro en una región sudamericana compatible con la región elegida en Vercel.
- Auth con correo y contraseña; registro público deshabilitado.
- PostgreSQL, Storage privado y Auth en el mismo proyecto.
- PITR habilitado antes de la migración real.
- Nunca exponer `SUPABASE_SERVICE_ROLE_KEY` al navegador.
- Los reportes se almacenan en el bucket privado `clinical-reports`.

## Alta controlada

1. El propietario crea el proyecto en su cuenta y registra quién tiene acceso administrativo.
2. En SQL Editor, revisar y ejecutar `supabase/migrations/202607240001_initial_lims.sql`.
3. En Authentication:
   - desactivar nuevos registros;
   - exigir correo confirmado;
   - definir una política de contraseña apropiada;
   - reducir la duración de sesión según la política del laboratorio;
   - configurar la URL exacta de producción y autorizar `/reset-password` como destino de redirección para invitaciones.
4. Crear la única cuenta técnica desde el panel administrativo. No se utiliza
   `public.profiles`: la cuenta autenticada sirve solo para acceder y la autoría
   clínica se registra con `public.analysts`.
5. Crear el registro único de laboratorio:

```sql
insert into public.lab_settings (legal_name, trade_name, timezone)
values ('RAZÓN SOCIAL PENDIENTE', 'Laboratorio José', 'America/Lima');
```

6. Añadir las variables a Vercel, por ambiente:
   - `NEXT_PUBLIC_DEMO_MODE=false`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` con el origen público de la aplicación.
   - `SUPABASE_SECRET_KEY` solo para tareas administrativas heredadas; se admite `SUPABASE_SERVICE_ROLE_KEY` como compatibilidad.

La instalación operativa utiliza una sola cuenta compartida. La ruta histórica de invitaciones está deshabilitada. Las identidades clínicas viven en `public.analysts` y deben seleccionarse expresamente al registrar cada análisis.
7. Ejecutar pruebas de RLS y de selección obligatoria de analista antes de cargar datos reales.

## Migraciones incluidas

Ejecutar en orden:

1. `202607240001_initial_lims.sql`: entidades, índices, RLS, Storage y ciclo de validación heredado.
2. `202607240002_clinical_rpcs.sql`: pacientes, órdenes, captura tipada, emisión, importación, analítica y evolución.
3. `202607240003_extension_schema_compatibility.sql`: compatibilidad explícita
   con el esquema `extensions` usado por Supabase.
4. `202607240004_auth_profile_bootstrap.sql`: sincroniza `auth.users` con
   `public.profiles`, asigna el primer propietario y crea `lab_settings`.
5. `202607240005_simplified_lab_workflow.sql`: adapta pacientes a DNI y nombre,
   iguala las facultades de los perfiles activos y añade el flujo
   registrar → guardar → imprimir sin validación clínica.
6. `202608020001_stateless_records.sql`: retira las transiciones y RPC de
   impresión, y elimina `audit_events` con todos sus triggers. Imprimir vuelve
   a ser una lectura pura, sin evento ni métrica.
7. `202608020002_offline_first_sync.sql`: registra equipos offline, agrega
   versión de concurrencia a pacientes, recibos idempotentes, cursor de cambios
   y la RPC transaccional `apply_offline_operation`.
8. `202608030001_shared_account_analysts.sql`: crea el catálogo de analistas,
   separa la cuenta técnica de la autoría clínica y exige un analista activo en
   registros online y offline.
9. `202608040001_dni_patient_ids_single_user.sql`: convierte el DNI en la llave
   entera de pacientes, simplifica sus datos a nombre completo, nacimiento y
   sexo, adapta órdenes/sincronización y elimina `public.profiles`.
10. `202608040002_single_user_access_repair.sql`: garantiza la configuración
    del laboratorio y vincula de forma explícita la única cuenta Auth permitida.
11. `202608040003_canonical_catalog_and_print_order.sql`: instala los seis
    grupos y 88 análisis en su orden clínico definitivo, versiona sus valores
    de referencia y obliga a que las selecciones nuevas conserven ese orden.
12. `202608040004_hematology_formula_precision.sql`: admite centésimas en
    hematíes, hemoglobina y hematocrito para guardar los valores autocalculados.
13. `202608200001_fix_save_catalog_analysis_ambiguous_analysis_id.sql`: renombra
    la variable `analysis_id` de `save_catalog_analysis`, que colisionaba con la
    columna homónima de `analysis_versions` y hacía fallar toda edición de
    análisis desde el Catálogo con `column reference "analysis_id" is ambiguous`.
    Crear análisis no se veía afectado: la colisión solo está en la rama de
    edición. Aplicada el 2026-08-20.
14. `202608200002_offline_catalog_operations.sql`: permite editar el catálogo sin
    internet. `create_catalog_group`, `create_catalog_subsection` y
    `save_catalog_analysis` aceptan un id generado por el equipo (y el código del
    análisis pasa a derivarse de ese id, para que no cambie al sincronizar);
    `apply_catalog_operation` centraliza el reparto de las doce acciones del
    catálogo, y `apply_offline_operation` acepta la operación `catalog.apply`.
    Archivar o borrar algo ya archivado o borrado devuelve `noop` en vez de fallar.
    **Ojo**: las tres primeras se recrean con `drop function` previo porque cambia
    su firma; cualquier código que las llame debe usar argumentos con nombre.
    Aplicada el 2026-08-20.
15. `202608210001_login_username.sql`: el personal ingresa con un nombre de
    usuario en lugar del correo. Agrega `lab_settings.login_username` (único,
    sembrado con la parte local del correo de la cuenta autorizada) y la función
    `email_for_login(text)`, `security definer`, que lo traduce al correo. Es
    ejecutable por `anon` porque la pantalla de ingreso todavía no tiene sesión;
    solo responde ante una coincidencia exacta y existe una sola cuenta. Para
    cambiar el usuario: `update public.lab_settings set login_username = '…';`.
    Aplicada el 2026-08-21.

16. `202608220001_patient_birth_time.sql`: edad en horas para recién nacidos.
    Agrega `patients.birth_time` (opcional) en vez de convertir `birth_date` a
    timestamp, para no cambiar la forma de ninguna lectura existente.
    `upsert_patient_with_demographics` y `update_patient_details` reciben un
    quinto argumento `patient_birth_time time default null`; ambas se sueltan y
    se recrean porque cambia la firma, y se les devuelven los permisos —soltar
    una función también borra sus grants, y al recrearla hereda EXECUTE para
    `public`/`anon`, que hay que retirar—. Una hora ya registrada no se borra al
    guardar sin ella, y una hora futura se rechaza con `invalid_birth_date`.
    `apply_offline_operation` transporta `birthTime` en el payload y lo compara
    al detectar conflictos de demografía. Aplicada el 2026-08-22.

17. `202608270001_clear_method_sample_reference_label.sql`: vacía la etiqueta
    «Según método y muestra» en `analysis_versions.reference_ranges` (76
    versiones), porque el laboratorio no quiere verla impresa en el informe del
    paciente. Deja `[{"label": ""}]` y no `[]`, ya que con el array vacío
    `referenceLabel()` imprime «Por definir». Ninguna de las filas afectadas
    llevaba `low`/`high`, así que no se pierde ningún límite numérico y no se
    desactiva ningún análisis. Los `clinical_snapshot` ya emitidos no se tocan:
    un informe histórico no cambia porque el catálogo cambie hoy.
    Aplicada el 2026-08-27.

18. `202608270002_clear_method_reference_label.sql`: lo mismo para la etiqueta
    «Según método» (10 versiones, todas de análisis numéricos y sin `low`/`high`).
    Esas cifras pasan a imprimirse sin intervalo de referencia al lado, por
    decisión del laboratorio. Aplicada el 2026-08-27.

Las RPC del flujo principal incluyen `search_patients`,
`upsert_simple_patient`, `upsert_patient_with_demographics`,
`update_patient_details`, `register_daily_analyses`,
`apply_offline_operation`, `get_analytics_summary` y `get_patient_trend`.

Las columnas heredadas `orders.status` y `result_revisions.status` se conservan
temporalmente como detalle de compatibilidad y permanecen en `draft`; no se
exponen ni representan un estado funcional. `lock_version` sí se mantiene para
detectar ediciones concurrentes.

### Forma de intervalos clínicos

`analysis_versions.reference_ranges` usa una lista de objetos. El responsable
clínico debe evitar solapamientos:

```json
[
  {
    "sex": "F",
    "min_age_days": 6574,
    "max_age_days": 43830,
    "low": 12,
    "high": 16,
    "label": "12.0 – 16.0"
  }
]
```

`critical_limits` usa `{ "low": 7, "high": 20 }`. Las opciones cualitativas
son una lista de textos exactos. La base verifica tipo, precisión, opción,
versión vigente, usuario y concurrencia; la selección final de
intervalos y límites debe aprobarse con casos de frontera antes de producción.

## Reglas de acceso

- Solo la cuenta técnica autenticada puede usar la aplicación. Las políticas
  RLS validan que `auth.uid()` coincida con `lab_settings.authorized_user_id`;
  no existe una tabla de perfiles ni roles de aplicación.
- La identidad clínica nunca se deduce de la cuenta: cada registro exige un
  analista activo de `public.analysts`.
- Las transiciones clínicas se ejecutan mediante RPC transaccionales.
- Los resultados validados no se editan: `amend_report` crea una revisión con motivo y conserva el informe anterior.

## Backups

- Habilitar PITR.
- Exportación lógica semanal cifrada.
- Copia nocturna cifrada de `clinical-reports` a un bucket S3 separado y controlado por el laboratorio.
- Prueba trimestral de restauración, con evidencia de fecha, responsable, RPO y RTO alcanzados.

## Prueba mínima de aislamiento

Antes de producción, verificar que:

1. anónimo no puede leer ninguna tabla ni objeto;
2. un usuario inactivo recibe cero filas y no puede mutar;
3. no se puede registrar un análisis con un analista inactivo;
4. un resultado crítico muestra una advertencia, pero puede guardarse e imprimirse;
5. dos actualizaciones con el mismo `lock_version` no pueden triunfar;
6. una URL de Storage expira y no permite enumerar objetos.
