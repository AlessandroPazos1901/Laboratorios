# QA report · LIMS José

- Fecha: 2026-07-24
- URL: `http://localhost:3000`
- Framework: Next.js 16.2.11
- Alcance: login, recuperación, las ocho secciones internas, búsqueda global,
  validación crítica, PDF, importación CSV, API, escritorio y móvil
- Evidencias: 9 capturas
- Consola: 0 errores

## Resultado

Salud inicial: **97/100**  
Salud final: **100/100** en comportamiento y accesibilidad probados.

## Hallazgos corregidos

### ISSUE-001 · Comunicación crítica parecía editable después de validar

- Severidad: media
- Categoría: funcional / seguridad clínica
- Reproducción: validar `ORD-2026-04668` después de confirmar y documentar el
  valor crítico.
- Antes: el formulario de comunicación permanecía activo visualmente.
- Corrección: el formulario desaparece al bloquear la revisión y se sustituye
  por evidencia explícita de solo lectura.
- Estado: verificado
- Commit: `58b3096`
- Evidencia anterior: `screenshots/results-validated.png`
- Evidencia posterior: `screenshots/issue-001-after.png`

### ISSUE-002 · Cuatro búsquedas operativas carecían de nombre accesible

- Severidad: media
- Categoría: accesibilidad
- Afectaba: cola diaria, pacientes, catálogo y auditoría.
- Corrección: nombres accesibles explícitos para las cuatro entradas y el
  selector de grupo del catálogo.
- Verificación automatizada: 0 entradas sin etiqueta en las cuatro vistas.
- Estado: verificado
- Commit: `dd6bc0b`
- Evidencia: `screenshots/issue-002-before.png`,
  `screenshots/issue-002-after.png`

### ISSUE-003 · Dependencias transitivas con alertas altas

- Severidad: alta
- Categoría: dependencias
- Afectaba: versiones transitivas de PostCSS y Sharp heredadas por Next.js.
- Corrección: overrides compatibles a PostCSS 8.5.23 y Sharp 0.35.3.
- Resultado: 3 alertas altas eliminadas; permanecen 2 moderadas asociadas al
  `uuid` interno de ExcelJS.
- Estado: verificado mediante instalación, audit y build
- Commit: `27c99b9`

## Flujos verificados

- Inicio de sesión sin backend: informa que la conexión segura está pendiente.
- Acceso de demostración: disponible solo con `NEXT_PUBLIC_DEMO_MODE=true`.
- Navegación: Inicio, Trabajo diario, Pacientes, Analítica, Catálogo,
  Importaciones, Auditoría y Configuración.
- Búsqueda global: abre una orden por código.
- Valor crítico: impide validar sin confirmación y comunicación.
- Validación: cambia estado, bloquea resultados y preserva evidencia.
- PDF: respuesta 200, `application/pdf`, 2,304 bytes.
- PDF inválido, inexistente y en borrador: respuestas 400, 404 y 409.
- Importador: CSV correcto, sin archivo y extensión inválida: 200, 400 y 415.
- Importador: detecta la columna edad y advierte que se recalculará.
- Recuperación: valida correo, proyecto no configurado y contraseñas distintas.
- Cabeceras: `DENY`, `nosniff`, `no-referrer`.
- Responsive: dashboard y menú lateral en 390 × 844.
- Consola: sin errores en los recorridos.

## Asuntos pendientes externos

- Terminar de aplicar las migraciones en el proyecto Supabase conectado y
  ejecutar pruebas RLS con dos usuarios reales.
- Aprobar clínicamente catálogo, rangos, críticos, PDF y correcciones.
- Las dos alertas moderadas de ExcelJS se aceptan temporalmente: afectan rutas
  de UUID no utilizadas por el importador. No se aplicó un downgrade mayor.
- El navegador empaquetado de gstack no inició en Windows; la misma matriz se
  ejecutó con Playwright y Microsoft Edge.

## Conclusión

QA encontró 3 problemas, corrigió 3 y elevó la salud verificada de 97 a 100.
La aplicación está lista para revisión funcional con datos ficticios; no está
autorizada para datos clínicos reales hasta conectar Supabase y completar las
aprobaciones indicadas.
