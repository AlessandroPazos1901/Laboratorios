# Configuración de Supabase

No se ha creado ni modificado ningún proyecto Supabase. Este documento es el punto de entrega para conectarlo cuando el propietario defina la cuenta.

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
   - configurar la URL exacta de producción y las URLs de preview autorizadas.
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
   - `SUPABASE_SERVICE_ROLE_KEY` solo si los procesos administrativos del servidor finalmente la requieren.
8. Ejecutar pruebas de RLS con dos usuarios antes de cargar datos reales.

## Reglas de acceso

- `owner`: administra usuarios, identidad del laboratorio y catálogo.
- `staff`: facultades operativas para pacientes, órdenes y resultados.
- Todo usuario inactivo queda fuera por RLS.
- La auditoría es de solo lectura para la aplicación; INSERT/UPDATE/DELETE se revocan.
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
3. `staff` no puede gestionar perfiles ni versionar catálogo;
4. nadie puede modificar o eliminar `audit_events`;
5. un resultado crítico sin comunicación documentada no se valida;
6. dos actualizaciones con el mismo `lock_version` no pueden triunfar;
7. una URL de Storage expira y no permite enumerar objetos.
