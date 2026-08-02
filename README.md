# LIMS José

Aplicación interna para gestionar pacientes, órdenes, resultados, validaciones, informes, analítica, catálogo, importaciones y auditoría de un laboratorio clínico. No incluye landing page ni registro público.

## Estado

La interfaz y el proyecto Supabase indicado por el propietario ya están conectados
en el entorno local. El acceso de demostración quedó desactivado. Las migraciones
se aplican manualmente y deben verificarse antes de cargar datos clínicos.

Con `NEXT_PUBLIC_DEMO_MODE=false`, `/app` lee exclusivamente las tablas reales.
Una base vacía muestra métricas en cero y estados vacíos. Los datos ficticios solo
se cargan cuando el modo de demostración se activa explícitamente.

## Desarrollo local

Requiere Node.js 20 o superior.

```bash
npm install
copy .env.example .env.local
npm run dev
```

Abrir `http://localhost:3000`. Con `NEXT_PUBLIC_DEMO_MODE=true` aparece un botón de acceso al prototipo. Este modo debe estar desactivado en Vercel Preview y Production.

## Comandos

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

## Documentación

- [Conexión y seguridad de Supabase](docs/SUPABASE.md)
- [Migración y conciliación del Excel](docs/MIGRATION.md)
- [Despliegue en Vercel](docs/VERCEL.md)
- [Controles clínicos y salida a producción](docs/CLINICAL-SAFETY.md)
- [PWA, cifrado y continuidad sin internet](docs/OFFLINE-PWA.md)

## Límites de V1

Una sede y un laboratorio. No incluye facturación, inventario, integración automática con analizadores, portal del paciente, sincronización pública con Drive ni IA diagnóstica.
