# Migración del Excel

Fuente evaluada: `REGISTRO DIARIO 2026 (version 1).xlsb.xlsm`. El libro se conserva sin modificaciones y, después del corte, debe quedar en modo de solo lectura.

## Línea base reconciliable

- 4,662 registros históricos en `RESULTADOS`.
- 57,776 valores clínicos poblados.
- 88 campos de resultados que requieren mapeo explícito.
- Padrón de hasta 164,414 filas.
- 17 formatos de informe que se sustituyen por un único generador versionado.

Estas cantidades son criterios de conciliación, no instrucciones para importar filas ciegamente.

## Proceso

1. Congelar una copia de origen y calcular SHA-256.
2. Importar a staging conservando archivo, hoja, número de fila y valor original.
3. Normalizar DNI como texto; nunca como número.
4. Detectar duplicados, documentos inválidos, nacimientos ausentes y sexo desconocido.
5. Recalcular edad con fecha de nacimiento y fecha de la orden.
6. Mapear cada uno de los 88 campos a un análisis/versionado aprobado por el responsable clínico.
7. Rechazar fórmulas `#REF!`, encabezados numéricos y reglas derivadas de `VLOOKUP` como autoridad clínica.
8. Verificar tipos, unidades, métodos e intervalos antes del commit.
9. Confirmar el lote de manera idempotente.
10. Conciliar pacientes, órdenes, análisis y excepciones con consultas independientes.

## Criterio de aceptación

La migración se acepta solamente cuando los 4,662 registros y 57,776 valores estén conciliados, o cuando cada diferencia tenga una excepción documentada y firmada.

## Corte

- Ensayo completo con datos anonimizados.
- Una semana de operación paralela.
- Comparación diaria de resultados e informes.
- Corte final acordado, Excel en solo lectura.
- Dos semanas de seguimiento.

No se ejecutan macros. No se utilizará una URL pública de Google Drive; los archivos se cargan por un canal privado y autorizado.
