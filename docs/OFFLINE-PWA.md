# PWA y continuidad sin internet

La aplicación incluye una arquitectura offline-first protegida por la bandera
`NEXT_PUBLIC_OFFLINE_MODE`. Supabase continúa siendo la fuente canónica; cada
equipo autorizado conserva una réplica cifrada y una cola de operaciones.

## Regla general

**Con internet se escribe directo contra la base; sin internet, en la cola local.**
La escritura directa exige además que la cola esté vacía: saltarse operaciones
que aún no subieron reordenaría las escrituras. Mientras quede algo pendiente,
todo pasa por la cola y en su orden.

Cada snapshot que llega del servidor se *rebasa* antes de guardarse: se vuelven a
aplicar encima las operaciones que siguen pendientes (`src/lib/offline/rebase.ts`).
Sin eso, como el pull siempre trae el estado completo, un cambio recién hecho
desaparecía de la pantalla aunque siguiera correctamente encolado.

## Alcance operativo

Sin conexión se permite consultar pacientes y los últimos 90 días, registrar
pacientes, crear tandas de análisis, editar resultados, generar el PDF, editar
el catálogo y cargar el padrón de pacientes desde Excel —ese archivo se procesa
y se guarda solo en la computadora, nunca sube a Supabase—. Administrar
analistas y cambiar la contraseña requiere internet.

### Catálogo sin conexión

El catálogo se edita con la operación `catalog.apply`, cuyo payload es el mismo
cuerpo que recibe `/api/catalog`. Ambos caminos terminan en la misma función de
base, `apply_catalog_operation`, así que no hay dos implementaciones que puedan
divergir.

Los ids de lo que se crea —grupo, subgrupo, análisis y su versión clínica— los
genera el equipo con `crypto.randomUUID()` y la base los respeta. Sin eso no se
podría crear un grupo y meterle análisis en la misma sesión sin conexión: no
habría a qué apuntar. El código del análisis se deriva de su id, de modo que el
que muestra el equipo antes de sincronizar es el definitivo.

Las operaciones de catálogo se encadenan por `dependencies` con la anterior de su
mismo tipo, porque `createdAt` puede empatar al milisegundo y crear un subgrupo
exige que su grupo ya exista.

Reconciliación: al ser metadatos y no datos clínicos de un paciente, gana el
último cambio en llegar. Archivar o borrar algo que otro equipo ya quitó se
considera aplicado. Los informes ya emitidos no se ven afectados: guardan su
propia instantánea clínica.

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

## Ingreso: una sola pantalla

El personal entra con **usuario y contraseña**, los mismos con o sin internet.
No hay PIN.

| Situación | Qué ocurre |
|---|---|
| Con internet, equipo nuevo | Valida contra Supabase, descarga los datos y deja la copia local cifrada con esa contraseña. |
| Con internet, equipo ya usado | Valida contra Supabase y abre la copia local en silencio. |
| Sin internet | Abre la copia local: que la contraseña la descifre prueba que ya fue válida contra el servidor. |

El usuario se configura en `lab_settings.login_username` y la base lo traduce al
correo de la cuenta compartida. Al cambiar la contraseña desde Configuración, la
bóveda se vuelve a envolver con la nueva; si se cambia desde otro equipo, este
tendrá que borrar sus datos locales y volver a prepararse, así que conviene
sincronizarlo antes.

## Modelo de seguridad local

- Cada bóveda pertenece a un usuario y dispositivo.
- PBKDF2-HMAC-SHA256 con 600.000 iteraciones deriva la clave de envoltura desde
  la contraseña de la cuenta.
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

La sincronización se intenta al ingresar, al reconectar, al volver el foco a la
pestaña y cada 30 segundos mientras está visible. Cada intento vacía la cola en
tandas sucesivas de 50 —antes se enviaba una sola tanda y el resto quedaba
varado— y termina con un pull, que es también lo que mantiene a los equipos al
día entre sí. Una PWA cerrada sincroniza en el siguiente ingreso; no se guarda
una solicitud clínica sin cifrar para Background Sync.

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
2. Desconectar Windows de la red, reiniciar e ingresar con usuario y contraseña.
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
