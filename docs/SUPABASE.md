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
4. Crear el primer usuario desde el panel administrativo.
5. Insertar su perfil como `owner`, sustituyendo el UUID:

```sql
insert into public.profiles (id, full_name, role)
values ('UUID-DE-AUTH-USERS', 'Nombre del propietario', 'owner');
```

6. Crear el registro único de laboratorio:

```sql
insert into public.lab_settings (legal_name, trade_name, timezone)
values ('RAZÓN SOCIAL PENDIENTE', 'Laboratorio José', 'America/Lima');
```

7. Añadir las variables a Vercel, por ambiente:
   - `NEXT_PUBLIC_DEMO_MODE=false`
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `NEXT_PUBLIC_SITE_URL` con el origen público de la aplicación.
   - `SUPABASE_SECRET_KEY` para enviar invitaciones desde el servidor; se admite `SUPABASE_SERVICE_ROLE_KEY` como compatibilidad heredada.

La pantalla Configuración permite que una cuenta `owner` invite nuevos usuarios. La ruta de servidor valida al remitente, envía el correo mediante Supabase Auth y activa el perfil asociado. Las claves administrativas nunca se envían al navegador.
8. Ejecutar pruebas de RLS con dos usuarios antes de cargar datos reales.

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

Las RPC disponibles incluyen `search_patients`, `upsert_patient`, `create_order`,
`save_result_draft`, `save_result_batch`, `register_daily_analyses`,
`preview_patient_import`,
`commit_patient_import`, `get_analytics_summary` y `get_patient_trend`.

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

- Los tres perfiles autorizados tendrán las mismas facultades dentro de la
  aplicación. Internamente cada cuenta se marca explícitamente como `owner`
  para reutilizar las políticas RLS restrictivas; nunca se eleva
  automáticamente a usuarios futuros y el rol no se muestra en la interfaz.
- Todo usuario inactivo queda fuera por RLS.
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
3. un perfil inactivo no puede consultar ni modificar catálogo;
4. un resultado crítico muestra una advertencia, pero puede guardarse e imprimirse;
5. dos actualizaciones con el mismo `lock_version` no pueden triunfar;
6. una URL de Storage expira y no permite enumerar objetos.
