import process from "node:process";
import pg from "pg";

if (!process.env.LAB_DATABASE_URL) {
  throw new Error("LAB_DATABASE_URL is required");
}

const client = new pg.Client({
  connectionString: process.env.LAB_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const state = await client.query(`
    select
      (select count(*) from public.patients) as patients,
      (select count(*) from public.orders) as orders,
      (select count(*) from public.result_values) as results,
      (select count(*) from public.analyses) as analyses,
      (select count(*) from public.analysis_versions) as versions,
      (
        select count(*)
        from public.orders
        where source_metadata->>'import_kind' = 'historical_results'
      ) as historical_orders,
      (
        select count(*)
        from public.result_values rv
        join public.result_revisions rr on rr.id = rv.revision_id
        join public.orders o on o.id = rr.order_id
        where o.source_metadata->>'import_kind' = 'historical_results'
      ) as historical_results,
      coalesce((
        select jsonb_agg((metadata->>'row')::integer order by (metadata->>'row')::integer)
        from public.patients
        where metadata->>'source' = 'initial_private_seed'
      ), '[]'::jsonb) as source_rows
  `);
  const versions = await client.query(`
    select a.code, a.active, a.result_type, av.version, av.sample_type,
      av.unit, av.method, av.reference_ranges, av.clinical_status
    from public.analysis_versions av
    join public.analyses a on a.id = av.analysis_id
    order by a.code, av.version
  `);
  console.log(JSON.stringify({ ...state.rows[0], analysis_versions: versions.rows }));
} finally {
  await client.end();
}
