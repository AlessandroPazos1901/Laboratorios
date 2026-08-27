-- Igual que 202608270001, para la etiqueta «Según método»: el laboratorio
-- tampoco quiere verla impresa en el informe del paciente.
--
-- Son 10 versiones, todas exactamente `[{"label": "Según método"}]` y todas de
-- análisis NUMÉRICOS (albúminas, fosfatasa alcalina, GGT, globulinas, LDH,
-- lipasa, proteínas, VLDL, PSA cuantitativo, microalbuminuria). Ninguna lleva
-- `low`/`high`, así que no se pierde ningún límite: la app ya no podía marcar
-- estos resultados fuera de rango. Lo que cambia es que la cifra se imprime sin
-- intervalo de referencia al lado; es una decisión del laboratorio.
--
-- Se deja `[{"label": ""}]` y no `[]` por lo mismo que la migración anterior:
-- con el array vacío `referenceLabel()` imprimiría «Por definir».
update public.analysis_versions
set reference_ranges = '[{"label": ""}]'::jsonb
where reference_ranges = '[{"label": "Según método"}]'::jsonb;
