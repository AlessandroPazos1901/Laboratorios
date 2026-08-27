const { Client } = require('pg');
const c = new Client({ connectionString: process.env.DB_URL, ssl: { rejectUnauthorized: false } });
(async () => {
  await c.connect();
  const q = async (label, sql) => { try { const r = await c.query(sql); console.log('##', label); console.table(r.rows); } catch (e) { console.log('##', label, 'ERR', e.message); } };
  await q('formas distintas de reference_ranges', `
    select jsonb_object_keys(reference_ranges) as clave, count(*)
    from analysis_versions where jsonb_typeof(reference_ranges)='object' group by 1 order by 2 desc`);
  await q('exactamente solo-label "Segun metodo y muestra"', `
    select count(*) from analysis_versions
    where reference_ranges = '{"label": "Según método y muestra"}'::jsonb`);
  await q('contiene ese label (con otras claves)', `
    select count(*) filter (where reference_ranges = '{"label": "Según método y muestra"}'::jsonb) as solo_label,
           count(*) filter (where reference_ranges->>'label' = 'Según método y muestra') as con_ese_label,
           count(*) as total_versiones from analysis_versions`);
  await q('labels mas frecuentes', `
    select reference_ranges->>'label' as label, count(*) from analysis_versions
    where reference_ranges ? 'label' group by 1 order by 2 desc limit 15`);
  await q('muestra de filas afectadas', `
    select av.id, a.code, a.name, av.version, av.clinical_status, av.reference_ranges::text, av.critical_limits::text
    from analysis_versions av join analyses a on a.id=av.analysis_id
    where av.reference_ranges->>'label' = 'Según método y muestra' limit 8`);
  await q('resultados ya guardados con ese label en el snapshot', `
    select count(*) from result_values where clinical_snapshot->'reference_range'->>'label' = 'Según método y muestra'`);
  await c.end();
})();
