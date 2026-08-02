# Controles clínicos y salida a producción

El sistema ayuda a aplicar controles; no acredita ni certifica al laboratorio por sí solo.

## Aprobaciones obligatorias

El responsable clínico debe aprobar por versión:

- catálogo de grupos, análisis y paneles;
- muestra, método, unidad, precisión y opciones cualitativas;
- intervalos por edad y sexo;
- límites críticos y procedimiento de comunicación;
- diseño y contenido del PDF;
- política de correcciones e impresión.

El responsable legal debe aprobar privacidad, retención, contratos de encargado y transferencias internacionales conforme a la Ley 29733 y su reglamento vigente.

## Principios implementados

- Ciclo visible: borrador → impreso; no existe aprobación clínica por roles.
- Valor crítico: advertencia visible no bloqueante.
- Corrección posterior a impresión: nueva revisión y motivo obligatorio.
- Snapshot clínico: el informe histórico no cambia cuando cambia el catálogo.
- Evolución: nunca mezcla silenciosamente unidades o métodos incompatibles.
- Sin diagnósticos automáticos.

## Pruebas de aceptación

- Límites exactos de edad, sexo, referencia y crítico.
- Numéricos, cualitativos y texto libre.
- Conservación de unidades en el historial.
- Concurrencia y recuperación tras interrupción.
- Informes Carta anonimizados aprobados por sección.
- Teclado, lector de pantalla, contraste y responsive.
- Restauración real desde backup.
- Piloto offline con corte real de red, reinicio, cola idempotente y conflicto
  concurrente entre dos equipos.
- Aprobación escrita del almacenamiento cifrado local, vigencia de 72 horas y
  procedimiento para equipos perdidos o revocados.

Referencias de diseño del proceso: NTS 072-MINSA/DGSP-V.01 y NTP-ISO 15189:2023. La interpretación aplicable debe validarse con los responsables clínico y legal.
