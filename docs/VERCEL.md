# Despliegue en Vercel

El repositorio está preparado para Vercel, pero no se ha creado ni enlazado un proyecto.

## Configuración recomendada

- Plan: Vercel Pro.
- Región de funciones: la sudamericana más cercana y compatible con la región de Supabase.
- Root Directory: `laboratorio-web` si el repositorio remoto contiene también otros archivos.
- Framework preset: Next.js.
- Node.js: 20 o superior.
- Production branch: la rama estable que defina el propietario.

## Variables

Configurar por separado Development, Preview y Production. En Preview y Production:

```text
NEXT_PUBLIC_DEMO_MODE=false
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

La service role solo se agrega si el diseño final la necesita y únicamente como secreto de servidor.

## Antes de publicar

- Conectar Supabase y completar la lista de `docs/SUPABASE.md`.
- Aprobar catálogo, límites críticos, PDF y correcciones.
- Ejecutar `npm run lint`, `npm run typecheck`, `npm test` y `npm run build`.
- Confirmar que ninguna variable, log o URL contiene datos clínicos.
- Desactivar grabaciones de sesión y analítica que capture formularios.
- Probar recuperación de contraseña, expiración de sesión y descarga privada.
- Añadir dominio, TLS, responsables y procedimiento de incidente.
