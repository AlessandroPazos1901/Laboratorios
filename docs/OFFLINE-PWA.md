# PWA y continuidad sin internet

La aplicación incluye una arquitectura offline-first protegida por la bandera
`NEXT_PUBLIC_OFFLINE_MODE`. Supabase continúa siendo la fuente canónica; cada
equipo autorizado conserva una réplica cifrada y una cola de operaciones.

## Alcance operativo

Sin conexión se permite consultar pacientes y los últimos 90 días, registrar
pacientes, crear tandas de análisis, editar resultados y generar el PDF. Importar
Excel, aprobar catálogo, invitar usuarios y cambiar contraseñas requiere internet.

Los equipos aislados no comparten cambios entre sí hasta reconectar. Los
conflictos de demografía o `lock_version` nunca se resuelven por “último cambio
gana”: aparecen en el panel de conciliación.

## Activación por ambiente

1. Habilitar PITR y crear un respaldo verificable de Supabase.
2. Revisar y ejecutar manualmente
   `supabase/migrations/202608020002_offline_first_sync.sql`.
3. Generar un par de claves ES256:

   ```powershell
   npm.cmd run offline:keys
   ```

4. Configurar la clave privada solo en el servidor como
   `OFFLINE_LEASE_PRIVATE_JWK` y la pública como
   `NEXT_PUBLIC_OFFLINE_LEASE_PUBLIC_JWK`.
5. Desplegar primero con `NEXT_PUBLIC_OFFLINE_MODE=false` y comprobar login,
   pacientes, resultados e informes.
6. Activar `NEXT_PUBLIC_OFFLINE_MODE=true` en staging, después en un equipo
   piloto y finalmente en el resto.

No se debe reutilizar el par de claves entre staging y producción. Rotarlo
invalida las autorizaciones offline existentes; primero deben sincronizarse las
colas y volver a enrolar los equipos.

## Modelo de seguridad local

- Cada bóveda pertenece a un usuario y dispositivo.
- El PIN exige al menos 8 dígitos.
- PBKDF2-HMAC-SHA256 con 600.000 iteraciones deriva la clave de envoltura.
- Una clave aleatoria AES-256-GCM cifra el snapshot, outbox y conflictos.
- La clave de datos descifrada solo vive en memoria mientras la PWA está abierta.
- La autorización ES256 vence a las 72 horas y se renueva al reconectar.
- Cache Storage solo contiene el shell y recursos públicos; nunca respuestas
  de `/api`, Supabase, PDF, DNI o resultados.

El PIN no sustituye los controles del equipo. Los puestos del laboratorio deben
usar cuentas individuales de Windows, BitLocker, bloqueo automático de pantalla,
antimalware actualizado y acceso físico restringido.

## Protocolo de sincronización

- `GET /api/sync/pull`: snapshot canónico y cursor del servidor.
- `POST /api/sync/push`: lote máximo de 50 operaciones, ordenado por
  dependencias.
- `apply_offline_operation`: aplica cada mutación y su recibo idempotente dentro
  de la misma transacción PostgreSQL.
- `offline_mutation_receipts`: evita duplicados si el servidor hizo commit pero
  el equipo perdió la respuesta.
- `sync_change_log`: cursor técnico sin copiar el contenido clínico.

La sincronización se intenta al reconectar, al desbloquear, manualmente y cada
30 segundos mientras la PWA permanece abierta. Una PWA cerrada sincroniza en el
siguiente desbloqueo; no se guarda una solicitud clínica sin cifrar para
Background Sync.

## Verificación y piloto

```powershell
npm.cmd test
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npm.cmd run test:e2e
```

Antes de ampliar el piloto:

1. Preparar un equipo y confirmar que IndexedDB no muestra PII legible.
2. Desconectar Windows de la red, reiniciar y desbloquear con PIN.
3. Crear paciente, tanda, resultados y PDF sin internet.
4. Reconectar y comprobar que la cola queda en cero.
5. Repetir una solicitud después de simular pérdida de respuesta y verificar
   que no se duplica.
6. Modificar el mismo resultado en dos equipos y resolver el conflicto.
7. Vencer o revocar un equipo y confirmar que ya no puede escribir.

## Actualización y reversión

El service worker no activa una versión nueva automáticamente. Si existen
pendientes, la UI exige sincronizarlos antes de actualizar. Para retroceder,
poner `NEXT_PUBLIC_OFFLINE_MODE=false`, impedir nuevos enrolamientos y mantener
temporalmente los endpoints/migración hasta que todas las colas lleguen a cero.

Nunca borrar IndexedDB, desregistrar el service worker o rotar las claves como
primer paso de una reversión: podría dejar trabajo clínico sin recuperar.
