import pg from "pg";

const client = new pg.Client({
  host: process.env.PGHOST,
  port: Number(process.env.PGPORT ?? 6543),
  database: process.env.PGDATABASE,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  ssl: { rejectUnauthorized: false },
});

try {
  await client.connect();
  const { rows: [audit] } = await client.query(`
    select
      (select jsonb_agg(name order by display_order) from public.analysis_groups where active) as groups,
      (select count(*)::integer from public.analyses where active) as active_analyses,
      (select jsonb_agg(a.name order by (a.source_metadata->>'picker_order')::integer)
       from public.analyses a join public.analysis_groups g on g.id = a.group_id
       where a.active and g.code = 'HEM') as hematology,
      (select count(*)::integer from public.order_analyses) as historical_selections,
      (select count(*)::integer from public.order_analyses oa
       left join public.analyses a on a.id = oa.analysis_id where a.id is null) as orphan_selections,
      (select count(*)::integer from public.analysis_versions av
       join public.analyses a on a.id = av.analysis_id
       where a.active and av.source_metadata->>'catalog_version' = '2') as canonical_versions,
      (select count(*)::integer from public.order_analyses oa
       join public.analyses a on a.id = oa.analysis_id
       join public.analysis_groups g on g.id = a.group_id
       where oa.display_order <> g.display_order * 1000
         + coalesce((a.source_metadata->>'picker_order')::integer, 999)) as noncanonical_saved_order,
      (select av.reference_ranges->0->>'label'
       from public.analysis_versions av join public.analyses a on a.id = av.analysis_id
       where a.code = 'HEM-HB' and av.source_metadata->>'catalog_version' = '2') as hemoglobin_reference,
      exists (
        select 1 from pg_trigger
        where tgrelid = 'public.order_analyses'::regclass
          and tgname = 'order_analyses_canonical_order' and not tgisinternal
      ) as canonical_order_trigger
  `);
  const expectedGroups = ["HEMATOLOGÍA", "BIOQUÍMICA", "INMUNOLOGÍA", "UROANÁLISIS", "PARASITOLOGÍA", "OTROS"];
  const expectedHematology = [
    "HEMATIES", "HEMOGLOBINA", "HEMATOCRITO", "LEUCOCITOS", "ABASTONADOS",
    "SEGMENTADOS", "EOSINOFILOS", "BASOFILOS", "MONOCITOS", "LINFOCITOS",
    "PLAQUETAS", "GRUPO Y FACTOR", "T.C.", "T.S.", "V.S.G.",
  ];
  const valid = JSON.stringify(audit.groups) === JSON.stringify(expectedGroups)
    && JSON.stringify(audit.hematology) === JSON.stringify(expectedHematology)
    && audit.active_analyses === 88
    && audit.canonical_versions === 88
    && audit.orphan_selections === 0
    && audit.noncanonical_saved_order === 0
    && audit.hemoglobin_reference === "12.0 - 17.5 g/dL"
    && audit.canonical_order_trigger === true;
  process.stdout.write(`${JSON.stringify({ valid, ...audit }, null, 2)}\n`);
  if (!valid) process.exitCode = 1;
} catch (error) {
  process.stderr.write(`${JSON.stringify({ valid: false, code: error.code, message: error.message }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => undefined);
}
