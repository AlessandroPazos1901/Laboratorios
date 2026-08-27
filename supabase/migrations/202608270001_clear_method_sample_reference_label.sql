-- Quita la etiqueta «Según método y muestra» de los intervalos de referencia.
-- El laboratorio no quiere verla impresa en el informe del paciente y son 76
-- versiones: quitarlas a mano desde el Catálogo no es viable.
--
-- Se deja `[{"label": ""}]` y NO `[]`: con el array vacío `referenceLabel()`
-- (src/lib/clinical.ts) devuelve «Por definir», que sería cambiar un texto por
-- otro. Con la etiqueta vacía la columna «V. NORMALES» sale en blanco.
--
-- Solo se tocan las versiones cuyo intervalo es exactamente esa etiqueta y nada
-- más. Ninguna de las 76 lleva `low`/`high`, así que no se pierde ningún límite
-- numérico ni se desactiva ningún análisis.
--
-- Los resultados ya emitidos conservan su `clinical_snapshot` intacto a
-- propósito: un informe histórico no cambia porque el catálogo cambie hoy.
update public.analysis_versions
set reference_ranges = '[{"label": ""}]'::jsonb
where reference_ranges = '[{"label": "Según método y muestra"}]'::jsonb;
