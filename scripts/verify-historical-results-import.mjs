import process from "node:process";
import pg from "pg";

const databaseUrl = process.env.LAB_DATABASE_URL;
if (!databaseUrl) throw new Error("LAB_DATABASE_URL is required");

const client = new pg.Client({
  connectionString: databaseUrl,
  ssl: { rejectUnauthorized: false },
});

await client.connect();
try {
  const result = await client.query(`
    with historical_orders as (
      select *
      from public.orders
      where source_metadata->>'import_kind' = 'historical_results'
        and source_metadata->>'workbook' =
          'REGISTRO DIARIO 2026 (version 1).xlsb.xlsm'
        and source_metadata->>'sheet' = 'RESULTADOS'
    ),
    historical_results as (
      select rv.*
      from public.result_values rv
      join public.result_revisions rr on rr.id = rv.revision_id
      join historical_orders ho on ho.id = rr.order_id
    )
    select
      (select count(*) from historical_orders) as orders,
      (select count(distinct patient_id) from historical_orders) as patients,
      (
        select count(*)
        from public.result_revisions rr
        join historical_orders ho on ho.id = rr.order_id
        where rr.status = 'validated' and rr.revision = 1
      ) as validated_revisions,
      (select count(*) from historical_results) as results,
      (
        select count(*)
        from historical_results
        where text_value is not null
          and numeric_value is null
          and qualitative_value is null
          and clinical_snapshot->>'historical_unreviewed' = 'true'
          and clinical_snapshot->>'flag_semantics' = 'not_evaluated'
      ) as safely_unreviewed_results,
      (
        select count(*) - count(distinct (
          source_metadata->>'workbook',
          source_metadata->>'sheet',
          source_metadata->>'row'
        ))
        from historical_orders
      ) as duplicate_source_rows,
      (
        select count(*)
        from public.analysis_versions
        where clinical_status = 'historical_unreviewed'
      ) as historical_versions,
      (
        select count(*)
        from public.analyses a
        join public.analysis_versions av on av.analysis_id = a.id
        where av.clinical_status = 'historical_unreviewed'
          and a.active
          and not exists (
            select 1
            from public.analysis_versions approved
            where approved.analysis_id = a.id
              and approved.clinical_status = 'approved'
          )
      ) as unsafe_active_historical_only_analyses
  `);

  const actual = Object.fromEntries(
    Object.entries(result.rows[0]).map(([key, value]) => [key, Number(value)]),
  );
  const expected = {
    orders: 20,
    patients: 20,
    validated_revisions: 20,
    results: 248,
    safely_unreviewed_results: 248,
    duplicate_source_rows: 0,
    historical_versions: 21,
    unsafe_active_historical_only_analyses: 0,
  };
  const failures = Object.entries(expected)
    .filter(([key, value]) => actual[key] !== value)
    .map(([key, value]) => `${key}: expected ${value}, got ${actual[key]}`);

  if (failures.length) {
    throw new Error(`Historical import verification failed: ${failures.join("; ")}`);
  }
  console.log(JSON.stringify(actual));
} finally {
  await client.end();
}
